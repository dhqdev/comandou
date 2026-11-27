import { emitLocal } from '../../lib/realtime';
import type { Category, ProductAvailability } from '../../lib/api';
import type {
  Delivery,
  DeliveryZone,
  PricingData,
  RecipeLine,
  StockItem,
  StockLot,
  StockMovement,
  StockReceipt,
  StockUnit,
} from '../../lib/types';
import type { MenuDef } from '../../pages/menu/menu-data';
import { fail, on } from './http';
import {
  categories,
  couriers,
  type DemoOrder,
  type DemoProduct,
  groups,
  iso,
  links,
  minutesAgo,
  money,
  newId,
  openSession,
  orders,
  paidOf,
  customers,
  products,
  rand,
  setStatus,
  store,
  STORE_POINT,
  toCents,
  totalOf,
  addPayment,
  USER_NAME,
} from './state';

/** Retaguarda do exemplo: cadastro do cardápio, estoque e entregas (com os motoboys andando). */

const notFound = () => fail(404, 'Não encontrado');
const today = () => new Date().toISOString().slice(0, 10);
const dayAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------------------- estoque

interface Insumo {
  key: string;
  name: string;
  unit: StockUnit;
  qty: number;
  min: number;
  cost: number;
  category: string;
  supplier: string;
  prep?: boolean;
}
const INSUMOS: Insumo[] = [
  {
    key: 'pao',
    name: 'Pão brioche',
    unit: 'un',
    qty: 86,
    min: 40,
    cost: 1.8,
    category: 'Padaria',
    supplier: 'Padaria Paulista',
  },
  {
    key: 'blend',
    name: 'Blend bovino 160 g',
    unit: 'un',
    qty: 64,
    min: 40,
    cost: 6.9,
    category: 'Carnes',
    supplier: 'Frigorífico Boi Bom',
  },
  {
    key: 'picanha',
    name: 'Blend de picanha 180 g',
    unit: 'un',
    qty: 16,
    min: 20,
    cost: 11.5,
    category: 'Carnes',
    supplier: 'Frigorífico Boi Bom',
  },
  {
    key: 'cheddar',
    name: 'Cheddar inglês (fatia)',
    unit: 'un',
    qty: 210,
    min: 100,
    cost: 0.65,
    category: 'Laticínios',
    supplier: 'Laticínios Serra',
  },
  {
    key: 'bacon',
    name: 'Bacon defumado',
    unit: 'kg',
    qty: 3.4,
    min: 2,
    cost: 42,
    category: 'Carnes',
    supplier: 'Frigorífico Boi Bom',
  },
  {
    key: 'batata',
    name: 'Batata pré-frita',
    unit: 'kg',
    qty: 22,
    min: 10,
    cost: 14.9,
    category: 'Congelados',
    supplier: 'Distribuidora Ceagesp',
  },
  {
    key: 'oleo',
    name: 'Óleo de fritura',
    unit: 'l',
    qty: 18,
    min: 10,
    cost: 9.8,
    category: 'Mercearia',
    supplier: 'Atacadão',
  },
  {
    key: 'alface',
    name: 'Alface americana',
    unit: 'un',
    qty: 6,
    min: 4,
    cost: 3.5,
    category: 'Hortifrúti',
    supplier: 'Hortifrúti Vila',
  },
  {
    key: 'tomate',
    name: 'Tomate',
    unit: 'kg',
    qty: 4.2,
    min: 3,
    cost: 7.9,
    category: 'Hortifrúti',
    supplier: 'Hortifrúti Vila',
  },
  {
    key: 'cebola',
    name: 'Cebola roxa',
    unit: 'kg',
    qty: 1.6,
    min: 3,
    cost: 5.4,
    category: 'Hortifrúti',
    supplier: 'Hortifrúti Vila',
  },
  {
    key: 'maionese',
    name: 'Maionese defumada (da casa)',
    unit: 'kg',
    qty: 1.8,
    min: 1,
    cost: 18,
    category: 'Preparos',
    supplier: 'Produção própria',
    prep: true,
  },
  {
    key: 'barbecue',
    name: 'Molho barbecue (da casa)',
    unit: 'kg',
    qty: 2.5,
    min: 1,
    cost: 22,
    category: 'Preparos',
    supplier: 'Produção própria',
    prep: true,
  },
  {
    key: 'frango',
    name: 'Frango empanado (filé)',
    unit: 'un',
    qty: 24,
    min: 20,
    cost: 4.2,
    category: 'Congelados',
    supplier: 'Distribuidora Ceagesp',
  },
  {
    key: 'graobico',
    name: 'Hambúrguer de grão-de-bico',
    unit: 'un',
    qty: 12,
    min: 10,
    cost: 3.9,
    category: 'Congelados',
    supplier: 'Verde Vida',
  },
  {
    key: 'ovo',
    name: 'Ovo',
    unit: 'un',
    qty: 60,
    min: 30,
    cost: 0.75,
    category: 'Mercearia',
    supplier: 'Granja Feliz',
  },
  {
    key: 'leite',
    name: 'Leite integral',
    unit: 'l',
    qty: 14,
    min: 10,
    cost: 4.9,
    category: 'Laticínios',
    supplier: 'Laticínios Serra',
  },
  {
    key: 'sorvete',
    name: 'Sorvete de creme',
    unit: 'l',
    qty: 7,
    min: 5,
    cost: 18,
    category: 'Sobremesas',
    supplier: 'Gelato Sul',
  },
  {
    key: 'chocolate',
    name: 'Calda de chocolate',
    unit: 'kg',
    qty: 1.2,
    min: 1,
    cost: 28,
    category: 'Sobremesas',
    supplier: 'Atacadão',
  },
  {
    key: 'brownie',
    name: 'Brownie (da casa)',
    unit: 'un',
    qty: 14,
    min: 10,
    cost: 3.8,
    category: 'Preparos',
    supplier: 'Produção própria',
    prep: true,
  },
  {
    key: 'limao',
    name: 'Limão tahiti',
    unit: 'kg',
    qty: 3.5,
    min: 3,
    cost: 6.5,
    category: 'Hortifrúti',
    supplier: 'Hortifrúti Vila',
  },
  {
    key: 'chopp',
    name: 'Chopp pilsen (barril)',
    unit: 'l',
    qty: 38,
    min: 30,
    cost: 9,
    category: 'Bebidas',
    supplier: 'Cervejaria Paulistana',
  },
  {
    key: 'agua',
    name: 'Água com gás 500 ml',
    unit: 'un',
    qty: 34,
    min: 24,
    cost: 1.9,
    category: 'Bebidas',
    supplier: 'Atacadão',
  },
  {
    key: 'onion',
    name: 'Anéis de cebola empanados',
    unit: 'kg',
    qty: 4,
    min: 3,
    cost: 19,
    category: 'Congelados',
    supplier: 'Distribuidora Ceagesp',
  },
  {
    key: 'embalagem',
    name: 'Embalagem de delivery',
    unit: 'un',
    qty: 140,
    min: 100,
    cost: 1.1,
    category: 'Descartáveis',
    supplier: 'Embalagens SP',
  },
];

