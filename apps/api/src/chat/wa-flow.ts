/**
 * Atendimento por menu no WhatsApp (0.279, pedido do David: "estilo de call center, começando
 * por um menu com os números"). Partes puras: tipos, formatação do WhatsApp, leitura das
 * respostas do cliente (número, quantidade, endereço, pedido escrito) e as contas da sacola.
 * Quem anda pelas telas é o `WaFlowEngine` (wa-flow-engine.ts), sem gastar a IA; ela só entra
 * para entender um pedido escrito que o leitor daqui não entendeu e para as perguntas livres.
 */

export type PayMethod = 'pix' | 'cash' | 'credit' | 'debit' | 'voucher';
export const PAY_METHODS: PayMethod[] = ['pix', 'cash', 'credit', 'debit', 'voucher'];
export const PAY_LABEL: Record<PayMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  credit: 'Cartão de crédito',
  debit: 'Cartão de débito',
  voucher: 'Vale-refeição',
};
const PAY_ICON: Record<PayMethod, string> = {
  pix: '⚡',
  cash: '💵',
  credit: '💳',
  debit: '💳',
  voucher: '🎫',
};

/** O que o dono deixou o atendimento por menu fazer (tela Assistente de IA). */
export interface FlowSettings {
  takeOrders: boolean;
  orderStatus: boolean;
  offerSignup: boolean;
  guestOrders: boolean;
  orderDelivery: boolean;
  orderPickup: boolean;
  payMethods: PayMethod[];
  understandText: boolean;
  itemNotes: boolean;
  sendTracking: boolean;
  freeChat: boolean;
  showInfo: boolean;
  takeReservations: boolean;
  sendPdfs: boolean;
  showPrices: boolean;
  suggestItems: boolean;
}

export interface FlowOption {
  id: string;
  name: string;
  priceDelta: string;
  stockOut?: boolean;
}
export interface FlowGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  allowRepeat?: boolean;
  options: FlowOption[];
}
export interface FlowItem {
  id: string;
  name: string;
  description: string | null;
  price: string;
  soldOut: boolean;
  soldByWeight: boolean;
  groups: FlowGroup[];
}
export interface FlowCategory {
  name: string;
  items: FlowItem[];
}

/** Uma linha da sacola. `unit` = preço de uma unidade já com os adicionais (em centavos). */
export interface CartLine {
  productId: string;
  name: string;
  qty: number;
  unit: number;
  optionIds: string[];
  optionNames: string[];
  notes?: string;
}

/** Item sendo montado (escolhas de complemento, observação). */
export interface ItemDraft {
  productId: string;
  qty: number;
  optionIds: string[];
  /** Grupo de complementos da vez (índice em `groups` do item). */
  group: number;
  notes?: string;
  /** Observação já veio no pedido escrito: não pergunta de novo. */
  notesAsked?: boolean;
}

export interface FlowAddress {
  street: string;
  number: string;
  district: string;
  complement?: string;
  reference?: string;
  city?: string;
  state?: string;
  cep?: string;
  lat?: number;
  lng?: number;
  /** Endereço salvo no cadastro (não grava de novo). */
  savedId?: string;
}

export type FlowStep =
  | 'home'
  | 'who'
  | 'who_name'
  | 'signup_name'
  | 'mode'
  | 'address'
  | 'address_new'
  | 'address_check'
  | 'address_fail'
  | 'cats'
  | 'items'
  | 'qty'
  | 'option'
  | 'notes'
  | 'cart'
  | 'remove'
  | 'pay'
  | 'change'
  | 'review'
  | 'chat';

