import { PRINT_BIG_WIDTH, PRINT_WIDTH } from './print-marks';
import type { PrintTemplateKind } from './print-templates';

/**
 * Editor visual dos modelos de impressão (0.278, pedido do David: "tipo um Canva para cada
 * modelo"). O papel é uma lista de blocos (logo, nome da loja, campos do pedido, itens, totais,
 * texto livre, separador…) com o estilo de cada um (tamanho, negrito, alinhamento, maiúsculas).
 * `compileLayout` transforma os blocos no mesmo Liquid que o modo código usa: a API, a impressora e
 * a IA não mudam nada. Os blocos vão guardados num comentário no começo do modelo
 * (`{% comment %}comandou-visual …{% endcomment %}`), e `readLayout` os lê de volta; se alguém mexeu
 * no código depois, o modelo deixa de ser "do visual" (`exact: false`) e a tela avisa.
 *
 * Limites reais da térmica (não invente outros): uma letra só, 42 colunas na normal, 21 na grande
 * (largura e altura duplas, sempre em negrito), negrito na linha inteira, a logo sempre centralizada.
 */

type Kind = PrintTemplateKind;
export type LayoutAlign = 'esquerda' | 'centro' | 'direita';
export type LayoutSize = 'normal' | 'grande';
export const LAYOUT_CHARS = ['-', '=', '*', '.', '~', '_', '#', '+'] as const;
export type LayoutChar = (typeof LAYOUT_CHARS)[number];

export type LayoutBlockType =
  | 'logo'
  | 'loja_nome'
  | 'loja_endereco'
  | 'loja_telefone'
  | 'texto'
  | 'separador'
  | 'espaco'
  | 'qr'
  | 'numero'
  | 'data'
  | 'hora'
  | 'tipo'
  | 'setor'
  | 'cliente'
  | 'telefone'
  | 'endereco'
  | 'cpf'
  | 'impresso'
  | 'nota'
  | 'observacao'
  | 'itens'
  | 'totais'
  | 'pagamentos';

/** Opções próprias de alguns blocos (itens, observação). */
export interface LayoutOpts {
  /** Itens: cabeçalho QTDE / DESCRIÇÃO / VALOR. */
  header?: boolean;
  /** Itens: preço de cada item. */
  prices?: boolean;
  /** Itens: complementos (+ Bacon). */
  options?: boolean;
  /** Itens: observação do item. */
  notes?: boolean;
  /** Observação do pedido: traço antes. */
  line?: boolean;
}

export interface LayoutBlock {
  /** Só na tela (não vai guardado): chave do React e da seleção. */
  id: string;
  type: LayoutBlockType;
  /** Texto do bloco de texto, endereço do QR Code ou rótulo do campo ("DATA:"). */
  text: string;
  size: LayoutSize;
  bold: boolean;
  align: LayoutAlign;
  upper: boolean;
  char: LayoutChar;
  opts: LayoutOpts;
  /** Escondido: fica na lista, não sai no papel. */
  hidden: boolean;
}

export interface PrintLayout {
  blocks: LayoutBlock[];
}

/** Que estilo cada bloco aceita (o resto não aparece na barra de formatação). */
export interface LayoutBlockInfo {
  label: string;
  /** Uma linha curta do que sai no papel. */
  hint: string;
  kinds: readonly Kind[];
  group: 'loja' | 'pedido' | 'conta' | 'enfeite';
  /** Tem texto/rótulo editável? 'text' = texto livre, 'label' = rótulo do campo, 'link' = QR. */
  input?: 'text' | 'label' | 'link';
  size?: boolean;
  bold?: boolean;
  align?: boolean;
  upper?: boolean;
  char?: boolean;
  opts?: (keyof LayoutOpts)[];
  /** Estilo ao adicionar. */
  start?: Partial<Omit<LayoutBlock, 'id' | 'type'>>;
}

const ALL: readonly Kind[] = ['receipt', 'delivery_slip', 'kitchen_ticket', 'fiscal_footer'];
const ORDER: readonly Kind[] = ['receipt', 'delivery_slip', 'kitchen_ticket'];
const STYLE = { size: true, bold: true, align: true, upper: true } as const;