const qtyStr = (n: number, u: StockUnit) => (u === 'un' ? n.toFixed(0) : n.toFixed(3));
interface StockRow {
  item: StockItem;
  key: string;
}
const stock: StockRow[] = INSUMOS.map((x, i) => {
  const value = Math.round(x.qty * x.cost * 100);
  return {
    key: x.key,
    item: {
      id: newId(),
      code: `IN-${String(i + 1).padStart(6, '0')}`,
      barcode: null,
      name: x.name,
      unit: x.unit,
      quantity: qtyStr(x.qty, x.unit),
      minQuantity: qtyStr(x.min, x.unit),
      avgCost: x.cost.toFixed(4),
      allowNegative: false,
      active: true,
      low: x.qty < x.min,
      stockValue: money(value),
      category: x.category,
      supplier: x.supplier,
      countedAt: iso(Date.now() - (2 + (i % 5)) * 86_400_000),
      dailyUsage: (x.min / 4).toFixed(3),
      shelfLifeDays: x.prep ? 4 : null,
      recipeYield: x.prep ? '1.000' : '0.000',
      hasPrep: !!x.prep,
      lastCost: x.cost.toFixed(4),
      costChangedAt: iso(Date.now() - (8 + i) * 86_400_000),
    },
  };
});
const sid = (key: string) => stock.find((s) => s.key === key)!.item.id;

