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

engine.registerFilter('dinheiro', money);
engine.registerFilter('centro', (v: unknown) =>
  str(v)
    .split('\n')
    .map((l) => {
      const t = l.slice(0, WIDTH);
      return ' '.repeat(Math.floor((WIDTH - t.length) / 2)) + t;
    })
    .join('\n'),
);
engine.registerFilter('esquerda', (v: unknown, n?: unknown) =>
  str(v).slice(0, clampWidth(n)).padEnd(clampWidth(n)),
);
engine.registerFilter('direita', (v: unknown, n?: unknown) =>
  str(v).slice(0, clampWidth(n)).padStart(clampWidth(n)),
);
/** "Total" | linha: "R$ 10,00" → texto à esquerda e valor à direita, na largura da bobina. */
engine.registerFilter('linha', (label: unknown, value?: unknown) => {
  const v = str(value).slice(0, WIDTH);
  const l = str(label).slice(0, Math.max(0, WIDTH - v.length - 1));
  return l.padEnd(WIDTH - v.length) + v;
});
/** Linha separadora: {{ "-" | traco }} ou {{ "=" | traco }}. */
engine.registerFilter('traco', (ch?: unknown) => (str(ch) || '-').slice(0, 1).repeat(WIDTH));
/** Quebra um texto longo em linhas da largura da bobina. */
engine.registerFilter('quebra', (v: unknown, indent?: unknown) => {
  const pad = ' '.repeat(Math.min(10, Number(indent) || 0));
  const out: string[] = [];
  let cur = '';
  for (const w of str(v).split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > WIDTH - pad.length) {
      if (cur) out.push(pad + cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(pad + cur);
  return out.join('\n');
});
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
    out = await engine.parseAndRender(body, data);
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

function friendly(err: unknown) {
  const m = (err as Error).message ?? String(err);
  if (/undefined filter/i.test(m)) return `Filtro desconhecido: ${m.replace(/.*filter:?\s*/i, '')}`;
  if (/not found|ENOENT|template/i.test(m) && /include|render|layout/i.test(m))
    return 'Os modelos não podem incluir outros arquivos';
  if (/limit/i.test(m)) return 'O modelo é pesado demais (laço muito grande?)';
  return `Erro no modelo: ${m.split('\n')[0].slice(0, 200)}`;
}

/**
 * Modelos iniciais: reproduzem o leiaute padrão do Comandou. O restaurante começa daqui e muda o
 * que quiser. Sem modelo salvo, o sistema usa o leiaute embutido (o mesmo resultado).
 */
export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  receipt: `{{ loja.nome | centro }}
{% if loja.endereco %}{{ loja.endereco | quebra | centro }}
{% endif %}{{ "CONFERÊNCIA DE CONTA" | centro }}
{{ "NÃO É DOCUMENTO FISCAL" | centro }}
{{ "=" | traco }}
{% if comanda_inteira %}{{ "COMANDA " | append: pedido.comanda | linha: pedido.hora }}{% else %}{{ "PEDIDO #" | append: pedido.numero | linha: pedido.hora }}{% endif %}
{% if impresso_em %}Impresso em {{ impresso_em }}
{% endif %}{{ pedido.local }}
{% if pedido.cliente %}Cliente: {{ pedido.cliente }}
{% endif %}{% if pedido.entrega %}{% if pedido.telefone %}Tel: {{ pedido.telefone }}
{% endif %}{{ "Entrega: " | append: pedido.endereco | quebra }}
{% endif %}{{ "-" | traco }}
{% for item in itens %}{{ item.quantidade_formatada | append: " " | append: item.nome | linha: item.total_formatado }}
{% for op in item.opcoes %}{{ "+ " | append: op | quebra: 3 }}
{% endfor %}{% if item.observacao %}{{ "OBS: " | append: item.observacao | quebra: 3 }}
{% endif %}{% endfor %}{{ "-" | traco }}
{% if totais.tem_extras %}{{ "Subtotal" | linha: totais.subtotal_formatado }}
{% endif %}{% if totais.desconto > 0 %}{{ "Desconto" | linha: totais.desconto_formatado }}
{% endif %}{% if totais.acrescimo > 0 %}{{ "Taxa de serviço" | linha: totais.acrescimo_formatado }}
{% endif %}{% if totais.entrega > 0 %}{{ "Taxa de entrega" | linha: totais.entrega_formatado }}
{% endif %}{{ "TOTAL" | linha: totais.total_formatado }}
{% if pagamentos.size > 0 %}{{ "-" | traco }}
{% for p in pagamentos %}{{ "Pago (" | append: p.forma | append: ")" | linha: p.valor_formatado }}
{% if p.troco > 0 %}{{ "  Troco" | linha: p.troco_formatado }}
{% endif %}{% endfor %}{% if totais.falta > 0 %}{{ "FALTA PAGAR" | linha: totais.falta_formatado }}
{% endif %}{% elsif pedido.pagar_na_entrega %}{{ "-" | traco }}
Pagamento na entrega: {{ pedido.pagar_na_entrega }}
{% if pedido.troco_para > 0 %}{{ "Troco para" | linha: pedido.troco_para_formatado }}
{% endif %}{% endif %}{% if pedido.cpf_cnpj %}CPF/CNPJ na nota: {{ pedido.cpf_cnpj }}
{% endif %}{% if pedido.observacao %}{{ "-" | traco }}
{{ "OBS DO PEDIDO: " | append: pedido.observacao | quebra }}
{% endif %}{{ "=" | traco }}`,
  delivery_slip: `{{ loja.nome | centro }}
{{ "VIA DE ENTREGA" | centro }}
{{ "=" | traco }}
Pedido: #{{ pedido.numero }}
Data: {{ pedido.data }}
{{ "-" | traco }}
{% if pedido.cliente %}{{ "Cliente: " | append: pedido.cliente | quebra }}
{% endif %}{% if pedido.telefone %}Telefone: {{ pedido.telefone }}
{% endif %}{% if pedido.endereco %}{{ pedido.endereco | quebra }}
{% endif %}{% unless pedido.entrega %}{{ pedido.canal }}
{% endunless %}{{ "-" | traco }}
{% for item in itens %}{{ item.quantidade_formatada | append: " " | append: item.nome | linha: item.total_formatado }}
{% for op in item.opcoes %}{{ "+ " | append: op | quebra: 3 }}
{% endfor %}{% if item.observacao %}{{ "OBS: " | append: item.observacao | quebra: 3 }}
{% endif %}{% endfor %}{{ "-" | traco }}
{{ "Subtotal:" | linha: totais.subtotal_formatado }}
{% if totais.desconto > 0 %}{{ "Desconto:" | linha: totais.desconto_formatado }}
{% endif %}{% if totais.acrescimo > 0 %}{{ "Acréscimo:" | linha: totais.acrescimo_formatado }}
{% endif %}{% if totais.entrega > 0 %}{{ "Taxa de entrega:" | linha: totais.entrega_formatado }}
{% endif %}{% if pedido.pago %}{{ "TOTAL:" | linha: totais.total_formatado }}
{{ "*** PAGO - NÃO COBRAR ***" | centro }}
{% for p in pagamentos %}Pago com: {{ p.forma }}
{% endfor %}{% else %}{{ "TOTAL A COBRAR:" | linha: pedido.cobrar_formatado }}
{% if pedido.pagar_na_entrega %}Pagamento: {{ pedido.pagar_na_entrega }}
{% endif %}{% if pedido.levar_de_troco > 0 %}{{ "Troco para:" | linha: pedido.troco_para_formatado }}
{{ "Levar de troco:" | linha: pedido.levar_de_troco_formatado }}
{% endif %}{% endif %}{% if pedido.observacao %}{{ "Obs.: " | append: pedido.observacao | quebra }}
{% endif %}{{ "=" | traco }}`,
  kitchen_ticket: `{{ setor | upcase | centro }}
{{ "=" | traco }}
{{ "PEDIDO #" | append: pedido.numero | linha: pedido.hora }}
{{ pedido.local }}{% if pedido.cliente %} - {{ pedido.cliente }}{% endif %}
{{ "-" | traco }}
{% for item in itens %}{{ item.quantidade_formatada | append: " " | append: item.nome | quebra }}
{% for op in item.opcoes %}{{ "+ " | append: op | quebra: 3 }}
{% endfor %}{% if item.observacao %}{{ "OBS: " | append: item.observacao | quebra: 3 }}
{% endif %}{% endfor %}{% if pedido.observacao %}{{ "-" | traco }}
{{ "OBS DO PEDIDO: " | append: pedido.observacao | quebra }}
{% endif %}{{ "=" | traco }}`,
  fiscal_footer: `{{ "Obrigado pela preferência!" | centro }}
{% if loja.nome %}{{ loja.nome | centro }}{% endif %}`,
};

/** Dados de exemplo para a prévia quando o restaurante ainda não tem pedido. */
export function sampleData(kind: TemplateKind, storeName: string): Record<string, unknown> {
  const pedido = {
    numero: 128,
    hora: '03/11 19:42',
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
    loja: { nome: storeName, endereco: 'Av. Central, 75 - Centro' },
    largura: WIDTH,
    impresso_em: '03/11/2026 19:58:10',
  };
  if (kind === 'kitchen_ticket') return { ...base, setor: 'Cozinha', pedido, itens };
  if (kind === 'delivery_slip') {
    const entrega = {
      ...pedido,
      canal: 'Delivery',
      local: 'Delivery',
      mesa: null,
      entrega: true,
      data: '03/11/2026 19:42:10',
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
  if (kind === 'fiscal_footer') return { ...base, pedido, nota: { numero: '1234', serie: '1' } };
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
