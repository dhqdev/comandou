import type { OrderChannel, OrderStatus, PaymentMethod } from '@comandou/shared';
import {
  addPayment,
  couriers,
  customers,
  type DemoOrder,
  type DemoProduct,
  groups,
  iso,
  links,
  makeItem,
  movements,
  nearStore,
  newId,
  nextOrderNumber,
  openTab,
  orders,
  personName,
  pick,
  products,
  rand,
  registers,
  sessions,
  startOfDay,
  tables,
  tabs,
  totalOf,
  USER_NAME,
} from './state';

/**
 * O dia da Fumaça até agora: caixa aberto desde a abertura, pedidos já concluídos (pagos), mesas
 * ocupadas com comanda, pedidos andando pelo PDV e pela cozinha e entregadores na rua. Os horários
 * saem do relógio de quem visita, então o exemplo sempre parece "agora".
 */

const PAY_MIX: PaymentMethod[] = [
  'pix',
  'pix',
  'pix',
  'credit',
  'credit',
  'debit',
  'debit',
  'cash',
];

const byKey = (key: string) => products.find((p) => p.key === key)!;

/** Escolhas obrigatórias do item (ponto da carne, bebida do combo, tamanho). */
function requiredOptions(p: DemoProduct): string[] {
  return links
    .filter((l) => l.productId === p.id)
    .flatMap((l) => {
      const g = groups.find((x) => x.id === l.groupId);
      if (!g) return [];
      if (g.minSelect > 0) return [pick(g.options.slice(0, 3)).id];
      // Adicional de vez em quando (bacon, cheddar…).
      return rand() < 0.25 ? [pick(g.options).id] : [];
    });
}

const BURGERS = ['fumaca', 'smash', 'classico', 'egg-bacon', 'picanha', 'crispy', 'cheeseburger'];
const SIDES = ['batata', 'batata-cheddar', 'onion-rings', 'iscas'];
const DRINKS = ['limonada', 'limonada-suica', 'chopp', 'agua-gas', 'shake-chocolate'];
const SWEETS = ['brownie-sorvete', 'sundae'];

/** Um pedido de verdade: burger ou combo, às vezes porção, bebida e sobremesa. */
function basket(size: number): [string, number][] {
  const out: [string, number][] = [];
  const combo = rand() < 0.3;
  out.push([combo ? pick(['combo-fumaca', 'combo-classico', 'combo-smash']) : pick(BURGERS), 1]);
  if (size > 1) out.push([pick(BURGERS), 1]);
  if (rand() < 0.6) out.push([pick(SIDES), 1]);
  if (!combo || rand() < 0.4) out.push([pick(DRINKS), size > 1 && rand() < 0.5 ? 2 : 1]);
  if (rand() < 0.25) out.push([pick(SWEETS), 1]);
  return out;
}

interface Plan {
  channel: OrderChannel;
  status: OrderStatus;
  at: number;
  source?: DemoOrder['source'];
  tabId?: string | null;
  customer?: { id: string | null; name: string; phone: string | null };
  items?: [string, number][];
  pay?: PaymentMethod | null;
  sessionId?: string | null;
  courierId?: string | null;
  notes?: string | null;
  served?: boolean;
  /** Item da cozinha já começado (pedido em produção). */
  started?: number;
}