export const LAYOUT_BLOCKS: Record<LayoutBlockType, LayoutBlockInfo> = {
  logo: {
    label: 'Logo',
    hint: 'A logo da Loja online, centralizada',
    kinds: ORDER,
    group: 'loja',
  },
  loja_nome: {
    label: 'Nome da loja',
    hint: 'Nome do restaurante',
    kinds: ALL,
    group: 'loja',
    ...STYLE,
    start: { size: 'grande', align: 'centro', upper: true },
  },
  loja_endereco: {
    label: 'Endereço da loja',
    hint: 'Endereço da Loja online',
    kinds: ALL,
    group: 'loja',
    ...STYLE,
    start: { align: 'centro' },
  },
  loja_telefone: {
    label: 'Telefone da loja',
    hint: 'Telefone (WhatsApp) da Loja online',
    kinds: ALL,
    group: 'loja',
    ...STYLE,
    start: { align: 'centro' },
  },
  texto: {
    label: 'Texto',
    hint: 'Um título, um recado, o Wi-Fi, o Instagram…',
    kinds: ALL,
    group: 'enfeite',
    input: 'text',
    ...STYLE,
    start: { text: 'Volte sempre!', align: 'centro' },
  },
  separador: {
    label: 'Linha',
    hint: 'Separa as partes do papel',
    kinds: ALL,
    group: 'enfeite',
    char: true,
  },
  espaco: { label: 'Espaço', hint: 'Uma linha em branco', kinds: ALL, group: 'enfeite' },
  qr: {
    label: 'QR Code',
    hint: 'Leva para um link (Instagram, avaliação, cardápio)',
    kinds: ['receipt', 'delivery_slip', 'fiscal_footer'],
    group: 'enfeite',
    input: 'link',
    start: { text: 'https://' },
  },
  numero: {
    label: 'Número do pedido',
    hint: '#128 (na conta da mesa inteira, o número da comanda)',
    kinds: ORDER,
    group: 'pedido',
    input: 'label',
    ...STYLE,
    start: { text: 'PEDIDO:', bold: true },
  },
  data: {
    label: 'Data e hora',
    hint: '03/11/2026 19:42',
    kinds: ORDER,
    group: 'pedido',
    input: 'label',
    ...STYLE,
    start: { text: 'DATA:' },
  },
  hora: {
    label: 'Hora',
    hint: '03/11 19:42',
    kinds: ORDER,
    group: 'pedido',
    input: 'label',
    ...STYLE,
    start: { text: 'HORA:' },
  },
  tipo: {
    label: 'Mesa ou tipo',
    hint: 'Mesa 7, Comanda 12, Delivery, Balcão…',
    kinds: ORDER,
    group: 'pedido',
    input: 'label',
    ...STYLE,
    start: { text: 'TIPO:', upper: true },
  },
  setor: {
    label: 'Setor',
    hint: 'Cozinha, Bar… (onde o papel sai)',
    kinds: ['kitchen_ticket'],
    group: 'pedido',
    input: 'label',
    ...STYLE,
    start: { text: '', size: 'grande', align: 'centro', upper: true },
  },
  cliente: {
    label: 'Cliente',
    hint: 'Nome de quem pediu (só quando tem)',
    kinds: ORDER,
    group: 'pedido',
    input: 'label',
    ...STYLE,
    start: { text: 'CLIENTE:' },
  },
  telefone: {
    label: 'Telefone do cliente',
    hint: 'Só quando tem',
    kinds: ['receipt', 'delivery_slip'],
    group: 'pedido',
    input: 'label',
    ...STYLE,
    start: { text: 'TELEFONE:' },
  },
  endereco: {
    label: 'Endereço de entrega',
    hint: 'Só no delivery',
    kinds: ['receipt', 'delivery_slip'],
    group: 'pedido',
    input: 'label',
    ...STYLE,
    start: { text: 'ENDEREÇO:' },
  },
  cpf: {
    label: 'CPF/CNPJ',
    hint: 'Só quando o cliente pediu',
    kinds: ['receipt'],
    group: 'conta',
    input: 'label',
    ...STYLE,
    start: { text: 'CPF/CNPJ:' },
  },
  impresso: {
    label: 'Hora da impressão',
    hint: 'Quando o papel saiu',
    kinds: ORDER,
    group: 'pedido',
    input: 'label',
    ...STYLE,
    start: { text: 'IMPRESSO:' },
  },
  nota: {
    label: 'Número da nota',
    hint: 'Número e série da NFC-e',
    kinds: ['fiscal_footer'],
    group: 'conta',
    input: 'label',
    ...STYLE,
    start: { text: 'NFC-E:' },
  },
  observacao: {
    label: 'Observação do pedido',
    hint: 'O recado do cliente (só quando tem)',
    kinds: ORDER,
    group: 'pedido',
    input: 'label',
    size: true,
    bold: true,
    upper: true,
    char: true,
    opts: ['line'],
    start: { text: 'OBSERVAÇÃO:', opts: { line: true } },
  },
  itens: {
    label: 'Itens',
    hint: 'Quantidade, nome, complementos e preço',
    kinds: ORDER,
    group: 'conta',
    size: true,
    bold: true,
    upper: true,
    char: true,
    opts: ['header', 'prices', 'options', 'notes'],
    start: { opts: { header: true, prices: true, options: true, notes: true } },
  },
  totais: {
    label: 'Totais',
    hint: 'Subtotal, desconto, taxas e o TOTAL',
    kinds: ['receipt', 'delivery_slip'],
    group: 'conta',
    size: true,
    bold: true,
    start: { size: 'grande' },
  },
  pagamentos: {
    label: 'Pagamentos',
    hint: 'Como pagou, troco e o que falta',
    kinds: ['receipt'],
    group: 'conta',
    char: true,
  },
};

