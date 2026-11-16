import { z } from 'zod';

/**
 * Página do restaurante (landing page em <endereço>/site): os textos que a IA escreve a partir
 * do cadastro da loja e do cardápio. Sem IA, um texto padrão montado com os mesmos dados, para
 * a página existir de qualquer jeito. O resto da página (logo, capa, cores, endereço, horário e
 * itens) vem do cadastro na hora de mostrar.
 */

const line = (max: number) => z.string().trim().max(max);

export const SiteCopy = z.object({
  /** Título grande do topo. */
  headline: line(80).min(1),
  /** Frase de apoio embaixo do título. */
  tagline: line(160).default(''),
  /** Parágrafo "Sobre". */
  about: line(600).default(''),
  /** Até 4 motivos para pedir (título curto e uma frase). */
  highlights: z
    .array(z.object({ title: line(40).min(1), text: line(140).default('') }))
    .max(4)
    .default([]),
  /** Texto do botão que leva ao cardápio. */
  cta: line(30).min(1).default('Pedir agora'),
});
export type SiteCopy = z.infer<typeof SiteCopy>;

/** O que a IA (ou o texto padrão) sabe do restaurante. */
export interface SiteFacts {
  name: string;
  about: string | null;
  city: string | null;
  state: string | null;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  etaMin: number;
  etaMax: number;
  categories: { name: string; items: string[] }[];
}

export const SITE_PAGE_PROMPT = `Você escreve a página de apresentação (landing page) de um restaurante brasileiro, a partir dos dados do cadastro e do cardápio que chegam em JSON.

Responda SOMENTE com JSON neste formato:
{"headline":"título de até 60 letras","tagline":"frase de apoio de até 140 letras","about":"um parágrafo de 2 ou 3 frases sobre o restaurante","highlights":[{"title":"até 30 letras","text":"uma frase curta"}],"cta":"texto do botão, até 20 letras"}

Regras:
- Português do Brasil, tom simples e direto, de quem fala com o cliente do bairro. Sem exagero, sem "o melhor da cidade", sem promessa que os dados não sustentam.
- Use só o que está nos dados. Não invente prêmios, anos de história, ingredientes, preços, promoções, endereço ou horário.
- "headline": fale da comida ou do jeito do restaurante, sem repetir só o nome dele.
- "highlights": 3 itens, tirados do cardápio (o que a casa faz) e de como ela atende (entrega, retirada, tempo médio quando houver).
- "cta": um convite para pedir, como "Pedir agora" ou "Ver o cardápio".
- Sem emoji, sem aspas dentro dos textos, sem markdown.`;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Texto padrão, sem IA: honesto e montado só com o que a loja cadastrou. */
export function defaultSiteCopy(f: SiteFacts): SiteCopy {
  const cats = f.categories.filter((c) => c.items.length).map((c) => c.name);
  const items = f.categories.reduce((n, c) => n + c.items.length, 0);
  const where = [f.city, f.state].filter(Boolean).join(', ');
  const serve =
    f.acceptsDelivery && f.acceptsPickup
      ? 'entrega e retirada'
      : f.acceptsDelivery
        ? 'entrega'
        : f.acceptsPickup
          ? 'retirada no balcão'
          : null;
  const highlights: SiteCopy['highlights'] = [];
  if (cats.length)
    highlights.push({
      title: 'Cardápio completo',
      text: `${cats.slice(0, 3).join(', ')}${cats.length > 3 ? ' e mais' : ''}.`.slice(0, 140),
    });
  if (serve)
    highlights.push({
      title: f.acceptsDelivery ? 'Pedido pelo celular' : 'Retire no balcão',
      text: `Peça pelo cardápio online, com ${serve}.`,
    });
  if (f.acceptsDelivery)
    highlights.push({
      title: 'Entrega acompanhada',
      text: `Em média de ${f.etaMin} a ${f.etaMax} minutos, com o pedido acompanhado na tela.`,
    });
  return {
    headline: `${f.name}: peça direto com a gente`.slice(0, 80),
    tagline: (where
      ? `Feito na hora em ${where}. Escolha no cardápio e peça em poucos toques.`
      : 'Feito na hora. Escolha no cardápio e peça em poucos toques.'
    ).slice(0, 160),
    about: (
      f.about?.trim() ||
      (items
        ? `${f.name} tem ${items} ${plural(items, 'item', 'itens')} no cardápio${cats.length ? `, entre ${cats.slice(0, 4).join(', ')}` : ''}. Peça pelo cardápio online e acompanhe o pedido.`
        : `Conheça ${f.name} e peça pelo cardápio online.`)
    ).slice(0, 600),
    highlights,
    cta: 'Pedir agora',
  };
}

/**
 * Resposta da IA virando os textos da página. Campo ausente ou inválido cai no texto padrão,
 * um por um: a página nunca fica sem título ou sem botão.
 */
export function readSiteCopy(text: string, fallback: SiteCopy): SiteCopy {
  let raw: unknown;
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    raw = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    return fallback;
  }
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const highlights = (Array.isArray(o.highlights) ? o.highlights : [])
    .map((h) => {
      const x = (h ?? {}) as Record<string, unknown>;
      return { title: str(x.title, 40), text: str(x.text, 140) };
    })
    .filter((h) => h.title)
    .slice(0, 4);
  return {
    headline: str(o.headline, 80) || fallback.headline,
    tagline: str(o.tagline, 160) || fallback.tagline,
    about: str(o.about, 600) || fallback.about,
    highlights: highlights.length ? highlights : fallback.highlights,
    cta: str(o.cta, 30) || fallback.cta,
  };
}