export function makeOrder(p: Plan): DemoOrder {
  const created = iso(p.at);
  const o: DemoOrder = {
    id: newId(),
    number: nextOrderNumber(),
    channel: p.channel,
    status: 'new',
    source: p.source ?? 'staff',
    appChannel: null,
    externalCode: null,
    tabId: p.tabId ?? null,
    customerId: p.customer?.id ?? null,
    customerName: p.customer?.name ?? null,
    customerPhone: p.customer?.phone ?? null,
    deliveryAddress:
      p.channel === 'delivery'
        ? `${pick(['Rua Vergueiro', 'Rua Joaquim Távora', 'Rua França Pinto', 'Rua Humberto I', 'Rua Áurea'])}, ${Math.floor(40 + rand() * 1500)} - Vila Mariana`
        : null,
    notes: p.notes ?? null,
    cancelReason: null,
    discount: 0,
    surcharge: 0,
    deliveryFee: p.channel === 'delivery' ? 690 : 0,
    version: 1,
    createdAt: created,
    acceptedAt: p.source === 'online' && p.status === 'awaiting' ? null : created,
    servedAt: null,
    paymentHint: null,
    changeFor: null,
    courierId: p.courierId ?? null,
    deliveryId: p.courierId ? newId() : null,
    destLat: null,
    destLng: null,
    deliveryFailed: null,
    collect: 'none',
    dispatchedAt: null,
    completedAt: null,
    items: (p.items ?? basket(p.channel === 'table' ? 2 : 1)).map(([key, qty]) => {
      const prod = byKey(key);
      return makeItem(prod, qty, requiredOptions(prod));
    }),
    payments: [],
    history: [{ from: null, to: 'new', reason: null, at: created, actorName: USER_NAME }],
  };
  // Itens na cozinha conforme o pedido anda.
  const flow: OrderStatus[] = ['ready', 'dispatched', 'completed'];
  const step = (min: number) => iso(p.at + min * 60_000);
  o.items.forEach((it, i) => {
    if (flow.includes(p.status)) {
      it.status = 'ready';
      it.startedAt = step(2 + i);
      it.readyAt = step(9 + i * 2);
    } else if (p.status === 'in_production' || p.status === 'cancel_requested') {
      if (i < (p.started ?? 1)) {
        it.status = 'preparing';
        it.startedAt = step(2 + i);
      }
    }
  });
  if (p.status === 'awaiting') {
    o.status = 'awaiting';
    o.history = [{ from: null, to: 'awaiting', reason: null, at: created, actorName: null }];
  } else if (p.status !== 'new') {
    const path: OrderStatus[] =
      p.status === 'completed'
        ? p.channel === 'delivery'
          ? ['in_production', 'ready', 'dispatched', 'completed']
          : ['in_production', 'ready', 'completed']
        : p.status === 'dispatched'
          ? ['in_production', 'ready', 'dispatched']
          : p.status === 'ready'
            ? ['in_production', 'ready']
            : p.status === 'cancelled'
              ? ['cancelled']
              : [p.status];
    path.forEach((s, i) => {
      o.history.push({
        from: o.status,
        to: s,
        reason: s === 'cancelled' ? 'Cliente desistiu' : null,
        at: step(2 + i * 8),
        actorName: USER_NAME,
      });
      o.status = s;
      o.version += 1;
    });
    if (o.status === 'dispatched') o.dispatchedAt = step(18);
    if (o.status === 'completed') o.completedAt = step(p.channel === 'delivery' ? 38 : 20);
    if (o.status === 'cancelled') {
      o.cancelReason = 'Cliente desistiu';
      o.items.forEach((it) => (it.status = 'cancelled'));
    }
  }
  if (p.served) o.servedAt = step(14);
  if (p.channel === 'delivery') {
    const at = nearStore();
    o.destLat = at.lat;
    o.destLng = at.lng;
  }
  if (p.pay) {
    const total = totalOf(o);
    const at = p.status === 'completed' ? (o.completedAt ?? created) : created;
    const tendered = p.pay === 'cash' ? Math.ceil(total / 5000) * 5000 : null;
    addPayment(o, p.pay, total, at, p.sessionId ?? null, tendered);
  }
  orders.push(o);
  return o;
}

let seeded = false;

