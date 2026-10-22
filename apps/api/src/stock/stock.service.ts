import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

export const ITEM_SELECT = `
  SELECT id, name, unit, quantity::text, min_quantity::text AS "minQuantity", avg_cost::text AS "avgCost",
         allow_negative AS "allowNegative", active, (quantity < min_quantity) AS low,
         round(quantity * avg_cost, 2)::text AS "stockValue"
    FROM stock_items`;

export type StockEntryKind = 'purchase' | 'loss' | 'count';

/**
 * Estoque por ficha técnica. Toda alteração de saldo:
 *  - trava a linha do insumo (FOR UPDATE, sempre em ordem de id e por ÚLTIMO na transação,
 *    depois de caixa/comanda/pedido) — evita corrida e deadlock entre vendas simultâneas;
 *  - grava um movimento com o saldo resultante (livro-razão só de inserção);
 *  - nunca fica negativo, a não ser que o insumo permita explicitamente.
 * As contas são feitas em NUMERIC no Postgres (nada de float).
 */
@Injectable()
export class StockService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Baixa os insumos de um pedido recém-criado (produtos + adicionais). Retorna quantos insumos mudaram. */
  async consumeForOrder(tx: Tx, ctx: Ctx, orderId: string): Promise<number> {
    const needs = await q<{ stock_item_id: string; q: string }>(
      tx,
      `WITH need AS (
         SELECT r.stock_item_id, r.quantity * i.quantity AS q
           FROM order_items i JOIN product_recipes r ON r.product_id = i.product_id
          WHERE i.order_id = $1 AND i.status <> 'cancelled'
         UNION ALL
         SELECT r.stock_item_id, r.quantity * i.quantity
           FROM order_item_options io
           JOIN order_items i ON i.id = io.order_item_id
           JOIN option_recipes r ON r.option_id = io.option_id
          WHERE i.order_id = $1 AND i.status <> 'cancelled')
       SELECT stock_item_id, round(sum(q), 3)::text AS q FROM need GROUP BY stock_item_id
       HAVING round(sum(q), 3) > 0 ORDER BY stock_item_id`,
      [orderId],
    );
    if (!needs.length) return 0;
    const items = await q<{ id: string; name: string; unit: string; ok: boolean }>(
      tx,
      `SELECT s.id, s.name, s.unit, (s.allow_negative OR s.quantity >= n.q::numeric) AS ok
         FROM stock_items s JOIN unnest($1::uuid[], $2::numeric[]) AS n(id, q) ON n.id = s.id
        ORDER BY s.id FOR UPDATE OF s`,
      [needs.map((n) => n.stock_item_id), needs.map((n) => n.q)],
    );
    const short = items.filter((i) => !i.ok);
    if (short.length) {
      throw new ConflictException(
        `Estoque insuficiente: ${short.map((i) => i.name).join(', ')}. Registre a entrada ou ajuste o estoque.`,
      );
    }
    for (const n of needs) {
      await this.move(tx, ctx, n.stock_item_id, 'sale', `-${n.q}`, { orderId });
    }
    return needs.length;
  }

  /** Devolve ao estoque o que um pedido consumiu (cancelamento). Idempotente. */
  async restoreForOrder(tx: Tx, ctx: Ctx, orderId: string): Promise<number> {
    const back = await q<{ stock_item_id: string; q: string }>(
      tx,
      `SELECT stock_item_id, (-sum(quantity))::text AS q FROM stock_movements
        WHERE order_id = $1 AND kind IN ('sale','sale_reversal')
        GROUP BY stock_item_id HAVING sum(quantity) < 0 ORDER BY stock_item_id`,
      [orderId],
    );
    if (!back.length) return 0;
    await q(tx, `SELECT id FROM stock_items WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [
      back.map((b) => b.stock_item_id),
    ]);
    for (const b of back) {
      await this.move(tx, ctx, b.stock_item_id, 'sale_reversal', b.q, {
        orderId,
        note: 'Pedido cancelado',
      });
    }
    return back.length;
  }

  /** Aplica um delta já validado (o insumo já deve estar travado). */
  private async move(
    tx: Tx,
    ctx: Ctx,
    itemId: string,
    kind: string,
    delta: string,
    extra: { orderId?: string; note?: string; unitCost?: string } = {},
  ) {
    const r = await one<{ quantity: string }>(
      tx,
      `UPDATE stock_items SET quantity = quantity + $2::numeric WHERE id = $1 RETURNING quantity::text`,
      [itemId, delta],
    );
    await q(
      tx,
      `INSERT INTO stock_movements (tenant_id, stock_item_id, kind, quantity, unit_cost, balance_after, order_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        ctx.tenantId,
        itemId,
        kind,
        delta,
        extra.unitCost ?? null,
        r!.quantity,
        extra.orderId ?? null,
        extra.note ?? null,
        ctx.userId,
      ],
    );
    return r!.quantity;
  }

  /**
   * Movimento manual:
   *  - purchase (entrada): soma e recalcula o custo médio ponderado se vier custo unitário;
   *  - loss (perda/quebra): subtrai, com motivo;
   *  - count (contagem/inventário): ajusta o saldo para o valor contado, com motivo.
   */
  async entry(
    ctx: Ctx,
    itemId: string,
    b: { kind: StockEntryKind; quantity: string; unitCost?: string; note?: string },
  ) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const it = await one<{ id: string; quantity: string; allow_negative: boolean; name: string }>(
        tx,
        `SELECT id, name, quantity::text, allow_negative FROM stock_items WHERE id = $1 FOR UPDATE`,
        [itemId],
      );
      if (!it) throw new NotFoundException('Insumo não encontrado');
      if ((b.kind === 'loss' || b.kind === 'count') && !b.note)
        throw new UnprocessableEntityException('Informe o motivo');
      let delta: string;
      if (b.kind === 'purchase') {
        delta = b.quantity;
        if (b.unitCost !== undefined) {
          // Custo médio ponderado sobre o saldo positivo existente.
          await q(
            tx,
            `UPDATE stock_items SET avg_cost = round(
               (GREATEST(quantity, 0) * avg_cost + $2::numeric * $3::numeric) / (GREATEST(quantity, 0) + $2::numeric), 4)
             WHERE id = $1`,
            [itemId, b.quantity, b.unitCost],
          );
        }
      } else if (b.kind === 'loss') {
        const ok = await one<{ ok: boolean }>(tx, `SELECT ($1::numeric - $2::numeric) >= 0 AS ok`, [
          it.quantity,
          b.quantity,
        ]);
        if (!ok!.ok && !it.allow_negative)
          throw new ConflictException(`Saldo insuficiente (${it.quantity})`);
        delta = `-${b.quantity}`;
      } else {
        const d = await one<{ d: string }>(tx, `SELECT ($1::numeric - $2::numeric)::text AS d`, [
          b.quantity,
          it.quantity,
        ]);
        if (Number(d!.d) === 0) return this.item(tx, itemId);
        delta = d!.d;
      }
      const kind = b.kind === 'count' ? 'adjustment' : b.kind;
      await this.move(tx, ctx, itemId, kind, delta, { note: b.note, unitCost: b.unitCost });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: `stock.${b.kind}`,
        entity: 'stock_item',
        entityId: itemId,
        data: {
          name: it.name,
          quantity: b.quantity,
          delta,
          unitCost: b.unitCost ?? null,
          note: b.note ?? null,
        },
        ip: ctx.ip,
      });
      return this.item(tx, itemId);
    });
    this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    return res;
  }

  async item(tx: Tx, id: string) {
    const it = await one(tx, `${ITEM_SELECT} WHERE id = $1`, [id]);
    if (!it) throw new NotFoundException('Insumo não encontrado');
    return it;
  }
}
