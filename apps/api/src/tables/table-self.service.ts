import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { fromCents, toCents } from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import { assertNoTabOnlinePending, CashService } from '../cash/cash.service';
import { Ctx, onlineCtx } from '../common/context';
import { withIdempotency } from '../common/idempotency';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { OnlinePayService, Payer, TablePay } from '../online-pay/online-pay.service';
import { ON_ACCOUNT_SQL, OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  publicPix,
  StoreService,
  TABLE_LOCATION_CODE,
  tablePresenceOf,
  UUID_RE,
} from '../store/store.service';
import { closeTabIfDoneIn, payTabOrdersIn, tabDueOf, tabOrdersIn } from './tab-settle';

/** Comprovantes da conta da mesa: além disso, o caixa resolve com o cliente. */
export const MAX_TAB_RECEIPTS = 5;

export type CallKind = 'waiter' | 'bill';
type Presence = { lat: number; lng: number; accuracy: number };

interface TableRow {
  id: string;
  label: string;
}
interface TabRow {
  id: string;
  number: number;
  status: string;
  table_id: string | null;
}

/**
 * Cliente sentado, pelo cardápio do QR Code da mesa: chama o garçom e fecha a conta sozinho.
 *
 * - Chamado (`table_calls`): aparece no app do garçom e no sistema (PDV, Salão) até alguém
 *   atender; um chamado aberto por mesa (chamar de novo só renova o tipo).
 * - Conta: o cliente vê os itens e o saldo da comanda inteira (pedidos do garçom e de outros
 *   celulares também), paga pelo Pix da loja e manda o comprovante. O caixa confere: aprovado, o
 *   valor entra como Pix nos pedidos da comanda (do mais antigo ao mais novo) e, sem saldo e sem
 *   nada em preparo, a mesa fica livre; recusado, o cliente vê o motivo e manda outro.
 */