export function seedDay() {
  if (seeded) return;
  seeded = true;
  const now = Date.now();
  // Abriu às 11h; visita bem cedo ainda mostra umas cinco horas de movimento.
  const opened = Math.min(startOfDay(now) + 11 * 3_600_000, now - 5 * 3_600_000);
  const minutes = (now - opened) / 60_000;

  // Caixa 1 aberto desde a abertura; o 2 ficou fechado ontem.
  const s1 = {
    id: newId(),
    number: 128,
    status: 'open' as const,
    registerId: registers[0]!.id,
    openingAmount: '200.00',
    openedAt: iso(opened - 8 * 60_000),
    closedAt: null,
    openedByName: USER_NAME,
    closedByName: null,
    counted: null,
    closingNote: null,
  };
  const s0 = {
    id: newId(),
    number: 127,
    status: 'closed' as const,
    registerId: registers[1]!.id,
    openingAmount: '150.00',
    openedAt: iso(opened - 24 * 3_600_000),
    closedAt: iso(opened - 12 * 3_600_000),
    openedByName: 'Larissa Costa',
    closedByName: 'Larissa Costa',
    counted: {
      cash: '812.40',
      credit: '1540.20',
      debit: '980.70',
      pix: '2310.50',
      voucher: '0.00',
      other: '0.00',
    },
    closingNote: null,
  };
  sessions.push(s0, s1);
  registers[0]!.openSessionId = s1.id;
  movements.push(
    {
      id: newId(),
      sessionId: s1.id,
      kind: 'opening',
      method: 'cash',
      amount: '200.00',
      note: 'Fundo de troco',
      orderId: null,
      createdAt: s1.openedAt,
    },
    {
      id: newId(),
      sessionId: s1.id,
      kind: 'supply',
      method: 'cash',
      amount: '50.00',
      note: 'Moedas para troco',
      orderId: null,
      createdAt: iso(opened + 60 * 60_000),
    },
  );

  // Pedidos já concluídos ao longo do dia (até 25 min atrás).
  const done = Math.round(Math.min(64, Math.max(30, minutes / 6)));
  const channels: OrderChannel[] = [
    'counter',
    'counter',
    'delivery',
    'delivery',
    'pickup',
    'table',
    'table',
  ];
  for (let i = 0; i < done; i++) {
    const at = opened + ((minutes - 25) * 60_000 * (i + rand() * 0.8)) / done;
    const channel = pick(channels);
    const online = channel !== 'counter' && channel !== 'table' && rand() < 0.6;
    const c = online ? pick(customers) : null;
    if (channel === 'table') {
      const t = openTab(pick(tables).id, null, (now - at) / 60_000);
      t.status = 'closed';
      makeOrder({
        channel,
        status: 'completed',
        at,
        tabId: t.id,
        pay: pick(PAY_MIX),
        sessionId: s1.id,
        served: true,
      });
      continue;
    }
    makeOrder({
      channel,
      status: 'completed',
      at,
      source: online ? 'online' : 'staff',
      customer: c
        ? { id: c.id, name: c.name, phone: c.phone }
        : channel === 'counter'
          ? undefined
          : { id: null, name: personName(), phone: null },
      pay: pick(PAY_MIX),
      sessionId: s1.id,
      courierId: channel === 'delivery' ? pick(couriers).id : null,
    });
  }
  // Um cancelado no meio do dia.
  makeOrder({
    channel: 'delivery',
    status: 'cancelled',
    at: opened + minutes * 0.4 * 60_000,
    source: 'online',
    customer: { id: customers[5]!.id, name: customers[5]!.name, phone: customers[5]!.phone },
  });

  // Sangria do meio do dia.
  movements.push({
    id: newId(),
    sessionId: s1.id,
    kind: 'withdrawal',
    method: 'cash',
    amount: '300.00',
    note: 'Sangria para o cofre',
    orderId: null,
    createdAt: iso(opened + minutes * 0.55 * 60_000),
  });

  // Mesas ocupadas agora (comanda aberta com pedidos andando).
  const mesa = (label: string) => tables.find((t) => t.label === label)!.id;
  const ago = (m: number) => now - m * 60_000;
  const t2 = openTab(mesa('2'), null, 43);
  makeOrder({
    channel: 'table',
    status: 'ready',
    at: ago(41),
    tabId: t2.id,
    served: true,
    items: [
      ['fumaca', 1],
      ['picanha', 1],
      ['batata', 1],
      ['chopp', 2],
    ],
  });
  makeOrder({
    channel: 'table',
    status: 'in_production',
    at: ago(12),
    tabId: t2.id,
    items: [
      ['brownie-sorvete', 1],
      ['sundae', 1],
    ],
    started: 1,
  });
  const t5 = openTab(mesa('5'), 'Família Rocha', 9);
  makeOrder({
    channel: 'table',
    status: 'new',
    at: ago(6),
    tabId: t5.id,
    items: [
      ['combo-fumaca', 2],
      ['combo-classico', 1],
      ['onion-rings', 1],
      ['limonada-suica', 2],
    ],
  });
  const t7 = openTab(mesa('7'), null, 65);
  makeOrder({
    channel: 'table',
    status: 'ready',
    at: ago(62),
    tabId: t7.id,
    served: true,
    items: [
      ['smash', 2],
      ['batata-cheddar', 1],
      ['chopp', 3],
    ],
  });
  makeOrder({
    channel: 'table',
    status: 'ready',
    at: ago(28),
    tabId: t7.id,
    served: true,
    items: [
      ['chopp', 2],
      ['onion-rings', 1],
    ],
  });
  t7.billRequestedAt = iso(ago(4));
  t7.billSplitParts = 2;
  const tb2 = openTab(mesa('B2'), 'Aniversário da Bia', 33);
  makeOrder({
    channel: 'table',
    status: 'in_production',
    at: ago(30),
    tabId: tb2.id,
    items: [
      ['triplo', 1],
      ['fumaca', 2],
      ['batata', 2],
      ['shake-chocolate', 2],
      ['agua-gas', 1],
    ],
    started: 3,
  });
  const comanda = openTab(null, 'Rafael (balcão)', 25);
  makeOrder({
    channel: 'table',
    status: 'ready',
    at: ago(24),
    tabId: comanda.id,
    served: true,
    items: [
      ['cheeseburger', 1],
      ['chopp', 1],
    ],
  });

  // Pedidos do PDV andando agora.
  const ana = customers[0]!;
  const bruno = customers[1]!;
  const online = (c: (typeof customers)[number]) => ({ id: c.id, name: c.name, phone: c.phone });
  const a1 = makeOrder({
    channel: 'delivery',
    status: 'awaiting',
    at: ago(5),
    source: 'online',
    customer: online(ana),
  });
  a1.paymentHint = 'pix';
  const a2 = makeOrder({
    channel: 'pickup',
    status: 'awaiting',
    at: ago(4),
    source: 'online',
    customer: online(bruno),
    items: [
      ['smash', 1],
      ['batata', 1],
    ],
  });
  a2.paymentHint = 'credit';
  makeOrder({
    channel: 'counter',
    status: 'in_production',
    at: ago(15),
    pay: 'pix',
    sessionId: s1.id,
  });
  makeOrder({
    channel: 'delivery',
    status: 'in_production',
    at: ago(14),
    source: 'online',
    customer: online(customers[2]!),
    pay: 'pix',
    sessionId: s1.id,
    started: 2,
  });
  makeOrder({
    channel: 'delivery',
    status: 'in_production',
    at: ago(11),
    customer: { id: null, name: personName(), phone: null },
    started: 1,
  }).paymentHint = 'cash';
  makeOrder({
    channel: 'counter',
    status: 'ready',
    at: ago(19),
    pay: 'debit',
    sessionId: s1.id,
    customer: { id: null, name: 'Senha 12', phone: null },
  });
  makeOrder({
    channel: 'pickup',
    status: 'ready',
    at: ago(22),
    source: 'online',
    customer: online(customers[3]!),
    pay: 'pix',
    sessionId: s1.id,
  });
  makeOrder({
    channel: 'delivery',
    status: 'ready',
    at: ago(26),
    source: 'online',
    customer: online(customers[4]!),
    pay: 'credit',
    sessionId: s1.id,
  });
  makeOrder({
    channel: 'delivery',
    status: 'dispatched',
    at: ago(41),
    source: 'online',
    customer: online(customers[6]!),
    pay: 'pix',
    sessionId: s1.id,
    courierId: couriers[0]!.id,
  });
  const d2 = makeOrder({
    channel: 'delivery',
    status: 'dispatched',
    at: ago(36),
    customer: online(customers[7]!),
    courierId: couriers[1]!.id,
  });
  d2.paymentHint = 'cash';
  d2.changeFor = '100.00';
  makeOrder({
    channel: 'delivery',
    status: 'cancel_requested',
    at: ago(18),
    source: 'online',
    customer: online(customers[8]!),
    pay: 'pix',
    sessionId: s1.id,
    started: 1,
    notes: 'Cliente pediu para cancelar: endereço errado',
  });
}

/** Comandas já fechadas não aparecem no Salão; só as abertas contam. */
export const openTabs = () => tabs.filter((t) => t.status === 'open');