/** Blocos de cada papel, na ordem da lista "Adicionar". */
export function layoutBlocksFor(kind: Kind): LayoutBlockType[] {
  return (Object.keys(LAYOUT_BLOCKS) as LayoutBlockType[]).filter((t) =>
    LAYOUT_BLOCKS[t].kinds.includes(kind),
  );
}

/** Opções de cada papel: o que cada caixinha faz, para a tela. */
export const LAYOUT_OPT_LABELS: Record<keyof LayoutOpts, string> = {
  header: 'Cabeçalho QTDE / DESCRIÇÃO',
  prices: 'Preço de cada item',
  options: 'Complementos',
  notes: 'Observação do item',
  line: 'Linha antes',
};

const TEXT_MAX = 240;

let seq = 0;
const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Bloco novo com o estilo inicial do tipo. */
export function newLayoutBlock(
  type: LayoutBlockType,
  over: Partial<Omit<LayoutBlock, 'id' | 'type'>> = {},
): LayoutBlock {
  const s = LAYOUT_BLOCKS[type].start ?? {};
  return {
    id: newId(),
    type,
    text: over.text ?? s.text ?? '',
    size: over.size ?? s.size ?? 'normal',
    bold: over.bold ?? s.bold ?? false,
    align: over.align ?? s.align ?? 'esquerda',
    upper: over.upper ?? s.upper ?? false,
    char: over.char ?? s.char ?? '-',
    opts: { ...(over.opts ?? s.opts ?? {}) },
    hidden: over.hidden ?? false,
  };
}

// ---------------------------------------------------------------------------------------------
// Liquid

/** Texto do lojista dentro do Liquid: sem chaves (abririam uma tag) e sem marca de impressão. */
export function cleanLayoutText(s: string, max = TEXT_MAX) {
  return String(s ?? '')
    .replace(/\r/g, '')
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    .replace(/@@/g, '@')
    .replace(/[\u0000-\u0009\u000b-\u001f-]/g, '')
    .slice(0, max);
}

/** Texto entre aspas do Liquid (não tem escape: escolhe a aspa que não aparece). */
function q(s: string) {
  const t = cleanLayoutText(s).replace(/\n/g, ' ');
  if (!t.includes('"')) return `"${t}"`;
  if (!t.includes("'")) return `'${t}'`;
  return `"${t.replace(/"/g, '”')}"`;
}

interface Ctx {
  kind: Kind;
  i: number;
}

const bigAlign = (a: LayoutAlign) => (a === 'centro' ? ': "centro"' : '');

/** Uma expressão (já com maiúsculas) no estilo do bloco. */
function styled(expr: string, b: LayoutBlock) {
  if (b.size === 'grande') {
    if (b.align === 'direita') return `{{ ${expr} | direita: ${PRINT_BIG_WIDTH} | grande }}\n`;
    return `{{ ${expr} | grande${bigAlign(b.align)} }}\n`;
  }
  const al = b.align === 'centro' ? ' | centro' : b.align === 'direita' ? ' | direita' : '';
  return `{{ ${expr} | quebra${al}${b.bold ? ' | negrito' : ''} }}\n`;
}

const up = (b: LayoutBlock) => (b.upper ? ' | upcase' : '');

/** Rótulo + valor: em coluna (esquerda), nas pontas (direita) ou no meio. */
function field(label: string, labelLen: number, v: string, b: LayoutBlock) {
  if (!labelLen) return styled(v, b);
  const bold = b.bold ? ' | negrito' : '';
  if (b.size === 'grande') {
    if (b.align === 'direita') return `{{ ${label} | linha: ${v}, ${PRINT_BIG_WIDTH} | grande }}\n`;
    return `{{ ${label} | append: " " | append: ${v} | grande${bigAlign(b.align)} }}\n`;
  }
  if (b.align === 'direita') return `{{ ${label} | linha: ${v}${bold} }}\n`;
  if (b.align === 'centro')
    return `{{ ${label} | append: " " | append: ${v} | quebra | centro${bold} }}\n`;
  const w = Math.min(20, Math.max(11, labelLen + 1));
  return `{{ ${label} | campo: ${v}${w === 11 ? '' : `, ${w}`}${bold} }}\n`;
}

const when = (cond: string | null, body: string) =>
  cond ? `{% if ${cond} %}${body}{% endif %}` : body;

/** Campo do pedido: valor, condição para sair e rótulo. */
function simpleField(b: LayoutBlock, c: Ctx, value: string, cond: string | null) {
  const v = `v${c.i}`;
  const label = cleanLayoutText(b.text).replace(/\n/g, ' ').trim();
  return when(cond, `{% assign ${v} = ${value}${up(b)} %}` + field(q(label), label.length, v, b));
}

function sep(ch: LayoutChar) {
  return `{{ "${ch}" | traco }}\n`;
}