/** Ficha técnica de cada item do cardápio (pelo nome curto do exemplo). */
const RECIPES: Record<string, [string, number][]> = {
  fumaca: [
    ['pao', 1],
    ['blend', 1],
    ['cheddar', 2],
    ['bacon', 0.03],
    ['maionese', 0.03],
    ['cebola', 0.02],
  ],
  smash: [
    ['pao', 1],
    ['blend', 1],
    ['cheddar', 2],
    ['maionese', 0.02],
  ],
  classico: [
    ['pao', 1],
    ['blend', 1],
    ['cheddar', 1],
    ['alface', 0.1],
    ['tomate', 0.04],
  ],
  'egg-bacon': [
    ['pao', 1],
    ['blend', 1],
    ['cheddar', 1],
    ['ovo', 1],
    ['bacon', 0.03],
  ],
  picanha: [
    ['pao', 1],
    ['picanha', 1],
    ['cheddar', 1],
    ['cebola', 0.03],
  ],
  crispy: [
    ['pao', 1],
    ['frango', 1],
    ['alface', 0.1],
    ['maionese', 0.02],
  ],
  veggie: [
    ['pao', 1],
    ['graobico', 1],
    ['alface', 0.1],
    ['tomate', 0.04],
  ],
  cheeseburger: [
    ['pao', 1],
    ['blend', 1],
    ['cheddar', 1],
  ],
  triplo: [
    ['pao', 1],
    ['blend', 3],
    ['cheddar', 3],
    ['bacon', 0.05],
  ],
  batata: [
    ['batata', 0.25],
    ['oleo', 0.05],
  ],
  'batata-cheddar': [
    ['batata', 0.25],
    ['oleo', 0.05],
    ['cheddar', 3],
    ['bacon', 0.04],
  ],
  'onion-rings': [
    ['onion', 0.2],
    ['oleo', 0.05],
  ],
  iscas: [
    ['frango', 2],
    ['oleo', 0.05],
  ],
  'shake-chocolate': [
    ['leite', 0.2],
    ['sorvete', 0.2],
    ['chocolate', 0.03],
  ],
  'shake-morango': [
    ['leite', 0.2],
    ['sorvete', 0.2],
  ],
  'shake-doce-leite': [
    ['leite', 0.2],
    ['sorvete', 0.2],
  ],
  limonada: [['limao', 0.12]],
  'limonada-suica': [
    ['limao', 0.15],
    ['leite', 0.05],
  ],
  chopp: [['chopp', 0.4]],
  'agua-gas': [
    ['agua', 1],
    ['limao', 0.02],
  ],
  'brownie-sorvete': [
    ['brownie', 1],
    ['sorvete', 0.1],
    ['chocolate', 0.02],
  ],
  sundae: [
    ['sorvete', 0.15],
    ['chocolate', 0.03],
  ],
  'sundae-morango': [['sorvete', 0.15]],
  'combo-fumaca': [
    ['pao', 1],
    ['blend', 1],
    ['cheddar', 2],
    ['bacon', 0.03],
    ['batata', 0.25],
    ['embalagem', 1],
  ],
  'combo-classico': [
    ['pao', 1],
    ['blend', 1],
    ['cheddar', 1],
    ['batata', 0.25],
    ['embalagem', 1],
  ],
  'combo-smash': [
    ['pao', 1],
    ['blend', 1],
    ['cheddar', 2],
    ['batata', 0.25],
    ['embalagem', 1],
  ],
};
const recipeOf = (p: DemoProduct): RecipeLine[] =>
  (RECIPES[p.key] ?? []).map(([k, q]) => ({ stockItemId: sid(k), quantity: q.toFixed(3) }));

