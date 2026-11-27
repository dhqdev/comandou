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
import { isMapsLink, mapsPlaceName } from '../common/maps-link';
import { safeFetch, SafeFetchError } from '../common/safe-fetch';
import { one, q } from '../common/sql';
import { open } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AI_KEY_CONTEXT } from './ai.service';
import { availableTokens, loadAiQuota, recordAiUsage } from './ai-quota';
import { chatFallbacks } from './ai-models';
import { ContentPart, OpenRouterClient, OpenRouterError } from './openrouter';
import { parseMenuText } from './menu-text';
import {
  mergeStores,
  PLACE_PROMPT,
  placeQuestion,
  readPlace,
  type PlaceFound,
  type PlaceHint,
} from './place-research';
import { defaultSiteCopy, readSiteCopy, SITE_PAGE_PROMPT, type SiteFacts } from './site-page';
import {
  EMPTY_STORE,
  extractPage,
  LINK_PROMPT,
  metaContent,
  pageForModel,
  PHOTO_STORE_PROMPT,
  TEXT_PROMPT,
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

/** Leitura dos primeiros passos: a loja, os itens e de onde vieram. */
export interface StoreReading {
  categories: ImportedCategory[];
  partial: boolean;
  store: ImportedStore;
  items: number;
  tokens: number;
  /** Achou o restaurante (pesquisa pelo Google Maps ou pelo nome). */
  found?: boolean;
  source?: string | null;
  /** Links do cardápio que a pesquisa achou. */
  links?: string[];
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

  /** Uma pergunta à IA que devolve JSON (com ou sem pesquisa na internet); desconta do limite. */
  private async ask(
    ctx: Ctx,
    prompt: string,
    content: ContentPart[],
    opts: { web?: number; source?: string } = {},
  ) {
    const { c, client } = await this.ready(ctx);
    // Modelo de ler o cardápio (Super Admin › Tokens de IA), que lê PDF e foto.
    const model = c.import_model;
    let result: Awaited<ReturnType<OpenRouterClient['complete']>>;
    try {
      result = await client.complete(
        model,
        [
          { role: 'system', content: prompt },
          { role: 'user', content },
        ],
        {
          json: true,
          maxTokens: 16_000,
          signal: AbortSignal.timeout(150_000),
          ...(opts.web ? { web: opts.web } : {}),
        },
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
      recordAiUsage(tx, {
        userId: ctx.userId,
        model: result.model,
        usage: result.usage,
        source: opts.source ?? 'menu_import',
      }),
    );
    return { c, result, used };
  }

  /** Uma leitura (texto, foto ou PDF) que devolve JSON; desconta do limite do restaurante. */
  private async read(ctx: Ctx, prompt: string, content: ContentPart[], images: string[] = []) {
    const { c, result, used } = await this.ask(ctx, prompt, content);
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
   * Cardápio descrito em texto (itens e preços digitados ou colados). Com a IA desligada, sem
   * limite ou fora do ar, lê as linhas sem IA: o que a pessoa escreveu no site chega igual.
   */
  async fromText(ctx: Ctx, text: string) {
    const local = () => {
      const categories = parseMenuText(text.slice(0, 12_000));
      const items = categories.reduce((n, c) => n + c.items.length, 0);
      if (!items)
        throw new UnprocessableEntityException(
          'Não encontrei itens nesse texto. Escreva um item por linha, com o preço.',
        );
      return { categories, partial: false, store: EMPTY_STORE, items, tokens: 0, withoutAi: true };
    };
    if (!(await this.status(ctx)).enabled) return local();
    let r;
    try {
      r = await this.read(ctx, TEXT_PROMPT, [{ type: 'text', text: text.slice(0, 12_000) }]);
    } catch (e) {
      if (e instanceof ServiceUnavailableException) return local();
      throw e;
    }
    return r.items ? r : local();
  }

  /**
   * Link do cardápio (site, cardápio digital, página do iFood): busca a página, separa texto,
   * imagens, cores e dados estruturados e pede para a IA montar a loja e os itens.
   */
  async fromLink(ctx: Ctx, url: string) {
    if (isMapsLink(url)) return this.fromPlace(ctx, { url });
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
   * O que a página do lugar no Google Maps mostra sem login: o nome e o endereço (título de
   * compartilhamento) e, às vezes, uma foto do lugar (imagem de compartilhamento).
   */
  private async mapsBasics(url: string) {
    let page;
    try {
      page = await safeFetch(url, { maxBytes: 1024 * 1024, truncate: true, timeoutMs: 12_000 });
    } catch {
      page = null;
    }
    const html = page ? page.body.toString('utf8').slice(0, 200_000) : '';
    const [title, ...rest] = (metaContent(html, 'og:title') ?? '').split(' · ');
    const name =
      mapsPlaceName(page?.url ?? url) ?? (title && !/google/i.test(title) ? title : null);
    const address = rest.join(' · ').trim() || null;
    // Foto do lugar (googleusercontent); o mapa estático não serve de capa.
    const img = metaContent(html, 'og:image') ?? '';
    const cover = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(img) ? img : null;
    const cep = address ? (/\b\d{5}-\d{3}\b/.exec(address)?.[0] ?? null) : null;
    const uf = address ? ([...address.matchAll(/ - ([A-Z]{2})\b/g)].pop()?.[1] ?? null) : null;
    const store: ImportedStore = {
      ...EMPTY_STORE,
      name,
      address,
      cep: cep ? cep.replace(/\D/g, '') : null,
      state: uf,
      coverUrl: cover,
    };
    return { store, source: page?.url ?? url };
  }

  /**
   * Achar o restaurante (link do Google Maps ou nome e cidade): a IA pesquisa o lugar na
   * internet (Maps, site, iFood, Instagram) e traz contato, endereço, horário e os links do
   * cardápio; o melhor link é lido em seguida para trazer itens, preços, fotos, logo e cores.
   * Sem IA, só o que o link do Maps mostra. Não achou nada: 422 (a pessoa manda o cardápio).
   */
  async fromPlace(
    ctx: Ctx,
    p: { url?: string; query?: string; city?: string | null },
  ): Promise<StoreReading> {
    const maps = p.url && isMapsLink(p.url) ? await this.mapsBasics(p.url) : null;
    const notFound = () =>
      new UnprocessableEntityException(
        maps?.store.name
          ? `Achei ${maps.store.name} no Google Maps, mas não o cardápio. Mande o PDF, fotos ou o link do cardápio.`
          : 'Não achei o restaurante na internet. Mande o PDF, fotos ou o link do cardápio.',
      );
    const empty = { categories: [] as ImportedCategory[], partial: false, items: 0, tokens: 0 };
    if (!(await this.status(ctx)).enabled) {
      // Sem IA: o Maps dá o nome e o endereço; o cardápio vem depois, por foto ou PDF.
      if (!maps?.store.address) throw notFound();
      return { ...empty, store: maps.store, found: true, source: maps.source };
    }
    const hint: PlaceHint = {
      name: maps?.store.name ?? p.query?.trim() ?? null,
      address: maps?.store.address ?? null,
      city: p.city ?? null,
      state: maps?.store.state ?? null,
      link: p.url ?? null,
    };
    if (!hint.name && !hint.address) throw notFound();
    let place: PlaceFound;
    try {
      const { result } = await this.ask(
        ctx,
        PLACE_PROMPT,
        [{ type: 'text', text: placeQuestion(hint) }],
        { web: 6, source: 'menu_place' },
      );
      place = readPlace(result.text, result.citations);
    } catch (e) {
      // Pesquisa fora do ar: com o Maps lido, segue só com ele.
      if (maps?.store.address && !(e instanceof HttpException && e.getStatus() === 429))
        return { ...empty, store: maps.store, found: true, source: maps.source };
      throw e;
    }
    if (!place.found && !maps?.store.address) throw notFound();
    // O endereço do Maps vale mais que o da pesquisa; o resto completa.
    let store = mergeStores(maps?.store ?? EMPTY_STORE, place.store);
    let categories = place.categories;
    let partial = false;
    let source = maps?.source ?? null;
    // O cardápio: o primeiro link que abrir com itens (cardápio digital, iFood, site).
    for (const link of place.menuLinks.slice(0, 3)) {
      try {
        const r = await this.fromLink(ctx, link);
        const found = 'store' in r ? r.store : null;
        if (!r.items && !found?.logoUrl) continue;
        if (found) store = mergeStores(store, found);
        if (r.items) {
          categories = r.categories;
          partial = r.partial;
          source = link;
          break;
        }
      } catch (e) {
        if (e instanceof HttpException && e.getStatus() === 429) break;
      }
    }
    const items = categories.reduce((n, c) => n + c.items.length, 0);
    return {
      categories,
      partial,
      store,
      items,
      tokens: 0,
      found: true,
      source,
      links: place.menuLinks,
    };
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
    const { c, client } = await this.ready(ctx);
    const prompt = photoPrompt(p.name, p.description ?? null, p.category ?? null);
    // O mesmo modelo de imagem das fotos do item (Super Admin › Tokens de IA), pela API de
    // imagens; se ele não criar por lá, a reserva do servidor (AI_IMAGE_MODEL), pelo chat.
    let model = c.image_model;
    let r: Awaited<ReturnType<OpenRouterClient['image']>>;
    try {
      try {
        r = await client.editImage(model, prompt, null);
      } catch (e) {
        if (!(e instanceof OpenRouterError) || ![400, 404, 405, 422].includes(e.status)) throw e;
        this.logger.warn(`criar pela API de imagens recusado (${e.message}); tentando o outro`);
        model = this.env.AI_IMAGE_MODEL;
        r = await client.image(model, prompt);
      }
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
   * Página do restaurante (<endereço>/site): escreve os textos com a IA a partir do cadastro da
   * loja e do cardápio e guarda. Com a IA desligada, sem limite ou fora do ar, guarda o texto
   * padrão montado com os mesmos dados: a página fica no ar de qualquer jeito.
   */
  async sitePage(ctx: Ctx, tenantName: string) {
    const facts = await this.db.withTenant(ctx, async (tx): Promise<SiteFacts> => {
      const s = await one<{
        about: string | null;
        city: string | null;
        state: string | null;
        accepts_delivery: boolean;
        accepts_pickup: boolean;
        eta_min: number;
        eta_max: number;
      }>(
        tx,
        `SELECT about, city, state, accepts_delivery, accepts_pickup, eta_min, eta_max
           FROM tenant_store_settings`,
      );
      const categories = await q<{ name: string; items: string[] }>(
        tx,
        `SELECT c.name, COALESCE(array_agg(p.name ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL), '{}') AS items
           FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.active
          WHERE c.active GROUP BY c.id ORDER BY c.position, c.name LIMIT 20`,
      );
      return {
        name: tenantName,
        about: s?.about ?? null,
        city: s?.city ?? null,
        state: s?.state ?? null,
        acceptsDelivery: s?.accepts_delivery ?? true,
        acceptsPickup: s?.accepts_pickup ?? true,
        etaMin: s?.eta_min ?? 30,
        etaMax: s?.eta_max ?? 50,
        categories: categories.map((c) => ({ name: c.name, items: c.items.slice(0, 15) })),
      };
    });
    const base = defaultSiteCopy(facts);
    let copy = base;
    let withAi = false;
    if ((await this.status(ctx)).enabled) {
      try {
        const { c, client } = await this.ready(ctx);
        // Só texto: vai pelo modelo da conversa (o mais barato), com a reserva dele.
        const result = await client.complete(
          c.model,
          [
            { role: 'system', content: SITE_PAGE_PROMPT },
            { role: 'user', content: JSON.stringify(facts) },
          ],
          {
            json: true,
            maxTokens: 1200,
            signal: AbortSignal.timeout(60_000),
            fallbacks: chatFallbacks(c.model),
          },
        );
        await this.db.withCentral(ctx, (tx) =>
          recordAiUsage(tx, {
            userId: ctx.userId,
            model: result.model,
            usage: result.usage,
            source: 'site_page',
          }),
        );
        copy = readSiteCopy(result.text, base);
        withAi = true;
      } catch (e) {
        // Sem IA agora: a página nasce com o texto padrão e pode ser refeita depois.
        this.logger.warn(`página do restaurante sem IA: ${(e as Error).message}`);
      }
    }
    await this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `INSERT INTO tenant_store_settings (tenant_id, site, site_updated_at) VALUES ($1, $2, now())
         ON CONFLICT (tenant_id) DO UPDATE SET site = EXCLUDED.site, site_updated_at = now()`,
        [ctx.tenantId, JSON.stringify(copy)],
      ),
    );
    return { copy, withAi };
  }

  /**
   * O site que a IA montou no comandou.com antes do cadastro (loja e cardápio), no mesmo formato
   * da leitura de um link. Já foi pago na geração: não desconta do limite do restaurante.
   */
  async siteDraft(ctx: Ctx) {
    const r = await this.db.withCentral(ctx, (tx) =>
      one<{ draft: Record<string, unknown> | null }>(
        tx,
        `SELECT draft FROM app_tenant_trial_site()`,
      ),
    );
    const d = r?.draft as
      | { store?: ImportedStore; categories?: ImportedCategory[]; suggested?: boolean }
      | null
      | undefined;
    if (!d) return { found: false, store: EMPTY_STORE, categories: [], partial: false, items: 0 };
    const categories = (d.categories ?? []).map((c) => ({
      name: c.name,
      items: c.items.map((i) => ({
        name: i.name,
        description: i.description ?? null,
        price: i.price ?? null,
        imageUrl: i.imageUrl ?? null,
      })),
    }));
    return {
      found: true,
      store: { ...EMPTY_STORE, ...(d.store ?? {}) },
      categories,
      suggested: !!d.suggested,
      partial: false,
      items: categories.reduce((n, c) => n + c.items.length, 0),
    };
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
    // Teste criado pelo site: de onde a pessoa disse que vem o cardápio (link, Maps ou texto).
    const trial = await this.db.withCentral(ctx, (tx) =>
      one<{ sourceKind: string; sourceValue: string; trialEndsAt: Date }>(
        tx,
        `SELECT * FROM app_tenant_trial()`,
      ),
    );
    // Site montado pela IA no comandou.com: os primeiros passos começam por ele.
    const site = trial
      ? await this.db.withCentral(ctx, (tx) =>
          one<{ draft: unknown }>(tx, `SELECT draft FROM app_tenant_trial_site()`),
        )
      : null;
    if (trial) Object.assign(trial, { aiSite: !!site?.draft });
    if (row) return { ...row, trial: trial ?? null };
    return (
      row ?? {
        trial: trial ?? null,
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