function items(b: LayoutBlock, c: Ctx) {
  const o = b.opts;
  const bold = b.bold ? ' | negrito' : '';
  const nm = `{% assign nm = item.nome${up(b)} %}`;
  if (c.kind === 'kitchen_ticket') {
    const line =
      b.size === 'grande'
        ? `{{ item.quantidade_formatada | append: " " | append: nm | grande }}\n`
        : `{{ item.quantidade_formatada | append: " " | append: nm | recuo: 3${bold} }}\n`;
    return (
      `{% for g in grupos %}{% if grupos.size > 1 %}{{ "-- " | append: g.nome | append: " --" | upcase | centro | negrito }}\n{% endif %}` +
      `{% for item in g.itens %}${nm}${line}` +
      (o.options
        ? `{% for op in item.opcoes %}{{ "+ " | append: op | quebra: 3 }}\n{% endfor %}`
        : '') +
      (o.notes
        ? `{% if item.observacao %}{{ "OBS: " | append: item.observacao | quebra: 3${b.bold || b.size === 'grande' ? ' | negrito' : ''} }}\n{% endif %}`
        : '') +
      `{% endfor %}{% endfor %}`
    );
  }
  const head = o.header
    ? (o.prices && b.size !== 'grande'
        ? `{{ "QTDE  DESCRIÇÃO" | linha: "VALOR" | negrito }}\n`
        : `{{ "QTDE  DESCRIÇÃO" | negrito }}\n`) + sep(b.char)
    : '';
  let line: string;
  if (b.size === 'grande')
    line =
      `{{ item.quantidade_formatada | append: " " | append: nm | grande }}\n` +
      (o.prices ? `{{ item.total_formatado | direita }}\n` : '');
  else if (o.prices)
    line = `{{ item.quantidade_formatada | coluna: 6 | append: nm | linha: item.total_formatado, ${PRINT_WIDTH}, 6${bold} }}\n`;
  else line = `{{ item.quantidade_formatada | coluna: 6 | append: nm | recuo: 6${bold} }}\n`;
  return (
    head +
    `{% for item in itens %}${nm}${line}` +
    (o.options
      ? `{% for op in item.opcoes %}{{ "+ " | append: op | quebra: 6 }}\n{% endfor %}`
      : '') +
    (o.notes
      ? `{% if item.observacao %}{{ "OBS: " | append: item.observacao | quebra: 6 }}\n{% endif %}`
      : '') +
    `{% endfor %}`
  );
}

function totalLine(label: string, value: string, b: LayoutBlock) {
  return b.size === 'grande'
    ? `{{ "${label}" | linha: ${value}, ${PRINT_BIG_WIDTH} | grande }}\n`
    : `{{ "${label}" | linha: ${value}${b.bold ? ' | negrito' : ''} }}\n`;
}

function totals(b: LayoutBlock, c: Ctx) {
  const extra = c.kind === 'receipt' ? 'TAXA DE SERVIÇO:' : 'ACRÉSCIMO:';
  const base =
    `{% if totais.tem_extras %}{{ "SUBTOTAL:" | linha: totais.subtotal_formatado }}\n{% endif %}` +
    `{% if totais.desconto > 0 %}{% assign desc = "-" | append: totais.desconto_formatado %}{{ "DESCONTO:" | linha: desc }}\n{% endif %}` +
    `{% if totais.acrescimo > 0 %}{{ "${extra}" | linha: totais.acrescimo_formatado }}\n{% endif %}` +
    `{% if totais.entrega > 0 %}{{ "TAXA DE ENTREGA:" | linha: totais.entrega_formatado }}\n{% endif %}`;
  if (c.kind === 'receipt') return base + totalLine('TOTAL:', 'totais.total_formatado', b);
  return (
    base +
    `{% if pedido.pago %}${totalLine('TOTAL:', 'totais.total_formatado', b)}` +
    `{{ "*** PAGO - NÃO COBRAR ***" | centro | negrito }}\n` +
    `{% for p in pagamentos %}{{ "PAGO COM:" | campo: p.forma }}\n{% endfor %}` +
    `{% else %}{% if pagamentos.size > 0 %}{{ "TOTAL:" | linha: totais.total_formatado }}\n` +
    `{% assign ja = totais.total | minus: pedido.cobrar | dinheiro %}{{ "JÁ PAGO:" | linha: ja }}\n{% endif %}` +
    totalLine('A COBRAR:', 'pedido.cobrar_formatado', b) +
    `{% if pedido.pagar_na_entrega %}{{ "PAGAMENTO:" | campo: pedido.pagar_na_entrega }}\n{% endif %}` +
    `{% if pedido.levar_de_troco > 0 %}{{ "TROCO PARA:" | linha: pedido.troco_para_formatado }}\n` +
    `{{ "LEVAR DE TROCO:" | linha: pedido.levar_de_troco_formatado | negrito }}\n{% endif %}{% endif %}`
  );
}

