import type { OrderChannel, OrderStatus, PaymentMethod, PaymentStatus } from '@comandou/shared';
import type { Category, Me, Product } from '../../lib/api';
import type {
  CashRegister,
  Courier,
  CustomerRow,
  DiningTable,
  MenuCategory,
  Order,
  OrderItem,
  Payment,
  Sector,
  StoreSettings,
  Tab,
} from '../../lib/types';
import type { GroupLink, OptionGroup } from '../../pages/menu/menu-data';
import {
  DEMO_CATEGORIES,
  DEMO_GROUPS,
  DEMO_ITEMS,
  DEMO_STORE,
  type DemoItem,
} from '../../site/demo-data';

/**
 * Estado do exemplo do site: a Fumaça Burger & Co. num dia de movimento, montada na hora em que
 * a página abre (os horários acompanham o relógio de quem visita). Tudo fica só na memória.
 */

// ------------------------------------------------------------------------------- utilidades

let seq = 0;
/** Id no formato de UUID (o app compara e monta endereços com eles). */
export const newId = () => `5a4d0000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;

export const toCents = (v: string | number | null | undefined) =>
  Math.round(Number(v ?? 0) * 100) || 0;
export const money = (cents: number) => (cents / 100).toFixed(2);

/** Sorteio repetível: a mesma visita vê sempre os mesmos números. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = prng(20261127);
export const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;

export const iso = (ms: number) => new Date(ms).toISOString();
export const minutesAgo = (m: number) => iso(Date.now() - m * 60_000);

/** Início do dia de hoje (00:00 local). */
export const startOfDay = (ms = Date.now()) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// ------------------------------------------------------------------------------- quem usa

export const TENANT = { id: newId(), slug: 'fumaca', name: DEMO_STORE.name };
export const USER_ID = newId();
export const USER_NAME = 'Thiago Ferraz';

/** O que o exemplo mostra: as telas da operação e da gestão, sem equipe, ajustes e plano. */
export const PERMISSIONS = [
  'catalog:read',
  'catalog:write',
  'orders:read',
  'orders:write',
  'orders:manage',
  'orders:cancel',
  'orders:discount',
  'kitchen:operate',
  'kitchen:reopen',
  'tables:operate',
  'payments:create',
  'payments:refund',
  'cash:operate',
  'cash:close',
  'reports:read',
  'stock:read',
  'stock:write',
  'delivery:manage',
  'finance:read',
  'finance:write',
  'customers:read',
  'customers:create',
];

export const ME: Me = {
  user: {
    id: USER_ID,
    name: USER_NAME,
    email: 'thiago@fumacaburger.com.br',
    role: 'manager',
    roleLabel: 'Gerente',
    photoAt: null,
  },
  permissions: PERMISSIONS,
  tenant: TENANT,
  support: null,
};

// ------------------------------------------------------------------------------- loja

const fullWeek = (open: string, close: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close }));

export const store: StoreSettings = {
  enabled: true,
  isOpen: true,
  autoAccept: false,
  acceptsDelivery: true,
  acceptsPickup: true,
  deliveryFee: money(Math.round(DEMO_STORE.fee * 100)),
  minOrder: money(DEMO_STORE.minOrder * 100),
  etaMin: 35,
  etaMax: 50,
  about:
    'Hambúrguer artesanal na brasa, pão de fermentação natural e batata cortada na casa. Desde 2019 na Vila Mariana.',
  address: 'Rua Domingos de Morais, 1200 - Vila Mariana',
  whatsapp: '(11) 98765-4321',
  city: 'São Paulo',
  state: 'SP',
  coverImageId: 'demo:capa',
  logoImageId: 'demo:logo',
  theme: 'auto',
  headline: DEMO_STORE.headline,
  featuredTitle: 'Os mais pedidos',
  accountsEnabled: true,
  showPopular: true,
  chatEnabled: true,
  chatGreeting: 'Oi! Em que posso ajudar?',
  brandColor: null,
  accentColor: null,
  fontStyle: 'padrao',
  cornerStyle: 'padrao',
  faviconImageId: null,
  brandStaffApp: false,
  hoursEnabled: true,
  hours: fullWeek('11:00', '23:30'),
  pixEnabled: true,
  pixKeyType: 'cnpj',
  pixKey: '12345678000190',
  pixName: 'Fumaca Burger',
  pixCity: 'Sao Paulo',
  storeLat: '-23.5893',
  storeLng: '-46.6345',
  tableCheckLocation: false,
  tableSelfPickup: false,
  tableAccount: true,
  tableCoupons: true,
  openNow: true,
  hasSite: true,
};

/** Ponto da loja no mapa (Vila Mariana) e um ponto de cliente a até ~3 km dela. */
export const STORE_POINT = { lat: -23.5893, lng: -46.6345 };
export const nearStore = () => ({
  lat: STORE_POINT.lat + (rand() - 0.5) * 0.045,
  lng: STORE_POINT.lng + (rand() - 0.5) * 0.05,
});

// ------------------------------------------------------------------------------- cozinhas

export const sectors: Sector[] = [
  {
    id: newId(),
    name: 'Chapa',
    channels: ['counter', 'table', 'delivery', 'pickup'],
    warnAfterMin: 12,
    lateAfterMin: 20,
    active: true,
  },
  {
    id: newId(),
    name: 'Porções',
    channels: ['counter', 'table', 'delivery', 'pickup'],
    warnAfterMin: 10,
    lateAfterMin: 18,
    active: true,
  },
  {
    id: newId(),
    name: 'Bar',
    channels: ['counter', 'table', 'delivery', 'pickup'],
    warnAfterMin: 6,
    lateAfterMin: 12,
    active: true,
  },
];
const SECTOR_OF: Record<string, string> = {
  combos: sectors[0]!.id,
  burgers: sectors[0]!.id,
  porcoes: sectors[1]!.id,
  shakes: sectors[2]!.id,
  bebidas: sectors[2]!.id,
  sobremesas: sectors[2]!.id,
};

// ------------------------------------------------------------------------------- cardápio

export const categories: Category[] = DEMO_CATEGORIES.map((c, i) => ({
  id: newId(),
  name: c.name,
  position: i,
  active: true,
  imageId: null,
  icon: null,
  sectorId: SECTOR_OF[c.key] ?? null,
}));
const catId = (key: string) => categories[DEMO_CATEGORIES.findIndex((c) => c.key === key)]!.id;

export const groups: OptionGroup[] = Object.values(DEMO_GROUPS).map((g) => ({
  id: newId(),
  name: g.name,
  minSelect: g.min,
  maxSelect: g.max,
  active: true,
  kind: g.key === 'tamanho' || g.key === 'ponto' ? 'variation' : 'additional',
  charge: 'sum',
  allowRepeat: false,
  productCount: 0,
  options: g.options.map((o, i) => ({
    id: newId(),
    name: o.name,
    priceDelta: money(Math.round(o.price * 100)),
    position: i,
    active: true,
    isDefault: false,
    description: o.desc ?? null,
    imageId: null,
  })),
}));
const groupByKey = (key: string) =>
  groups[Object.keys(DEMO_GROUPS).indexOf(key)] as OptionGroup | undefined;

/** Produto do exemplo (o do cardápio e o que a foto e as escolhas pedem). */
export interface DemoProduct extends Product {
  key: string;
  /** Custo do prato (ficha técnica), para margem, DRE e precificação. */
  cost: string;
}

export const products: DemoProduct[] = DEMO_ITEMS.map((it: DemoItem, i) => {
  const price = Math.round(it.price * 100);
  return {
    id: newId(),
    key: it.key,
    categoryId: catId(it.cat),
    name: it.name,
    description: it.desc,
    price: money(price),
    active: true,
    // Um item esgotado, como no dia a dia (aparece apagado na venda).
    soldOut: it.key === 'sundae-morango',
    sectorId: SECTOR_OF[it.cat] ?? null,
    imageId: `demo:${it.img}`,
    featured: it.badge === 'Mais pedido',
    badge: it.badge ?? null,
    code: `P${String(i + 1).padStart(3, '0')}`,
    familyId: null,
    cost: money(Math.round(price * (it.cat === 'bebidas' ? 0.28 : 0.34))),
    soldByWeight: false,
    weightTare: '0.000',
    barcode: null,
    barcodeType: 'fixed',
    position: i,
  };
});

export const links: GroupLink[] = DEMO_ITEMS.flatMap((it, i) =>
  (it.groups ?? []).flatMap((key, position) => {
    const g = groupByKey(key);
    return g ? [{ productId: products[i]!.id, groupId: g.id, position }] : [];
  }),
);
for (const g of groups) g.productCount = links.filter((l) => l.groupId === g.id).length;

export const productById = (id: string) => products.find((p) => p.id === id);

/** O cardápio de venda (Nova venda, garçom): categorias com itens e escolhas. */
export function saleMenu(): MenuCategory[] {
  return categories
    .filter((c) => c.active)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      id: c.id,
      name: c.name,
      imageId: c.imageId ?? null,
      products: products
        .filter((p) => p.categoryId === c.id && p.active)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          soldOut: p.soldOut,
          sectorId: p.sectorId,
          imageId: p.imageId ?? null,
          code: p.code ?? null,
          soldByWeight: false,
          points: Math.floor(toCents(p.price) / 100),
          optionGroups: links
            .filter((l) => l.productId === p.id)
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
            .flatMap((l) => {
              const g = groups.find((x) => x.id === l.groupId && x.active);
              return g
                ? [
                    {
                      id: g.id,
                      name: g.name,
                      minSelect: g.minSelect,
                      maxSelect: g.maxSelect,
                      kind: g.kind,
                      charge: g.charge,
                      allowRepeat: g.allowRepeat,
                      options: g.options
                        .filter((o) => o.active)
                        .map((o) => ({
                          id: o.id,
                          name: o.name,
                          priceDelta: o.priceDelta,
                          description: o.description ?? null,
                        })),
                    },
                  ]
                : [];
            }),
        })),
    }));
}

export function optionById(id: string) {
  for (const g of groups) {
    const o = g.options.find((x) => x.id === id);
    if (o) return o;
  }
  return undefined;
}

// ------------------------------------------------------------------------------- pessoas

const FIRST = [
  'Ana',
  'Bruno',
  'Camila',
  'Diego',
  'Eduarda',
  'Felipe',
  'Gabriela',
  'Henrique',
  'Isabela',
  'João',
  'Larissa',
  'Marcos',
  'Natália',
  'Otávio',
  'Patrícia',
  'Rafael',
  'Sofia',
  'Thiago',
  'Vitória',
  'Lucas',
];
const LAST = [
  'Almeida',
  'Hashimoto',
  'Ribeiro',
  'Vasconcelos',
  'Souza',
  'Martins',
  'Oliveira',
  'Carvalho',
  'Costa',
  'Pereira',
  'Rocha',
  'Lima',
  'Barbosa',
  'Teixeira',
];
const STREETS = [
  'Rua Vergueiro',
  'Rua Domingos de Morais',
  'Rua Joaquim Távora',
  'Rua França Pinto',
  'Rua Humberto I',
  'Rua Machado de Assis',
  'Rua Áurea',
  'Rua Pelotas',
];
export const personName = () => `${pick(FIRST)} ${pick(LAST)}`;
const phone = () => `(11) 9${Math.floor(1000 + rand() * 8999)}-${Math.floor(1000 + rand() * 8999)}`;
const address = () =>
  `${pick(STREETS)}, ${Math.floor(30 + rand() * 1900)} - Vila Mariana, São Paulo`;

export const customers: CustomerRow[] = Array.from({ length: 18 }, (_, i) => {
  const name = i === 0 ? 'Ana Almeida' : i === 1 ? 'Bruno Hashimoto' : personName();
  const orders = 2 + Math.floor(rand() * 30);
  const lastDays = Math.floor(rand() * 25);
  return {
    id: newId(),
    name,
    avatar: null,
    photoUrl: null,
    phone: phone().replace(/\D/g, ''),
    email: `${name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}${i}@email.com`,
    marketingOptIn: rand() > 0.4,
    blocked: false,
    createdAt: iso(Date.now() - (60 + Math.floor(rand() * 300)) * 86_400_000),
    lastLoginAt: iso(Date.now() - lastDays * 86_400_000),
    orders,
    spent: money(orders * (4200 + Math.floor(rand() * 3500))),
    lastOrderAt: iso(Date.now() - lastDays * 86_400_000),
    topItem: pick(products).name,
    document: null,
    birthDay: 1 + Math.floor(rand() * 27),
    birthMonth: 1 + Math.floor(rand() * 11),
  };
});

const COURIER_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44'];
export const couriers: Courier[] = ['Felipe Santos', 'Giovana Cardoso', 'Marcos Lima'].map(
  (name, i) => ({
    id: newId(),
    name,
    phone: phone(),
    userId: null,
    userName: null,
    active: true,
    linkCreatedAt: minutesAgo(60 * 24 * 20),
    linkSeenAt: minutesAgo(1 + i),
    appSeenAt: null,
    color: COURIER_COLORS[i]!,
    linkCopyable: true,
  }),
);

// ------------------------------------------------------------------------------- caixa

export const registers: CashRegister[] = [
  { id: newId(), name: 'Caixa 1', active: true, openSessionId: null },
  { id: newId(), name: 'Caixa 2', active: true, openSessionId: null },
];

export interface DemoMovement {
  id: string;
  sessionId: string;
  kind: 'opening' | 'sale' | 'supply' | 'withdrawal' | 'refund';
  method: PaymentMethod;
  amount: string;
  note: string | null;
  orderId: string | null;
  createdAt: string;
}
export interface DemoSession {
  id: string;
  number: number;
  status: 'open' | 'closed';
  registerId: string;
  openingAmount: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string;
  closedByName: string | null;
  counted: Record<PaymentMethod, string> | null;
  closingNote: string | null;
}
export const sessions: DemoSession[] = [];
export const movements: DemoMovement[] = [];

// ------------------------------------------------------------------------------- salão

const SALON: { label: string; seats: number; area: string; shape: DiningTable['shape'] }[] = [
  ...Array.from({ length: 10 }, (_, i) => ({
    label: String(i + 1),
    seats: i % 3 === 0 ? 2 : i % 4 === 0 ? 6 : 4,
    area: 'Salão',
    shape: (i % 3 === 0 ? 'round' : 'square') as DiningTable['shape'],
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    label: `B${i + 1}`,
    seats: 4,
    area: 'Varanda',
    shape: 'rect' as DiningTable['shape'],
  })),
];

export interface DemoTable {
  id: string;
  label: string;
  seats: number;
  area: string | null;
  position: number;
  shape: DiningTable['shape'];
  active: boolean;
}
export const tables: DemoTable[] = SALON.map((t, i) => ({
  id: newId(),
  label: t.label,
  seats: t.seats,
  area: t.area,
  position: i,
  shape: t.shape,
  active: true,
}));

export interface DemoTab {
  id: string;
  number: number;
  status: Tab['status'];
  customerName: string | null;
  tableId: string | null;
  openedAt: string;
  billRequestedAt: string | null;
  billSplitParts: number | null;
  serviceFeePercent: string | null;
}
export const tabs: DemoTab[] = [];
let tabNumber = 40;
export function openTab(tableId: string | null, customerName: string | null, minutes = 0) {
  const t: DemoTab = {
    id: newId(),
    number: ++tabNumber,
    status: 'open',
    customerName,
    tableId,
    openedAt: minutesAgo(minutes),
    billRequestedAt: null,
    billSplitParts: null,
    serviceFeePercent: '10.00',
  };
  tabs.push(t);
  return t;
}

// ------------------------------------------------------------------------------- pedidos

export interface DemoOrder {
  id: string;
  number: number;
  channel: OrderChannel;
  status: OrderStatus;
  source: 'staff' | 'online' | 'app';
  appChannel: string | null;
  externalCode: string | null;
  tabId: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  cancelReason: string | null;
  discount: number;
  surcharge: number;
  deliveryFee: number;
  version: number;
  createdAt: string;
  acceptedAt: string | null;
  servedAt: string | null;
  paymentHint: PaymentMethod | null;
  changeFor: string | null;
  courierId: string | null;
  /** Corrida do entregador (Entregas): o id dela e o ponto do cliente no mapa. */
  deliveryId: string | null;
  destLat: number | null;
  destLng: number | null;
  /** Corrida que deu errado (voltou para pronto) ou o acerto do dinheiro recebido na porta. */
  deliveryFailed: string | null;
  collect: 'none' | 'pending' | 'settled';
  dispatchedAt: string | null;
  completedAt: string | null;
  items: OrderItem[];
  payments: Payment[];
  history: NonNullable<Order['history']>;
}
export const orders: DemoOrder[] = [];
let orderNumber = 18540;
export const nextOrderNumber = () => ++orderNumber;

export function makeItem(
  p: DemoProduct,
  qty: number,
  optionIds: string[] = [],
  notes: string | null = null,
): OrderItem {
  const opts = optionIds.flatMap((id) => {
    const o = optionById(id);
    return o ? [{ id: newId(), name: o.name, priceDelta: o.priceDelta }] : [];
  });
  const unit = toCents(p.price) + opts.reduce((s, o) => s + toCents(o.priceDelta), 0);
  return {
    id: newId(),
    productId: p.id,
    name: p.name,
    quantity: qty.toFixed(3),
    unit: 'un',
    unitPrice: money(unit),
    total: money(Math.round(unit * qty)),
    notes,
    status: 'pending',
    sectorId: p.sectorId,
    startedAt: null,
    readyAt: null,
    imageId: p.imageId ?? null,
    options: opts,
    cancelReason: null,
  };
}

export const subtotalOf = (o: DemoOrder) =>
  o.items.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + toCents(i.total), 0);
export const totalOf = (o: DemoOrder) =>
  Math.max(0, subtotalOf(o) - o.discount + o.surcharge + o.deliveryFee);
export const paidOf = (o: DemoOrder) =>
  o.payments.reduce((s, p) => s + toCents(p.amount) - toCents(p.refundedAmount), 0);

export function paymentStatusOf(o: DemoOrder): PaymentStatus {
  const paid = paidOf(o);
  if (paid <= 0) return 'unpaid';
  return paid < totalOf(o) ? 'partial' : 'paid';
}

/** O pedido do jeito que a API devolve. */
export function orderView(o: DemoOrder, detail = false): Order {
  const tab = o.tabId ? tabs.find((t) => t.id === o.tabId) : undefined;
  const table = tab?.tableId ? tables.find((t) => t.id === tab.tableId) : undefined;
  const total = totalOf(o);
  const paid = paidOf(o);
  return {
    id: o.id,
    number: o.number,
    channel: o.channel,
    status: o.status,
    paymentStatus: paymentStatusOf(o),
    subtotal: money(subtotalOf(o)),
    discount: money(o.discount),
    surcharge: money(o.surcharge),
    deliveryFee: money(o.deliveryFee),
    total: money(total),
    paidAmount: money(paid),
    balance: money(Math.max(0, total - paid)),
    tabId: o.tabId,
    tabNumber: tab?.number ?? null,
    tableLabel: table?.label ?? null,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    deliveryAddress: o.deliveryAddress,
    deliveryLat: o.destLat === null ? null : o.destLat.toFixed(6),
    deliveryLng: o.destLng === null ? null : o.destLng.toFixed(6),
    taxDocument: null,
    notes: o.notes,
    cancelReason: o.cancelReason,
    receivableAt: null,
    receivableReason: null,
    source: o.source,
    appChannel: o.appChannel,
    externalCode: o.externalCode,
    deliveredBy: o.appChannel ? 'merchant' : null,
    scheduledFor: null,
    paymentHint: o.paymentHint,
    changeFor: o.changeFor,
    acceptedAt: o.acceptedAt,
    pixStatus: null,
    servedAt: o.servedAt,
    pixReceipt: null,
    version: o.version,
    createdAt: o.createdAt,
    items: o.items,
    payments: o.payments,
    ...(detail ? { history: o.history, pixReceipts: [], onlineCharges: [], app: null } : {}),
  };
}

export function tabView(t: DemoTab, withOrders = false): Tab {
  const list = orders.filter((o) => o.tabId === t.id && o.status !== 'cancelled');
  const sub = list.reduce((s, o) => s + subtotalOf(o) - o.discount + o.surcharge, 0);
  const fee = t.serviceFeePercent ? Math.round((sub * Number(t.serviceFeePercent)) / 100) : 0;
  const paid = list.reduce((s, o) => s + paidOf(o), 0);
  const table = t.tableId ? tables.find((x) => x.id === t.tableId) : undefined;
  return {
    id: t.id,
    number: t.number,
    status: t.status,
    customerName: t.customerName,
    tableId: t.tableId,
    tableLabel: table?.label ?? null,
    openedAt: t.openedAt,
    total: money(sub + fee),
    paid: money(paid),
    balance: money(Math.max(0, sub + fee - paid)),
    orderCount: list.length,
    billRequestedAt: t.billRequestedAt,
    pixReceiptAt: null,
    billSplitParts: t.billSplitParts,
    serviceFeePercent: t.serviceFeePercent,
    serviceFee: money(fee),
    ...(withOrders ? { orders: list.map((o) => orderView(o)) } : {}),
  };
}

export function tableView(t: DemoTable): DiningTable {
  const tab = tabs.find((x) => x.tableId === t.id && x.status === 'open');
  const v = tab ? tabView(tab) : null;
  return {
    id: t.id,
    label: t.label,
    seats: t.seats,
    area: t.area,
    position: t.position,
    shape: t.shape,
    active: t.active,
    tabId: tab?.id ?? null,
    tabNumber: tab?.number ?? null,
    openedAt: tab?.openedAt ?? null,
    tabTotal: v?.total ?? '0.00',
    tabPaid: v?.paid ?? '0.00',
    tabCustomer: tab?.customerName ?? null,
    billRequestedAt: tab?.billRequestedAt ?? null,
    pixReceiptAt: null,
    reservationId: null,
    reservationName: null,
    reservationAt: null,
    reservationParty: null,
    reservationStatus: null,
  };
}

/** Caixa aberto agora (o primeiro), para os pagamentos do exemplo. */
export const openSession = () => sessions.find((s) => s.status === 'open') ?? null;

export function addPayment(
  o: DemoOrder,
  method: PaymentMethod,
  cents: number,
  at: string,
  sessionId: string | null,
  tendered: number | null = null,
) {
  const p: Payment = {
    id: newId(),
    method,
    amount: money(cents),
    tendered: tendered ? money(tendered) : null,
    refundedAmount: '0.00',
    cashSessionId: sessionId,
    createdAt: at,
    createdByName: USER_NAME,
  };
  o.payments.push(p);
  if (sessionId)
    movements.push({
      id: newId(),
      sessionId,
      kind: 'sale',
      method,
      amount: money(cents),
      note: null,
      orderId: o.id,
      createdAt: at,
    });
  return p;
}

export function setStatus(
  o: DemoOrder,
  to: OrderStatus,
  reason: string | null = null,
  at?: string,
) {
  const when = at ?? iso(Date.now());
  o.history.push({ from: o.status, to, reason, at: when, actorName: USER_NAME });
  o.status = to;
  o.version += 1;
  if (to === 'new' && !o.acceptedAt) o.acceptedAt = when;
  if (to === 'dispatched') o.dispatchedAt = when;
  if (to === 'completed') o.completedAt = when;
  if (to === 'cancelled') o.cancelReason = reason;
}
