import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  fromCents,
  PAYMENT_METHODS,
  PaymentMethod,
  paymentStatusFor,
  roleHas,
  toCents,
} from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { withIdempotency } from '../common/idempotency';
import { nextNumber, one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { postCashSession } from '../finance/closing';
import type { OrderRow } from '../orders/orders.service';
import { OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';

export interface PaymentInput {
  cashSessionId: string;
  method: PaymentMethod;
  amount: string;
  /** Valor entregue pelo cliente (só dinheiro) para cálculo de troco. */
  tendered?: string;
  /** CPF/CNPJ na nota (só dígitos). */
  taxDocument?: string | null;
}

/** O cliente já pagou pelo Pix do cardápio e o comprovante espera a conferência. */
export const pixPendingMessage = (number: number) =>
  `O cliente pagou o pedido #${number} pelo Pix e mandou o comprovante. Aprove ou recuse o comprovante antes de cobrar este pedido.`;

/**
 * Comprovante do Pix esperando conferência: cobrar de novo faria o cliente pagar duas vezes.
 * Fica fora de applyPayment: a aprovação do próprio comprovante passa por lá.
 */
export async function assertNoPixPending(tx: Tx, o: { id: string; number: number }) {
  if (await one(tx, `SELECT 1 FROM orders WHERE id = $1 AND pix_status = 'submitted'`, [o.id]))
    throw new ConflictException(pixPendingMessage(o.number));
}

interface SessionRow {
  id: string;
  status: 'open' | 'closed';
  number: number;
  register_id: string;
}

type Totals = Record<PaymentMethod, number>;
const zero = (): Totals => Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Totals;
type MethodStrings = Partial<Record<PaymentMethod, string>>;

/**
 * Diferença de cada forma no fechamento (contado − esperado), só as que não bateram. Sessão ainda
 * aberta (sem os dois lados gravados) devolve null.
 */
export function closingDifferences(expected: MethodStrings, counted: MethodStrings): MethodStrings;
export function closingDifferences(
  expected: MethodStrings | null | undefined,
  counted: MethodStrings | null | undefined,
): MethodStrings | null;
export function closingDifferences(
  expected: MethodStrings | null | undefined,
  counted: MethodStrings | null | undefined,
): MethodStrings | null {
  if (!expected || !counted) return null;
  const out: MethodStrings = {};
  for (const m of PAYMENT_METHODS) {
    const d = toCents(counted[m] ?? '0') - toCents(expected[m] ?? '0');
    if (d !== 0) out[m] = fromCents(d);
  }
  return out;
}

const toStrings = (t: Totals) =>
  Object.fromEntries(Object.entries(t).map(([k, v]) => [k, fromCents(v)])) as Record<
    PaymentMethod,
    string
  >;

/**
 * Caixa e pagamentos.
 *
 * Travas (sempre nesta ordem para evitar deadlock):
 *   sessão de caixa (FOR SHARE em vendas/estornos; FOR UPDATE em sangria/suprimento/fechamento
 *   e no estorno em dinheiro)
 *   → comanda → pedidos (por created_at, id) → pagamento.
 * O fechamento trava a sessão em modo exclusivo, então nenhum pagamento entra em uma sessão
 * enquanto ela fecha, e nenhum pagamento é aceito depois de fechada.
 *
 * Nada financeiro é apagado ou editado: estornos geram novos registros e movimentos negativos.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Antes de gravar um estorno, dentro da transação (ex.: o pagamento veio do app e o estorno vai
   * ao PagBank primeiro). Erro aqui recusa o estorno.
   */
  private readonly refundHooks: ((
    tx: Tx,
    ctx: Ctx,
    paymentId: string,
    cents: number,
  ) => Promise<void>)[] = [];
  onRefundInTx(hook: (tx: Tx, ctx: Ctx, paymentId: string, cents: number) => Promise<void>) {
    this.refundHooks.push(hook);
  }

  /** Quem quer saber quando um pedido fica totalmente pago (ex.: emissão automática da NFC-e). */
  private readonly paidHooks: ((ctx: Ctx, orderId: string) => Promise<void>)[] = [];
  onOrderPaid(hook: (ctx: Ctx, orderId: string) => Promise<void>) {
    this.paidHooks.push(hook);
  }
  /** Avisa, fora da transação e sem esperar, que o pedido ficou pago. Falha aqui nunca volta ao caixa. */
  notifyPaid(ctx: Ctx, orderId: string) {
    for (const h of this.paidHooks) void h(ctx, orderId).catch(() => undefined);
  }

  // ------------------------------------------------------------------ sessões
  async open(
    ctx: Ctx,
    b: { registerId: string; openingAmount: string; note?: string },
    idemKey?: string,
  ) {
    const res = await this.db.withTenant(ctx, (tx) =>
      withIdempotency(tx, ctx.tenantId, 'cash.open', idemKey, b, async () => {
        const reg = await one<{ active: boolean }>(
          tx,
          `SELECT active FROM cash_registers WHERE id = $1`,
          [b.registerId],
        );
        if (!reg?.active) throw new NotFoundException('Terminal de caixa não encontrado');
        const already = await one(
          tx,
          `SELECT id FROM cash_sessions WHERE register_id = $1 AND status = 'open'`,
          [b.registerId],
        );
        if (already) throw new ConflictException('Este terminal já tem um caixa aberto');
        const number = await nextNumber(tx, ctx.tenantId, 'cash_session');
        const s = await one<{ id: string }>(
          tx,
          `INSERT INTO cash_sessions (tenant_id, register_id, number, opening_amount, opened_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [ctx.tenantId, b.registerId, number, b.openingAmount, ctx.userId],
        );
        if (toCents(b.openingAmount) > 0) {
          await q(
            tx,
            `INSERT INTO cash_movements (tenant_id, cash_session_id, kind, method, amount, note, created_by)
             VALUES ($1,$2,'opening','cash',$3,$4,$5)`,
            [ctx.tenantId, s!.id, b.openingAmount, b.note ?? null, ctx.userId],
          );
        }
        await this.audit.record(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: 'cash.opened',
          entity: 'cash_session',
          entityId: s!.id,
          data: { number, registerId: b.registerId, openingAmount: b.openingAmount },
          ip: ctx.ip,
        });
        return this.summary(tx, s!.id);
      }),
    );
    this.realtime.publish(ctx.tenantId, { type: 'cash.changed', sessionId: res!.id });
    return res;
  }

  async list(ctx: Ctx, status?: 'open' | 'closed') {
    const rows = await this.db.withTenant(ctx, (tx) =>
      q<Record<string, unknown>>(
        tx,
        `SELECT s.id, s.number, s.status, s.register_id AS "registerId", r.name AS "registerName",
                s.opening_amount::text AS "openingAmount", s.opened_at AS "openedAt", s.closed_at AS "closedAt",
                s.difference::text, uo.name AS "openedByName", s.expected AS "closedExpected", s.counted
           FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id
           LEFT JOIN users uo ON uo.id = s.opened_by
          ${status ? 'WHERE s.status = $1' : ''}
          ORDER BY s.opened_at DESC LIMIT 50`,
        status ? [status] : [],
      ),
    );
    // A lista leva só a diferença de cada forma, não os dois objetos do fechamento.
    return rows.map(({ closedExpected, counted, ...r }) => ({
      ...r,
      differences: closingDifferences(
        closedExpected as MethodStrings | null,
        counted as MethodStrings | null,
      ),
    }));
  }

  async get(ctx: Ctx, id: string) {
    const s = await this.db.withTenant(ctx, (tx) => this.summary(tx, id, true));
    if (!s) throw new NotFoundException('Sessão de caixa não encontrada');
    return s;
  }

  /** Saldo esperado por forma de pagamento = soma do livro-razão da sessão. */
  private async expected(tx: Tx, sessionId: string): Promise<Totals> {
    const rows = await q<{ method: PaymentMethod; total: string }>(
      tx,
      `SELECT method, sum(amount)::text AS total FROM cash_movements WHERE cash_session_id = $1 GROUP BY method`,
      [sessionId],
    );
    const t = zero();
    for (const r of rows) t[r.method] = toCents(r.total);
    return t;
  }

  async summary(tx: Tx, id: string, withMovements = false) {
    const s = await one<Record<string, unknown>>(
      tx,
      `SELECT s.id, s.number, s.status, s.register_id AS "registerId", r.name AS "registerName",
              s.opening_amount::text AS "openingAmount", s.opened_at AS "openedAt", s.closed_at AS "closedAt",
              uo.name AS "openedByName", uc.name AS "closedByName",
              s.expected AS "closedExpected", s.counted, s.difference::text, s.closing_note AS "closingNote"
         FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id
         LEFT JOIN users uo ON uo.id = s.opened_by LEFT JOIN users uc ON uc.id = s.closed_by
        WHERE s.id = $1`,
      [id],
    );
    if (!s) return undefined;
    const byKind = await q(
      tx,
      `SELECT kind, method, count(*)::int AS count, sum(amount)::text AS total
         FROM cash_movements WHERE cash_session_id = $1 GROUP BY kind, method ORDER BY kind, method`,
      [id],
    );
    const expected = toStrings(await this.expected(tx, id));
    // Pago dentro dos aplicativos enquanto este caixa esteve aberto: só para conferir, nunca entra
    // no esperado da gaveta (o dinheiro chega no repasse do aplicativo).
    const appSales = await q(
      tx,
      `SELECT p.app_channel AS channel, count(DISTINCT p.order_id)::int AS orders,
              sum(p.amount - p.refunded_amount)::numeric(14,2)::text AS total
         FROM payments p
        WHERE p.method = 'app' AND p.created_at >= $1 AND p.created_at < COALESCE($2, now())
        GROUP BY 1 HAVING sum(p.amount - p.refunded_amount) > 0 ORDER BY 1`,
      [s.openedAt, s.closedAt ?? null],
    );
    const movements = withMovements
      ? await q(
          tx,
          `SELECT m.id, m.kind, m.method, m.amount::text, m.note, m.order_id AS "orderId", o.number AS "orderNumber",
                  m.payment_id AS "paymentId", m.created_at AS "createdAt", u.name AS "createdByName"
             FROM cash_movements m LEFT JOIN users u ON u.id = m.created_by LEFT JOIN orders o ON o.id = m.order_id
            WHERE m.cash_session_id = $1 ORDER BY m.id DESC LIMIT 500`,
          [id],
        )
      : undefined;
    const differences = closingDifferences(
      s.closedExpected as MethodStrings | null,
      s.counted as MethodStrings | null,
    );
    return { ...(s as { id: string }), expected, byKind, appSales, movements, differences };
  }

  /**
   * Linha do tempo do caixa: um registro por evento (abertura, venda por pedido, suprimento,
   * sangria, estorno), com os valores separados por forma de pagamento, e os totais da tela.
   * `sessionId` = um terminal; sem ele = todos os caixas abertos.
   */
  async timeline(ctx: Ctx, sessionId?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const sessions = await q<{
        id: string;
        number: number;
        status: 'open' | 'closed';
        registerId: string;
        registerName: string;
        openingAmount: string;
        openedAt: string;
        closedAt: string | null;
        openedByName: string | null;
      }>(
        tx,
        `SELECT s.id, s.number, s.status, s.register_id AS "registerId", r.name AS "registerName",
                s.opening_amount::text AS "openingAmount", s.opened_at AS "openedAt",
                s.closed_at AS "closedAt", uo.name AS "openedByName"
           FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id
           LEFT JOIN users uo ON uo.id = s.opened_by
          WHERE ${sessionId ? 's.id = $1' : "s.status = 'open'"}
          ORDER BY s.opened_at`,
        sessionId ? [sessionId] : [],
      );
      if (sessionId && !sessions.length)
        throw new NotFoundException('Sessão de caixa não encontrada');
      const ids = sessions.map((s) => s.id);
      const movements = ids.length
        ? await q<{
            id: string;
            sessionId: string;
            kind: 'opening' | 'sale' | 'supply' | 'withdrawal' | 'refund';
            method: PaymentMethod;
            amount: string;
            note: string | null;
            orderId: string | null;
            createdAt: string;
            createdByName: string | null;
          }>(
            tx,
            `SELECT m.id::text, m.cash_session_id AS "sessionId", m.kind, m.method, m.amount::text,
                    m.note, m.order_id AS "orderId", m.created_at AS "createdAt", u.name AS "createdByName"
               FROM cash_movements m LEFT JOIN users u ON u.id = m.created_by
              WHERE m.cash_session_id = ANY($1::uuid[])
              ORDER BY m.created_at, m.id`,
            [ids],
          )
        : [];
      const orderIds = [
        ...new Set(movements.map((m) => m.orderId).filter((x): x is string => !!x)),
      ];
      const orders = orderIds.length
        ? await q<{
            id: string;
            number: number;
            channel: string;
            deliveryFee: string;
            discount: string;
            surcharge: string;
            status: string;
            paymentStatus: string;
          }>(
            tx,
            `SELECT id, number, channel, delivery_fee::text AS "deliveryFee", discount::text,
                    surcharge::text, status, payment_status AS "paymentStatus"
               FROM orders WHERE id = ANY($1::uuid[])`,
            [orderIds],
          )
        : [];
      const fiscal = orderIds.length
        ? await q<{ orderId: string; id: string; status: string; kind: string }>(
            tx,
            `SELECT DISTINCT ON (order_id) order_id AS "orderId", id, status, kind
               FROM fiscal_documents
              WHERE order_id = ANY($1::uuid[]) AND status <> 'discarded'
              ORDER BY order_id, (status IN ('draft','pending','processing','authorized','cancelling')) DESC,
                       created_at DESC`,
            [orderIds],
          )
        : [];
      const orderById = new Map(orders.map((o) => [o.id, o]));
      const fiscalByOrder = new Map(fiscal.map((f) => [f.orderId, f]));
      const sessionById = new Map(sessions.map((s) => [s.id, s]));

      type Event = {
        id: string;
        at: string;
        kind: 'opening' | 'sale' | 'supply' | 'withdrawal' | 'refund';
        sessionId: string;
        sessionNumber: number;
        registerName: string;
        orderId: string | null;
        orderNumber: number | null;
        channel: string | null;
        deliveryFee: string;
        discount: string;
        amounts: Totals;
        note: string | null;
        createdByName: string | null;
        orderPaid: boolean;
        fiscal: { id: string; status: string; kind: string } | null;
      };
      const events: Event[] = [];
      const saleByKey = new Map<string, Event>();
      const base = (sessionId: string, m?: (typeof movements)[number]) => {
        const s = sessionById.get(sessionId)!;
        return {
          sessionId,
          sessionNumber: s.number,
          registerName: s.registerName,
          note: m?.note ?? null,
          createdByName: m?.createdByName ?? null,
        };
      };
      const t = {
        sold: 0,
        deliveryFees: 0,
        surcharges: 0,
        moved: 0,
        supplies: 0,
        withdrawals: 0,
      };
      // A abertura sempre aparece (mesmo com fundo zero, que não gera movimento).
      for (const s of sessions) {
        if (movements.some((m) => m.sessionId === s.id && m.kind === 'opening')) continue;
        events.push({
          ...base(s.id),
          id: `open-${s.id}`,
          at: s.openedAt,
          kind: 'opening',
          orderId: null,
          orderNumber: null,
          channel: null,
          deliveryFee: '0.00',
          discount: '0.00',
          amounts: zero(),
          createdByName: s.openedByName,
          orderPaid: false,
          fiscal: null,
        });
      }
      const counted = new Set<string>();
      for (const m of movements) {
        const cents = toCents(m.amount);
        t.moved += cents;
        if (m.kind === 'supply') t.supplies += cents;
        if (m.kind === 'withdrawal') t.withdrawals -= cents;
        if (m.kind === 'sale' || m.kind === 'refund') t.sold += cents;
        const o = m.orderId ? orderById.get(m.orderId) : undefined;
        const key = `${m.sessionId}:${m.orderId}`;
        if (m.kind === 'sale' && saleByKey.has(key)) {
          saleByKey.get(key)!.amounts[m.method] += cents;
          continue;
        }
        const ev: Event = {
          ...base(m.sessionId, m),
          id: m.id,
          at: m.createdAt,
          kind: m.kind,
          orderId: m.orderId,
          orderNumber: o?.number ?? null,
          channel: o?.channel ?? null,
          deliveryFee: m.kind === 'sale' && o ? o.deliveryFee : '0.00',
          discount: m.kind === 'sale' && o ? o.discount : '0.00',
          amounts: zero(),
          orderPaid: o?.paymentStatus === 'paid' && o.status !== 'cancelled',
          fiscal: m.orderId ? (fiscalByOrder.get(m.orderId) ?? null) : null,
        };
        ev.amounts[m.method] = cents;
        if (m.kind === 'opening') ev.createdByName = sessionById.get(m.sessionId)!.openedByName;
        if (m.kind === 'sale' && o) {
          saleByKey.set(key, ev);
          if (!counted.has(o.id)) {
            counted.add(o.id);
            t.deliveryFees += toCents(o.deliveryFee);
            t.surcharges += toCents(o.surcharge);
          }
        }
        events.push(ev);
      }
      events.sort((a, b) => +new Date(a.at) - +new Date(b.at));
      return {
        sessions,
        totals: {
          sold: fromCents(t.sold),
          deliveryFees: fromCents(t.deliveryFees),
          surcharges: fromCents(t.surcharges),
          moved: fromCents(t.moved),
          closedOrders: counted.size,
          supplies: fromCents(t.supplies),
          withdrawals: fromCents(t.withdrawals),
        },
        events: events.map((e) => ({ ...e, amounts: toStrings(e.amounts) })),
      };
    });
  }

  async lockSession(tx: Tx, id: string, mode: 'SHARE' | 'UPDATE'): Promise<SessionRow> {
    const s = await one<SessionRow>(
      tx,
      `SELECT id, status, number, register_id FROM cash_sessions WHERE id = $1 FOR ${mode === 'SHARE' ? 'SHARE' : 'UPDATE'}`,
      [id],
    );
    if (!s) throw new NotFoundException('Sessão de caixa não encontrada');
    if (s.status !== 'open')
      throw new ConflictException('Caixa fechado: abra um caixa para continuar');
    return s;
  }

  /** Suprimento (entrada de troco) e sangria (retirada) — somente em dinheiro. */
  async movement(
    ctx: Ctx,
    sessionId: string,
    b: { kind: 'supply' | 'withdrawal'; amount: string; note: string },
    idemKey?: string,
  ) {
    const res = await this.db.withTenant(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx.tenantId,
        `cash.${b.kind}`,
        idemKey,
        { sessionId, ...b },
        async () => {
          await this.lockSession(tx, sessionId, 'UPDATE');
          const cents = toCents(b.amount);
          if (cents <= 0) throw new UnprocessableEntityException('Valor deve ser maior que zero');
          if (b.kind === 'withdrawal') {
            const exp = await this.expected(tx, sessionId);
            if (cents > exp.cash) {
              throw new ConflictException(
                `Sangria maior que o dinheiro em caixa (${fromCents(exp.cash)})`,
              );
            }
          }
          const signed = b.kind === 'withdrawal' ? -cents : cents;
          const m = await one<{ id: string }>(
            tx,
            `INSERT INTO cash_movements (tenant_id, cash_session_id, kind, method, amount, note, created_by)
           VALUES ($1,$2,$3,'cash',$4,$5,$6) RETURNING id::text`,
            [ctx.tenantId, sessionId, b.kind, fromCents(signed), b.note, ctx.userId],
          );
          await this.audit.record(tx, {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            action: `cash.${b.kind}`,
            entity: 'cash_session',
            entityId: sessionId,
            data: { amount: b.amount, note: b.note },
            ip: ctx.ip,
          });
          return { id: m!.id, sessionId, kind: b.kind, amount: fromCents(signed) };
        },
      ),
    );
    this.realtime.publish(ctx.tenantId, { type: 'cash.changed', sessionId });
    return res;
  }

  /**
   * Fechamento conferido: o operador informa o contado por forma de pagamento; o sistema grava
   * esperado, contado e diferença. Depois de fechada, a sessão não recebe mais movimentos.
   */
  async close(
    ctx: Ctx,
    sessionId: string,
    b: { counted: Partial<Record<PaymentMethod, string>>; note?: string },
    idemKey?: string,
  ) {
    if (!roleHas(ctx.user.role, 'cash:close'))
      throw new ForbiddenException('Sem permissão para fechar o caixa');
    const res = await this.db.withTenant(ctx, (tx) =>
      withIdempotency(tx, ctx.tenantId, 'cash.close', idemKey, { sessionId, ...b }, async () => {
        await this.lockSession(tx, sessionId, 'UPDATE');
        const exp = await this.expected(tx, sessionId);
        const counted = zero();
        for (const m of PAYMENT_METHODS) counted[m] = toCents(b.counted[m] ?? '0');
        const sum = (t: Totals) => Object.values(t).reduce((a, v) => a + v, 0);
        // `difference` é o saldo geral (sobrou ou faltou dinheiro no total), mas a conferência é
        // forma por forma: sobra numa forma não cobre falta em outra sem observação.
        const diff = sum(counted) - sum(exp);
        const differences = closingDifferences(toStrings(exp), toStrings(counted));
        if (Object.keys(differences).length > 0 && !b.note) {
          throw new UnprocessableEntityException(
            'Há diferença no fechamento: informe uma observação',
          );
        }
        await q(
          tx,
          `UPDATE cash_sessions SET status = 'closed', closed_by = $2, closed_at = now(), expected = $3, counted = $4,
                  difference = $5, closing_note = $6
            WHERE id = $1`,
          [
            sessionId,
            ctx.userId,
            JSON.stringify(toStrings(exp)),
            JSON.stringify(toStrings(counted)),
            fromCents(diff),
            b.note ?? null,
          ],
        );
        // O dia vai para o financeiro na mesma transação: recebíveis de cada forma, com a taxa
        // da maquininha e o dia previsto na conta (conciliação bancária e DRE partem daqui).
        const posted = await postCashSession(tx, ctx.tenantId, ctx.userId, sessionId);
        await this.audit.record(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: 'cash.closed',
          entity: 'cash_session',
          entityId: sessionId,
          data: {
            expected: toStrings(exp),
            counted: toStrings(counted),
            difference: fromCents(diff),
            differences,
            postedToFinance: posted,
          },
          ip: ctx.ip,
        });
        return this.summary(tx, sessionId);
      }),
    );
    this.realtime.publish(ctx.tenantId, { type: 'cash.changed', sessionId });
    return res;
  }

  // ---------------------------------------------------------------- pagamentos
  /** Registra um pagamento em um pedido já travado e uma sessão já travada (FOR SHARE). */
  async applyPayment(
    tx: Tx,
    ctx: Ctx,
    o: OrderRow,
    p: {
      cashSessionId: string;
      method: PaymentMethod;
      amountCents: number;
      tendered?: string | null;
    },
  ) {
    if (o.status === 'cancelled') throw new ConflictException(`Pedido #${o.number} está cancelado`);
    const total = toCents(o.total);
    const paid = toCents(o.paid_amount);
    if (p.amountCents <= 0) throw new UnprocessableEntityException('Valor deve ser maior que zero');
    if (paid + p.amountCents > total) {
      throw new ConflictException(
        `Valor maior que o saldo do pedido #${o.number} (${fromCents(total - paid)})`,
      );
    }
    const pay = await one<{ id: string }>(
      tx,
      `INSERT INTO payments (tenant_id, order_id, cash_session_id, method, amount, tendered, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        ctx.tenantId,
        o.id,
        p.cashSessionId,
        p.method,
        fromCents(p.amountCents),
        p.tendered ?? null,
        ctx.userId,
      ],
    );
    await q(
      tx,
      `INSERT INTO cash_movements (tenant_id, cash_session_id, kind, method, amount, payment_id, order_id, created_by)
       VALUES ($1,$2,'sale',$3,$4,$5,$6,$7)`,
      [
        ctx.tenantId,
        p.cashSessionId,
        p.method,
        fromCents(p.amountCents),
        pay!.id,
        o.id,
        ctx.userId,
      ],
    );
    const newPaid = paid + p.amountCents;
    const status = paymentStatusFor(total, newPaid);
    await q(
      tx,
      `UPDATE orders SET paid_amount = $2, payment_status = $3, version = version + 1 WHERE id = $1`,
      [o.id, fromCents(newPaid), status],
    );
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'payment.created',
      entity: 'payment',
      entityId: pay!.id,
      data: {
        orderId: o.id,
        method: p.method,
        amount: fromCents(p.amountCents),
        sessionId: p.cashSessionId,
      },
      ip: ctx.ip,
    });
    o.paid_amount = fromCents(newPaid);
    o.payment_status = status;
    o.version += 1;
    return {
      id: pay!.id,
      orderId: o.id,
      orderNumber: o.number,
      method: p.method,
      amount: fromCents(p.amountCents),
      paymentStatus: status,
    };
  }

  async payOrder(ctx: Ctx, orderId: string, b: PaymentInput, idemKey?: string) {
    const res = await this.db.withTenant(ctx, (tx) =>
      withIdempotency(tx, ctx.tenantId, 'payment.create', idemKey, { orderId, ...b }, async () => {
        await this.lockSession(tx, b.cashSessionId, 'SHARE');
        const o = await this.orders.lock(tx, orderId);
        await assertNoPixPending(tx, o);
        if (b.taxDocument)
          await tx.$client.query(`UPDATE orders SET tax_document = $2 WHERE id = $1`, [
            o.id,
            b.taxDocument,
          ]);
        const amountCents = toCents(b.amount);
        const change = changeFor(b, amountCents);
        const payment = await this.applyPayment(tx, ctx, o, {
          ...b,
          amountCents,
          tendered: b.method === 'cash' ? b.tendered : null,
        });
        return { payment, change, order: await this.orders.detail(tx, orderId) };
      }),
    );
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId });
    this.realtime.publish(ctx.tenantId, { type: 'cash.changed', sessionId: b.cashSessionId });
    const tabId = res.order?.tabId;
    if (tabId) this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId });
    if (res.payment?.paymentStatus === 'paid') this.notifyPaid(ctx, orderId);
    return res;
  }

  /**
   * Estorno (total ou parcial) de um pagamento. Não apaga nada: cria payment_refunds,
   * movimento negativo na sessão ATUAL informada e reduz o pago do pedido.
   */
  async refund(
    ctx: Ctx,
    paymentId: string,
    b: { cashSessionId: string; amount: string; reason: string },
    idemKey?: string,
  ) {
    if (!roleHas(ctx.user.role, 'payments:refund'))
      throw new ForbiddenException('Estorno exige autorização');
    let orderId = '';
    const res = await this.db.withTenant(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx.tenantId,
        'payment.refund',
        idemKey,
        { paymentId, ...b },
        async () => {
          const ref = await one<{ order_id: string; method: string }>(
            tx,
            `SELECT order_id, method FROM payments WHERE id = $1`,
            [paymentId],
          );
          if (!ref) throw new NotFoundException('Pagamento não encontrado');
          // Estorno em dinheiro trava a sessão só para ele (como a sangria): dois estornos juntos
          // não tiram da gaveta mais do que ela tem.
          await this.lockSession(tx, b.cashSessionId, ref.method === 'cash' ? 'UPDATE' : 'SHARE');
          const o = await this.orders.lock(tx, ref.order_id);
          orderId = o.id;
          await this.orders.assertNoLiveFiscalDocument(tx, o.id, 'estornar');
          const pay = await one<{
            amount: string;
            refunded_amount: string;
            method: PaymentMethod | 'app';
          }>(
            tx,
            `SELECT amount::text, refunded_amount::text, method FROM payments WHERE id = $1 FOR UPDATE`,
            [paymentId],
          );
          // Pago no aplicativo: quem devolve ao cliente é o aplicativo (some sozinho quando ele cancela).
          if (pay!.method === 'app')
            throw new ConflictException(
              'Pagamento feito no aplicativo: o estorno é feito pelo aplicativo, não pelo caixa',
            );
          const cents = toCents(b.amount);
          const available = toCents(pay!.amount) - toCents(pay!.refunded_amount);
          if (cents <= 0) throw new UnprocessableEntityException('Valor deve ser maior que zero');
          if (cents > available)
            throw new ConflictException(`Estorno maior que o disponível (${fromCents(available)})`);
          if (pay!.method === 'cash') {
            const exp = await this.expected(tx, b.cashSessionId);
            if (cents > exp.cash)
              throw new ConflictException('Não há dinheiro suficiente neste caixa para o estorno');
          }
          for (const h of this.refundHooks) await h(tx, ctx, paymentId, cents);
          const r = await one<{ id: string }>(
            tx,
            `INSERT INTO payment_refunds (tenant_id, payment_id, cash_session_id, amount, reason, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [ctx.tenantId, paymentId, b.cashSessionId, fromCents(cents), b.reason, ctx.userId],
          );
          await q(tx, `UPDATE payments SET refunded_amount = refunded_amount + $2 WHERE id = $1`, [
            paymentId,
            fromCents(cents),
          ]);
          await q(
            tx,
            `INSERT INTO cash_movements (tenant_id, cash_session_id, kind, method, amount, payment_id, order_id, note, created_by)
           VALUES ($1,$2,'refund',$3,$4,$5,$6,$7,$8)`,
            [
              ctx.tenantId,
              b.cashSessionId,
              pay!.method,
              fromCents(-cents),
              paymentId,
              o.id,
              b.reason,
              ctx.userId,
            ],
          );
          const newPaid = toCents(o.paid_amount) - cents;
          await q(
            tx,
            `UPDATE orders SET paid_amount = $2, payment_status = $3, version = version + 1 WHERE id = $1`,
            [o.id, fromCents(newPaid), paymentStatusFor(toCents(o.total), newPaid)],
          );
          await this.audit.record(tx, {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            action: 'payment.refunded',
            entity: 'payment',
            entityId: paymentId,
            data: {
              refundId: r!.id,
              amount: fromCents(cents),
              reason: b.reason,
              sessionId: b.cashSessionId,
            },
            ip: ctx.ip,
          });
          return {
            refundId: r!.id,
            paymentId,
            amount: fromCents(cents),
            order: await this.orders.detail(tx, o.id),
          };
        },
      ),
    );
    this.realtime.publish(ctx.tenantId, {
      type: 'order.changed',
      orderId: orderId || res.order!.id,
    });
    this.realtime.publish(ctx.tenantId, { type: 'cash.changed', sessionId: b.cashSessionId });
    return res;
  }
}

/** Troco: só para dinheiro, com valor entregue >= valor pago. */
export function changeFor(
  b: { method: PaymentMethod; tendered?: string },
  amountCents: number,
): string {
  if (b.method !== 'cash' || !b.tendered) return '0.00';
  const t = toCents(b.tendered);
  if (t < amountCents)
    throw new UnprocessableEntityException('Valor entregue menor que o valor pago');
  return fromCents(t - amountCents);
}