function payments(b: LayoutBlock) {
  return (
    `{% if pagamentos.size > 0 %}${sep(b.char)}` +
    `{% for p in pagamentos %}{{ "PAGO (" | append: p.forma | append: "):" | linha: p.valor_formatado }}\n` +
    `{% if p.troco > 0 %}{{ "  TROCO:" | linha: p.troco_formatado }}\n{% endif %}{% endfor %}` +
    `{% if totais.falta > 0 %}{{ "FALTA PAGAR:" | linha: totais.falta_formatado | negrito }}\n{% endif %}` +
    `{% elsif pedido.pagar_na_entrega %}${sep(b.char)}` +
    `{{ "PAGAMENTO:" | campo: pedido.pagar_na_entrega }}\n` +
    `{% if pedido.troco_para > 0 %}{{ "TROCO PARA:" | linha: pedido.troco_para_formatado }}\n{% endif %}{% endif %}`
  );
}

function blockLiquid(b: LayoutBlock, c: Ctx): string {
  const k = c.kind;
  switch (b.type) {
    case 'logo':
      return `{% if loja.logo %}{{ loja.logo }}\n{% endif %}`;
    case 'loja_nome':
      return styled(`loja.nome${up(b)}`, b);
    case 'loja_endereco':
      return when('loja.endereco', styled(`loja.endereco${up(b)}`, b));
    case 'loja_telefone':
      return when('loja.telefone', styled(`loja.telefone${up(b)}`, b));
    case 'texto': {
      const lines = cleanLayoutText(b.text).split('\n');
      return lines.map((l) => (l.trim() ? styled(`${q(l)}${up(b)}`, b) : '\n')).join('');
    }
    case 'separador':
      return sep(b.char);
    case 'espaco':
      return '\n';
    case 'qr': {
      const link = cleanLayoutText(b.text).replace(/\s+/g, '').slice(0, 300);
      return link && link !== 'https://' ? `{{ ${q(link)} | qrcode }}\n` : '';
    }
    case 'numero': {
      if (k !== 'receipt') return simpleField(b, c, `"#" | append: pedido.numero`, null);
      const label = cleanLayoutText(b.text).replace(/\n/g, ' ').trim();
      const v = `v${c.i}`;
      const l = `l${c.i}`;
      return (
        `{% if comanda_inteira %}{% assign ${v} = pedido.comanda${up(b)} %}{% assign ${l} = ${label ? '"COMANDA:"' : '""'} %}` +
        `{% else %}{% assign ${v} = "#" | append: pedido.numero %}{% assign ${l} = ${q(label)} %}{% endif %}` +
        field(l, label ? Math.max(label.length, 8) : 0, v, b)
      );
    }
    case 'data':
      return simpleField(b, c, 'pedido.data', null);
    case 'hora':
      return simpleField(b, c, 'pedido.hora', null);
    case 'tipo':
      return simpleField(b, c, k === 'delivery_slip' ? 'pedido.canal' : 'pedido.local', null);
    case 'setor':
      return simpleField(b, c, 'setor', null);
    case 'cliente':
      return simpleField(b, c, 'pedido.cliente', 'pedido.cliente');
    case 'telefone':
      return simpleField(
        b,
        c,
        'pedido.telefone',
        k === 'receipt' ? 'pedido.entrega and pedido.telefone' : 'pedido.telefone',
      );
    case 'endereco':
      return simpleField(
        b,
        c,
        'pedido.endereco',
        k === 'receipt' ? 'pedido.entrega and pedido.endereco' : 'pedido.endereco',
      );
    case 'cpf':
      return simpleField(b, c, 'pedido.cpf_cnpj', 'pedido.cpf_cnpj');
    case 'impresso':
      return simpleField(b, c, 'impresso_em', null);
    case 'nota':
      return simpleField(
        b,
        c,
        `nota.numero | append: " SÉRIE " | append: nota.serie`,
        'nota.numero',
      );
    case 'observacao': {
      const label = cleanLayoutText(b.text).replace(/\n/g, ' ').trim();
      return when(
        'pedido.observacao',
        (b.opts.line ? sep(b.char) : '') +
          (label ? `{{ ${q(label)} | negrito }}\n` : '') +
          styled(`pedido.observacao${up(b)}`, { ...b, align: 'esquerda' }),
      );
    }
    case 'itens':
      return items(b, c);
    case 'totais':
      return totals(b, c);
    case 'pagamentos':
      return payments(b);
  }
}

const TAG = 'comandou-visual';
const TAG_RE = /^\{% comment %\}comandou-visual ([A-Za-z0-9+/=]*)\{% endcomment %\}/;
/** Marca de bloco da prévia (caractere de uso privado + id do bloco), uma linha antes de cada bloco. */
const OWNER = '';

/**
 * Blocos → Liquid. `marks` põe uma linha `N` antes de cada bloco: só para a prévia saber de
 * qual bloco é cada linha (clicar no papel escolhe o bloco). Nunca vai para a impressora.
 */
