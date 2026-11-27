import { canTransition, type OrderStatus, type PaymentMethod } from '@comandou/shared';
import { emitLocal } from '../../lib/realtime';
import type { CashSession, CashTimeline, CashTimelineEvent, Tab } from '../../lib/types';
import { fail, on, Reply } from './http';
import { makeOrder } from './seed';
import {
  addPayment,
  couriers,
  customers,
  type DemoOrder,
  iso,
  makeItem,
  ME,
  nearStore,
  money,
  movements,
  newId,
  nextOrderNumber,
  openSession,
  openTab,
  orders,
  orderView,
  paidOf,
  productById,
  registers,
  saleMenu,
  sectors,
  sessions,
  setStatus,
  store,
  tables,
  tableView,
  tabs,
  tabView,
  toCents,
  totalOf,
  USER_NAME,
  type DemoSession,
} from './state';

/** Pedidos, salão, comandas, cozinha, caixa e clientes: o dia a dia do PDV no exemplo. */

const order = (id: string) => orders.find((o) => o.id === id) ?? null;
const notFound = () => fail(404, 'Não encontrado');
const changed = (o: DemoOrder) => {
  emitLocal({ type: 'order.changed', orderId: o.id, status: o.status });
  emitLocal({ type: 'kitchen.changed', orderId: o.id });
  if (o.tabId) emitLocal({ type: 'tab.changed', tabId: o.tabId });
};
const ACTIVE: OrderStatus[] = [
  'awaiting',
  'new',
  'in_production',
  'ready',
  'dispatched',
  'cancel_requested',
];

interface ItemIn {
  productId: string;
  quantity: number;
  notes?: string;
  optionIds?: string[];
}

function itemsFrom(list: ItemIn[] | undefined) {
  return (list ?? []).flatMap((i) => {
    const p = productById(i.productId);
    return p ? [makeItem(p, i.quantity, i.optionIds ?? [], i.notes?.trim() || null)] : [];
  });
}

/** Itens do pedido voltam a andar na cozinha conforme o status. */
function itemsFollow(o: DemoOrder, to: OrderStatus) {
  const now = iso(Date.now());
  for (const it of o.items) {
    if (it.status === 'cancelled') continue;
    if (to === 'cancelled') it.status = 'cancelled';
    else if (to === 'ready' || to === 'dispatched' || to === 'completed') {
      if (it.status !== 'ready') {
        it.status = 'ready';
        it.startedAt = it.startedAt ?? now;
        it.readyAt = now;
      }
    } else if (to === 'in_production' && it.status === 'pending') {
      it.status = 'preparing';
      it.startedAt = now;
    }
  }
}