/** Onde o cliente está no menu (guardado em ai_customer_chats.flow). */
export interface Flow {
  at: FlowStep;
  cart: CartLine[];
  mode?: 'delivery' | 'pickup';
  customerId?: string | null;
  name?: string;
  address?: FlowAddress;
  /** Taxa da entrega e pedido mínimo do endereço (centavos). */
  fee?: number;
  minOrder?: number;
  pay?: PayMethod;
  /** Troco para (centavos); 0 = não precisa. */
  changeFor?: number;
  cat?: number;
  draft?: ItemDraft;
  /** Itens do pedido escrito que ainda pedem escolha (complementos obrigatórios). */
  queue?: ItemDraft[];
  /** Ids das escolhas da tela atual (endereços salvos, sugestão). */
  pick?: string[];
  /** Sugestão de item para acompanhar (id do produto), mostrada na sacola. */
  upsell?: string;
  /** Pedido feito por esta conversa (para não fazer duas vezes com dois "1"). */
  placed?: string;
  /** O cliente pediu para fechar: depois da sacola vêm pagamento e conferência. */
  checkout?: boolean;
}

export const newFlow = (): Flow => ({ at: 'home', cart: [] });

// ------------------------------------------------------------------ formatação do WhatsApp

const KEYCAPS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/** Número da opção: 1️⃣ … 🔟 e, depois disso, *11.* em negrito. */
export const num = (n: number) => KEYCAPS[n] ?? `*${n}.*`;

/** Texto em negrito do WhatsApp (sem asterisco solto dentro). */
export const b = (s: string) => `*${clean(s)}*`;
/** Itálico. */
export const i = (s: string) => `_${clean(s).replace(/_/g, ' ')}_`;
/** Riscado. */
export const s = (t: string) => `~${clean(t).replace(/~/g, ' ')}~`;
/** Monoespaçado (bloco). */
export const mono = (t: string) => `\`\`\`${t.replace(/`/g, "'")}\`\`\``;
/** Código curto na linha. */
export const code = (t: string) => `\`${t.replace(/`/g, "'")}\``;
/** Citação. */
export const quote = (t: string) =>
  t
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

