import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Ctx } from '../common/context';
import { sniff } from '../common/file-sniff';
import { safeFetch, SafeFetchError } from '../common/safe-fetch';
import { one } from '../common/sql';
import { open } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AI_KEY_CONTEXT } from './ai.service';
import { availableTokens, loadAiQuota, recordAiUsage } from './ai-quota';
import { ContentPart, OpenRouterClient, OpenRouterError } from './openrouter';
import {
  EMPTY_STORE,
  extractPage,
  LINK_PROMPT,
  pageForModel,
  PHOTO_STORE_PROMPT,
  photoPrompt,
  readBox,
  readStore,
  type Box,
  type ImportedStore,
} from './store-import';

export interface ImportedItem {
  name: string;
  description: string | null;
  /** Preço em reais com duas casas ("24.90"); null quando o cardápio não mostra. */
  price: string | null;
  /** Foto do item na página do link (endereço da imagem). */
  imageUrl?: string | null;
  /** Foto do item dentro da foto do cardápio (0–1000: topo, esquerda, baixo, direita). */
  photoBox?: Box | null;
}
export interface ImportedCategory {
  name: string;
  items: ImportedItem[];
}

export const IMPORT_MAX_BYTES = 3 * 1024 * 1024;
const MAX_ITEMS = 300;

const PROMPT = `Você lê cardápios de restaurantes brasileiros (foto do cardápio, foto de um prato ou PDF) e devolve os itens organizados.

Responda SOMENTE com JSON neste formato:
{"categories":[{"name":"Nome da categoria","items":[{"name":"Nome do item","description":"descrição curta ou null","price":"24.90 ou null"}]}]}

Regras:
- Copie nomes, descrições e preços como estão escritos. Não invente item, descrição nem preço.
- "price" é o preço em reais com ponto e duas casas, sem "R$" (ex.: "24.90"). Sem preço visível: null.
- Item com tamanhos ou variações de preço (P, M, G; 300 ml, 500 ml): crie um item para cada, com o tamanho no nome ("Pizza Calabresa G").
- Use as categorias do próprio cardápio (Lanches, Pizzas, Bebidas...). Se não houver, agrupe pelo tipo do item.
- Nomes com a primeira letra maiúscula, sem tudo em maiúsculas.
- Foto de um único prato, sem texto: devolva um item com o nome mais provável do prato, uma descrição curta do que aparece e "price": null, na categoria que fizer sentido.
- Se não houver comida, bebida nem cardápio na imagem, devolva {"categories":[]}.`;

const clip = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** "R$ 24,90", "24.9", 24.9 → "24.90"; o que não for preço vira null. */
export function parsePrice(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  // Vírgula decimal brasileira: "1.234,50" → "1234.50".
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 99_999) return null;
  return n.toFixed(2);
}

/**
 * Lê o JSON do modelo. Cardápio grande pode estourar o limite de resposta e o JSON chega cortado
 * no meio de um item: nesse caso aproveita tudo o que veio inteiro até ali (`partial`).
 */
export function parseImportJson(raw: string): { json: unknown; partial: boolean } | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  const end = raw.lastIndexOf('}');
  if (end > start) {
    try {
      return { json: JSON.parse(raw.slice(start, end + 1)), partial: false };
    } catch {
      // segue para o conserto abaixo
    }
  }
  // Volta de "}" em "}" (fim de um item ou de uma categoria) e fecha o que ficou aberto.
  let cut = raw.length;
  for (let tries = 0; tries < 400; tries++) {
    cut = raw.lastIndexOf('}', cut - 1);
    if (cut <= start) return null;
    const head = raw.slice(start, cut + 1);
    for (const tail of [']}]}', ']}']) {
      try {
        return { json: JSON.parse(head + tail), partial: true };
      } catch {
        // tenta o próximo
      }
    }
  }
  return null;
}

