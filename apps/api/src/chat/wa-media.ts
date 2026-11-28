import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  artFonts,
  encodePng,
  logoForArt,
  renderSvgPixels,
  shrink,
} from '../birthdays/birthday-image';
import { q, one } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { decodeImage, ThumbQueue } from '../store/media-thumbs';
import { CARD_MAX_ITEMS, CARD_W, type CardItem, menuCardSvg } from './wa-menu-card';
import { clean, type FlowCategory, money } from './wa-flow';

type JpegEnc = typeof import('@jsquash/jpeg/encode.js');
let jpeg: Promise<JpegEnc> | null = null;

/** Codificador JPEG (WebAssembly, uma vez por processo). */
function jpegEnc() {
  jpeg ??= (async () => {
    const m = (await import('@jsquash/jpeg/encode.js')) as JpegEnc;
    const wasm = new WebAssembly.Module(
      readFileSync(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')),
    );
    await (m.init as unknown as (w: WebAssembly.Module) => Promise<void>)(wasm);
    return m;
  })().catch((e: unknown) => {
    jpeg = null;
    throw e;
  });
  return jpeg;
}

async function toJpeg(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
  quality: number,
) {
  const out = await (
    await jpegEnc()
  ).default(
    {
      data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      width,
      height,
      colorSpace: 'srgb',
    } as ImageData,
    { quality },
  );
  return Buffer.from(out);
}

/** Fundo branco por baixo (JPEG não tem transparência; PNG de logo/foto recortada ficaria preto). */
function flatten(rgba: Uint8Array | Uint8ClampedArray) {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]! / 255;
    out[i] = Math.round(rgba[i]! * a + 255 * (1 - a));
    out[i + 1] = Math.round(rgba[i + 1]! * a + 255 * (1 - a));
    out[i + 2] = Math.round(rgba[i + 2]! * a + 255 * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

/** Guarda poucas imagens prontas (a mais usada fica; a mais antiga sai). */
class Lru {
  private readonly map = new Map<string, Buffer>();
  constructor(private readonly max: number) {}
  get(k: string) {
    const v = this.map.get(k);
    if (v) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: Buffer) {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  dropTenant(tenantId: string) {
    for (const k of this.map.keys()) if (k.startsWith(`${tenantId}:`)) this.map.delete(k);
  }
}

/**
 * Imagens do atendimento por menu no WhatsApp (0.280): o cartão de cada categoria (fotos dos itens
 * com o número, nome, preço e selo, na cor da loja) e a foto de um item. Tudo em WebAssembly, sem
 * dependência nativa. Montar trava a linha do Node por alguns décimos de segundo, então vai numa
 * fila de um por vez; com a fila cheia, a mensagem sai só com o texto (nunca atrasa a conversa).
 * Imagem pronta fica em memória pela "cara" do cardápio (mudou nome, preço, foto ou esgotou,
 * monta de novo).
 */
@Injectable()
export class WaMediaService {
  private readonly logger = new Logger('WaMedia');
  private readonly cards = new Lru(48);
  private readonly photos = new Lru(120);
  private readonly queue = new ThumbQueue(4, 1);

  constructor(
    private readonly db: DatabaseService,
    realtime: RealtimeService,
  ) {
    realtime.onCacheClear((tenantId) => this.forget(tenantId));
  }

  /** O restaurante mudou o cardápio pelo painel (limpeza de cache): monta de novo. */
  forget(tenantId: string) {
    this.cards.dropTenant(tenantId);
    this.photos.dropTenant(tenantId);
  }

  /** Cartão da categoria em JPEG, ou null (sem fotos, fila cheia ou erro: vai só o texto). */
  async categoryCard(
    tenantId: string,
    o: { store: string; category: FlowCategory; showPrices: boolean },
  ): Promise<Buffer | null> {
    const items = o.category.items.slice(0, CARD_MAX_ITEMS);
    // Categoria sem nenhuma foto: o cartão não acrescenta nada à lista.
    if (!items.some((it) => it.imageId)) return null;
    const brand = await this.brand(tenantId);
    const key = `${tenantId}:card:${createHash('sha256')
      .update(
        JSON.stringify([
          o.store,
          o.category.name,
          o.showPrices,
          brand,
          o.category.items.length,
          items.map((it) => [it.id, it.name, it.price, it.soldOut, it.imageId, it.badge]),
        ]),
      )
      .digest('base64url')}`;
    const hit = this.cards.get(key);
    if (hit) return hit;
    if (this.queue.busy) return null;
    try {
      return await this.queue.run(key, async () => {
        const photos = await this.thumbs(
          tenantId,
          items.map((it) => it.imageId).filter((id): id is string => !!id),
        );
        const logo = brand.logo
          ? await logoForArt(await this.media(tenantId, brand.logo, 320))
          : null;
        const cardItems: CardItem[] = items.map((it, k) => ({
          n: k + 1,
          name: clean(it.name),
          price: o.showPrices ? `${money(it.price)}${it.soldByWeight ? '/kg' : ''}` : null,
          badge: it.badge ? clean(it.badge).slice(0, 24) : null,
          soldOut: it.soldOut,
          photo: (it.imageId && photos.get(it.imageId)) || null,
        }));
        const fonts = await artFonts();
        const { svg } = menuCardSvg(
          {
            store: clean(o.store),
            category: clean(o.category.name),
            color: brand.color,
            logo,
            items: cardItems,
            more: Math.max(0, o.category.items.length - items.length),
          },
          { body: fonts.body, bold: fonts.bold },
        );
        const img = await renderSvgPixels(svg, CARD_W);
        const out = await toJpeg(img.width, img.height, flatten(img.pixels), 80);
        this.cards.set(key, out);
        return out;
      });
    } catch (e) {
      this.logger.warn(`Cartão do cardápio (${tenantId}): ${(e as Error).message}`);
      return null;
    }
  }

  /** Foto do item em JPEG (até 900 px), ou null. */
  async itemPhoto(tenantId: string, imageId: string | null | undefined): Promise<Buffer | null> {
    if (!imageId) return null;
    const key = `${tenantId}:photo:${imageId}`;
    const hit = this.photos.get(key);
    if (hit) return hit;
    if (this.queue.busy) return null;
    try {
      return await this.queue.run(key, async () => {
        const m = await this.media(tenantId, imageId, 640);
        if (!m) return null;
        let out: Buffer;
        if (m.type === 'image/jpeg' && m.bytes.length <= 400_000) out = m.bytes;
        else {
          const img = await decodeImage(m.type, m.bytes);
          const s = shrink(img.width, img.height, img.data, 900);
          out = await toJpeg(s.width, s.height, flatten(s.data), 84);
        }
        this.photos.set(key, out);
        return out;
      });
    } catch (e) {
      this.logger.warn(`Foto do item (${tenantId}): ${(e as Error).message}`);
      return null;
    }
  }

  /** Cor e logo da loja (tela Loja online). */
  private async brand(tenantId: string) {
    const r = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ color: string | null; logo: string | null }>(
        tx,
        `SELECT COALESCE(brand_color, accent_color) AS color, logo_image_id AS logo
           FROM tenant_store_settings LIMIT 1`,
      ),
    );
    return { color: r?.color ?? '#e8590c', logo: r?.logo ?? null };
  }

  /** A miniatura guardada (ou a original, se ainda não tem) de uma foto. */
  private async media(tenantId: string, id: string, w: 320 | 640) {
    const r = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ type: string; bytes: Buffer }>(
        tx,
        `SELECT COALESCE(t.content_type, m.content_type) AS type, COALESCE(t.bytes, m.bytes) AS bytes
           FROM media m LEFT JOIN media_thumbs t ON t.media_id = m.id AND t.width = $2
          WHERE m.id = $1`,
        [id, w],
      ),
    );
    return r ? { type: r.type, bytes: r.bytes } : null;
  }

  /** Fotos dos itens do cartão, pequenas e em PNG (data URI), pelo id da foto. */
  private async thumbs(tenantId: string, ids: string[]) {
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const rows = await this.db.withTenant({ tenantId }, (tx) =>
      q<{ id: string; type: string; bytes: Buffer }>(
        tx,
        `SELECT m.id, COALESCE(t.content_type, m.content_type) AS type,
                COALESCE(t.bytes, m.bytes) AS bytes
           FROM media m LEFT JOIN media_thumbs t ON t.media_id = m.id AND t.width = 320
          WHERE m.id = ANY($1::uuid[])`,
        [ids],
      ),
    );
    for (const r of rows) {
      try {
        const img = await decodeImage(r.type, r.bytes);
        const s = shrink(img.width, img.height, img.data, 360);
        out.set(
          r.id,
          `data:image/png;base64,${encodePng(s.width, s.height, s.data).toString('base64')}`,
        );
      } catch {
        /* foto que não abre: o cartão usa a inicial do item */
      }
    }
    return out;
  }
}
