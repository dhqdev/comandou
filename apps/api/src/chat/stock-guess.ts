/**
 * Estoque inicial sugerido pela IA para cada item do cardápio (criação pelo site): quanto ter
 * para vender e com quanto repor. Funções puras; quem chama o modelo é o SiteAiService.
 *
 * O controle é o simples do cardápio (Estoque da lista de itens): a quantidade conta porções ou
 * unidades e o item fica "Esgotado" no zero. Por isso a IA também diz quando NÃO controlar
 * (vendido por peso, rodízio, adicional), e a pessoa confere tudo nos primeiros passos.
 */

/** Sugestão de um item; null = não controlar estoque deste item. */
export interface StockGuess {
  qty: number;
  min: number;
}

/** O que a IA recebe de cada item. */
export interface StockItemIn {
  name: string;
  category: string;
  price: string | null;
  description?: string | null;
}

export const STOCK_PROMPT = `Você ajuda um restaurante brasileiro pequeno que está começando a usar um sistema de pedidos a montar o estoque inicial de cada item do cardápio.

O estoque conta porções ou unidades prontas para vender: quando chega a zero, o item aparece como esgotado. O dono confere e ajusta depois.

Responda SOMENTE com JSON neste formato:
{"items":[{"i":0,"qty":30,"min":6}]}

Regras:
- Um objeto para cada item da lista, com o mesmo número "i".
- "qty": quantidade inteira para começar. Bebida em lata, long neck ou garrafa: 24 a 72 (uma semana de venda). Água, suco de caixinha e itens de mercado: 12 a 48. Sobremesa pronta, doce e salgado de vitrine: 10 a 30. Lanche, pizza, prato, porção e açaí: 15 a 50 porções (um dia movimentado). Item caro ou que sai pouco (combo grande, peça inteira, garrafa de vinho): menos, de 3 a 12.
- "min": quando avisar para repor, inteiro, cerca de um quinto de "qty" e no mínimo 1.
- Item que não faz sentido contar (vendido por peso ou por quilo, rodízio, à vontade, buffet, taxa, couvert, adicional, molho extra, borda, serviço): "qty": null e "min": null.
- Use o nome, a categoria, o preço e a descrição para decidir. Não escreva nada além do JSON.`;

const brl = (p: string | null) => (p ? `R$ ${p.replace('.', ',')}` : 'sem preço');

/** A lista que vai para o modelo: uma linha por item, numerada a partir de 0. */
export function stockQuestion(items: StockItemIn[]): string {
  const lines = items.map((it, i) => {
    const desc = it.description ? ` · ${it.description.replace(/\s+/g, ' ').slice(0, 80)}` : '';
    return `${i}. ${it.name} (${it.category}) · ${brl(it.price)}${desc}`;
  });
  return `Itens do cardápio:\n${lines.join('\n')}`;
}

const int = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
};

/** Teto da quantidade sugerida (o sistema aceita mais; a IA não precisa). */
export const STOCK_MAX = 9999;

/**
 * Lê a resposta do modelo. Devolve um valor para cada um dos `n` itens: a sugestão, null (não
 * controlar) ou undefined (a IA não disse nada deste item).
 */
export function readStockGuess(raw: string, n: number): (StockGuess | null | undefined)[] {
  const out: (StockGuess | null | undefined)[] = Array.from({ length: n }, () => undefined);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return out;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return out;
  }
  const list = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return out;
  for (const row of list) {
    const r = row as { i?: unknown; qty?: unknown; min?: unknown } | null;
    const i = int(r?.i);
    if (i === null || i < 0 || i >= n || out[i] !== undefined) continue;
    const qty = int(r?.qty);
    if (qty === null || qty <= 0) {
      out[i] = null;
      continue;
    }
    const q = Math.min(qty, STOCK_MAX);
    const min = int(r?.min);
    out[i] = {
      qty: q,
      min: min === null || min < 1 ? Math.max(1, Math.round(q / 5)) : Math.min(min, q),
    };
  }
  return out;
}