/** Limpa o que o modelo devolveu: só o formato esperado, com limites de tamanho. */
export function readImport(
  raw: string,
  images: string[] = [],
): { categories: ImportedCategory[]; partial: boolean; store: ImportedStore } {
  const parsed = parseImportJson(raw);
  if (!parsed) return { categories: [], partial: false, store: EMPTY_STORE };
  const store = readStore((parsed.json as { store?: unknown } | null)?.store, images);
  const cats = (parsed.json as { categories?: unknown } | null)?.categories;
  if (!Array.isArray(cats)) return { categories: [], partial: false, store };
  const usedImages = new Set<string>();
  const out: ImportedCategory[] = [];
  let total = 0;
  for (const c of cats) {
    const name = clip((c as { name?: unknown })?.name, 60) || 'Cardápio';
    const items: ImportedItem[] = [];
    const list = (c as { items?: unknown })?.items;
    for (const it of Array.isArray(list) ? list : []) {
      if (total >= MAX_ITEMS) break;
      const n = clip((it as { name?: unknown })?.name, 120);
      if (!n) continue;
      const item: ImportedItem = {
        name: n,
        description: clip((it as { description?: unknown })?.description, 500) || null,
        price: parsePrice((it as { price?: unknown })?.price),
      };
      const ix = Number((it as { image?: unknown })?.image);
      const url = Number.isInteger(ix) && ix >= 0 ? images[ix] : undefined;
      // A mesma foto em dois itens é logo ou banner, não foto do prato.
      if (url && url !== store.logoUrl && !usedImages.has(url)) {
        usedImages.add(url);
        item.imageUrl = url;
      }
      const box = readBox((it as { photo?: unknown })?.photo);
      if (box) item.photoBox = box;
      items.push(item);
      total++;
    }
    if (!items.length) continue;
    const same = out.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (same) same.items.push(...items);
    else out.push({ name, items });
  }
  return { categories: out, partial: parsed.partial || total >= MAX_ITEMS, store };
}

/**
 * Importar o cardápio com IA: a pessoa manda a foto do cardápio, a foto de um prato ou um PDF e
 * o modelo devolve categorias, itens, descrições e preços para ela conferir antes de salvar.
 * Usa a chave do OpenRouter do painel Super Admin e desconta do limite de tokens do restaurante
 * (fonte "menu_import" no extrato de uso).
 */
