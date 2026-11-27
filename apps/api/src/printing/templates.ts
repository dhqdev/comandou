import { PRINT_BIG_WIDTH, PRINT_MARKS } from '@comandou/shared';
import { Liquid } from 'liquidjs';

/**
 * Modelos de impressão do restaurante, em Liquid (a mesma ideia do Jinja: {{ variável }},
 * {% for %}, {% if %}). Liquid foi feito para o cliente escrever modelo sem conseguir rodar
 * código: não acessa arquivos, rede nem o processo. Aqui ainda limitamos tamanho, tempo e
 * memória de cada impressão e desligamos {% include %}/{% render %} (não há arquivos).
 *
 * Só a conferência de conta, a via de entrega, a comanda da cozinha e o rodapé do cupom fiscal são editáveis. O
 * corpo do cupom fiscal (DANFE NFC-e) segue o leiaute obrigatório da SEFAZ e não muda.
 */

export const TEMPLATE_KINDS = [
  'receipt',
  'delivery_slip',
  'kitchen_ticket',
  'fiscal_footer',
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const TEMPLATE_MAX = 8000;
/** Colunas de uma bobina de 80 mm na fonte normal. */
export const WIDTH = 42;
/** Colunas da letra grande. */
export const BIG = PRINT_BIG_WIDTH;

const engine = new Liquid({
  templates: {}, // nada de arquivos: include/render/layout não encontram nada
  ownPropertyOnly: true,
  strictFilters: true,
  parseLimit: TEMPLATE_MAX,
  renderLimit: 200,
  memoryLimit: 2e6,
  outputEscape: undefined,
});

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const money = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return str(v);
  const [i, d] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}R$ ${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d}`;
};
const clampWidth = (n: unknown) => Math.max(1, Math.min(WIDTH, Number(n) || WIDTH));
/** Largura pedida no filtro (ex.: 21 para a letra grande); sem número, a bobina inteira. */
const widthOf = (n: unknown) => clampWidth(n);

const centerLine = (l: string, w: number) => {
  const t = l.trim().slice(0, w);
  return ' '.repeat(Math.floor((w - t.length) / 2)) + t;
};
const wrapText = (v: unknown, indent = 0, w = WIDTH) => {
  const pad = ' '.repeat(Math.min(10, indent));
  const max = Math.max(1, w - pad.length);
  const out: string[] = [];
  let cur = '';
  for (const raw of str(v).split(/\s+/)) {
    // Palavra maior que a linha (link, código): corta em pedaços em vez de passar da bobina.
    for (let word = raw; word; word = word.slice(max)) {
      const w0 = word.slice(0, max);
      if ((cur + ' ' + w0).trim().length > max) {
        if (cur) out.push(pad + cur);
        cur = w0;
      } else cur = (cur + ' ' + w0).trim();
      if (word.length <= max) break;
    }
  }
  if (cur) out.push(pad + cur);
  return out;
};
const mark = (prefix: string) => (v: unknown) =>
  str(v)
    .split('\n')
    .map((l) => (l.trim() && !l.startsWith('@@') ? prefix + l : l))
    .join('\n');

engine.registerFilter('dinheiro', money);
/** {{ "texto" | centro }} na bobina; {{ "texto" | centro: 21 }} para a letra grande. */
engine.registerFilter('centro', (v: unknown, n?: unknown) =>
  str(v)
    .split('\n')
    .map((l) => centerLine(l, widthOf(n)))
    .join('\n'),
);
engine.registerFilter('esquerda', (v: unknown, n?: unknown) =>
  str(v).slice(0, clampWidth(n)).padEnd(clampWidth(n)),
);
engine.registerFilter('direita', (v: unknown, n?: unknown) =>
  str(v).slice(0, clampWidth(n)).padStart(clampWidth(n)),
);
/**
 * "Total" | linha: "R$ 10,00" → texto à esquerda e valor à direita, na largura da bobina.
 * Com largura: "TOTAL:" | linha: valor, 21 (para usar com | grande). Texto que não cabe quebra
 * para a linha de baixo; com recuo (terceiro número), as linhas de baixo começam nessa coluna:
 * "2x    Nome comprido" | linha: valor, 42, 6.
 */
engine.registerFilter('linha', (label: unknown, value?: unknown, n?: unknown, indent?: unknown) => {
  const w = widthOf(n);
  const v = str(value).slice(0, w);
  const room = Math.max(1, w - v.length - 1);
  const l = str(label);
  if (l.length <= room) return l.padEnd(w - v.length) + v;
  let r = Math.max(0, Math.min(10, Number(indent) || 0, room - 1));
  // A coluna da esquerda passou do recuo (ex.: "0,350kg"): o recuo vai até o fim dela.
  while (r > 0 && r < Math.min(room - 1, l.length) && l[r - 1] !== ' ') r++;
  const head = l.slice(0, r);
  const first = wrapText(l.slice(r), 0, room - r);
  const rest = wrapText(first.slice(1).join(' '), r, w);
  return [(head + (first[0] ?? '')).padEnd(w - v.length) + v, ...rest].join('\n');
});
/** Coluna de largura fixa que nunca corta o texto: {{ item.quantidade_formatada | coluna: 6 }}. */
engine.registerFilter('coluna', (v: unknown, n?: unknown) => {
  const t = str(v);
  const w = clampWidth(n);
  return t.length < w ? t.padEnd(w) : `${t} `;
});
/** Linha separadora: {{ "-" | traco }} ou {{ "=" | traco }}. */
engine.registerFilter('traco', (ch?: unknown, n?: unknown) =>
  (str(ch) || '-').slice(0, 1).repeat(widthOf(n)),
);
/** Quebra um texto longo em linhas da largura da bobina ({{ t | quebra: 3 }} recua 3 colunas). */
engine.registerFilter('quebra', (v: unknown, indent?: unknown, n?: unknown) =>
  wrapText(v, Number(indent) || 0, widthOf(n)).join('\n'),
);
/**
 * Texto longo com as linhas de baixo recuadas (a primeira fica na margem): "2x Hambúrguer
 * artesanal…" | recuo: 3 → a continuação começa na coluna 3, embaixo do nome. Quantidade maior
 * que o recuo ("0,350kg") empurra o recuo até o fim dela, como na tabela de itens.
 */
engine.registerFilter('recuo', (v: unknown, indent?: unknown, n?: unknown) => {
  const w = widthOf(n);
  // Espaços do começo da linha ficam (coluna da quantidade: "2x    Nome").
  const l = str(v)
    .replace(/\s+/g, (s) => (s.includes('\n') ? ' ' : s))
    .trimEnd();
  if (l.length <= w) return l;
  const want = Math.max(0, Math.min(10, Number(indent) || 0, w - 1));
  let r = want;
  while (r > 0 && r < Math.min(10, l.length) && l[r - 1] !== ' ') r++;
  // Primeira palavra comprida demais (link, código): fica o recuo pedido.
  if (r > 0 && l[r - 1] !== ' ') r = want;
  const first = wrapText(l.slice(r), 0, w - r);
  const rest = wrapText(first.slice(1).join(' '), r, w);
  return [l.slice(0, r) + (first[0] ?? ''), ...rest].join('\n');
});
/**
 * Rótulo e valor em colunas, como no cupom: {{ "DATA:" | campo: pedido.data }} →
 * "DATA:      03/11/2026 19:42". Valor longo quebra alinhado. Rótulo com 11 colunas (ou o número dado).
 */
engine.registerFilter('campo', (label: unknown, value?: unknown, n?: unknown) => {
  const lw = Math.max(1, Math.min(20, Number(n) || 11));
  const l = str(label).slice(0, lw).padEnd(lw);
  const lines = wrapText(value, 0, WIDTH - lw);
  if (!lines.length) return l.trimEnd();
  return lines.map((x, i) => (i === 0 ? l : ' '.repeat(lw)) + x).join('\n');
});
/** Negrito na linha inteira (cada linha do texto). */
engine.registerFilter('negrito', mark(PRINT_MARKS.bold));
/**
 * Letra grande (largura e altura duplas, em negrito): cabem 21 colunas. Texto maior quebra em
 * linhas; {{ loja.nome | grande: "centro" }} centraliza.
 */
engine.registerFilter('grande', (v: unknown, align?: unknown) =>
  str(v)
    .split('\n')
    .flatMap((l) => (l.length <= BIG ? [l] : wrapText(l, 0, BIG)))
    .map((l) => (align === 'centro' ? centerLine(l, BIG) : l.slice(0, BIG)))
    .map((l) => (l.trim() ? PRINT_MARKS.big + l : ''))
    .join('\n'),
);
/** 2.000 → 2; 1.500 → 1,5. */
engine.registerFilter('qtd', (v: unknown) =>
  str(v)
    .replace(/\.?0+$/, '')
    .replace('.', ','),
);

export class TemplateError extends Error {}

/** Confere se o modelo é válido (sintaxe) sem imprimir. */
export function checkTemplate(body: string) {
  if (!body.trim()) throw new TemplateError('O modelo está vazio');
  if (/\{%-?\s*(include|render|layout)\b/.test(body))
    throw new TemplateError('Os modelos não podem incluir outros arquivos');
  if (body.length > TEMPLATE_MAX)
    throw new TemplateError(`O modelo passa de ${TEMPLATE_MAX} caracteres`);
  try {
    engine.parse(body);
  } catch (err) {
    throw new TemplateError(friendly(err));
  }
}

/** Monta o texto da impressão. Linhas em branco seguidas viram uma só e nada passa da bobina. */
export async function renderTemplate(body: string, data: Record<string, unknown>) {
  checkTemplate(body);
  let out: string;
  try {
    out = await engine.parseAndRender(body, withMarks(data));
  } catch (err) {
    throw new TemplateError(friendly(err));
  }
  return out
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .slice(0, 20_000);
}

/**
 * Texto que veio de fora (observação do cliente, nome do item) nunca vira marca de impressão: um
 * "@@QR@@..." escrito pelo cliente imprimiria um QR Code. Depois de limpar, `loja.logo` vira a
 * marca da logo (ou vazio, sem logo cadastrada).
 */
function clean(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.replace(/@@/g, '@');
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  if (v instanceof Date) return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, depth + 1)]));
}

function withMarks(data: Record<string, unknown>) {
  const out = clean(data) as Record<string, unknown>;
  const loja = out.loja as Record<string, unknown> | undefined;
  if (loja && typeof loja === 'object')
    out.loja = { ...loja, logo: loja.logo ? PRINT_MARKS.logo : '' };
  return out;
}

function friendly(err: unknown) {
  const m = (err as Error).message ?? String(err);
  if (/undefined filter/i.test(m)) return `Filtro desconhecido: ${m.replace(/.*filter:?\s*/i, '')}`;
  if (/not found|ENOENT|template/i.test(m) && /include|render|layout/i.test(m))
    return 'Os modelos não podem incluir outros arquivos';
  if (/limit/i.test(m)) return 'O modelo é pesado demais (laço muito grande?)';
  return `Erro no modelo: ${m.split('\n')[0].slice(0, 200)}`;
}

/**
 * Modelos iniciais, no jeito de cupom: logo e nome grande no topo, campos alinhados (PEDIDO, DATA,
 * TIPO, CLIENTE, ENDEREÇO), observação em destaque, tabela QTDE / DESCRIÇÃO / VALOR e o TOTAL
 * grande. Sem modelo salvo, o sistema imprime com estes. O restaurante começa daqui e muda o que
 * quiser (ou pede para a IA do editor).
 */
export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  receipt: `{% if loja.logo %}{{ loja.logo }}
{% endif %}{{ loja.nome | upcase | grande: "centro" }}
{% if loja.endereco %}{{ loja.endereco | quebra | centro }}
{% endif %}{% if loja.telefone %}{{ loja.telefone | centro }}
{% endif %}{{ "=" | traco }}
{{ "CONFERÊNCIA DE CONTA" | centro | negrito }}
{{ "NÃO É DOCUMENTO FISCAL" | centro }}
{{ "-" | traco }}
{% assign num = "#" | append: pedido.numero %}{% if comanda_inteira %}{{ "COMANDA:" | campo: pedido.comanda | negrito }}{% else %}{{ "PEDIDO:" | campo: num | negrito }}{% endif %}
{{ "DATA:" | campo: pedido.data }}
{{ "TIPO:" | campo: pedido.local | upcase }}
{% if pedido.cliente %}{{ "CLIENTE:" | campo: pedido.cliente }}
{% endif %}{% if pedido.entrega %}{% if pedido.telefone %}{{ "TELEFONE:" | campo: pedido.telefone }}
{% endif %}{% if pedido.endereco %}{{ "ENDEREÇO:" | campo: pedido.endereco }}
{% endif %}{% endif %}{% if pedido.observacao %}{{ "-" | traco }}
{{ "OBSERVAÇÃO:" | negrito }}
{{ pedido.observacao | quebra }}
{% endif %}{{ "-" | traco }}
{{ "QTDE  DESCRIÇÃO" | linha: "VALOR" | negrito }}
{{ "-" | traco }}
{% for item in itens %}{{ item.quantidade_formatada | coluna: 6 | append: item.nome | linha: item.total_formatado, 42, 6 }}
{% for op in item.opcoes %}{{ "+ " | append: op | quebra: 6 }}
{% endfor %}{% if item.observacao %}{{ "OBS: " | append: item.observacao | quebra: 6 }}
{% endif %}{% endfor %}{{ "-" | traco }}
{% if totais.tem_extras %}{{ "SUBTOTAL:" | linha: totais.subtotal_formatado }}
{% endif %}{% if totais.desconto > 0 %}{% assign desc = "-" | append: totais.desconto_formatado %}{{ "DESCONTO:" | linha: desc }}
{% endif %}{% if totais.acrescimo > 0 %}{{ "TAXA DE SERVIÇO:" | linha: totais.acrescimo_formatado }}
{% endif %}{% if totais.entrega > 0 %}{{ "TAXA DE ENTREGA:" | linha: totais.entrega_formatado }}
{% endif %}{{ "TOTAL:" | linha: totais.total_formatado, 21 | grande }}
{% if pagamentos.size > 0 %}{{ "-" | traco }}
{% for p in pagamentos %}{{ "PAGO (" | append: p.forma | append: "):" | linha: p.valor_formatado }}
{% if p.troco > 0 %}{{ "  TROCO:" | linha: p.troco_formatado }}
{% endif %}{% endfor %}{% if totais.falta > 0 %}{{ "FALTA PAGAR:" | linha: totais.falta_formatado | negrito }}
{% endif %}{% elsif pedido.pagar_na_entrega %}{{ "-" | traco }}
{{ "PAGAMENTO:" | campo: pedido.pagar_na_entrega }}
{% if pedido.troco_para > 0 %}{{ "TROCO PARA:" | linha: pedido.troco_para_formatado }}
{% endif %}{% endif %}{% if pedido.cpf_cnpj %}{{ "CPF/CNPJ:" | campo: pedido.cpf_cnpj }}
{% endif %}{{ "=" | traco }}`,
  delivery_slip: `{% if loja.logo %}{{ loja.logo }}
{% endif %}{{ loja.nome | upcase | grande: "centro" }}
{% if loja.telefone %}{{ loja.telefone | centro }}
{% endif %}{{ "=" | traco }}
{{ "VIA DE ENTREGA" | centro | negrito }}
{{ "-" | traco }}
{% assign num = "#" | append: pedido.numero %}{{ "PEDIDO:" | campo: num | negrito }}
{{ "DATA:" | campo: pedido.data }}
{{ "TIPO:" | campo: pedido.canal | upcase }}
{% if pedido.cliente %}{{ "CLIENTE:" | campo: pedido.cliente }}
{% endif %}{% if pedido.telefone %}{{ "TELEFONE:" | campo: pedido.telefone }}
{% endif %}{% if pedido.endereco %}{{ "ENDEREÇO:" | campo: pedido.endereco | negrito }}
{% endif %}{% if pedido.observacao %}{{ "-" | traco }}
{{ "OBSERVAÇÃO:" | negrito }}
{{ pedido.observacao | quebra }}
{% endif %}{{ "-" | traco }}
{{ "QTDE  DESCRIÇÃO" | linha: "VALOR" | negrito }}
{{ "-" | traco }}
{% for item in itens %}{{ item.quantidade_formatada | coluna: 6 | append: item.nome | linha: item.total_formatado, 42, 6 }}
{% for op in item.opcoes %}{{ "+ " | append: op | quebra: 6 }}
{% endfor %}{% if item.observacao %}{{ "OBS: " | append: item.observacao | quebra: 6 }}
{% endif %}{% endfor %}{{ "-" | traco }}
{% if totais.tem_extras %}{{ "SUBTOTAL:" | linha: totais.subtotal_formatado }}
{% endif %}{% if totais.desconto > 0 %}{% assign desc = "-" | append: totais.desconto_formatado %}{{ "DESCONTO:" | linha: desc }}
{% endif %}{% if totais.acrescimo > 0 %}{{ "ACRÉSCIMO:" | linha: totais.acrescimo_formatado }}
{% endif %}{% if totais.entrega > 0 %}{{ "TAXA DE ENTREGA:" | linha: totais.entrega_formatado }}
{% endif %}{% if pedido.pago %}{{ "TOTAL:" | linha: totais.total_formatado, 21 | grande }}
{{ "*** PAGO - NÃO COBRAR ***" | centro | negrito }}
{% for p in pagamentos %}{{ "PAGO COM:" | campo: p.forma }}
{% endfor %}{% else %}{% if pagamentos.size > 0 %}{{ "TOTAL:" | linha: totais.total_formatado }}
{% assign ja = totais.total | minus: pedido.cobrar | dinheiro %}{{ "JÁ PAGO:" | linha: ja }}
{% endif %}{{ "A COBRAR:" | linha: pedido.cobrar_formatado, 21 | grande }}
{% if pedido.pagar_na_entrega %}{{ "PAGAMENTO:" | campo: pedido.pagar_na_entrega }}
{% endif %}{% if pedido.levar_de_troco > 0 %}{{ "TROCO PARA:" | linha: pedido.troco_para_formatado }}
{{ "LEVAR DE TROCO:" | linha: pedido.levar_de_troco_formatado | negrito }}
{% endif %}{% endif %}{{ "=" | traco }}`,
  kitchen_ticket: `{{ setor | upcase | grande: "centro" }}
{{ "=" | traco }}
{% assign num = "PEDIDO #" | append: pedido.numero %}{{ num | grande: "centro" }}
{{ pedido.local | upcase | grande: "centro" }}
{{ "HORA:" | campo: pedido.hora }}
{% if pedido.cliente %}{{ "CLIENTE:" | campo: pedido.cliente }}
{% endif %}{% if pedido.observacao %}{{ "-" | traco }}
{{ "OBSERVAÇÃO:" | negrito }}
{{ pedido.observacao | quebra | negrito }}
{% endif %}{{ "-" | traco }}
{% for g in grupos %}{% if grupos.size > 1 %}{{ "-- " | append: g.nome | append: " --" | upcase | centro | negrito }}
{% endif %}{% for item in g.itens %}{{ item.quantidade_formatada | append: " " | append: item.nome | recuo: 3 | negrito }}
{% for op in item.opcoes %}{{ "+ " | append: op | quebra: 3 }}
{% endfor %}{% if item.observacao %}{{ "OBS: " | append: item.observacao | quebra: 3 | negrito }}
{% endif %}{% endfor %}{% endfor %}{{ "=" | traco }}`,
  fiscal_footer: `{{ "Obrigado pela preferência!" | centro | negrito }}
{% if loja.nome %}{{ loja.nome | centro }}{% endif %}`,
};

/** Dados de exemplo para a prévia quando o restaurante ainda não tem pedido. */
export function sampleData(kind: TemplateKind, storeName: string): Record<string, unknown> {
  const pedido = {
    numero: 128,
    hora: '03/11 19:42',
    data: '03/11/2026 19:42',
    canal: 'Mesa',
    local: 'Mesa 7',
    mesa: '7',
    comanda: null,
    cliente: 'Maria',
    telefone: '(11) 98888-7777',
    endereco: 'Rua das Flores, 120 - Centro',
    entrega: false,
    observacao: 'Sem cebola em tudo',
    pagar_na_entrega: null,
    cpf_cnpj: '123.456.789-09',
    troco_para: 0,
    troco_para_formatado: money(0),
  };
  const itens = [
    {
      nome: 'X-Burger da casa',
      quantidade: '2.000',
      unidade: 'un',
      quantidade_formatada: '2x',
      total: 59.8,
      total_formatado: money(59.8),
      opcoes: ['Bacon extra'],
      observacao: 'Ponto da carne: mal passado',
    },
    {
      nome: 'Refrigerante lata',
      quantidade: '1.000',
      unidade: 'un',
      quantidade_formatada: '1x',
      total: 7,
      total_formatado: money(7),
      opcoes: [],
      observacao: null,
    },
  ];
  const base = {
    loja: {
      nome: storeName,
      endereco: 'Av. Central, 75 - Centro',
      telefone: '(11) 3333-4444',
      logo: false,
    },
    largura: WIDTH,
    impresso_em: '03/11/2026 19:58:10',
  };
  if (kind === 'kitchen_ticket')
    return { ...base, setor: 'Cozinha', pedido, itens, grupos: [{ nome: 'Cozinha', itens }] };
  if (kind === 'delivery_slip') {
    const entrega = {
      ...pedido,
      canal: 'Delivery',
      local: 'Delivery',
      mesa: null,
      entrega: true,
      data: '03/11/2026 19:42',
      pagar_na_entrega: 'Dinheiro',
      troco_para: 80,
      troco_para_formatado: money(80),
      cobrar: 73.8,
      cobrar_formatado: money(73.8),
      pago: false,
      levar_de_troco: 6.2,
      levar_de_troco_formatado: money(6.2),
    };
    const totais = {
      subtotal: 66.8,
      desconto: 0,
      acrescimo: 0,
      entrega: 7,
      total: 73.8,
      falta: 73.8,
      tem_extras: true,
      subtotal_formatado: money(66.8),
      desconto_formatado: money(0),
      acrescimo_formatado: money(0),
      entrega_formatado: money(7),
      total_formatado: money(73.8),
      falta_formatado: money(73.8),
    };
    return { ...base, pedido: entrega, itens, totais, pagamentos: [] };
  }
  // O rodapé da NFC-e enxerga só a loja (sem logo: o cupom fiscal tem o cabeçalho próprio) e a nota,
  // igual à impressão de verdade (`fiscalReceipt` em printing.service.ts).
  if (kind === 'fiscal_footer')
    return {
      ...base,
      loja: { nome: base.loja.nome, endereco: base.loja.endereco, telefone: base.loja.telefone },
      nota: { numero: '1234', serie: '1' },
    };
  return {
    ...base,
    pedido,
    itens,
    totais: {
      subtotal: 66.8,
      desconto: 0,
      acrescimo: 6.68,
      entrega: 0,
      total: 73.48,
      falta: 0,
      tem_extras: true,
      subtotal_formatado: money(66.8),
      desconto_formatado: money(0),
      acrescimo_formatado: money(6.68),
      entrega_formatado: money(0),
      total_formatado: money(73.48),
      falta_formatado: money(0),
    },
    pagamentos: [
      {
        forma: 'Pix',
        valor: 73.48,
        valor_formatado: money(73.48),
        troco: 0,
        troco_formatado: money(0),
      },
    ],
  };
}

export { money as formatMoney };
