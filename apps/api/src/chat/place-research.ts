import { isMapsLink } from '../common/maps-link';
import { readImport, type ImportedCategory } from './menu-import.service';
import { decodeEntities, type ImportedStore } from './store-import';

/**
 * Achar o restaurante na internet (primeiros passos "pelo Google Maps"): a IA pesquisa o lugar
 * (Google Maps, site, iFood, Instagram, guias) e devolve os dados da loja e os links onde o
 * cardápio aparece. Funções puras; quem pesquisa e lê os links é o MenuImportService.
 */

export interface PlaceHint {
  /** Nome (e às vezes a cidade) digitado pela pessoa ou tirado do link do Maps. */
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  link: string | null;
}

export interface PlaceFound {
  found: boolean;
  store: ImportedStore;
  /** Links para ler o cardápio, do melhor para o pior (cardápio digital, iFood, site). */
  menuLinks: string[];
  /** Itens com preço que a pesquisa já mostrou (quando nenhum link abre). */
  categories: ImportedCategory[];
}

export const PLACE_PROMPT = `Você pesquisa na internet um restaurante brasileiro para montar o cadastro da loja dele no sistema. Procure no Google Maps, no site oficial, no iFood, no Instagram, no Facebook e em guias (TripAdvisor, Guia Local). Confirme que é o mesmo lugar (mesmo nome e mesma cidade).

Responda SOMENTE com JSON neste formato:
{"found":true,"store":{"name":"nome da loja","about":"frase curta sobre a loja ou null","whatsapp":"telefone ou WhatsApp com DDD ou null","address":"rua, número e bairro ou null","cep":"00000-000 ou null","city":"cidade ou null","state":"UF ou null","hours":[{"day":0,"open":"18:00","close":"23:00"}]},"links":{"menu":"link do cardápio digital ou null","ifood":"link da loja no iFood ou null","site":"site oficial ou null","instagram":"link do Instagram ou null"},"categories":[{"name":"Nome da categoria","items":[{"name":"Nome do item","description":"descrição curta ou null","price":"24.90 ou null"}]}]}

Regras:
- Não achou o lugar com segurança: {"found":false}. Nunca invente um restaurante.
- Telefone, endereço, horário e links: só o que a pesquisa mostrou. Não invente.
- "hours": um turno por dia (0 = domingo ... 6 = sábado), "open" e "close" em HH:MM. Fechado no dia: não inclua. Sem horário: [].
- "address" sem a cidade e a UF (elas vão em "city" e "state").
- "about": até 200 caracteres, o que a casa serve, sem exagero e sem inventar prêmios ou datas.
- "links": endereços completos (https://...). Não use link do Google Maps nem de busca.
- "categories": só itens com nome e preço que apareceram na pesquisa, copiados como estão ("price" com ponto e duas casas, sem "R$"). Não achou o cardápio: [].`;

/** O que vai para o modelo: tudo o que já se sabe do lugar. */
export function placeQuestion(h: PlaceHint): string {
  return [
    'Pesquise este restaurante:',
    h.name && `Nome: ${h.name}`,
    h.address && `Endereço: ${h.address}`,
    (h.city || h.state) && `Cidade: ${[h.city, h.state].filter(Boolean).join(' - ')}`,
    h.link && `Link do Google Maps: ${h.link}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Só link de página comum (http/https), fora do Google Maps e de buscadores. */
export function usableLink(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const raw = v.trim();
  if (!raw || raw.length > 2000) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (isMapsLink(u.href)) return null;
    if (/(^|\.)(google|bing|duckduckgo|yahoo)\.[a-z.]+$/i.test(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Links que costumam ter o cardápio inteiro, na ordem em que vale a pena tentar. */
const MENU_HOST =
  /(^|\.)(ifood\.com\.br|anota\.ai|goomer\.app|cardapioweb\.com|menudino\.com|aiqfome\.com|deliverydireto\.com\.br|instadelivery\.com\.br|saipos\.com|ola\.click|neemo\.com\.br|cardapio\.ai)$/i;

/** Limpa a resposta da pesquisa. `citations` são as páginas que a pesquisa usou. */
export function readPlace(raw: string, citations: string[] = []): PlaceFound {
  const r = readImport(raw);
  let j: { found?: unknown; links?: Record<string, unknown> } = {};
  try {
    j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as typeof j;
  } catch {
    /* JSON cortado: fica com o que o readImport aproveitou */
  }
  const links = j.links && typeof j.links === 'object' ? j.links : {};
  const named = [links.menu, links.ifood, links.site].map(usableLink);
  // Páginas citadas pela pesquisa que são de cardápio digital entram depois das apontadas.
  const cited = citations.map(usableLink).filter((u) => !!u && MENU_HOST.test(new URL(u).hostname));
  const menuLinks = [...new Set([...named, ...cited].filter((u): u is string => !!u))].slice(0, 4);
  const store = { ...r.store, name: r.store.name ? decodeEntities(r.store.name) : null };
  const found =
    j.found !== false && !!(store.name || store.address || store.whatsapp || menuLinks.length);
  return {
    found,
    store: found ? store : r.store,
    menuLinks: found ? menuLinks : [],
    categories: found ? r.categories.map(withPriceOnly).filter((c) => c.items.length) : [],
  };
}

/** Da pesquisa só entra item com preço (sem preço é chute da busca). */
const withPriceOnly = (c: ImportedCategory): ImportedCategory => ({
  name: c.name,
  items: c.items.filter((i) => i.price !== null),
});

/** Junta dois cadastros da loja: o primeiro valor achado fica. */
export function mergeStores(a: ImportedStore, b: ImportedStore): ImportedStore {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof ImportedStore)[]) {
    if (k === 'hours') {
      if (!out.hours.length) out.hours = b.hours;
    } else if (out[k] == null) (out as Record<string, unknown>)[k] = b[k];
  }
  return out;
}