@Injectable()
export class MenuImportService {
  private readonly logger = new Logger('MenuImportService');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
  ) {}

  /** A tela pergunta antes de oferecer a importação: está ligada e ainda há tokens? */
  async status(ctx: Ctx) {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    const c = qt.config;
    const reason =
      !c.enabled || !c.api_key_enc || !this.env.INTEGRATIONS_KEY
        ? 'platform'
        : !c.tenant_enabled
          ? 'tenant'
          : qt.blocked
            ? 'limit'
            : null;
    return {
      enabled: reason === null,
      reason,
      assistantName: c.assistant_name,
      usage: {
        used: qt.used,
        limit: c.monthly_tokens,
        bonus: c.bonus_tokens,
        available: availableTokens(c.monthly_tokens, qt.used, c.bonus_tokens),
      },
    };
  }

  /** Chave e limites da IA conferidos; o cliente pronto para chamar o OpenRouter. */
  private async ready(ctx: Ctx) {
    const qt = await this.db.withCentral(ctx, (tx) => loadAiQuota(tx));
    const c = qt.config;
    if (!c.enabled || !c.api_key_enc || !this.env.INTEGRATIONS_KEY)
      throw new ServiceUnavailableException(
        'A importação com IA ainda não foi ligada pelo Comandou',
      );
    if (!c.tenant_enabled)
      throw new ServiceUnavailableException('A IA está desligada para este restaurante');
    if (qt.blocked)
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'ai_limit',
          message: 'O limite de uso da IA neste mês acabou. Fale com o suporte do Comandou.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    let apiKey: string;
    try {
      apiKey = open(this.env.INTEGRATIONS_KEY, c.api_key_enc, AI_KEY_CONTEXT);
    } catch {
      throw new ServiceUnavailableException('A chave da IA precisa ser salva de novo no painel');
    }
    return { c, client: new OpenRouterClient(this.env.OPENROUTER_BASE_URL, apiKey) };
  }

  /** Uma leitura (texto, foto ou PDF) que devolve JSON; desconta do limite do restaurante. */
  private async read(ctx: Ctx, prompt: string, content: ContentPart[], images: string[] = []) {
    const { c, client } = await this.ready(ctx);
    const model = this.env.AI_IMPORT_MODEL;
    let result: Awaited<ReturnType<OpenRouterClient['complete']>>;
    try {
      result = await client.complete(
        model,
        [
          { role: 'system', content: prompt },
          { role: 'user', content },
        ],
        { json: true, maxTokens: 16_000, signal: AbortSignal.timeout(150_000) },
      );
    } catch (e) {
      this.logger.warn(`importação do cardápio falhou: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        e instanceof OpenRouterError
          ? 'A IA não respondeu agora. Tente de novo em instantes.'
          : 'Não deu para falar com a IA. Tente de novo em instantes.',
      );
    }
    const used = await this.db.withCentral(ctx, (tx) =>
      recordAiUsage(tx, { userId: ctx.userId, model, usage: result.usage, source: 'menu_import' }),
    );
    const { categories, partial, store } = readImport(result.text, images);
    return {
      categories,
      /** O cardápio era grande demais para uma leitura só: veio até onde deu. */
      partial,
      store,
      items: categories.reduce((n, cat) => n + cat.items.length, 0),
      tokens: result.usage.promptTokens + result.usage.completionTokens,
      usage: {
        used: used.usedMonth,
        limit: c.monthly_tokens,
        bonus: used.bonusLeft,
        available: availableTokens(c.monthly_tokens, used.usedMonth, used.bonusLeft),
      },
    };
  }

  /**
   * Foto ou PDF do cardápio. Com `store` (primeiros passos), lê também os dados da loja, as
   * cores e onde estão o logo e a foto de cada item na imagem.
   */
  async analyze(ctx: Ctx, file: Buffer, mime: string, store = false) {
    if (file.length === 0 || file.length > IMPORT_MAX_BYTES)
      throw new UnprocessableEntityException('Arquivo vazio ou maior que 3 MB');
    const isPdf = mime === 'application/pdf';
    if (isPdf ? file.toString('latin1', 0, 5) !== '%PDF-' : sniff(file) !== mime)
      throw new UnprocessableEntityException('Envie uma foto (JPG, PNG, WebP) ou um PDF');
    const data = `data:${mime};base64,${file.toString('base64')}`;
    const attachment: ContentPart = isPdf
      ? { type: 'file', file: { filename: 'cardapio.pdf', file_data: data } }
      : { type: 'image_url', image_url: { url: data } };
    const r = await this.read(ctx, store ? PHOTO_STORE_PROMPT : PROMPT, [
      { type: 'text', text: 'Leia este cardápio e devolva o JSON.' },
      attachment,
    ]);
    if (!store) {
      // A importação do cardápio (Cardápio › Itens) segue com o formato de antes.
      const { store: _s, ...rest } = r;
      return { ...rest, categories: r.categories.map(stripExtras) };
    }
    return r;
  }

  /**
   * Link do cardápio (site, cardápio digital, página do iFood): busca a página, separa texto,
   * imagens, cores e dados estruturados e pede para a IA montar a loja e os itens.
   */
  async fromLink(ctx: Ctx, url: string) {
    let page;
    try {
      page = await safeFetch(url, { maxBytes: 4 * 1024 * 1024, truncate: true, timeoutMs: 20_000 });
    } catch (e) {
      throw new UnprocessableEntityException(
        e instanceof SafeFetchError ? e.message : 'Não consegui abrir esse link',
      );
    }
    if (page.status >= 400)
      throw new UnprocessableEntityException(
        page.status === 404
          ? 'Essa página não existe. Confira o link.'
          : 'O site não deixou ler a página. Mande prints ou fotos do cardápio.',
      );
    if (page.contentType === 'application/pdf')
      return this.analyze(ctx, page.body.subarray(0, IMPORT_MAX_BYTES), 'application/pdf', true);
    if (page.contentType.startsWith('image/')) {
      const mime = sniff(page.body);
      if (!mime) throw new UnprocessableEntityException('Esse link não é de uma página nem foto');
      return this.analyze(ctx, page.body, mime, true);
    }
    const info = extractPage(page.body.toString('utf8'), page.url);
    if (info.text.length < 40 && !info.dataJson && !info.jsonLd)
      throw new UnprocessableEntityException(
        'Essa página não mostra o cardápio sem login ou app. Mande prints ou fotos do cardápio.',
      );
    const r = await this.read(
      ctx,
      LINK_PROMPT,
      [{ type: 'text', text: pageForModel(info) }],
      info.images,
    );
    // Sem logo apontado pela IA: o maior ícone do site (apple-touch-icon) serve.
    const store: ImportedStore = {
      ...r.store,
      brandColor: r.store.brandColor ?? info.themeColor,
      logoUrl: r.store.logoUrl ?? info.icons[0] ?? null,
      coverUrl: r.store.coverUrl ?? info.ogImage,
      faviconUrl: info.icons[0] ?? null,
    };
    if (!r.items && !store.name && !store.address)
      throw new UnprocessableEntityException(
        'Não encontrei o cardápio nesse link. Mande prints ou fotos do cardápio.',
      );
    return { ...r, store, source: page.url };
  }

  /**
   * Foto de uma página externa (logo, capa, foto do item) para o navegador reduzir e guardar
   * pelo envio normal de fotos. Só imagem JPG, PNG ou WebP, até 6 MB.
   */
  async image(url: string): Promise<{ mime: string; body: Buffer }> {
    let r;
    try {
      r = await safeFetch(url, {
        maxBytes: 6 * 1024 * 1024,
        accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8',
        timeoutMs: 15_000,
      });
    } catch (e) {
      throw new UnprocessableEntityException(
        e instanceof SafeFetchError ? e.message : 'Não consegui baixar a foto',
      );
    }
    const mime = r.status < 400 ? sniff(r.body) : null;
    if (!mime) throw new UnprocessableEntityException('Esse endereço não é de uma foto');
    return { mime, body: r.body };
  }

  /** Foto ilustrativa de um item sem foto, criada pela IA (desconta do limite). */
  async photo(
    ctx: Ctx,
    p: { name: string; description?: string | null; category?: string | null },
  ): Promise<{ mime: string; body: Buffer }> {
    const { client } = await this.ready(ctx);
    const model = this.env.AI_IMAGE_MODEL;
    let r: Awaited<ReturnType<OpenRouterClient['image']>>;
    try {
      r = await client.image(model, photoPrompt(p.name, p.description ?? null, p.category ?? null));
    } catch (e) {
      this.logger.warn(`foto do item falhou: ${(e as Error).message}`);
      throw new ServiceUnavailableException('A IA não conseguiu criar a foto agora');
    }
    await this.db.withCentral(ctx, (tx) =>
      recordAiUsage(tx, { userId: ctx.userId, model, usage: r.usage, source: 'menu_photo' }),
    );
    const mime = sniff(r.bytes);
    if (!mime) throw new ServiceUnavailableException('A IA devolveu uma foto que não deu para ler');
    return { mime, body: r.bytes };
  }

  /**
   * O que foi informado no cadastro do restaurante (painel do Comandou): telefone, cidade, UF,
   * razão social e responsável. Os primeiros passos usam para preencher a loja sozinhos.
   */
  async signup(ctx: Ctx) {
    const row = await this.db.withCentral(ctx, (tx) =>
      one<{
        name: string;
        legalName: string | null;
        document: string | null;
        contactName: string | null;
        phone: string | null;
        email: string | null;
        city: string | null;
        state: string | null;
      }>(tx, `SELECT * FROM app_tenant_signup_profile()`),
    );
    return (
      row ?? {
        name: null,
        legalName: null,
        document: null,
        contactName: null,
        phone: null,
        email: null,
        city: null,
        state: null,
      }
    );
  }
}

/** Sem os campos novos (foto e caixa), para quem usa a importação de antes. */
const stripExtras = (c: ImportedCategory): ImportedCategory => ({
  name: c.name,
  items: c.items.map(({ name, description, price }) => ({ name, description, price })),
});