export function registerOps() {
  // ------------------------------------------------------------------------ pedidos
  on('GET', '/orders', ({ query }) => {
    const status = query.get('status')?.split(',') as OrderStatus[] | undefined;
    const channel = query.get('channel');
    const from = query.get('from');
    const to = query.get('to');
    const limit = Number(query.get('limit') ?? 100);
    let list = orders.slice();
    if (query.get('active') === 'true') list = list.filter((o) => ACTIVE.includes(o.status));
    if (status) list = list.filter((o) => status.includes(o.status));
    if (channel) list = list.filter((o) => o.channel === channel);
    if (from) list = list.filter((o) => o.createdAt >= new Date(from).toISOString());
    if (to) list = list.filter((o) => o.createdAt < new Date(to).toISOString());
    if (query.get('toServe') === 'true')
      list = list.filter((o) => o.channel === 'table' && o.status === 'ready' && !o.servedAt);
    if (query.get('openBalance') === 'true')
      list = list.filter((o) => o.status === 'completed' && paidOf(o) < totalOf(o));
    if (query.get('pixRefund') === 'true') list = [];
    return list
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((o) => orderView(o));
  });
  on('GET', '/orders/period-counts', ({ query }) => {
    const ranges = query.getAll('r');
    return Object.fromEntries(
      ranges.map((r) => {
        const [key, from, to] = r.split(',');
        const n = orders.filter(
          (o) =>
            o.createdAt >= new Date(from!).toISOString() &&
            o.createdAt < new Date(to!).toISOString(),
        ).length;
        return [key, n];
      }),
    );
  });
  on('GET', '/orders/:id', ({ params }) => {
    const o = order(params.id!);
    return o ? orderView(o, true) : notFound();
  });
  on('POST', '/orders', ({ body }) => {
    const b = body as {
      channel: DemoOrder['channel'];
      tabId?: string;
      tableId?: string;
      customerName?: string;
      customerPhone?: string;
      customerId?: string;
      deliveryAddress?: string;
      notes?: string;
      deliveryFee?: string;
      discount?: string;
      surcharge?: string;
      items: ItemIn[];
    };
    const items = itemsFrom(b.items);
    if (!items.length) return fail(422, 'Escolha ao menos um item');
    let tabId = b.tabId ?? null;
    if (!tabId && b.tableId) {
      const open = tabs.find((t) => t.tableId === b.tableId && t.status === 'open');
      tabId = (open ?? openTab(b.tableId, null)).id;
    }
    const c = b.customerId ? customers.find((x) => x.id === b.customerId) : undefined;
    const now = iso(Date.now());
    const o: DemoOrder = {
      id: newId(),
      number: nextOrderNumber(),
      channel: b.channel,
      status: 'new',
      source: 'staff',
      appChannel: null,
      externalCode: null,
      tabId,
      customerId: c?.id ?? null,
      customerName: b.customerName?.trim() || c?.name || null,
      customerPhone: b.customerPhone?.trim() || c?.phone || null,
      deliveryAddress: b.deliveryAddress?.trim() || null,
      notes: b.notes?.trim() || null,
      cancelReason: null,
      discount: toCents(b.discount),
      surcharge: toCents(b.surcharge),
      deliveryFee: b.channel === 'delivery' ? toCents(b.deliveryFee ?? store.deliveryFee) : 0,
      version: 1,
      createdAt: now,
      acceptedAt: now,
      servedAt: null,
      paymentHint: null,
      changeFor: null,
      courierId: null,
      deliveryId: null,
      destLat: b.channel === 'delivery' ? nearStore().lat : null,
      destLng: b.channel === 'delivery' ? nearStore().lng : null,
      deliveryFailed: null,
      collect: 'none',
      dispatchedAt: null,
      completedAt: null,
      items,
      payments: [],
      history: [{ from: null, to: 'new', reason: null, at: now, actorName: USER_NAME }],
    };
    orders.push(o);
    changed(o);
    return orderView(o, true);
  });
  on('POST', '/orders/:id/status', ({ params, body }) => {
    const o = order(params.id!);
    if (!o) return notFound();
    const b = body as { to: OrderStatus; reason?: string; receivable?: boolean };
    if (!canTransition(o.status, b.to, o.channel))
      return fail(409, 'Este pedido já mudou de situação. A tela foi atualizada.');
    if (b.to === 'completed' && paidOf(o) < totalOf(o) && !b.receivable)
      return fail(422, 'Receba o pagamento antes de concluir o pedido');
    setStatus(o, b.to, b.reason ?? null);
    itemsFollow(o, b.to);
    changed(o);
    return orderView(o, true);
  });
  on('POST', '/orders/:id/served', ({ params }) => {
    const o = order(params.id!);
    if (!o) return notFound();
    o.servedAt = iso(Date.now());
    o.version += 1;
    changed(o);
    return orderView(o, true);
  });
  on('POST', '/orders/:id/claim', ({ params }) => {
    const o = order(params.id!);
    return o ? orderView(o, true) : notFound();
  });
  on('POST', '/orders/:id/payments', ({ params, body }) => {
    const o = order(params.id!);
    if (!o) return notFound();
    const b = body as {
      cashSessionId: string;
      method: PaymentMethod;
      amount: string;
      tendered?: string;
    };
    const amount = toCents(b.amount);
    const balance = totalOf(o) - paidOf(o);
    if (amount <= 0) return fail(422, 'Informe o valor');
    if (amount > balance) return fail(422, 'Valor maior que o saldo do pedido');
    addPayment(
      o,
      b.method,
      amount,
      iso(Date.now()),
      b.cashSessionId || openSession()?.id || null,
      toCents(b.tendered) || null,
    );
    o.version += 1;
    changed(o);
    emitLocal({ type: 'cash.changed', sessionId: b.cashSessionId });
    const tendered = toCents(b.tendered);
    return { change: money(tendered > amount ? tendered - amount : 0), order: orderView(o, true) };
  });
  on('POST', '/orders/:id/dispatch', ({ params, body }) => {
    const o = order(params.id!);
    if (!o) return notFound();
    const courier = couriers.find((c) => c.id === (body as { courierId: string }).courierId);
    if (!courier) return fail(422, 'Escolha o entregador');
    o.courierId = courier.id;
    o.deliveryId = newId();
    o.deliveryFailed = null;
    if (o.status !== 'dispatched') setStatus(o, 'dispatched');
    itemsFollow(o, 'dispatched');
    changed(o);
    emitLocal({ type: 'delivery.changed', deliveryId: o.deliveryId });
    return { ...orderView(o, true), trackingPath: `/rastreio/exemplo-${o.number}` };
  });
  on('PATCH', '/orders/:id/adjustments', ({ params, body }) => {
    const o = order(params.id!);
    if (!o) return notFound();
    const b = body as { discount?: string; surcharge?: string; deliveryFee?: string };
    if (b.discount !== undefined) o.discount = toCents(b.discount);
    if (b.surcharge !== undefined) o.surcharge = toCents(b.surcharge);
    if (b.deliveryFee !== undefined) o.deliveryFee = toCents(b.deliveryFee);
    o.version += 1;
    changed(o);
    return orderView(o, true);
  });
  on('PATCH', '/orders/:id/items', ({ params, body }) => {
    const o = order(params.id!);
    if (!o) return notFound();
    const b = body as {
      add?: ItemIn[];
      change?: { itemId: string; quantity?: number; notes?: string | null }[];
      remove?: string[];
      notes?: string | null;
    };
    o.items.push(...itemsFrom(b.add));
    for (const c of b.change ?? []) {
      const it = o.items.find((x) => x.id === c.itemId);
      if (!it) continue;
      if (c.quantity !== undefined) {
        it.quantity = c.quantity.toFixed(3);
        it.total = money(Math.round(toCents(it.unitPrice) * c.quantity));
      }
      if (c.notes !== undefined) it.notes = c.notes;
    }
    if (b.remove?.length) o.items = o.items.filter((i) => !b.remove!.includes(i.id));
    if (b.notes !== undefined) o.notes = b.notes;
    o.version += 1;
    changed(o);
    return orderView(o, true);
  });
  on('POST', '/orders/:id/items/:itemId/cancel', ({ params, body }) => {
    const o = order(params.id!);
    const it = o?.items.find((i) => i.id === params.itemId);
    if (!o || !it) return notFound();
    it.status = 'cancelled';
    it.cancelReason = (body as { reason?: string })?.reason ?? null;
    o.version += 1;
    changed(o);
    return orderView(o, true);
  });
  on('POST', '/orders/:id/print', () => ({ queued: true }));
  on('GET', '/orders/:id/prints', () => []);
  on('POST', '/orders/:id/nfce', () =>
    fail(
      403,
      'No exemplo do site a nota fiscal fica de fora. No teste grátis você emite de verdade.',
    ),
  );

  // ------------------------------------------------------------------------ salão e comandas
  on('GET', '/tables', () => tables.filter((t) => t.active).map(tableView));
  on('GET', '/salon/settings', () => ({ serviceFeePercent: '10.00' }));
  on('GET', '/tabs', ({ query }) => {
    const status = query.get('status');
    return tabs
      .filter((t) => !status || t.status === status)
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt))
      .map((t) => tabView(t));
  });
  on('GET', '/tabs/:id', ({ params }) => {
    const t = tabs.find((x) => x.id === params.id);
    return t ? tabView(t, true) : notFound();
  });
  on('POST', '/tabs', ({ body }) => {
    const b = (body ?? {}) as { tableId?: string; customerName?: string };
    if (b.tableId) {
      const open = tabs.find((t) => t.tableId === b.tableId && t.status === 'open');
      if (open) return tabView(open, true);
    }
    const t = openTab(b.tableId ?? null, b.customerName?.trim() || null);
    emitLocal({ type: 'tab.changed', tabId: t.id });
    return tabView(t, true);
  });
  const tabAct = (fn: (t: (typeof tabs)[number], body: Record<string, unknown>) => unknown) =>
    (({ params, body }: { params: Record<string, string>; body: unknown }) => {
      const t = tabs.find((x) => x.id === params.id);
      if (!t) return notFound();
      const out = fn(t, (body ?? {}) as Record<string, unknown>);
      if (out instanceof Reply) return out;
      emitLocal({ type: 'tab.changed', tabId: t.id });
      return tabView(t, true);
    }) as Parameters<typeof on>[2];
  on(
    'POST',
    '/tabs/:id/name',
    tabAct((t, b) => (t.customerName = String(b.name ?? '').trim() || null)),
  );
  on(
    'POST',
    '/tabs/:id/bill-request',
    tabAct((t, b) => {
      t.billRequestedAt = b.requested === false ? null : iso(Date.now());
      t.billSplitParts = typeof b.parts === 'number' ? b.parts : t.billSplitParts;
    }),
  );
  on(
    'POST',
    '/tabs/:id/service-fee',
    tabAct((t, b) => (t.serviceFeePercent = b.percent == null ? null : String(b.percent))),
  );
  on(
    'POST',
    '/tabs/:id/transfer',
    tabAct((t, b) => {
      const busy = tabs.some(
        (x) => x.tableId === b.tableId && x.status === 'open' && x.id !== t.id,
      );
      if (busy) return fail(409, 'Essa mesa já está ocupada');
      t.tableId = String(b.tableId);
    }),
  );
  on(
    'POST',
    '/tabs/:id/close',
    tabAct((t) => {
      const v = tabView(t);
      if (toCents(v.balance) > 0) return fail(422, 'Receba o saldo da comanda antes de fechar');
      t.status = 'closed';
      t.billRequestedAt = null;
      for (const o of orders.filter(
        (x) => x.tabId === t.id && x.status !== 'cancelled' && x.status !== 'completed',
      )) {
        setStatus(o, 'completed');
        itemsFollow(o, 'completed');
      }
    }),
  );
  on('POST', '/tabs/:id/payments', ({ params, body }) => {
    const t = tabs.find((x) => x.id === params.id);
    if (!t) return notFound();
    const b = body as {
      cashSessionId: string;
      method: PaymentMethod;
      amount: string;
      tendered?: string;
    };
    let left = toCents(b.amount);
    const v = tabView(t);
    if (left > toCents(v.balance)) return fail(422, 'Valor maior que o saldo da comanda');
    // A taxa de serviço vai junto no último pedido com saldo.
    const list = orders.filter((o) => o.tabId === t.id && o.status !== 'cancelled');
    const fee = toCents(v.serviceFee);
    list.forEach((o, i) => {
      if (left <= 0) return;
      const due = totalOf(o) - paidOf(o) + (i === list.length - 1 ? fee : 0);
      const part = Math.min(due, left);
      if (part <= 0) return;
      if (i === list.length - 1 && fee) o.surcharge += Math.min(fee, part);
      addPayment(o, b.method, part, iso(Date.now()), b.cashSessionId || openSession()?.id || null);
      left -= part;
    });
    emitLocal({ type: 'tab.changed', tabId: t.id });
    emitLocal({ type: 'cash.changed', sessionId: b.cashSessionId });
    const tendered = toCents(b.tendered);
    const amount = toCents(b.amount);
    return { change: money(tendered > amount ? tendered - amount : 0), tab: tabView(t, true) };
  });
  on('GET', '/table-service/calls', () => []);
  on('GET', '/table-service/receipts', () => []);
  on('GET', '/table-service/tabs/:id/receipts', () => []);

  // ------------------------------------------------------------------------ cardápio da venda
  on('GET', '/menu', () => saleMenu());
  on('GET', '/sectors', () => sectors);

  // ------------------------------------------------------------------------ cozinha
  on('GET', '/kitchen/config', () => ({
    kitchens: sectors.map((s) => ({ id: s.id, name: s.name, channels: s.channels, color: null })),
    display: {
      askKitchen: false,
      allowAll: true,
      channelTabs: true,
      photos: true,
      options: true,
      notes: true,
      customer: true,
      timer: true,
      doneColumn: true,
      allDay: true,
      print: false,
    },
    hasPrinter: false,
  }));
  on('GET', '/kitchen', ({ query }) => {
    const sectorId = query.get('sectorId');
    const sector = sectors.find((s) => s.id === sectorId);
    const doneSince = iso(Date.now() - 20 * 60_000);
    const list = orders
      .filter((o) => ['new', 'in_production', 'ready', 'cancel_requested'].includes(o.status))
      // Pronto há muito tempo (mesa já servida) sai da coluna Pronto.
      .filter((o) => o.status !== 'ready' || o.items.some((i) => (i.readyAt ?? '') > doneSince))
      .map((o) => {
        const tab = o.tabId ? tabs.find((t) => t.id === o.tabId) : undefined;
        const table = tab?.tableId ? tables.find((t) => t.id === tab.tableId) : undefined;
        const items = o.items
          .filter((i) => i.status !== 'cancelled' && (!sector || i.sectorId === sector.id))
          .map((i) => ({ ...i, options: i.options.map((x) => x.name) }));
        return {
          id: o.id,
          number: o.number,
          channel: o.channel,
          status: o.status,
          notes: o.notes,
          createdAt: o.createdAt,
          tableLabel: table?.label ?? null,
          tabNumber: tab?.number ?? null,
          customerName: o.customerName,
          appChannel: null,
          externalCode: null,
          items,
        };
      })
      .filter((o) => o.items.length)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      sector: sector ?? null,
      warnAfterMin: sector?.warnAfterMin ?? 10,
      lateAfterMin: sector?.lateAfterMin ?? 20,
      serverTime: iso(Date.now()),
      orders: list,
    };
  });
  /** Item andou na cozinha: o pedido acompanha (começou → em produção; tudo pronto → pronto). */
  const followItems = (o: DemoOrder) => {
    const live = o.items.filter((i) => i.status !== 'cancelled');
    const open = live.filter((i) => i.status === 'pending' || i.status === 'preparing').length;
    const started = live.filter((i) => i.status === 'preparing' || i.status === 'ready').length;
    if (open === 0 && (o.status === 'new' || o.status === 'in_production')) setStatus(o, 'ready');
    else if (open > 0 && o.status === 'ready')
      setStatus(o, 'in_production', 'Item reaberto na cozinha');
    else if (started > 0 && o.status === 'new') setStatus(o, 'in_production');
    changed(o);
  };
  on('POST', '/kitchen/items/:id/:action', ({ params }) => {
    const o = orders.find((x) => x.items.some((i) => i.id === params.id));
    const it = o?.items.find((i) => i.id === params.id);
    if (!o || !it) return notFound();
    const now = iso(Date.now());
    if (params.action === 'start' && it.status === 'pending') {
      it.status = 'preparing';
      it.startedAt = now;
    } else if (
      params.action === 'ready' &&
      (it.status === 'pending' || it.status === 'preparing')
    ) {
      it.status = 'ready';
      it.startedAt = it.startedAt ?? now;
      it.readyAt = now;
    } else if (params.action === 'reopen' && it.status === 'ready') {
      it.status = 'preparing';
      it.readyAt = null;
    }
    followItems(o);
    return { ok: true };
  });
  on('POST', '/kitchen/orders/:id/bump', ({ params, body }) => {
    const o = order(params.id!);
    if (!o) return notFound();
    const b = body as { to: 'preparing' | 'ready'; sectorId?: string };
    const now = iso(Date.now());
    for (const it of o.items) {
      if (b.sectorId && it.sectorId !== b.sectorId) continue;
      if (b.to === 'preparing' && it.status === 'pending') {
        it.status = 'preparing';
        it.startedAt = now;
      }
      if (b.to === 'ready' && (it.status === 'pending' || it.status === 'preparing')) {
        it.status = 'ready';
        it.startedAt = it.startedAt ?? now;
        it.readyAt = now;
      }
    }
    followItems(o);
    return { ok: true };
  });
  on('POST', '/kitchen/orders/:id/print', () => ({ queued: true }));

  // ------------------------------------------------------------------------ caixa
  on('GET', '/cash-registers', () =>
    registers.map((r) => ({
      ...r,
      openSessionId: sessions.find((s) => s.registerId === r.id && s.status === 'open')?.id ?? null,
    })),
  );
  on('GET', '/cash/sessions', ({ query }) => {
    const status = query.get('status');
    return sessions
      .filter((s) => !status || s.status === status)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .map((s) => sessionView(s, false));
  });
  on('GET', '/cash/sessions/open/timeline', () =>
    timeline(sessions.filter((s) => s.status === 'open')),
  );
  on('GET', '/cash/sessions/:id/timeline', ({ params }) => {
    const s = sessions.find((x) => x.id === params.id);
    return s ? timeline([s]) : notFound();
  });
  on('GET', '/cash/sessions/:id', ({ params }) => {
    const s = sessions.find((x) => x.id === params.id);
    return s ? sessionView(s, true) : notFound();
  });
  on('POST', '/cash/sessions', ({ body }) => {
    const b = body as { registerId: string; openingAmount: string };
    if (sessions.some((s) => s.registerId === b.registerId && s.status === 'open'))
      return fail(409, 'Este caixa já está aberto');
    const s: DemoSession = {
      id: newId(),
      number: Math.max(...sessions.map((x) => x.number)) + 1,
      status: 'open',
      registerId: b.registerId,
      openingAmount: money(toCents(b.openingAmount)),
      openedAt: iso(Date.now()),
      closedAt: null,
      openedByName: USER_NAME,
      closedByName: null,
      counted: null,
      closingNote: null,
    };
    sessions.push(s);
    movements.push({
      id: newId(),
      sessionId: s.id,
      kind: 'opening',
      method: 'cash',
      amount: s.openingAmount,
      note: null,
      orderId: null,
      createdAt: s.openedAt,
    });
    emitLocal({ type: 'cash.changed', sessionId: s.id });
    return sessionView(s, true);
  });
  on('POST', '/cash/sessions/:id/movements', ({ params, body }) => {
    const s = sessions.find((x) => x.id === params.id);
    if (!s || s.status !== 'open') return fail(409, 'O caixa não está aberto');
    const b = body as { kind: 'supply' | 'withdrawal'; amount: string; note?: string };
    movements.push({
      id: newId(),
      sessionId: s.id,
      kind: b.kind,
      method: 'cash',
      amount: money(toCents(b.amount)),
      note: b.note?.trim() || null,
      orderId: null,
      createdAt: iso(Date.now()),
    });
    emitLocal({ type: 'cash.changed', sessionId: s.id });
    return sessionView(s, true);
  });
  on('POST', '/cash/sessions/:id/close', ({ params, body }) => {
    const s = sessions.find((x) => x.id === params.id);
    if (!s || s.status !== 'open') return fail(409, 'O caixa não está aberto');
    const b = body as { counted: Record<PaymentMethod, string>; note?: string };
    s.status = 'closed';
    s.closedAt = iso(Date.now());
    s.closedByName = USER_NAME;
    s.counted = b.counted;
    s.closingNote = b.note ?? null;
    emitLocal({ type: 'cash.changed', sessionId: s.id });
    return sessionView(s, true);
  });

  // ------------------------------------------------------------------------ clientes e entregadores
  on('GET', '/customers', ({ query }) => {
    const q = (query.get('q') ?? '').trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const list = customers.filter(
      (c) =>
        !q || c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.phone.includes(digits)),
    );
    return {
      summary: {
        total: customers.length,
        new30: 3,
        active30: 11,
        spent: '18420.50',
        avgTicket: '58.70',
      },
      customers: list,
    };
  });
  on('POST', '/customers', ({ body }) => {
    const b = body as { name: string; phone: string };
    const c = {
      id: newId(),
      name: b.name.trim(),
      avatar: null,
      photoUrl: null,
      phone: b.phone.replace(/\D/g, ''),
      email: null,
      marketingOptIn: false,
      blocked: false,
      createdAt: iso(Date.now()),
      lastLoginAt: null,
      orders: 0,
      spent: '0.00',
      lastOrderAt: null,
    };
    customers.unshift(c);
    return c;
  });
  on('GET', '/couriers', () => couriers);
  on('GET', '/me', () => ME);
}