const movementsLog: StockMovement[] = [];
function logMovement(
  row: StockRow,
  kind: StockMovement['kind'],
  qty: number,
  note: string | null,
  at: string,
  cost: number | null,
) {
  movementsLog.push({
    id: newId(),
    stockItemId: row.item.id,
    itemName: row.item.name,
    unit: row.item.unit,
    kind,
    quantity: qtyStr(qty, row.item.unit),
    unitCost: cost === null ? null : cost.toFixed(4),
    balanceAfter: row.item.quantity,
    orderId: null,
    orderNumber: null,
    note,
    createdAt: at,
    createdByName: kind === 'sale' ? null : USER_NAME,
    countId: null,
    value: cost === null ? null : money(Math.round(Math.abs(qty) * cost * 100)),
    itemCode: row.item.code,
    receiptCode: kind === 'purchase' ? 'RC-000214' : null,
    receiptId: null,
    productionCode: kind === 'production' ? 'PR-000088' : null,
    lotCode: null,
  });
}
// Uma semana de movimentos: compras, vendas e uma perda.
for (const row of stock) {
  const x = INSUMOS.find((i) => i.key === row.key)!;
  logMovement(
    row,
    'purchase',
    x.min * 2,
    'Compra semanal',
    iso(Date.now() - 5 * 86_400_000),
    x.cost,
  );
  logMovement(row, 'sale', -(x.min * 0.6), null, iso(Date.now() - 2 * 86_400_000), x.cost);
  logMovement(row, 'sale', -(x.min * 0.4), null, minutesAgo(40 + Math.floor(rand() * 90)), x.cost);
}
logMovement(
  stock.find((s) => s.key === 'tomate')!,
  'loss',
  -0.6,
  'Passou do ponto',
  minutesAgo(300),
  7.9,
);

function setQty(row: StockRow, qty: number) {
  row.item.quantity = qtyStr(qty, row.item.unit);
  row.item.low = qty < Number(row.item.minQuantity);
  row.item.stockValue = money(Math.round(qty * Number(row.item.avgCost) * 100));
}

function availability(): ProductAvailability[] {
  return products.map((p) => {
    const lines = recipeOf(p).map((l) => {
      const row = stock.find((s) => s.item.id === l.stockItemId)!;
      const have = Number(row.item.quantity);
      const need = Number(l.quantity);
      return {
        stockItemId: l.stockItemId,
        name: row.item.name,
        unit: row.item.unit,
        need: l.quantity,
        have: row.item.quantity,
        short: have < need,
      };
    });
    const portions = lines.length
      ? Math.floor(Math.min(...lines.map((l) => Number(l.have) / Number(l.need))))
      : null;
    return {
      productId: p.id,
      out: portions !== null && portions < 1,
      portions,
      direct: false,
      missing: lines.filter((l) => l.short).map((l) => l.name),
      lines,
    };
  });
}

// ------------------------------------------------------------------------------- entregas

const deliveryOf = (o: DemoOrder): Delivery | null => {
  if (!o.courierId || !o.deliveryId) return null;
  const c = couriers.find((x) => x.id === o.courierId)!;
  const out = o.status === 'dispatched';
  const pos = out ? courierPos(o) : null;
  const total = totalOf(o);
  return {
    id: o.deliveryId,
    status: o.deliveryFailed ? 'failed' : out ? 'out' : 'delivered',
    orderId: o.id,
    orderNumber: o.number,
    orderStatus: o.status,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    deliveryAddress: o.deliveryAddress,
    total: money(total),
    balance: money(Math.max(0, total - paidOf(o))),
    paymentStatus: paidOf(o) >= total ? 'paid' : paidOf(o) > 0 ? 'partial' : 'unpaid',
    courierId: c.id,
    courierName: c.name,
    dispatchedAt: o.dispatchedAt ?? o.createdAt,
    finishedAt: out ? null : (o.completedAt ?? null),
    failureReason: o.deliveryFailed,
    lastLat: pos ? pos.lat.toFixed(6) : null,
    lastLng: pos ? pos.lng.toFixed(6) : null,
    lastLocationAt: out ? iso(Date.now() - 4000) : null,
    lastHeading: pos?.heading ?? null,
    lastSpeed: out ? 7.5 : null,
    lastAccuracy: out ? 8 : null,
    paymentHint: o.paymentHint,
    changeFor: o.changeFor,
    deliveryLat: o.destLat === null ? null : o.destLat.toFixed(6),
    deliveryLng: o.destLng === null ? null : o.destLng.toFixed(6),
    notes: o.notes,
    courierPay: out ? null : '8.00',
    payEstimate: '8.00',
    distanceM: 2400,
    collectStatus: o.collect,
    collectAmount: o.collect === 'none' ? null : money(total),
    collectMethod: o.collect === 'none' ? null : 'cash',
    settledAt: o.collect === 'settled' ? (o.completedAt ?? null) : null,
  };
};

