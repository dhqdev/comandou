import { readImport, type ImportedItem } from '../../chat/menu-import.service';
import { mergeStores } from '../../chat/place-research';
import type { StockGuess, StockItemIn } from '../../chat/stock-guess';
import type { ImportedStore } from '../../chat/store-import';

/**
 * Site com IA (comandou.com): o pedido para o modelo e a limpeza do que ele devolve. Funções
 * puras; quem busca a página e chama o OpenRouter é o SiteAiService.
 */

export type SiteAiKind = 'site' | 'maps' | 'text';

/**
 * Item do rascunho. `stock`: o estoque inicial sugerido pela IA (null = não controlar; sem o
 * campo = ainda não sugerido).
 */
export type DraftItem = ImportedItem & { stock?: StockGuess | null };
export interface DraftCategory {
  name: string;
  items: DraftItem[];
}

/** Rascunho do site: a loja, o cardápio e a frase de abertura. Vai junto com o teste. */
export interface SiteDraft {
  store: ImportedStore;
  categories: DraftCategory[];
  /** Frase curta para o topo da loja ("Smash burger na brasa desde 2019"). */
  tagline: string | null;
  /** O lugar não mostrou cardápio: os itens são sugestões da IA, sem preço. */
  suggested: boolean;
  /** Cardápio enviado no site: quantas páginas (fotos ou PDFs) já foram lidas. */
  pages?: number;
  /** Campo único da criação (0.279): CNPJ/CPF e razão social que a IA achou no que veio. */
  legal?: DraftLegal;
  /** Quantas mensagens e arquivos já entraram neste rascunho, e o que cada arquivo era. */
  parts?: number;
  files?: string[];
}

/** Dados da empresa para o cadastro e o contrato (só o que estava escrito). */
export interface DraftLegal {
  document: string | null;
  legalName: string | null;
}

export const SITE_PROMPT = `Você cria a loja online (cardápio digital) de um restaurante brasileiro a partir do que se sabe dele: a página do site, o nome e o endereço que vieram do Google Maps, ou o que o dono escreveu. As imagens da página aparecem no texto como [img N].

Responda SOMENTE com JSON neste formato:
{"store":{"name":"nome da loja","tagline":"frase curta para o topo da loja","about":"duas frases sobre a loja","whatsapp":"telefone com DDD ou null","address":"rua, número e bairro ou null","city":"cidade ou null","state":"UF ou null","hours":[{"day":0,"open":"18:00","close":"23:00"}],"brandColor":"#rrggbb","accentColor":"#rrggbb","logo":"número N da imagem do logo ou null","cover":"número N de uma foto boa para capa ou null"},"suggested":false,"categories":[{"name":"Nome da categoria","items":[{"name":"Nome do item","description":"descrição curta","price":"24.90 ou null","image":"número N da foto do item ou null"}]}]}

Regras da loja:
- "tagline": até 60 caracteres, no tom de um restaurante de verdade, sem exagero nem emoji. Ex.: "Smash burger na chapa, do jeito certo".
- "about": até 220 caracteres, o que a casa serve e o jeito dela. Não invente prêmios, datas nem números.
- Telefone, endereço e horário: só o que estiver escrito. Não invente. Sem horário: [].
- "hours": um turno por dia (0 = domingo ... 6 = sábado), "open" e "close" em HH:MM.
- "brandColor": a cor principal da marca (logo, títulos, botões). Sem marca clara, escolha uma cor que combine com o tipo de comida (ex.: vermelho queimado para hamburgueria, verde para comida natural). Nunca branco, preto ou cinza. "accentColor": outra cor que combine, diferente da principal.
- "logo" e "cover": só com certeza, senão null.

Regras do cardápio:
- Havendo cardápio na fonte, copie nomes e preços como estão escritos. "price" em reais com ponto e duas casas, sem "R$" ("24.90"); sem preço: null. Tamanhos diferentes viram itens diferentes ("Pizza Calabresa G").
- Item sem descrição: escreva uma descrição curta (até 70 caracteres) só com o que o nome deixa claro. Não invente ingrediente improvável.
- Categorias do próprio cardápio; sem elas, agrupe pelo tipo (Lanches, Pizzas, Porções, Bebidas, Sobremesas...).
- Nomes com a primeira letra maiúscula, sem tudo em maiúsculas.
- A fonte não mostra cardápio nenhum (só nome e endereço, por exemplo): sugira de 6 a 10 itens típicos para esse tipo de lugar, em 2 a 4 categorias, todos com "price": null, e responda "suggested": true.`;

