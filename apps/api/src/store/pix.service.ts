import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { fromCents, toCents } from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.service';
import { Ctx, onlineCtx } from '../common/context';
import { sniff } from '../common/file-sniff';
import { withIdempotency } from '../common/idempotency';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MAX_PIX_RECEIPTS, StoreService } from './store.service';

/** Comprovante: foto (o navegador já reduz) ou o PDF que o app do banco gera, até 3 MB. */
export const RECEIPT_IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);
export const RECEIPT_TYPES = new Set([...RECEIPT_IMAGE_TYPES, 'application/pdf']);
export const MAX_RECEIPT_BYTES = 3 * 1024 * 1024;

/** Confere tipo, tamanho e assinatura do comprovante (o Content-Type do navegador não basta). */
export function checkReceipt(body: unknown, type: string | undefined) {
  const mime = (type ?? '').split(';')[0].trim().toLowerCase();
  if (!RECEIPT_TYPES.has(mime) || !Buffer.isBuffer(body))
    throw new UnprocessableEntityException('Envie o comprovante em foto (JPG, PNG) ou PDF');
  if (body.length === 0 || body.length > MAX_RECEIPT_BYTES)
    throw new UnprocessableEntityException('Comprovante vazio ou maior que 3 MB');
  const real =
    mime === 'application/pdf'
      ? body.subarray(0, 5).toString('latin1') === '%PDF-'
        ? mime
        : null
      : sniff(body);
  if (real !== mime)
    throw new UnprocessableEntityException('O arquivo não é uma foto ou PDF válido');
  return { mime, bytes: body };
}

interface PixOrderRow {
  id: string;
  number: number;
  status: string;
  total: string;
  paid_amount: string;
  pix_status: string | null;
  tab_id: string | null;
}

/**
 * Pix pelo cardápio com comprovante, sem banco nem intermediário: o cliente paga pelo QR Code
 * estático da loja e manda a foto ou o PDF do comprovante; a equipe confere e aprova (o pagamento
 * entra no caixa como Pix) ou recusa (o cliente pode mandar outro).
 */
