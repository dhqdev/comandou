import { readImport, type ImportedCategory } from '../../chat/menu-import.service';
import type { ImportedStore } from '../../chat/store-import';

/**
 * Site com IA (comandou.com): o pedido para o modelo e a limpeza do que ele devolve. Funções
 * puras; quem busca a página e chama o OpenRouter é o SiteAiService.
 */

export type SiteAiKind = 'site' | 'maps' | 'text';

/** Rascunho do site: a loja, o cardápio e a frase de abertura. Vai junto com o teste. */
export interface SiteDraft {
  store: ImportedStore;
  categories: ImportedCategory[];
  /** Frase curta para o topo da loja ("Smash burger na brasa desde 2019"). */
  tagline: string | null;
  /** O lugar não mostrou cardápio: os itens são sugestões da IA, sem preço. */
  suggested: boolean;
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