export function compileLayout(kind: Kind, layout: PrintLayout, marks = false): string {
  const allowed = new Set(layoutBlocksFor(kind));
  let out = `{% comment %}${TAG} ${encodeLayout(layout)}{% endcomment %}`;
  layout.blocks.forEach((b, i) => {
    if (b.hidden || !allowed.has(b.type)) return;
    if (marks) out += `${OWNER}${b.id.replace(/[^A-Za-z0-9_-]/g, '')}\n`;
    out += blockLiquid(b, { kind, i });
  });
  return out.replace(/\n$/, '');
}

/** Prévia montada com `compileLayout(…, true)`: o texto limpo e o id do bloco de cada linha. */
export function splitLayoutPreview(text: string): { text: string; owners: (string | null)[] } {
  const lines: string[] = [];
  const owners: (string | null)[] = [];
  let cur: string | null = null;
  for (const l of String(text ?? '').split('\n')) {
    if (l.startsWith(OWNER)) {
      cur = l.slice(1).trim() || null;
      continue;
    }
    // Linha em branco depois de outra em branco some (a impressão de verdade faz igual).
    if (!l.trim() && (!lines.length || !lines[lines.length - 1].trim())) continue;
    lines.push(l);
    owners.push(cur);
  }
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
    owners.pop();
  }
  return { text: lines.join('\n'), owners };
}

// ---------------------------------------------------------------------------------------------
// Guardar os blocos no modelo (compacto: só o que muda do padrão)

type Stored = {
  t: LayoutBlockType;
  x?: string;
  g?: 1;
  n?: 1;
  a?: 'c' | 'd';
  u?: 1;
  c?: LayoutChar;
  o?: string;
  h?: 1;
};
const OPT_KEYS: (keyof LayoutOpts)[] = ['header', 'prices', 'options', 'notes', 'line'];
const OPT_CODE: Record<keyof LayoutOpts, string> = {
  header: 'h',
  prices: 'p',
  options: 'o',
  notes: 'n',
  line: 'l',
};

function toStored(b: LayoutBlock): Stored {
  const s: Stored = { t: b.type };
  if (b.text) s.x = cleanLayoutText(b.text);
  if (b.size === 'grande') s.g = 1;
  if (b.bold) s.n = 1;
  if (b.align !== 'esquerda') s.a = b.align === 'centro' ? 'c' : 'd';
  if (b.upper) s.u = 1;
  if (b.char !== '-') s.c = b.char;
  const o = OPT_KEYS.filter((k) => b.opts[k])
    .map((k) => OPT_CODE[k])
    .join('');
  if (o) s.o = o;
  if (b.hidden) s.h = 1;
  return s;
}

function fromStored(s: Stored): LayoutBlock | null {
  if (!s || typeof s !== 'object' || !(s.t in LAYOUT_BLOCKS)) return null;
  const opts: LayoutOpts = {};
  for (const k of OPT_KEYS)
    if (typeof s.o === 'string' && s.o.includes(OPT_CODE[k])) opts[k] = true;
  return {
    id: newId(),
    type: s.t,
    text: typeof s.x === 'string' ? cleanLayoutText(s.x) : '',
    size: s.g ? 'grande' : 'normal',
    bold: !!s.n,
    align: s.a === 'c' ? 'centro' : s.a === 'd' ? 'direita' : 'esquerda',
    upper: !!s.u,
    char: (LAYOUT_CHARS as readonly string[]).includes(s.c as string) ? (s.c as LayoutChar) : '-',
    opts,
    hidden: !!s.h,
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      c = Math.min(c, 0x10ffff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return out;
}

function fromUtf8(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    let c: number;
    if (b < 0x80) c = b;
    else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63);
    else if (b < 0xf0) c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else
      c =
        ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    s += String.fromCodePoint(Math.min(c, 0x10ffff));
  }
  return s;
}

function b64(bytes: number[]) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    s += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    s += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return s;
}

function unb64(s: string): number[] {
  const clean = s.replace(/=+$/, '');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('base64');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return out;
}

export function encodeLayout(layout: PrintLayout): string {
  return b64(utf8(JSON.stringify({ v: 1, b: layout.blocks.map(toStored) })));
}