/** Onde o motoboy está agora: anda da loja até o cliente em ~25 minutos. */
function courierPos(o: DemoOrder) {
  const from = STORE_POINT;
  const to = { lat: o.destLat ?? from.lat, lng: o.destLng ?? from.lng };
  const started = new Date(o.dispatchedAt ?? o.createdAt).getTime();
  const k = Math.min(0.96, Math.max(0.05, (Date.now() - started) / (25 * 60_000)));
  // Um desvio de rua (não anda em linha reta).
  const bend = Math.sin(k * Math.PI) * 0.004;
  const heading = (Math.atan2(to.lng - from.lng, to.lat - from.lat) * 180) / Math.PI;
  return {
    lat: from.lat + (to.lat - from.lat) * k + bend,
    lng: from.lng + (to.lng - from.lng) * k - bend,
    heading: (heading + 360) % 360,
    k,
  };
}
function trailOf(o: DemoOrder): [number, number][] {
  const now = courierPos(o);
  const steps = Math.max(2, Math.round(now.k * 20));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const k = (now.k * i) / steps;
    const to = { lat: o.destLat ?? STORE_POINT.lat, lng: o.destLng ?? STORE_POINT.lng };
    const bend = Math.sin(k * Math.PI) * 0.004;
    return [
      STORE_POINT.lat + (to.lat - STORE_POINT.lat) * k + bend,
      STORE_POINT.lng + (to.lng - STORE_POINT.lng) * k - bend,
    ];
  });
}

const zones: DeliveryZone[] = [
  {
    id: newId(),
    name: 'Até 2 km',
    color: '#2f9e44',
    kind: 'radius',
    polygon: null,
    centerLat: String(STORE_POINT.lat),
    centerLng: String(STORE_POINT.lng),
    radiusM: 2000,
    fee: '4.90',
    minOrder: '25.00',
    etaMin: 25,
    etaMax: 40,
    active: true,
    position: 0,
  },
  {
    id: newId(),
    name: 'Até 4 km',
    color: '#1c7ed6',
    kind: 'radius',
    polygon: null,
    centerLat: String(STORE_POINT.lat),
    centerLng: String(STORE_POINT.lng),
    radiusM: 4000,
    fee: '6.90',
    minOrder: '30.00',
    etaMin: 35,
    etaMax: 50,
    active: true,
    position: 1,
  },
];