// ------------------------------------------------------------------------ contas do caixa

const METHODS: PaymentMethod[] = ['cash', 'credit', 'debit', 'pix', 'voucher', 'other'];
const zero = () => Object.fromEntries(METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;

function expectedOf(s: DemoSession) {
  const sum = zero();
  for (const m of movements.filter((x) => x.sessionId === s.id)) {
    const v = toCents(m.amount);
    if (m.kind === 'withdrawal' || m.kind === 'refund') sum[m.method] -= v;
    else sum[m.method] += v;
  }
  return sum;
}
const asMoney = (r: Record<PaymentMethod, number>) =>
  Object.fromEntries(METHODS.map((m) => [m, money(r[m])])) as Record<PaymentMethod, string>;

function sessionView(s: DemoSession, detail: boolean): CashSession {
  const expected = expectedOf(s);
  const reg = registers.find((r) => r.id === s.registerId)!;
  const own = movements.filter((m) => m.sessionId === s.id);
  const sales = own.filter((m) => m.kind === 'sale');
  const byKind = METHODS.flatMap((method) => {
    const list = sales.filter((m) => m.method === method);
    return list.length
      ? [
          {
            kind: 'sale',
            method,
            count: list.length,
            total: money(list.reduce((t, m) => t + toCents(m.amount), 0)),
          },
        ]
      : [];
  });
  const counted = s.counted;
  const diff = counted ? METHODS.reduce((t, m) => t + toCents(counted[m]) - expected[m], 0) : null;
  return {
    id: s.id,
    number: s.number,
    status: s.status,
    registerId: s.registerId,
    registerName: reg.name,
    openingAmount: s.openingAmount,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    openedByName: s.openedByName,
    closedByName: s.closedByName,
    expected: asMoney(expected),
    closedExpected: s.status === 'closed' ? asMoney(expected) : null,
    counted,
    difference: diff === null ? null : money(diff),
    differences: counted
      ? Object.fromEntries(
          METHODS.filter((m) => toCents(counted[m]) !== expected[m]).map((m) => [
            m,
            money(toCents(counted[m]) - expected[m]),
          ]),
        )
      : null,
    closingNote: s.closingNote,
    byKind,
    appSales: [],
    ...(detail
      ? {
          movements: own
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((m) => ({
              id: m.id,
              kind: m.kind,
              method: m.method,
              amount: m.amount,
              note: m.note,
              orderNumber: m.orderId
                ? (orders.find((o) => o.id === m.orderId)?.number ?? null)
                : null,
              createdAt: m.createdAt,
              createdByName: USER_NAME,
            })),
        }
      : {}),
  };
}

function timeline(list: DemoSession[]): CashTimeline {
  const ids = new Set(list.map((s) => s.id));
  const own = movements.filter((m) => ids.has(m.sessionId));
  const byOrder = new Map<string, CashTimelineEvent>();
  const events: CashTimelineEvent[] = [];
  for (const m of own.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const s = list.find((x) => x.id === m.sessionId)!;
    const reg = registers.find((r) => r.id === s.registerId)!;
    const o = m.orderId ? orders.find((x) => x.id === m.orderId) : undefined;
    if (o && byOrder.has(o.id)) {
      const e = byOrder.get(o.id)!;
      e.amounts[m.method] = money(toCents(e.amounts[m.method]) + toCents(m.amount));
      continue;
    }
    const amounts = asMoney(zero());
    amounts[m.method] = m.amount;
    const e: CashTimelineEvent = {
      id: m.id,
      at: m.createdAt,
      kind: m.kind,
      sessionId: s.id,
      sessionNumber: s.number,
      registerName: reg.name,
      orderId: o?.id ?? null,
      orderNumber: o?.number ?? null,
      channel: o?.channel ?? null,
      deliveryFee: money(o?.deliveryFee ?? 0),
      discount: money(o?.discount ?? 0),
      amounts,
      note: m.note,
      createdByName: USER_NAME,
      orderPaid: o ? paidOf(o) >= totalOf(o) : false,
      fiscal: null,
    };
    if (o) byOrder.set(o.id, e);
    events.push(e);
  }
  const sum = (k: DemoSession['status'] | 'sale' | 'supply' | 'withdrawal') =>
    own.filter((m) => m.kind === k).reduce((t, m) => t + toCents(m.amount), 0);
  const sold = sum('sale');
  const fees = [...byOrder.values()].reduce((t, e) => t + toCents(e.deliveryFee), 0);
  return {
    sessions: list.map((s) => {
      const v = sessionView(s, false);
      return {
        id: v.id,
        number: v.number,
        status: v.status,
        registerId: v.registerId,
        registerName: v.registerName,
        openingAmount: v.openingAmount,
        openedAt: v.openedAt,
        closedAt: v.closedAt,
        openedByName: v.openedByName,
      };
    }),
    totals: {
      sold: money(sold),
      deliveryFees: money(fees),
      surcharges: '0.00',
      moved: money(sum('supply') - sum('withdrawal')),
      closedOrders: byOrder.size,
      supplies: money(sum('supply')),
      withdrawals: money(sum('withdrawal')),
    },
    events: events.reverse(),
  };
}

export { makeOrder };
export type { Tab };