/** O modelo foi feito no editor visual? `exact` = ninguém mexeu no código depois. */
export function readLayout(
  kind: Kind,
  body: string | null | undefined,
): { layout: PrintLayout; exact: boolean } | null {
  const m = TAG_RE.exec(String(body ?? ''));
  if (!m) return null;
  try {
    const raw = JSON.parse(fromUtf8(unb64(m[1]))) as { v?: number; b?: Stored[] };
    if (!raw || !Array.isArray(raw.b)) return null;
    const allowed = new Set(layoutBlocksFor(kind));
    const blocks = raw.b
      .slice(0, 80)
      .map(fromStored)
      .filter((b): b is LayoutBlock => !!b && allowed.has(b.type));
    const layout = { blocks };
    return { layout, exact: compileLayout(kind, layout) === body };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Estilos prontos

export type LayoutPresetId = 'classico' | 'moderno' | 'economico' | 'destaque';

export const LAYOUT_PRESETS: { id: LayoutPresetId; name: string; hint: string }[] = [
  { id: 'classico', name: 'Clássico', hint: 'O cupom de sempre, com tudo alinhado em colunas' },
  { id: 'moderno', name: 'Moderno', hint: 'Tudo no meio, linhas de pontinhos e mais respiro' },
  { id: 'economico', name: 'Econômico', hint: 'Sem logo e sem enfeite: gasta menos papel' },
  { id: 'destaque', name: 'Destaque', hint: 'Número e total bem grandes, fácil de ler de longe' },
];

type Spec = [LayoutBlockType, Partial<Omit<LayoutBlock, 'id' | 'type'>>?];
const T = (text: string, o: Partial<LayoutBlock> = {}): Spec => [
  'texto',
  { align: 'centro', ...o, text },
];
const S = (char: LayoutChar = '-'): Spec => ['separador', { char }];
/** Nome da loja em letra normal (o bloco nasce grande). */
const PLAIN_NAME = { align: 'centro', size: 'normal', upper: false } as const;
const ITENS_ALL = { header: true, prices: true, options: true, notes: true };

const TITLE: Record<Kind, string> = {
  receipt: 'CONFERÊNCIA DE CONTA',
  delivery_slip: 'VIA DE ENTREGA',
  kitchen_ticket: '',
  fiscal_footer: '',
};

function presetSpecs(kind: Kind, id: LayoutPresetId): Spec[] {
  if (kind === 'fiscal_footer') {
    if (id === 'moderno')
      return [
        S('.'),
        T('Obrigado pela preferência!'),
        ['loja_nome', PLAIN_NAME],
        ['loja_telefone'],
      ];
    if (id === 'economico') return [T('Obrigado e volte sempre!')];
    if (id === 'destaque')
      return [
        S('*'),
        T('OBRIGADO!', { size: 'grande' }),
        ['loja_nome', { ...PLAIN_NAME, bold: true }],
        S('*'),
      ];
    return [T('Obrigado pela preferência!', { bold: true }), ['loja_nome', PLAIN_NAME]];
  }
  if (kind === 'kitchen_ticket') {
    if (id === 'moderno')
      return [
        ['setor', { size: 'grande', align: 'centro' }],
        S('.'),
        ['numero', { text: 'Pedido', align: 'centro', bold: true }],
        ['tipo', { text: '', align: 'centro', bold: true }],
        ['hora', { text: '', align: 'centro' }],
        ['cliente', { text: '', align: 'centro' }],
        S('.'),
        ['observacao', { text: 'Observação:', bold: true, opts: {} }],
        ['itens', { bold: true, opts: { options: true, notes: true } }],
        S('.'),
      ];
    if (id === 'economico')
      return [
        ['numero', { text: 'PEDIDO', bold: true }],
        ['tipo', { text: '', upper: true, bold: true }],
        ['hora', { text: 'HORA:' }],
        ['observacao', { text: 'OBS:', bold: true, opts: { line: false } }],
        S(),
        ['itens', { bold: true, upper: false, opts: { options: true, notes: true } }],
      ];
    if (id === 'destaque')
      return [
        ['setor', { size: 'grande', align: 'centro', upper: true }],
        S('*'),
        ['numero', { text: 'PEDIDO', size: 'grande', align: 'centro' }],
        ['tipo', { text: '', size: 'grande', align: 'centro', upper: true }],
        ['hora', { text: 'HORA:' }],
        ['cliente', { text: 'CLIENTE:' }],
        ['observacao', { text: 'OBSERVAÇÃO:', size: 'grande', char: '*', opts: { line: true } }],
        S('*'),
        ['itens', { size: 'grande', opts: { options: true, notes: true } }],
        S('*'),
      ];
    return [
      ['setor', { size: 'grande', align: 'centro', upper: true }],
      S('='),
      ['numero', { text: 'PEDIDO', size: 'grande', align: 'centro' }],
      ['tipo', { text: '', size: 'grande', align: 'centro', upper: true }],
      ['hora', { text: 'HORA:' }],
      ['cliente', { text: 'CLIENTE:' }],
      ['observacao', { text: 'OBSERVAÇÃO:', bold: true, opts: { line: true } }],
      S(),
      ['itens', { bold: true, opts: { options: true, notes: true } }],
      S('='),
    ];
  }
  const r = kind === 'receipt';
  const title = TITLE[kind];
  const head: Spec[] = [];
  const fields: Spec[] = [];
  const tail: Spec[] = [];
  if (id === 'moderno') {
    head.push(
      ['logo'],
      ['loja_nome', { size: 'grande', align: 'centro' }],
      ['loja_telefone'],
      ['espaco'],
    );
    head.push(T(title.charAt(0) + title.slice(1).toLowerCase(), { bold: true }));
    if (r) head.push(T('Não é documento fiscal'));
    head.push(S('.'));
    fields.push(
      ['numero', { text: 'Pedido', align: 'centro', bold: true }],
      ['data', { text: '', align: 'centro' }],
      ['tipo', { text: '', align: 'centro' }],
      ['cliente', { text: 'Cliente:', align: 'centro' }],
    );
    if (!r)
      fields.push(
        ['telefone', { text: 'Tel.:', align: 'centro' }],
        ['endereco', { text: '', align: 'centro', bold: true }],
      );
    fields.push(['observacao', { text: 'Observação:', opts: { line: false } }], S('.'));
    tail.push(['itens', { char: '.', opts: { prices: true, options: true, notes: true } }], S('.'));
    tail.push(['totais', { size: 'grande' }]);
    if (r)
      tail.push(['pagamentos', { char: '.' }], ['cpf', { text: 'CPF/CNPJ:', align: 'centro' }]);
    tail.push(['espaco'], T('Obrigado pela visita!'));
    return [...head, ...fields, ...tail];
  }
  if (id === 'economico') {
    head.push(['loja_nome', { ...PLAIN_NAME, bold: true, upper: true }], T(title));
    if (r) head.push(T('NÃO É DOCUMENTO FISCAL'));
    head.push(S());
    fields.push(
      ['numero', { text: 'PEDIDO:', align: 'direita', bold: true }],
      ['data', { text: 'DATA:', align: 'direita' }],
      ['tipo', { text: 'TIPO:', align: 'direita', upper: true }],
      ['cliente', { text: 'CLIENTE:', align: 'direita' }],
    );
    if (!r)
      fields.push(
        ['telefone', { text: 'TELEFONE:' }],
        ['endereco', { text: 'ENDEREÇO:', bold: true }],
      );
    fields.push(['observacao', { text: 'OBS:', bold: true, opts: { line: false } }], S());
    tail.push(['itens', { opts: { prices: true, options: true, notes: true } }], S());
    tail.push(['totais', { bold: true }]);
    if (r) tail.push(['pagamentos'], ['cpf', { text: 'CPF/CNPJ:' }]);
    return [...head, ...fields, ...tail];
  }
  if (id === 'destaque') {
    head.push(['logo'], ['loja_nome', { size: 'grande', align: 'centro', upper: true }], S('*'));
    head.push(T(`*** ${title} ***`, { bold: true }));
    if (r) head.push(T('NÃO É DOCUMENTO FISCAL'));
    head.push(S('*'));
    fields.push(
      ['numero', { text: 'PEDIDO', size: 'grande', align: 'centro' }],
      ['tipo', { text: '', size: 'grande', align: 'centro', upper: true }],
      ['data', { text: 'DATA:' }],
      ['cliente', { text: 'CLIENTE:', bold: true }],
    );
    if (!r)
      fields.push(
        ['telefone', { text: 'TELEFONE:', bold: true }],
        ['endereco', { text: '', size: 'grande' }],
      );
    fields.push(
      ['observacao', { text: 'OBSERVAÇÃO:', bold: true, char: '*', opts: { line: true } }],
      S('*'),
    );
    tail.push(['itens', { bold: true, opts: ITENS_ALL, char: '*' }], S('*'));
    tail.push(['totais', { size: 'grande' }]);
    if (r) tail.push(['pagamentos', { char: '*' }], ['cpf', { text: 'CPF/CNPJ:' }]);
    tail.push(S('*'));
    return [...head, ...fields, ...tail];
  }
  // Clássico: igual ao modelo padrão do Comandou.
  head.push(['logo'], ['loja_nome', { size: 'grande', align: 'centro', upper: true }]);
  if (r) head.push(['loja_endereco']);
  head.push(['loja_telefone'], S('='), T(title, { bold: true }));
  if (r) head.push(T('NÃO É DOCUMENTO FISCAL'));
  head.push(S());
  fields.push(
    ['numero', { text: 'PEDIDO:', bold: true }],
    ['data', { text: 'DATA:' }],
    ['tipo', { text: 'TIPO:', upper: true }],
    ['cliente', { text: 'CLIENTE:' }],
    ['telefone', { text: 'TELEFONE:' }],
    ['endereco', { text: 'ENDEREÇO:', bold: !r }],
    ['observacao', { text: 'OBSERVAÇÃO:', opts: { line: true } }],
    S(),
  );
  tail.push(['itens', { opts: ITENS_ALL }], S(), ['totais', { size: 'grande' }]);
  if (r) tail.push(['pagamentos'], ['cpf', { text: 'CPF/CNPJ:' }]);
  tail.push(S('='));
  return [...head, ...fields, ...tail];
}

/** Os blocos de um estilo pronto para o papel. */
export function layoutPreset(kind: Kind, id: LayoutPresetId): PrintLayout {
  return {
    blocks: presetSpecs(kind, id)
      .filter(([t]) => LAYOUT_BLOCKS[t].kinds.includes(kind))
      .map(([t, o]) => newLayoutBlock(t, o ?? {})),
  };
}