@Injectable()
export class TableSelfService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly store: StoreService,
    private readonly cash: CashService,
    private readonly orders: OrdersService,
    private readonly onlinePay: OnlinePayService,
  ) {}

  // ------------------------------------------------------------------ cliente (público)

  private async tableIn(tx: Tx, tableId: string): Promise<TableRow> {
    if (!UUID_RE.test(tableId)) throw new NotFoundException('Mesa não encontrada');
    const t = await one<TableRow>(
      tx,
      `SELECT id, label FROM dining_tables WHERE id = $1 AND active`,
      [tableId],
    );
    if (!t) throw new NotFoundException('Mesa não encontrada');
    return t;
  }

  private openTabIn(tx: Tx, tableId: string, lock = false) {
    return one<TabRow>(
      tx,
      `SELECT id, number, status, table_id FROM tabs WHERE table_id = $1 AND status = 'open'
        ${lock ? 'FOR UPDATE' : ''}`,
      [tableId],
    );
  }

  /** Loja com o cardápio ligado (e a conferência de que o celular está no restaurante). */
  private async storeFor(tx: Tx, presence?: Presence) {
    const s = await this.store.settingsIn(tx);
    if (!s.enabled) throw new NotFoundException('Cardápio online desativado');
    // Mesma conferência do pedido pela mesa (desligada ou sem o ponto da loja: sempre passa).
    if (!tablePresenceOf(s, presence).ok)
      throw new HttpException(
        {
          message: presence
            ? 'Parece que você não está no restaurante. Confirme a localização de dentro do salão.'
            : 'Confirme sua localização para chamar o garçom pelo celular',
          code: TABLE_LOCATION_CODE,
        },
        428,
      );
    return s;
  }

  /**
   * Conta da mesa para o cliente: itens, taxa de serviço, total, pago e saldo da comanda aberta,
   * as formas de pagar que a loja ligou, o último comprovante e o chamado aberto.
   *
   * Formas de pagar pelo celular (as que o admin liberou): o Pix com comprovante (`methods.pix`)
   * e o PagBank conectado (`methods.pixAuto` = Pix que confirma sozinho, `methods.card`). Como
   * no cardápio online, o Pix do PagBank fica no lugar do Pix com comprovante.
   */
  async bill(tenantId: string, tableId: string) {
    const offer = await this.onlinePay.offer(tenantId).catch(() => null);
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.store.settingsIn(tx);
      if (!s.enabled) throw new NotFoundException('Cardápio online desativado');
      const table = await this.tableIn(tx, tableId);
      const call = await one<{ kind: CallKind; createdAt: Date }>(
        tx,
        `SELECT kind, created_at AS "createdAt" FROM table_calls
          WHERE table_id = $1 AND status = 'open'`,
        [tableId],
      );
      const storePix = publicPix(s);
      const manualPix = !!storePix && !offer?.pix;
      const tab = await this.openTabIn(tx, tableId);
      const base = {
        table: { id: table.id, label: table.label },
        call: call ?? null,
        methods: { pix: manualPix, pixAuto: !!offer?.pix, card: !!offer?.card },
        pix: manualPix ? storePix : null,
        /** Chave pública do cartão e o ambiente (o cartão é cifrado no celular). */
        pagbank: offer ? { publicKey: offer.publicKey, env: offer.env } : null,
      };
      if (!tab)
        return {
          ...base,
          open: false,
          items: [],
          serviceFee: '0.00',
          total: '0.00',
          paid: '0.00',
          due: '0.00',
          awaiting: 0,
          receipt: null,
          online: null,
        };
      const orders = await tabOrdersIn(tx, tab.id);
      const live = orders.filter((o) => o.status !== 'cancelled');
      const items = await q<{ name: string; quantity: string; unit: string; total: string }>(
        tx,
        `SELECT i.name, i.quantity::text, i.unit, i.total::text
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.tab_id = $1 AND o.status <> 'cancelled' AND i.status <> 'cancelled'
          ORDER BY i.created_at, i.id`,
        [tab.id],
      );
      const receipt = await one<{
        id: string;
        status: string;
        amount: string;
        rejectReason: string | null;
        createdAt: Date;
      }>(
        tx,
        `SELECT id, status, amount::text, reject_reason AS "rejectReason", created_at AS "createdAt"
           FROM tab_pix_receipts WHERE tab_id = $1 AND status <> 'replaced'
          ORDER BY created_at DESC LIMIT 1`,
        [tab.id],
      );
      const online = await this.onlinePay.tabPublicViewIn(tx, tab.id);
      const sum = (f: (o: (typeof live)[number]) => string) =>
        fromCents(live.reduce((n, o) => n + toCents(f(o)), 0));
      // Pago pelo app e ainda fora do caixa: para o cliente a conta já está paga.
      const outside = toCents(online.paidOutside);
      return {
        ...base,
        open: true,
        items,
        serviceFee: sum((o) => o.surcharge),
        total: sum((o) => o.total),
        paid: fromCents(toCents(sum((o) => o.paid_amount)) + outside),
        due: fromCents(Math.max(0, tabDueOf(orders) - outside)),
        /** Pedidos do celular ainda esperando a loja aceitar: não se paga antes. */
        awaiting: live.filter((o) => o.status === 'awaiting').length,
        receipt: receipt
          ? {
              status: receipt.status,
              amount: receipt.amount,
              rejectReason: receipt.rejectReason,
              at: receipt.createdAt,
            }
          : null,
        online,
      };
    });
  }

  /**
   * Paga a conta inteira da mesa pelo PagBank (Pix automático ou cartão), sem a conta do cliente:
   * o CPF e o e-mail de quem paga vão só para o PagBank. Mesma conferência de localização do
   * chamado (gerar o Pix trava cobrar a mesa de outro jeito até ele vencer).
   */
  async payTab(
    tenantId: string,
    tableId: string,
    b: (
      | { method: 'card'; encryptedCard: string; holderName: string }
      | { method: 'pix'; name: string }
    ) & { cpf: string; email: string; amount: string; presence?: Presence },
    baseUrl: string,
    ip?: string,
  ) {
    const table = await this.db.withTenant({ tenantId }, async (tx) => {
      await this.storeFor(tx, b.presence);
      return this.tableIn(tx, tableId);
    });
    const payer: Payer = {
      name: b.method === 'card' ? b.holderName : b.name,
      email: b.email,
      taxId: b.cpf,
      phone: '',
    };
    const p: TablePay =
      b.method === 'card'
        ? {
            method: 'card',
            encryptedCard: b.encryptedCard,
            holderName: b.holderName,
            payer,
            amount: b.amount,
          }
        : { method: 'pix', payer, amount: b.amount };
    await this.onlinePay.payTab(tenantId, table, p, baseUrl, ip);
    return this.bill(tenantId, tableId);
  }

  /** "Pagar de outro jeito": o Pix gerado deixa de valer e a mesa paga com o garçom. */
  async cancelTabPix(tenantId: string, tableId: string) {
    await this.db.withTenant({ tenantId }, (tx) => this.tableIn(tx, tableId));
    await this.onlinePay.cancelTabPix(tenantId, tableId);
    return this.bill(tenantId, tableId);
  }

  /** "Chamar o garçom" (ou "pagar com o garçom"): um chamado aberto por mesa. */
  async call(tenantId: string, tableId: string, kind: CallKind, presence?: Presence, ip?: string) {
    const ctx = onlineCtx(tenantId);
    ctx.ip = ip;
    const res = await this.db.withTenant(ctx, async (tx) => {
      await this.storeFor(tx, presence);
      const table = await this.tableIn(tx, tableId);
      const tab = await this.openTabIn(tx, tableId);
      const c = await one<{ id: string; created: boolean }>(
        tx,
        `INSERT INTO table_calls (tenant_id, table_id, tab_id, kind) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, table_id) WHERE status = 'open'
         DO UPDATE SET kind = EXCLUDED.kind
         RETURNING id, (xmax = 0) AS created`,
        [tenantId, tableId, tab?.id ?? null, kind],
      );
      if (c!.created)
        await this.audit.record(tx, {
          tenantId,
          actorUserId: null,
          action: 'table.called',
          entity: 'table',
          entityId: tableId,
          data: { callId: c!.id, kind, label: table.label },
          ip,
        });
      return { id: c!.id, tableId, label: table.label };
    });
    this.realtime.publish(tenantId, {
      type: 'table.call',
      tableId,
      callId: res.id,
      status: 'open',
    });
    return { ok: true, kind };
  }

  /** O cliente desistiu do chamado (ou já foi atendido no salão). */
  async cancelCall(tenantId: string, tableId: string) {
    const res = await this.db.withTenant({ tenantId }, async (tx) => {
      await this.tableIn(tx, tableId);
      return one<{ id: string }>(
        tx,
        `UPDATE table_calls SET status = 'cancelled' WHERE table_id = $1 AND status = 'open'
         RETURNING id`,
        [tableId],
      );
    });
    if (res)
      this.realtime.publish(tenantId, {
        type: 'table.call',
        tableId,
        callId: res.id,
        status: 'cancelled',
      });
    return { ok: true };
  }

  /**
   * Comprovante do Pix da conta inteira (foto ou PDF, já conferidos). Vale o saldo de agora; mandar
   * outro antes de o caixa olhar troca o anterior. A mesa passa a "em pagamento" no salão.
   */
  async submitReceipt(
    tenantId: string,
    tableId: string,
    f: { mime: string; bytes: Buffer; width?: number; height?: number },
    ip?: string,
  ) {
    const ctx = onlineCtx(tenantId);
    ctx.ip = ip;
    const res = await this.db.withTenant(ctx, async (tx) => {
      const s = await this.store.settingsIn(tx);
      if (!s.enabled) throw new NotFoundException('Cardápio online desativado');
      if (!publicPix(s))
        throw new ConflictException('Esta loja não recebe Pix pelo celular. Chame o garçom.');
      await this.tableIn(tx, tableId);
      const tab = await this.openTabIn(tx, tableId, true);
      if (!tab) throw new ConflictException('Esta mesa não tem conta aberta');
      const orders = await tabOrdersIn(tx, tab.id, true);
      const waiting = orders.find((o) => o.status === 'awaiting');
      if (waiting)
        throw new ConflictException(
          `O pedido #${waiting.number} ainda espera a loja aceitar. Pague depois que ele for aceito.`,
        );
      // Pagando pelo PagBank agora (ou já pago por ele): mandar comprovante cobraria duas vezes.
      await assertNoTabOnlinePending(tx, tab.id).catch(() => {
        throw new ConflictException(
          'Esta mesa já está pagando a conta pelo app. Espere confirmar ou chame o garçom.',
        );
      });
      const due = tabDueOf(orders);
      if (due <= 0) throw new ConflictException('A conta desta mesa já está paga');
      const n = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM tab_pix_receipts WHERE tab_id = $1`,
        [tab.id],
      );
      if (n!.n >= MAX_TAB_RECEIPTS)
        throw new UnprocessableEntityException(
          'Já chegaram vários comprovantes desta mesa. Chame o garçom.',
        );
      await q(
        tx,
        `UPDATE tab_pix_receipts SET status = 'replaced' WHERE tab_id = $1 AND status = 'submitted'`,
        [tab.id],
      );
      const r = await one<{ id: string; created_at: Date }>(
        tx,
        `INSERT INTO tab_pix_receipts (tenant_id, tab_id, content_type, bytes, size, width, height, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
        [
          tenantId,
          tab.id,
          f.mime,
          f.bytes,
          f.bytes.length,
          f.width ?? null,
          f.height ?? null,
          fromCents(due),
        ],
      );
      // A mesa pediu a conta: o salão mostra "em pagamento".
      await q(
        tx,
        `UPDATE tabs SET bill_requested_at = COALESCE(bill_requested_at, now()) WHERE id = $1`,
        [tab.id],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: null,
        action: 'tab.pix_receipt_sent',
        entity: 'tab',
        entityId: tab.id,
        data: { receiptId: r!.id, type: f.mime, size: f.bytes.length, amount: fromCents(due) },
        ip,
      });
      return { tabId: tab.id, at: r!.created_at, amount: fromCents(due) };
    });
    this.realtime.publish(tenantId, { type: 'tab.changed', tabId: res.tabId });
    return { status: 'submitted' as const, at: res.at, amount: res.amount };
  }

  // ------------------------------------------------------------------ equipe

  /** Chamados abertos (app do garçom, PDV e Salão), do mais antigo ao mais novo. */
  calls(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `SELECT c.id, c.table_id AS "tableId", dt.label AS "tableLabel", c.tab_id AS "tabId",
                c.kind, c.created_at AS "createdAt"
           FROM table_calls c JOIN dining_tables dt ON dt.id = c.table_id
          WHERE c.status = 'open'
          ORDER BY c.created_at`,
      ),
    );
  }

  /** "Atendi": o chamado sai da lista de todo mundo. */
  async answer(ctx: Ctx, id: string) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const c = await one<{ id: string; table_id: string; status: string }>(
        tx,
        `SELECT id, table_id, status FROM table_calls WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!c) throw new NotFoundException('Chamado não encontrado');
      if (c.status !== 'open') return { tableId: c.table_id, changed: false };
      await q(
        tx,
        `UPDATE table_calls SET status = 'answered', answered_at = now(), answered_by = $2
          WHERE id = $1`,
        [id, ctx.userId],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'table.call_answered',
        entity: 'table',
        entityId: c.table_id,
        data: { callId: id },
        ip: ctx.ip,
      });
      return { tableId: c.table_id, changed: true };
    });
    if (res.changed)
      this.realtime.publish(ctx.tenantId, {
        type: 'table.call',
        tableId: res.tableId,
        callId: id,
        status: 'answered',
      });
    return { ok: true };
  }

  /** Comprovantes da conta da mesa esperando o caixa conferir. */
  pendingReceipts(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `SELECT r.id, r.tab_id AS "tabId", tb.number AS "tabNumber", tb.table_id AS "tableId",
                dt.label AS "tableLabel", r.amount::text, r.content_type AS "contentType",
                r.created_at AS "createdAt",
                (SELECT COALESCE(sum(o.total - o.paid_amount)
                   FILTER (WHERE o.status <> 'cancelled' AND NOT ${ON_ACCOUNT_SQL}), 0)::text
                   FROM orders o WHERE o.tab_id = r.tab_id) AS due
           FROM tab_pix_receipts r
           JOIN tabs tb ON tb.id = r.tab_id
           LEFT JOIN dining_tables dt ON dt.id = tb.table_id
          WHERE r.status = 'submitted'
          ORDER BY r.created_at`,
      ),
    );
  }

  /** Arquivo do comprovante (privado, só para a equipe). */
  async receiptFile(ctx: Ctx, id: string) {
    const f = await this.db.withTenant(ctx, (tx) =>
      one<{ contentType: string; bytes: Buffer | null }>(
        tx,
        `SELECT content_type AS "contentType", bytes FROM tab_pix_receipts WHERE id = $1`,
        [id],
      ),
    );
    if (!f) throw new NotFoundException('Comprovante não encontrado');
    if (!f.bytes) throw new NotFoundException('O arquivo deste comprovante já foi apagado');
    return { contentType: f.contentType, bytes: f.bytes };
  }

  private async lockReceipt(tx: Tx, id: string) {
    const r = await one<{ id: string; tab_id: string; status: string; amount: string }>(
      tx,
      `SELECT id, tab_id, status, amount::text FROM tab_pix_receipts WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!r) throw new NotFoundException('Comprovante não encontrado');
    if (r.status === 'replaced')
      throw new ConflictException('A mesa mandou um comprovante mais novo. Confira o último.');
    if (r.status !== 'submitted')
      throw new ConflictException(
        r.status === 'approved'
          ? 'Este comprovante já foi aprovado'
          : 'Este comprovante já foi recusado',
      );
    return r;
  }

  /**
   * Comprovante conferido: o valor (até o saldo de agora) entra como Pix no caixa, nos pedidos
   * da comanda do mais antigo ao mais novo. Sem saldo e sem nada em preparo, a mesa fica livre.
   * Exige `Idempotency-Key`: reenviar não lança duas vezes.
   */
  async approve(ctx: Ctx, id: string, cashSessionId: string, idemKey: string) {
    const touched: string[] = [];
    const res = await this.db.withTenant(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx.tenantId,
        'tab_pix.approve',
        idemKey,
        { id, cashSessionId },
        async () => {
          // Travas na ordem do caixa: sessão → comanda → pedidos → comprovante.
          await this.cash.lockSession(tx, cashSessionId, 'SHARE');
          const tabId = (
            await one<{ tab_id: string }>(tx, `SELECT tab_id FROM tab_pix_receipts WHERE id = $1`, [
              id,
            ])
          )?.tab_id;
          if (!tabId) throw new NotFoundException('Comprovante não encontrado');
          const tab = await one<TabRow>(
            tx,
            `SELECT id, number, status, table_id FROM tabs WHERE id = $1 FOR UPDATE`,
            [tabId],
          );
          const orders = await tabOrdersIn(tx, tabId, true);
          const r = await this.lockReceipt(tx, id);
          if (!tab || tab.status !== 'open')
            throw new ConflictException(
              'A conta desta mesa já foi fechada. Recuse o comprovante e, se o Pix caiu, devolva ao cliente.',
            );
          const waiting = orders.find((o) => o.status === 'awaiting');
          if (waiting)
            throw new ConflictException(
              `O pedido #${waiting.number}, feito pelo cliente no celular, ainda espera aceite. Aceite ou recuse antes de aprovar o Pix.`,
            );
          const due = tabDueOf(orders);
          if (due <= 0)
            throw new ConflictException(
              'A conta da mesa já está paga. Recuse este comprovante e, se o Pix caiu, devolva o valor ao cliente.',
            );
          // A mesa pagando pelo PagBank agora: aprovar o comprovante cobraria duas vezes.
          await assertNoTabOnlinePending(tx, tabId);
          const { applied, payments } = await payTabOrdersIn(tx, ctx, this.cash, orders, {
            cashSessionId,
            method: 'pix',
            cents: toCents(r.amount),
          });
          touched.push(...payments.map((p) => p.orderId));
          await q(
            tx,
            `UPDATE tab_pix_receipts SET status = 'approved', reviewed_by = $2, reviewed_at = now(),
                  applied = $3, cash_session_id = $4 WHERE id = $1`,
            [id, ctx.userId, fromCents(applied), cashSessionId],
          );
          await this.audit.record(tx, {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            action: 'tab.pix_receipt_approved',
            entity: 'tab',
            entityId: tabId,
            data: { receiptId: id, amount: r.amount, applied: fromCents(applied) },
            ip: ctx.ip,
          });
          // Pedidos já servidos e agora pagos: concluem. Sem saldo e nada aberto: a mesa fica livre.
          const reservations: string[] = [];
          for (const oid of touched) {
            const st = await this.orders.settleServedIn(tx, ctx, oid);
            reservations.push(...(st.reservationIds ?? []));
          }
          const closed = await closeTabIfDoneIn(tx, this.audit, ctx, tabId, 'tab_pix_paid');
          return {
            tabId,
            closed,
            applied: fromCents(applied),
            short: fromCents(Math.max(0, due - applied)),
            reservations: [...reservations, ...closed.reservations],
          };
        },
      ),
    );
    for (const oid of touched)
      this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId: oid });
    this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId: res.tabId });
    this.realtime.publish(ctx.tenantId, { type: 'cash.changed', sessionId: cashSessionId });
    if (res.closed.done) this.orders.notifyTabClosed(ctx, res.tabId);
    this.orders.publishReservations(ctx, res.reservations);
    return { applied: res.applied, short: res.short, tabClosed: res.closed.done };
  }

  /** Comprovante recusado (com motivo): o cliente vê na conta da mesa e pode mandar outro. */
  async reject(ctx: Ctx, id: string, reason: string) {
    const tabId = await this.db.withTenant(ctx, async (tx) => {
      const r = await this.lockReceipt(tx, id);
      await q(
        tx,
        `UPDATE tab_pix_receipts SET status = 'rejected', reviewed_by = $2, reviewed_at = now(),
                reject_reason = $3 WHERE id = $1`,
        [id, ctx.userId, reason],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'tab.pix_receipt_rejected',
        entity: 'tab',
        entityId: r.tab_id,
        data: { receiptId: id, reason },
        ip: ctx.ip,
      });
      return r.tab_id;
    });
    this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId });
    return { ok: true };
  }
}