@Injectable()
export class PixService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly orders: OrdersService,
    private readonly cash: CashService,
    private readonly store: StoreService,
  ) {}

  private async lockOrder(tx: Tx, id: string) {
    const o = await one<PixOrderRow>(
      tx,
      `SELECT id, number, status, total::text, paid_amount::text, pix_status, tab_id
         FROM orders WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!o) throw new NotFoundException('Pedido não encontrado');
    return o;
  }

  /** Cliente manda o comprovante (pelo link do pedido ou pela conta, já conferida como dele). */
  async submit(
    tenantId: string,
    ref: { token: string } | { orderId: string },
    f: { mime: string; bytes: Buffer; width?: number; height?: number },
    ip?: string,
  ) {
    const ctx = onlineCtx(tenantId);
    ctx.ip = ip;
    const res = await this.db.withTenant(ctx, async (tx) => {
      const id = 'token' in ref ? await this.store.byToken(tx, ref.token) : ref.orderId;
      const o = await this.lockOrder(tx, id);
      if (!o.pix_status)
        throw new ConflictException('Este pedido não é pago por Pix pelo cardápio');
      if (o.status === 'cancelled') throw new ConflictException('Este pedido foi cancelado');
      const due = toCents(o.total) - toCents(o.paid_amount);
      if (o.pix_status === 'approved' || due <= 0)
        throw new ConflictException('O pagamento deste pedido já foi confirmado pela loja');
      const n = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM pix_receipts WHERE order_id = $1`,
        [id],
      );
      if (n!.n >= MAX_PIX_RECEIPTS)
        throw new UnprocessableEntityException(
          'Já chegaram vários comprovantes deste pedido. Fale com a loja.',
        );
      // Mandou outro antes de a loja olhar: vale o mais novo.
      await q(
        tx,
        `UPDATE pix_receipts SET status = 'replaced' WHERE order_id = $1 AND status = 'submitted'`,
        [id],
      );
      const r = await one<{ id: string; created_at: Date }>(
        tx,
        `INSERT INTO pix_receipts (tenant_id, order_id, content_type, bytes, size, width, height, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
        [
          tenantId,
          id,
          f.mime,
          f.bytes,
          f.bytes.length,
          f.width ?? null,
          f.height ?? null,
          fromCents(due),
        ],
      );
      await q(
        tx,
        `UPDATE orders SET pix_status = 'submitted', version = version + 1 WHERE id = $1`,
        [id],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: null,
        action: 'order.pix_receipt_sent',
        entity: 'order',
        entityId: id,
        data: { receiptId: r!.id, type: f.mime, size: f.bytes.length, amount: fromCents(due) },
        ip,
      });
      return {
        orderId: id,
        tabId: o.tab_id,
        receipt: { id: r!.id, status: 'submitted', at: r!.created_at },
      };
    });
    this.realtime.publish(tenantId, { type: 'order.changed', orderId: res.orderId });
    return { status: 'submitted' as const, at: res.receipt.at };
  }

  /** Arquivo do comprovante, para a equipe (privado: nunca vai para o cache público). */
  async file(ctx: Ctx, orderId: string, receiptId: string) {
    const f = await this.db.withTenant(ctx, (tx) =>
      one<{ contentType: string; bytes: Buffer | null }>(
        tx,
        `SELECT content_type AS "contentType", bytes FROM pix_receipts WHERE id = $1 AND order_id = $2`,
        [receiptId, orderId],
      ),
    );
    if (!f) throw new NotFoundException('Comprovante não encontrado');
    if (!f.bytes)
      throw new NotFoundException('O arquivo deste comprovante já foi apagado (mais de 180 dias)');
    return { contentType: f.contentType, bytes: f.bytes };
  }

  private async lockReceipt(tx: Tx, orderId: string, receiptId: string) {
    const r = await one<{ id: string; status: string }>(
      tx,
      `SELECT id, status FROM pix_receipts WHERE id = $1 AND order_id = $2 FOR UPDATE`,
      [receiptId, orderId],
    );
    if (!r) throw new NotFoundException('Comprovante não encontrado');
    if (r.status === 'replaced')
      throw new ConflictException('O cliente mandou um comprovante mais novo. Confira o último.');
    if (r.status !== 'submitted')
      throw new ConflictException(
        r.status === 'approved'
          ? 'Este comprovante já foi aprovado'
          : 'Este comprovante já foi recusado',
      );
    return r;
  }

  /**
   * Comprovante conferido: o que falta pagar entra como Pix no caixa escolhido (o pedido fica
   * pago). Exige `Idempotency-Key`: reenviar não lança o pagamento duas vezes.
   */
  async approve(
    ctx: Ctx,
    orderId: string,
    receiptId: string,
    b: { cashSessionId?: string },
    idemKey: string,
  ) {
    const res = await this.db.withTenant(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx.tenantId,
        'pix.approve',
        idemKey,
        { orderId, receiptId, ...b },
        async () => {
          // Travas na ordem do caixa: sessão → pedido → comprovante.
          if (b.cashSessionId) await this.cash.lockSession(tx, b.cashSessionId, 'SHARE');
          const o = await this.orders.lock(tx, orderId);
          await this.lockReceipt(tx, orderId, receiptId);
          if (o.status === 'cancelled')
            throw new ConflictException(`Pedido #${o.number} está cancelado`);
          const due = toCents(o.total) - toCents(o.paid_amount);
          let paymentId: string | null = null;
          if (due > 0) {
            if (!b.cashSessionId)
              throw new UnprocessableEntityException(
                'Abra um caixa para aprovar: o Pix entra como pagamento no caixa',
              );
            const p = await this.cash.applyPayment(tx, ctx, o, {
              cashSessionId: b.cashSessionId,
              method: 'pix',
              amountCents: due,
            });
            paymentId = p.id;
          }
          await q(
            tx,
            `UPDATE pix_receipts SET status = 'approved', reviewed_by = $2, reviewed_at = now(),
                    payment_id = $3 WHERE id = $1`,
            [receiptId, ctx.userId, paymentId],
          );
          await q(
            tx,
            `UPDATE orders SET pix_status = 'approved', version = version + 1 WHERE id = $1`,
            [orderId],
          );
          await this.audit.record(tx, {
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            action: 'order.pix_receipt_approved',
            entity: 'order',
            entityId: orderId,
            data: { receiptId, paymentId, amount: fromCents(Math.max(due, 0)) },
            ip: ctx.ip,
          });
          return {
            paid: paymentId !== null,
            order: await this.orders.detail(tx, orderId),
          };
        },
      ),
    );
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId });
    if (res.paid && b.cashSessionId)
      this.realtime.publish(ctx.tenantId, { type: 'cash.changed', sessionId: b.cashSessionId });
    const tabId = res.order?.tabId;
    if (tabId) this.realtime.publish(ctx.tenantId, { type: 'tab.changed', tabId });
    const paidNow = (res.order as { paymentStatus?: string } | undefined)?.paymentStatus === 'paid';
    if (res.paid && paidNow) this.cash.notifyPaid(ctx, orderId);
    return res.order;
  }

  /** Comprovante recusado (com motivo): o cliente vê no acompanhamento e pode mandar outro. */
  async reject(ctx: Ctx, orderId: string, receiptId: string, reason: string) {
    const order = await this.db.withTenant(ctx, async (tx) => {
      await this.lockOrder(tx, orderId);
      await this.lockReceipt(tx, orderId, receiptId);
      await q(
        tx,
        `UPDATE pix_receipts SET status = 'rejected', reviewed_by = $2, reviewed_at = now(),
                reject_reason = $3 WHERE id = $1`,
        [receiptId, ctx.userId, reason],
      );
      await q(
        tx,
        `UPDATE orders SET pix_status = 'rejected', version = version + 1 WHERE id = $1`,
        [orderId],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'order.pix_receipt_rejected',
        entity: 'order',
        entityId: orderId,
        data: { receiptId, reason },
        ip: ctx.ip,
      });
      return this.orders.detail(tx, orderId);
    });
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId });
    return order;
  }
}