export function registerBack() {
  // Item do cardápio: IA das fotos fica para o teste grátis; fotos extras e avaliações do exemplo.
  on('GET', '/catalog-ai', () => ({
    photo: false,
    reason: 'No exemplo do site a IA das fotos fica de fora.',
  }));
  on('GET', '/products/:id/photos', ({ params }) => {
    const p = products.find((x) => x.id === params.id);
    return { imageIds: p?.imageId ? [p.imageId] : [] };
  });
  on('GET', '/products/:id/reviews', ({ params }) => {
    const n = (products.findIndex((x) => x.id === params.id) % 3) + 2;
    const notes = [
      'Chegou quentinho, muito bom!',
      'O pão é ótimo. Peço sempre.',
      'Bem servido, vale o preço.',
      null,
    ];
    return Array.from({ length: n }, (_, i) => ({
      id: `${params.id}-r${i}`,
      name: customers[(i * 5) % customers.length]!.name,
      rating: i === 2 ? 4 : 5,
      comment: notes[i % notes.length] ?? null,
      createdAt: new Date(Date.now() - (i + 1) * 3 * 86_400_000).toISOString(),
      hidden: false,
      likes: 6 - i,
    }));
  });

  // ------------------------------------------------------------------------ cardápio
  on('GET', '/categories', () => categories.slice().sort((a, b) => a.position - b.position));
  on('POST', '/categories', ({ body }) => {
    const b = body as Partial<Category>;
    const c: Category = {
      id: newId(),
      name: String(b.name ?? 'Nova categoria').trim(),
      position: categories.length,
      active: true,
      imageId: null,
      icon: b.icon ?? null,
      sectorId: b.sectorId ?? null,
    };
    categories.push(c);
    emitLocal({ type: 'menu.changed' });
    return c;
  });
  on('PATCH', '/categories/:id', ({ params, body }) => {
    const c = categories.find((x) => x.id === params.id);
    if (!c) return notFound();
    Object.assign(c, body as object);
    emitLocal({ type: 'menu.changed' });
    return c;
  });
  on('GET', '/products', () => products);
  on(
    'GET',
    '/products/:id',
    ({ params }) => products.find((p) => p.id === params.id) ?? notFound(),
  );
  on('POST', '/products', ({ body }) => {
    const b = body as Partial<DemoProduct>;
    const p: DemoProduct = {
      id: newId(),
      key: `novo-${products.length}`,
      categoryId: b.categoryId ?? categories[0]!.id,
      name: String(b.name ?? 'Item novo').trim(),
      description: b.description ?? null,
      price: money(toCents(b.price)),
      active: b.active ?? true,
      soldOut: false,
      sectorId: b.sectorId ?? null,
      imageId: null,
      featured: false,
      badge: null,
      code: `P${String(products.length + 1).padStart(3, '0')}`,
      familyId: null,
      cost: '0.00',
      soldByWeight: false,
      weightTare: '0.000',
      barcode: null,
      barcodeType: 'fixed',
      position: products.length,
    };
    products.push(p);
    emitLocal({ type: 'menu.changed' });
    return p;
  });
  on('PATCH', '/products/:id', ({ params, body }) => {
    const p = products.find((x) => x.id === params.id);
    if (!p) return notFound();
    const b = body as Partial<DemoProduct>;
    Object.assign(p, b, b.price !== undefined ? { price: money(toCents(b.price)) } : {});
    emitLocal({ type: 'menu.changed' });
    return p;
  });
  on('GET', '/products/:id/menus', () => []);
  on('PUT', '/products/:id/menus', () => ({ ok: true }));
  on('PUT', '/products/:id/option-groups', ({ params, body }) => {
    const ids = ((body as { groupIds?: string[] })?.groupIds ?? []) as string[];
    for (let i = links.length - 1; i >= 0; i--)
      if (links[i]!.productId === params.id) links.splice(i, 1);
    ids.forEach((groupId, position) => links.push({ productId: params.id!, groupId, position }));
    for (const g of groups) g.productCount = links.filter((l) => l.groupId === g.id).length;
    emitLocal({ type: 'menu.changed' });
    return { ok: true };
  });
  on('GET', '/item-families', () => []);
  on('GET', '/option-groups', () => groups);
  on('PATCH', '/option-groups/:id', ({ params, body }) => {
    const g = groups.find((x) => x.id === params.id);
    if (!g) return notFound();
    Object.assign(g, body as object);
    emitLocal({ type: 'menu.changed' });
    return g;
  });
  on('GET', '/product-option-groups', () => links);
  on('GET', '/menus', (): MenuDef[] => [
    {
      id: newId(),
      name: 'Principal',
      kind: 'principal',
      active: true,
      items: products.length,
      customPrices: 0,
      updatedAt: minutesAgo(60 * 30),
    },
    {
      id: newId(),
      name: 'Delivery',
      kind: 'delivery',
      active: true,
      items: products.length,
      customPrices: 0,
      updatedAt: minutesAgo(60 * 30),
    },
  ]);
  on('GET', '/fiscal/rules', () => ({ rules: [], links: [], uncovered: [] }));
  on('GET', '/ifood/status', () => ({ configured: false, connections: [] }));
  on('GET', '/ifood/connections', () => []);

  // ------------------------------------------------------------------------ estoque
  on('GET', '/stock/availability', () => availability());
  on('GET', '/stock/items', () => stock.map((s) => s.item));
  on(
    'GET',
    '/stock/items/:id',
    ({ params }) => stock.find((s) => s.item.id === params.id)?.item ?? notFound(),
  );
  on('PATCH', '/stock/items/:id', ({ params, body }) => {
    const row = stock.find((s) => s.item.id === params.id);
    if (!row) return notFound();
    Object.assign(row.item, body as object);
    setQty(row, Number(row.item.quantity));
    emitLocal({ type: 'stock.changed' });
    return row.item;
  });
  on('POST', '/stock/items/:id/movements', ({ params, body }) => {
    const row = stock.find((s) => s.item.id === params.id);
    if (!row) return notFound();
    const b = body as {
      kind: StockMovement['kind'];
      quantity: string | number;
      unitCost?: string;
      note?: string;
    };
    const q = Math.abs(Number(b.quantity));
    const out = b.kind === 'loss' || b.kind === 'withdrawal';
    const next = b.kind === 'adjustment' ? q : Number(row.item.quantity) + (out ? -q : q);
    setQty(row, Math.max(0, next));
    logMovement(
      row,
      b.kind,
      out ? -q : q,
      b.note ?? null,
      iso(Date.now()),
      b.unitCost ? Number(b.unitCost) : Number(row.item.avgCost),
    );
    emitLocal({ type: 'stock.changed' });
    return row.item;
  });
  on('GET', '/stock/movements', ({ query }) => {
    const itemId = query.get('itemId');
    const outOnly = query.get('direction') === 'out';
    return movementsLog
      .filter(
        (m) => (!itemId || m.stockItemId === itemId) && (!outOnly || m.quantity.startsWith('-')),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  on('GET', '/stock/lots', (): StockLot[] =>
    stock
      .filter((s) => s.item.hasPrep)
      .map((s, i) => ({
        id: newId(),
        code: `LT-${String(310 + i).padStart(6, '0')}`,
        stockItemId: s.item.id,
        itemName: s.item.name,
        itemCode: s.item.code,
        unit: s.item.unit,
        quantity: s.item.quantity,
        madeOn: dayAgo(1),
        expiresOn: dayAgo(-3),
        status: 'available',
        origin: 'production',
        receiptCode: null,
        receiptId: null,
        productionCode: `PR-${String(88 + i).padStart(6, '0')}`,
        note: null,
        createdAt: iso(Date.now() - 86_400_000),
        closedAt: null,
      })),
  );
  on('GET', '/stock/receipts', (): StockReceipt[] => [
    {
      id: newId(),
      code: 'RC-000214',
      supplier: 'Frigorífico Boi Bom',
      invoice: '58.231',
      receivedOn: dayAgo(5),
      note: null,
      total: '1243.40',
      createdAt: iso(Date.now() - 5 * 86_400_000),
      createdByName: USER_NAME,
      linesCount: 3,
    },
    {
      id: newId(),
      code: 'RC-000213',
      supplier: 'Hortifrúti Vila',
      invoice: null,
      receivedOn: dayAgo(3),
      note: 'Entrega da manhã',
      total: '186.90',
      createdAt: iso(Date.now() - 3 * 86_400_000),
      createdByName: USER_NAME,
      linesCount: 4,
    },
  ]);
  on('GET', '/stock/productions', () => []);
  on('GET', '/stock/factors', () => []);
  on('GET', '/stock/counts', () => []);
  on('GET', '/stock/cost-changes', () => []);
  on('GET', '/stock/items/:id/usage', ({ params }) => ({
    preps: [],
    menu: products
      .filter((p) => recipeOf(p).some((l) => l.stockItemId === params.id))
      .map((p) => ({ kind: 'product', id: p.id, name: p.name, price: p.price, cost: p.cost })),
  }));
  on('GET', '/stock/recipes', () => ({
    products: products.flatMap((p) => recipeOf(p).map((l) => ({ ...l, productId: p.id }))),
    options: [],
  }));
  on('GET', '/stock/item-recipes', () => []);
  on(
    'GET',
    '/stock/pricing',
    (): PricingData => ({
      settings: {
        taxPercent: '6.00',
        feePercent: '3.50',
        fixedPercent: '18.00',
        targetMargin: '15.00',
      },
      products: products.map((p) => {
        const cat = categories.find((c) => c.id === p.categoryId);
        const sold = 20 + Math.floor(rand() * 260);
        return {
          id: p.id,
          name: p.name,
          categoryName: cat?.name ?? '',
          price: p.price,
          active: p.active,
          cost: Number(p.cost).toFixed(4),
          hasRecipe: true,
          missingCost: false,
          targetMargin: null,
          sold30: String(sold),
          revenue30: money(sold * toCents(p.price)),
        };
      }),
      options: [],
      summary: { revenue30: '84213.70', cogs30: '27980.10', losses30: '412.30' },
    }),
  );

  // ------------------------------------------------------------------------ entregas
  on('GET', '/deliveries', ({ query }) => {
    const scope = query.get('scope') ?? 'active';
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return orders
      .filter(
        (o) =>
          o.deliveryId &&
          (scope === 'active' ? o.status === 'dispatched' : o.createdAt >= start.toISOString()),
      )
      .flatMap((o) => {
        const d = deliveryOf(o);
        return d ? [d] : [];
      })
      .sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt));
  });
  on('GET', '/deliveries/live-map', ({ query }) => {
    const ids = (query.get('ids') ?? '').split(',').filter(Boolean);
    return {
      store: { lat: STORE_POINT.lat, lng: STORE_POINT.lng },
      trails: Object.fromEntries(
        orders
          .filter((o) => o.deliveryId && ids.includes(o.deliveryId))
          .map((o) => [o.deliveryId!, trailOf(o)]),
      ),
    };
  });
  const byDelivery = (id: string) => orders.find((o) => o.deliveryId === id) ?? null;
  on('POST', '/deliveries/:id/complete', ({ params }) => {
    const o = byDelivery(params.id!);
    if (!o) return notFound();
    if (paidOf(o) < totalOf(o)) o.collect = 'pending';
    setStatus(o, 'completed');
    emitLocal({ type: 'delivery.changed', deliveryId: o.deliveryId! });
    emitLocal({ type: 'order.changed', orderId: o.id, status: o.status });
    return { ok: true };
  });
  on('POST', '/deliveries/:id/fail', ({ params, body }) => {
    const o = byDelivery(params.id!);
    if (!o) return notFound();
    o.deliveryFailed = String((body as { reason?: string })?.reason ?? 'Não entregue');
    setStatus(o, 'ready', o.deliveryFailed);
    o.courierId = null;
    emitLocal({ type: 'delivery.changed', deliveryId: params.id! });
    emitLocal({ type: 'order.changed', orderId: o.id, status: o.status });
    return { ok: true };
  });
  on('POST', '/deliveries/:id/tracking-link', ({ params }) => ({
    trackingPath: `/rastreio/exemplo-${byDelivery(params.id!)?.number ?? ''}`,
  }));
  on('GET', '/deliveries/collections', () =>
    couriers
      .map((c) => {
        const list = orders.filter((o) => o.courierId === c.id && o.collect === 'pending');
        return {
          courierId: c.id,
          courierName: c.name,
          total: money(list.reduce((t, o) => t + totalOf(o) - paidOf(o), 0)),
          deliveries: list.flatMap((o) => {
            const d = deliveryOf(o);
            return d ? [d] : [];
          }),
        };
      })
      .filter((g) => g.deliveries.length),
  );
  on('POST', '/deliveries/:id/settle', ({ params, body }) => {
    const o = byDelivery(params.id!);
    if (!o) return notFound();
    const s = (body as { cashSessionId?: string })?.cashSessionId ?? openSession()?.id ?? null;
    addPayment(o, 'cash', totalOf(o) - paidOf(o), iso(Date.now()), s);
    o.collect = 'settled';
    emitLocal({ type: 'delivery.changed', deliveryId: o.deliveryId! });
    return { ok: true };
  });
  on('GET', '/delivery-zones', () => ({
    zones,
    store: {
      lat: String(STORE_POINT.lat),
      lng: String(STORE_POINT.lng),
      address: store.address,
      deliveryFee: store.deliveryFee,
    },
  }));
  on('GET', '/couriers/:id/link', () => ({ path: '/entregador/exemplo' }));
  on('PATCH', '/couriers/:id', ({ params, body }) => {
    const c = couriers.find((x) => x.id === params.id);
    if (!c) return notFound();
    Object.assign(c, body as object);
    return c;
  });
  on('GET', '/users', () => []);

  // Os motoboys andam: a cada poucos segundos o mapa recebe a posição nova.
  window.setInterval(() => {
    for (const o of orders.filter((x) => x.status === 'dispatched' && x.deliveryId)) {
      const p = courierPos(o);
      emitLocal({
        type: 'delivery.location',
        deliveryId: o.deliveryId!,
        lat: p.lat,
        lng: p.lng,
        heading: p.heading,
        speed: 7.5,
        at: iso(Date.now()),
      });
    }
  }, 4000);
}

export const day = { today, dayAgo };