/** Texto que vai para o modelo quando só se sabe o nome (e o endereço) do lugar. */
export function placeForModel(name: string | null, address: string | null, link: string): string {
  return [
    'Fonte: Google Maps (não mostra o cardápio).',
    'Pesquise este lugar na internet (Google Maps, site oficial, iFood, Instagram) e use o que achar dele: telefone, endereço, horário e o cardápio de verdade com os preços. Só sugira itens se não achar o cardápio.',
    name && `Nome do lugar: ${name}`,
    address && `Endereço: ${address}`,
    `Link: ${link}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const clip = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) || null : null;

/** Limpa a resposta do modelo; `images` traduz o [img N] da página. */
export function readSiteDraft(raw: string, images: string[] = []): SiteDraft {
  const r = readImport(raw, images);
  let tagline: string | null = null;
  let suggested = false;
  try {
    const start = raw.indexOf('{');
    const j = JSON.parse(raw.slice(start, raw.lastIndexOf('}') + 1)) as {
      store?: { tagline?: unknown };
      suggested?: unknown;
    };
    tagline = clip(j.store?.tagline, 80);
    suggested = j.suggested === true;
  } catch {
    const m = /"tagline"\s*:\s*"([^"]{1,200})"/.exec(raw);
    tagline = clip(m?.[1], 80);
  }
  const categories = r.categories.slice(0, 30).map((c) => ({
    name: c.name,
    // Sugestão nunca chega com preço: quem define é o dono.
    items: c.items.slice(0, 60).map((i) => ({ ...i, price: suggested ? null : i.price })),
  }));
  return {
    store: { ...r.store, about: r.store.about ?? tagline },
    categories,
    tagline,
    suggested,
  };
}

export const draftItems = (d: SiteDraft) => d.categories.reduce((n, c) => n + c.items.length, 0);

/** O que o navegador do visitante recebe para mostrar no celular (o rascunho fica no banco). */
export function publicDraft(d: SiteDraft) {
  return {
    name: d.store.name,
    tagline: d.tagline,
    about: d.store.about,
    brandColor: d.store.brandColor,
    accentColor: d.store.accentColor,
    logoUrl: d.store.logoUrl,
    coverUrl: d.store.coverUrl,
    suggested: d.suggested,
    items: draftItems(d),
    categories: d.categories.slice(0, 6).map((c) => ({
      name: c.name,
      items: c.items.slice(0, 6).map((i) => ({
        name: i.name,
        description: i.description,
        price: i.price,
        imageUrl: i.imageUrl ?? null,
      })),
    })),
  };
}

// ------------------------------------------------------------------ cardápio enviado no site

/** Páginas de um mesmo cardápio enviadas no site (foto ou PDF, uma por vez). */
export const MENU_MAX_PAGES = 8;
const MAX_CATEGORIES = 30;
const MAX_MENU_ITEMS = 300;

const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Limpa a leitura de uma página do cardápio (foto ou PDF) enviada no site. */
export function readMenuDraft(raw: string): SiteDraft {
  const r = readImport(raw);
  return {
    store: { ...r.store, logoUrl: null, logoBox: null, coverUrl: null, faviconUrl: null },
    categories: r.categories.slice(0, MAX_CATEGORIES).map((c) => ({
      name: c.name,
      // O arquivo não fica guardado: sem caixa de foto para recortar depois.
      items: c.items.map(({ name, description, price }) => ({ name, description, price })),
    })),
    tagline: null,
    suggested: false,
    pages: 1,
  };
}

/**
 * Junta uma página nova ao cardápio já lido: categoria de mesmo nome recebe os itens, item
 * repetido (mesmo nome) fica de fora, e os dados da loja que faltavam entram.
 */
export function mergeMenuDrafts(a: SiteDraft, b: SiteDraft): SiteDraft {
  const categories = a.categories.map((c) => ({ name: c.name, items: [...c.items] }));
  const seen = new Set(categories.flatMap((c) => c.items.map((i) => key(i.name))));
  let total = seen.size;
  for (const c of b.categories) {
    let into = categories.find((x) => key(x.name) === key(c.name));
    for (const it of c.items) {
      if (total >= MAX_MENU_ITEMS || seen.has(key(it.name))) continue;
      if (!into) {
        if (categories.length >= MAX_CATEGORIES) break;
        into = { name: c.name, items: [] };
        categories.push(into);
      }
      into.items.push(it);
      seen.add(key(it.name));
      total++;
    }
  }
  return {
    ...a,
    store: mergeStores(a.store, b.store),
    categories,
    pages: (a.pages ?? 1) + (b.pages ?? 1),
  };
}

/** Itens que ainda não têm a sugestão de estoque (no máximo 120 por pedido à IA). */
export function stockTargets(d: SiteDraft, max = 120): StockItemIn[] {
  const out: StockItemIn[] = [];
  for (const c of d.categories)
    for (const it of c.items)
      if (it.stock === undefined && out.length < max)
        out.push({ name: it.name, category: c.name, price: it.price, description: it.description });
  return out;
}

/**
 * Põe a sugestão de estoque nos itens pelo nome (o cardápio pode ter ganhado páginas enquanto a
 * IA pensava). O que a IA não respondeu fica sem, para pedir de novo.
 */
export function applyStock(
  d: SiteDraft,
  targets: StockItemIn[],
  guesses: (StockGuess | null | undefined)[],
): SiteDraft {
  const byName = new Map<string, StockGuess | null>();
  targets.forEach((t, i) => {
    const g = guesses[i];
    if (g !== undefined) byName.set(key(t.name), g);
  });
  return {
    ...d,
    categories: d.categories.map((c) => ({
      name: c.name,
      items: c.items.map((it) => {
        const g = byName.get(key(it.name));
        return it.stock === undefined && g !== undefined ? { ...it, stock: g } : it;
      }),
    })),
  };
}

/** O cardápio inteiro para a janela de criar (itens, preços e o estoque sugerido). */
export function publicMenu(d: SiteDraft) {
  return {
    items: draftItems(d),
    suggested: d.suggested,
    /** Ainda falta a sugestão de estoque de algum item. */
    stockPending: stockTargets(d).length > 0,
    store: {
      name: d.store.name,
      whatsapp: d.store.whatsapp,
      address: d.store.address,
      city: d.store.city,
      hours: d.store.hours.length,
    },
    categories: d.categories.map((c) => ({
      name: c.name,
      items: c.items.map((i) => ({
        name: i.name,
        description: i.description,
        price: i.price,
        stock: i.stock,
      })),
    })),
  };
}

// ------------------------------------------------------------------ campo único (0.279)

/**
 * Pedido do David (0.279): no site, uma barra só para mandar tudo sobre o restaurante (texto,
 * links, fotos, PDF) e a IA vai montando a loja: logo, nome, endereço de entrega, cardápio com os
 * preços, CNPJ/CPF. Cada mensagem ou arquivo é lido uma vez e somado ao rascunho.
 */
export const COMPOSE_PROMPT = `${SITE_PROMPT}

Agora a loja chega aos poucos: o dono manda o que tiver (texto, links já abertos aqui como páginas, fotos e PDFs, um de cada vez). Leia SÓ a parte nova abaixo; o sistema junta com o que já se sabe.
No "store", além dos campos acima, inclua:
"document":"CNPJ (14 números) ou CPF (11 números) do restaurante, só se estiver escrito, senão null",
"legalName":"razão social, só se estiver escrita, senão null",
"cep":"CEP só com números ou null"
E, na raiz do JSON, "file": o que é o arquivo anexado ("logo" = só a marca; "menu" = cardápio; "cover" = foto da fachada, do salão ou de um prato para a capa; "document" = cartão do CNPJ, contrato ou nota; "other"), ou null sem arquivo.
- Endereço para entrega: rua, número e bairro em "address"; cidade e UF separadas.
- Nunca invente CNPJ, CPF, razão social, telefone ou endereço.
- Se a parte nova é só um logo, uma foto de capa, um documento ou um texto sem itens, responda "categories": [] e "suggested": false (não sugira itens).`;

/** Dígitos do CNPJ conferidos. */
export function isCnpj(v: string): boolean {
  if (!/^\d{14}$/.test(v) || /^(\d)\1{13}$/.test(v)) return false;
  const dv = (len: number) => {
    const w =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(v[i]) * w[i]!;
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(v[12]) && dv(13) === Number(v[13]);
}

/** Dígitos do CPF conferidos. */
export function isCpfDigits(v: string): boolean {
  if (!/^\d{11}$/.test(v) || /^(\d)\1{10}$/.test(v)) return false;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(v[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(v[9]) && dv(10) === Number(v[10]);
}

/** CNPJ ou CPF válido (só números) ou null. */
export function legalDocument(v: unknown): string | null {
  const d = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  return isCnpj(d) || isCpfDigits(d) ? d : null;
}

/** Lê a resposta de uma parte do campo único: o rascunho, os dados da empresa e o tipo do arquivo. */
export function readComposeDraft(
  raw: string,
  images: string[] = [],
): { draft: SiteDraft; file: string | null } {
  const draft = readSiteDraft(raw, images);
  let legal: DraftLegal = { document: null, legalName: null };
  let file: string | null = null;
  let cep: string | null = null;
  try {
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as {
      store?: { document?: unknown; legalName?: unknown; cep?: unknown };
      file?: unknown;
    };
    legal = {
      document: legalDocument(j.store?.document),
      legalName: clip(j.store?.legalName, 160),
    };
    file =
      typeof j.file === 'string' && ['logo', 'menu', 'cover', 'document', 'other'].includes(j.file)
        ? j.file
        : null;
    const c = typeof j.store?.cep === 'string' ? j.store.cep.replace(/\D/g, '') : '';
    cep = c.length === 8 ? c : null;
  } catch {
    /* sem os extras: fica o rascunho */
  }
  // Arquivo que não é cardápio não traz itens (a IA às vezes "sugere" mesmo assim).
  const noItems = file && file !== 'menu';
  return {
    draft: {
      ...draft,
      store: { ...draft.store, cep: draft.store.cep ?? cep },
      categories: noItems ? [] : draft.categories,
      suggested: noItems ? false : draft.suggested,
      legal,
    },
    file,
  };
}

/**
 * Junta uma parte nova ao rascunho: dados da loja que faltavam, itens novos (sugestão sai quando
 * chega cardápio de verdade) e os dados da empresa.
 */
export function mergeCompose(a: SiteDraft, b: SiteDraft): SiteDraft {
  const real = (d: SiteDraft) => draftItems(d) > 0 && !d.suggested;
  let base: SiteDraft = a;
  if (a.suggested && real(b)) base = { ...a, categories: [], suggested: false };
  const merged =
    draftItems(b) && !(b.suggested && draftItems(base))
      ? mergeMenuDrafts(base, b)
      : { ...base, store: mergeStores(base.store, b.store) };
  return {
    ...merged,
    pages: a.pages,
    tagline: a.tagline ?? b.tagline,
    suggested: draftItems(merged) > 0 && (base.suggested || (!draftItems(base) && b.suggested)),
    legal: {
      document: a.legal?.document ?? b.legal?.document ?? null,
      legalName: a.legal?.legalName ?? b.legal?.legalName ?? null,
    },
    parts: (a.parts ?? 1) + (b.parts ?? 1),
    files: [...(a.files ?? []), ...(b.files ?? [])].slice(0, 20),
  };
}

/** O que a tela de criar recebe do campo único: a loja montada e o cardápio com o estoque. */
export function publicCompose(d: SiteDraft) {
  return {
    site: publicDraft(d),
    menu: publicMenu(d),
    legal: d.legal ?? { document: null, legalName: null },
    store: {
      address: d.store.address,
      city: d.store.city,
      state: d.store.state,
      cep: d.store.cep,
      whatsapp: d.store.whatsapp,
      hours: d.store.hours.length,
    },
    parts: d.parts ?? 1,
    files: d.files ?? [],
  };
}

/** Links do texto (até 3): http(s), www. e domínios .com/.com.br soltos. */
export function linksIn(text: string): string[] {
  const out: string[] = [];
  const re =
    /\b((?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9][a-z0-9-]{1,62}\.(?:com\.br|com|net\.br|net|app|site|menu|food|delivery)(?:\/[^\s<>"']*)?)/gi;
  for (const m of text.matchAll(re)) {
    let u = m[1]!.replace(/[),.;!?]+$/, '');
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    if (!out.includes(u)) out.push(u);
    if (out.length >= 3) break;
  }
  return out;
}