/** Tira as marcas de formatação de um texto do cardápio (não quebra o negrito de fora). */
export function clean(t: string): string {
  return t
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "36.90" ou 3690 centavos → "R$ 36,90". */
export function money(v: number | string): string {
  const cents = typeof v === 'number' ? v : toCents(v);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}

export function toCents(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '0').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export const fromCents = (c: number) => (c / 100).toFixed(2);

/** Lista de opções numeradas, uma por linha. */
export function options(lines: string[], start = 1): string {
  return lines.map((l, k) => `${num(k + start)} ${l}`).join('\n');
}

const HINT = quote('Responda com o *número* da opção.');
const BACK = `${num(0)} Voltar`;

// ------------------------------------------------------------------ leitura das respostas

/** Tira acento, pontuação e caixa: "Pão de Queijo!" → "pao de queijo". */
export function norm(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  meia: 6,
};

/** Resposta que é só um número de opção ("2", "2.", "opção 2", "2️⃣", "dois"). */
export function choice(text: string): number | null {
  const t = text.replace(/⃣|️/g, '').replace(/🔟/g, '10').trim();
  const m = /^(?:op[cç][aã]o\s*)?#?\s*(\d{1,2})\s*[.)-]?$/i.exec(t);
  if (m) return Number(m[1]);
  const w = norm(t);
  return w in WORD_NUMBERS ? WORD_NUMBERS[w]! : null;
}

/** Várias opções separadas por vírgula, espaço ou "e" ("1, 3 e 4"). null se tiver outra coisa. */
export function choices(text: string): number[] | null {
  const parts = text
    .replace(/⃣|️/g, '')
    .split(/\s*(?:,|;|\s+e\s+|\s+)\s*/i)
    .filter(Boolean);
  if (!parts.length) return null;
  const out: number[] = [];
  for (const p of parts) {
    const n = choice(p);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/** Quantidade de 1 a 50 ("2", "duas", "2 unidades"). */
export function quantity(text: string): number | null {
  const t = norm(text)
    .replace(/\b(unidades?|un|x|vezes)\b/g, '')
    .trim();
  const n = /^\d{1,3}$/.test(t) ? Number(t) : (WORD_NUMBERS[t] ?? null);
  return n !== null && n >= 1 && n <= 50 ? n : null;
}

/** Valor em reais escrito pelo cliente ("100", "R$ 50,00", "cinquenta" não). Centavos ou null. */
export function amount(text: string): number | null {
  const m = /(\d{1,5}(?:[.,]\d{1,2})?)/.exec(text.replace(/r\$\s*/i, ''));
  if (!m) return null;
  return toCents(m[1]!.replace(',', '.'));
}

const GREETINGS =
  /^(oi+|ola|ol[aá]+|opa|eai|e ai|bom dia|boa tarde|boa noite|boa|hello|hi|hey|menu|inicio|comecar|ajuda|cardapio inicial|voltar ao menu|oi tudo bem|oi boa noite|oi bom dia|oi boa tarde|ola boa noite|ola bom dia|ola boa tarde)$/;

/** "oi", "bom dia", "menu": mostra o menu de novo (sem IA). */
export const isGreeting = (text: string) => GREETINGS.test(norm(text));

/** Palavras que voltam ao começo de qualquer tela. */
export const isMenuWord = (text: string) =>
  /^(menu|inicio|recomecar|comecar de novo|voltar ao inicio)$/.test(norm(text));
export const isCartWord = (text: string) =>
  /^(sacola|carrinho|meu pedido|ver sacola|ver carrinho)$/.test(norm(text));
export const isCancelWord = (text: string) =>
  /^(cancelar|cancela|desistir|desisto|parar|sair)$/.test(norm(text));

/**
 * Endereço escrito numa linha: "Rua das Flores, 120, Centro, apto 12". Rua, número e bairro são
 * obrigatórios; o resto vira complemento. null quando não deu para separar.
 */
export function parseAddress(text: string): FlowAddress | null {
  const raw = text.replace(/\n+/g, ', ').replace(/\s+/g, ' ').trim();
  if (raw.length < 8 || raw.length > 300) return null;
  const cepM = /\b(\d{5})-?(\d{3})\b/.exec(raw);
  const cep = cepM ? `${cepM[1]}${cepM[2]}` : undefined;
  const noCep = cepM ? raw.replace(cepM[0], '').replace(/\bcep\b:?/i, '') : raw;
  let parts = noCep
    .split(/\s*[,;]\s*|\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  // "Rua das Flores 120, Centro": o número veio colado na rua.
  if (parts.length >= 1 && !/\d/.test(parts[1] ?? '')) {
    const m = /^(.*?\D)\s+(\d{1,6}[a-z]?)$/i.exec(parts[0]!);
    if (m) parts = [m[1]!.trim(), m[2]!, ...parts.slice(1)];
  }
  if (parts.length < 3) return null;
  const [street, number, ...rest] = parts;
  const numM = /^(?:n[º°o.]?\s*)?(\d{1,6}[a-z]?|s\/?n)$/i.exec(number!.trim());
  if (!numM || street!.length < 3) return null;
  const district = rest[0]!;
  if (district.length < 2 || /\d{3,}/.test(district)) return null;
  const extra = rest.slice(1).join(', ').slice(0, 80);
  return {
    street: street!.slice(0, 120),
    number: numM[1]!.toUpperCase().replace('/', '').replace(/^SN$/, 'S/N').slice(0, 20),
    district: district.slice(0, 80),
    ...(extra ? { complement: extra } : {}),
    ...(cep ? { cep } : {}),
  };
}

export const addressLine = (a: FlowAddress) =>
  `${a.street}, ${a.number}${a.complement ? ` (${a.complement})` : ''} — ${a.district}`;

// ------------------------------------------------------------------ pedido escrito sem IA

/** Item do pedido escrito que o leitor reconheceu. */
export interface TextPick {
  productId: string;
  qty: number;
  notes?: string;
}

const STOP = new Set(['de', 'da', 'do', 'com', 'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'no', 'na']);
const tokens = (t: string) =>
  norm(t)
    .split(' ')
    .filter((w) => w && !STOP.has(w));

/**
 * Lê "2 smash duplo e uma coca sem gelo" pelo cardápio, sem IA. Cada pedaço (separado por
 * vírgula, "e", "+" ou linha) precisa casar com um item só, com folga; senão devolve null e a IA
 * entra (se o dono deixou). "sem/com/tirar ..." no pedaço vira observação.
 */
export function readOrderText(text: string, menu: FlowCategory[]): TextPick[] | null {
  const items = menu.flatMap((c) => c.items).filter((it) => !it.soldOut && !it.soldByWeight);
  if (!items.length) return null;
  const body = norm(
    text.replace(
      /\b(quero|queria|gostaria de|me ve|me manda|manda|pedir|vou querer|por favor|pfv|pf)\b/gi,
      ' ',
    ),
  );
  if (!body) return null;
  const pieces = text
    .replace(
      /\b(quero|queria|gostaria de|me v[eê]|me manda|manda|pedir|vou querer|por favor|pfv|pf)\b/gi,
      ' ',
    )
    .split(
      /\s*(?:,|;|\+|\n|\s+e\s+(?=\d|um\b|uma\b|dois\b|duas\b|tr[eê]s\b|quatro\b|cinco\b|mais\b)|\s+mais\s+)\s*/i,
    )
    .map((p) => p.trim())
    .filter((p) => norm(p));
  if (!pieces.length || pieces.length > 12) return null;
  const out: TextPick[] = [];
  for (const piece of pieces) {
    const noteM = /\b((?:sem|com|tirar|tira|bem|mal|pouco|muito|extra)\b.*)$/i.exec(piece);
    const head = noteM ? piece.slice(0, noteM.index) : piece;
    const words = norm(head).split(' ');
    let qty = 1;
    const q = words[0] ?? '';
    if (/^\d{1,2}$/.test(q)) {
      qty = Number(q);
      words.shift();
    } else if (q in WORD_NUMBERS && WORD_NUMBERS[q]! > 0) {
      qty = WORD_NUMBERS[q]!;
      words.shift();
    } else if (/^\d{1,2}x$/.test(q)) {
      qty = Number(q.slice(0, -1));
      words.shift();
    }
    const want = words.filter((w) => w && !STOP.has(w) && w !== 'x');
    if (!want.length || qty < 1 || qty > 50) return null;
    let best: { it: FlowItem; score: number } | null = null;
    let second = 0;
    for (const it of items) {
      const name = tokens(it.name);
      if (!name.length) continue;
      const hit = want.filter((w) =>
        name.some((n) => n === w || (w.length >= 4 && n.startsWith(w))),
      );
      // Quanto do pedaço casou e quanto do nome do item apareceu.
      const score = hit.length / want.length + hit.length / name.length;
      if (!best || score > best.score) {
        second = best?.score ?? 0;
        best = { it, score };
      } else if (score > second) second = score;
    }
    if (!best || best.score < 1.2 || best.score - second < 0.25) return null;
    const notes = noteM?.[1]?.trim().slice(0, 140);
    const prev = out.find((o) => o.productId === best!.it.id && o.notes === notes);
    if (prev) prev.qty += qty;
    else out.push({ productId: best.it.id, qty, ...(notes ? { notes } : {}) });
  }
  return out.length ? out : null;
}

// ------------------------------------------------------------------ sacola

export const findItem = (menu: FlowCategory[], id: string) =>
  menu.flatMap((c) => c.items).find((it) => it.id === id) ?? null;

/** Preço de uma unidade com os adicionais escolhidos (centavos). */
export function unitPrice(it: FlowItem, optionIds: string[]): number {
  let cents = toCents(it.price);
  for (const g of it.groups)
    for (const id of optionIds) {
      const o = g.options.find((x) => x.id === id);
      if (o) cents += toCents(o.priceDelta);
    }
  return cents;
}

export function optionNames(it: FlowItem, optionIds: string[]): string[] {
  const out: string[] = [];
  for (const g of it.groups)
    for (const id of optionIds) {
      const o = g.options.find((x) => x.id === id);
      if (o) out.push(o.name);
    }
  return out;
}

export const subtotal = (cart: CartLine[]) => cart.reduce((n, l) => n + l.unit * l.qty, 0);
export const cartCount = (cart: CartLine[]) => cart.reduce((n, l) => n + l.qty, 0);

/** Junta na sacola (mesmo item, mesmas escolhas e observação = soma a quantidade). */
export function addToCart(cart: CartLine[], line: CartLine): CartLine[] {
  const same = cart.find(
    (l) =>
      l.productId === line.productId &&
      (l.notes ?? '') === (line.notes ?? '') &&
      [...l.optionIds].sort().join() === [...line.optionIds].sort().join(),
  );
  if (!same) return [...cart, line];
  return cart.map((l) => (l === same ? { ...l, qty: Math.min(99, l.qty + line.qty) } : l));
}

/** Grupos que o item ainda precisa responder (obrigatórios sempre; opcionais se `all`). */
export function groupsToAsk(it: FlowItem, all: boolean): number[] {
  return it.groups
    .map((g, k) => ({ g, k }))
    .filter(({ g }) => g.options.some((o) => !o.stockOut) && (all || g.minSelect > 0))
    .map(({ k }) => k);
}

/** Item para acompanhar (bebida ou sobremesa que ainda não está na sacola). */
export function upsellFor(menu: FlowCategory[], cart: CartLine[]): FlowItem | null {
  if (!cart.length) return null;
  const inCart = new Set(cart.map((l) => l.productId));
  const extras = /bebida|drink|refri|suco|sobremesa|doce|acompanhamento|porc/;
  for (const c of menu) {
    if (!extras.test(norm(c.name))) continue;
    const it = c.items.find(
      (x) =>
        !x.soldOut && !x.soldByWeight && !inCart.has(x.id) && groupsToAsk(x, false).length === 0,
    );
    if (it) return it;
  }
  return null;
}

// ------------------------------------------------------------------ textos das telas

export interface HomeEntry {
  key: 'order' | 'status' | 'menu' | 'reserve' | 'info' | 'human';
  label: string;
}

/** Opções do menu principal, na ordem, pelo que o dono ligou. */
export function homeEntries(st: FlowSettings, o: { reservations: boolean }): HomeEntry[] {
  const out: HomeEntry[] = [];
  if (st.takeOrders) out.push({ key: 'order', label: '🛵 Fazer um pedido' });
  if (st.orderStatus) out.push({ key: 'status', label: '📦 Acompanhar meu pedido' });
  out.push({ key: 'menu', label: '📖 Ver o cardápio' });
  if (st.takeReservations && o.reservations)
    out.push({ key: 'reserve', label: '📅 Reservar uma mesa' });
  if (st.showInfo) out.push({ key: 'info', label: '🕒 Horários e endereço' });
  out.push({ key: 'human', label: '🙋 Falar com uma pessoa' });
  return out;
}

export function homeText(o: {
  agent: string;
  store: string;
  name: string | null;
  greeting: string | null;
  entries: HomeEntry[];
  open: boolean;
  closedNote: string | null;
}): string {
  const hello = o.greeting?.trim()
    ? clean(o.greeting)
    : `Olá${o.name ? `, ${b(o.name.split(' ')[0]!)}` : ''}! 👋 Aqui é ${b(o.agent)}, da ${b(o.store)}.`;
  return [
    hello,
    o.open
      ? i('Como posso te ajudar?')
      : `🔴 ${i('Estamos fechados agora.')}${o.closedNote ? ` ${o.closedNote}` : ''}`,
    '',
    options(o.entries.map((e) => e.label)),
    '',
    HINT,
  ].join('\n');
}

export function catsText(menu: FlowCategory[], cart: CartLine[], o: { understandText: boolean }) {
  const lines = [
    `🍽️ ${b('Cardápio')}`,
    i('Escolha uma categoria:'),
    '',
    options(menu.map((c) => `${clean(c.name)} ${i(`(${c.items.length})`)}`)),
  ];
  if (o.understandText)
    lines.push('', `💬 ${i('Ou escreva o pedido, ex.:')} ${code('2 smash e 1 coca')}`);
  if (cart.length)
    lines.push(
      '',
      `🛒 Sacola: ${cartCount(cart)} ${cartCount(cart) === 1 ? 'item' : 'itens'} · ${b(money(subtotal(cart)))} — mande ${b('sacola')} para fechar`,
    );
  lines.push(BACK);
  return lines.join('\n');
}

export function itemsText(c: FlowCategory, showPrices: boolean) {
  const lines = c.items.map((it, k) => {
    const price = showPrices ? ` — ${b(money(it.price))}${it.soldByWeight ? ' o kg' : ''}` : '';
    const desc = it.description ? `\n    ${i(clean(it.description).slice(0, 70))}` : '';
    if (it.soldOut) return `${num(k + 1)} ${s(it.name)} ${i('esgotado')}`;
    return `${num(k + 1)} ${clean(it.name)}${price}${desc}`;
  });
  return [`${b(clean(c.name))}`, '', ...lines, '', BACK].join('\n');
}

export function qtyText(it: FlowItem, showPrices: boolean) {
  return [
    `${b(clean(it.name))}${showPrices ? ` — ${money(it.price)}` : ''}`,
    it.description ? i(clean(it.description).slice(0, 140)) : null,
    '',
    `Quantos você quer? Mande o número ${i('(ex.: 1 ou 2)')}.`,
    BACK,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function optionText(it: FlowItem, g: FlowGroup, showPrices: boolean) {
  const rule =
    g.minSelect > 0
      ? g.minSelect === g.maxSelect
        ? `escolha ${g.minSelect}`
        : `escolha de ${g.minSelect} a ${g.maxSelect}`
      : `opcional, até ${g.maxSelect}`;
  const opts = g.options.map((o) => {
    const plus = showPrices && toCents(o.priceDelta) > 0 ? ` ${i(`+${money(o.priceDelta)}`)}` : '';
    return o.stockOut ? `${s(o.name)} ${i('em falta')}` : `${clean(o.name)}${plus}`;
  });
  const many = g.maxSelect > 1;
  return [
    `${b(clean(it.name))} · ${b(clean(g.name))} ${i(`(${rule})`)}`,
    '',
    options(opts),
    g.minSelect === 0 ? `${num(0)} Não quero` : null,
    '',
    many ? quote(`Pode mandar mais de um: ${code('1, 3')}`) : HINT,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export const notesText = (it: FlowItem) =>
  [
    `📝 Alguma observação para ${b(clean(it.name))}?`,
    i('Ex.: sem cebola, ponto da carne, sem gelo.'),
    '',
    `${num(0)} Sem observação`,
  ].join('\n');

/** Linhas da sacola ("- 2× Smash duplo (Bem passado) — R$ 77,80"). */
export function cartLines(cart: CartLine[], showPrices = true): string[] {
  return cart.map((l) => {
    const opts = l.optionNames.length ? ` ${i(`(${l.optionNames.map(clean).join(', ')})`)}` : '';
    const price = showPrices ? ` — ${money(l.unit * l.qty)}` : '';
    const notes = l.notes ? `\n   ↳ obs.: ${i(l.notes)}` : '';
    return `- ${l.qty}× ${clean(l.name)}${opts}${price}${notes}`;
  });
}

export function cartText(
  cart: CartLine[],
  o: { upsell: FlowItem | null; showPrices: boolean; added?: string },
) {
  const lines: string[] = [];
  if (o.added) lines.push(`✅ Adicionei ${o.added}.`, '');
  if (!cart.length) {
    lines.push(`🛒 ${i('Sua sacola está vazia.')}`, '', options(['➕ Escolher itens']), BACK);
    return lines.join('\n');
  }
  lines.push(`🛒 ${b('Sua sacola')}`, ...cartLines(cart, o.showPrices));
  if (o.showPrices) lines.push(i(`Subtotal: ${money(subtotal(cart))}`));
  lines.push('', options(['➕ Adicionar mais itens', '✅ Fechar o pedido', '🗑️ Tirar um item']));
  if (o.upsell)
    lines.push(
      '',
      `💡 Que tal ${b(clean(o.upsell.name))}${o.showPrices ? ` (${money(o.upsell.price)})` : ''}? Mande ${num(4)} para adicionar.`,
    );
  return lines.join('\n');
}

export function removeText(cart: CartLine[]) {
  return [
    `🗑️ ${b('Qual item sai da sacola?')}`,
    '',
    options(cart.map((l) => `${l.qty}× ${clean(l.name)}`)),
    BACK,
  ].join('\n');
}

export function payText(methods: PayMethod[], mode: 'delivery' | 'pickup') {
  return [
    `💳 ${b('Como vai pagar?')}`,
    i(mode === 'delivery' ? 'O pagamento é na entrega.' : 'O pagamento é na retirada.'),
    '',
    options(methods.map((m) => `${PAY_ICON[m]} ${PAY_LABEL[m]}`)),
    BACK,
  ].join('\n');
}

export const changeText = (total: number) =>
  [
    `💵 Vai precisar de troco?`,
    `Mande o valor que vai pagar ${i(`(o total é ${money(total)})`)}, ex.: ${code('100')}.`,
    '',
    `${num(0)} Não preciso de troco`,
  ].join('\n');

export function reviewText(
  f: Flow,
  o: { showPrices: boolean; eta: string | null; storeAddress: string | null },
) {
  const sub = subtotal(f.cart);
  const fee = f.mode === 'delivery' ? (f.fee ?? 0) : 0;
  const lines = [`🧾 ${b('Confira seu pedido')}`, '', ...cartLines(f.cart, o.showPrices), ''];
  if (o.showPrices) {
    lines.push(`Subtotal: ${money(sub)}`);
    if (f.mode === 'delivery') lines.push(`Entrega: ${fee ? money(fee) : 'grátis'}`);
    lines.push(b(`Total: ${money(sub + fee)}`), '');
  }
  lines.push(
    f.mode === 'delivery' && f.address
      ? `🛵 Entrega em: ${addressLine(f.address)}`
      : `🏃 Retirada na loja${o.storeAddress ? `: ${clean(o.storeAddress)}` : ''}`,
  );
  if (o.eta) lines.push(`⏱️ Previsão: ${o.eta}`);
  if (f.pay)
    lines.push(
      `${PAY_ICON[f.pay]} Pagamento: ${PAY_LABEL[f.pay]}${f.pay === 'cash' && f.changeFor ? ` ${i(`(troco para ${money(f.changeFor)})`)}` : ''}`,
    );
  if (f.name) lines.push(`👤 Nome: ${clean(f.name)}`);
  lines.push('', options(['✅ Confirmar pedido', '✏️ Mudar algo']), `${num(0)} ❌ Cancelar pedido`);
  return lines.join('\n');
}

/** Situação do pedido com um sinal de cor (o mesmo texto da IA, mais curto). */
export const STATUS_DOT: Record<string, string> = {
  awaiting: '🟡',
  new: '🟠',
  in_production: '👨‍🍳',
  ready: '✅',
  dispatched: '🛵',
  completed: '🏁',
  cancel_requested: '⚠️',
  cancelled: '❌',
};
