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
import { AVAILABILITY_SQL } from './availability-sql';
import { StockCostsService, type CostChange } from './stock-costs.service';

/**
 * Insumo com o consumo médio por dia das vendas dos últimos 30 dias ("dailyUsage"), que a tela
 * usa para estimar quantos dias o saldo ainda dura. Filtre e ordene sempre com o alias "s.".
 *
 * - O consumo é o das vendas menos o que voltou de pedido cancelado (`sale_reversal`): pedido
 *   lançado e cancelado não conta como consumo (antes contava e o "dura X dias" encurtava).
 * - O valor em estoque conta só o que existe: saldo negativo (insumo liberado para ficar
 *   negativo) vale zero, em vez de descontar do valor dos outros insumos.
 */
export const ITEM_SELECT = `
  SELECT s.id, s.code, s.barcode, s.name, s.unit, s.quantity::text, s.min_quantity::text AS "minQuantity",
         s.avg_cost::text AS "avgCost", s.allow_negative AS "allowNegative", s.active,
         (s.quantity < s.min_quantity) AS low,
         round(greatest(s.quantity, 0) * s.avg_cost, 2)::text AS "stockValue",
         s.category, s.supplier, s.counted_at AS "countedAt", u.daily::text AS "dailyUsage",
         s.shelf_life_days AS "shelfLifeDays", s.recipe_yield::text AS "recipeYield",
         EXISTS (SELECT 1 FROM stock_item_recipes r WHERE r.stock_item_id = s.id) AS "hasPrep",
         s.last_cost::text AS "lastCost", s.cost_changed_at AS "costChangedAt"
    FROM stock_items s
    LEFT JOIN LATERAL (
      SELECT CASE WHEN -sum(m.quantity) > 0 THEN round(-sum(m.quantity) / 30, 3) END AS daily
        FROM stock_movements m
       WHERE m.stock_item_id = s.id AND m.kind IN ('sale', 'sale_reversal')
         AND m.created_at >= now() - interval '30 days'
    ) u ON true`;

/**
 * Hoje no relógio do restaurante (o servidor do banco roda em UTC: à noite no Brasil o
 * `current_date` já é amanhã). Recebimento, lote e validade usam o dia da casa.
 */
export const TZ_SQL = `coalesce((SELECT timezone FROM tenants WHERE id = app_current_tenant()),
    'America/Sao_Paulo')`;
export const TODAY_SQL = `(now() AT TIME ZONE ${TZ_SQL})::date`;

export type StockEntryKind = 'purchase' | 'loss' | 'withdrawal' | 'count';

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
    private readonly costs: StockCostsService,
  ) {}

  /**
   * Baixa os insumos de um pedido recém-criado (produtos + adicionais). Retorna quantos insumos
   * mudaram. Idempotente: pedido que já baixou (reserva do pedido em análise) não baixa de novo.
   */
  async consumeForOrder(tx: Tx, ctx: Ctx, orderId: string): Promise<number> {
    const done = await one(
      tx,
      `SELECT 1 FROM stock_movements WHERE order_id = $1 AND kind = 'sale' LIMIT 1`,
      [orderId],
    );
    if (done) return 0;
    return this.consumeItems(tx, ctx, orderId, null);
  }

  /**
   * Baixa só os itens informados (itens acrescentados ou alterados num pedido já lançado).
   * Mesmo cálculo e mesma checagem de saldo da baixa do pedido.
   */
  consumeForItems(tx: Tx, ctx: Ctx, orderId: string, itemIds: string[]): Promise<number> {
    if (!itemIds.length) return Promise.resolve(0);
    return this.consumeItems(tx, ctx, orderId, itemIds);
  }

  private async consumeItems(
    tx: Tx,
    ctx: Ctx,
    orderId: string,
    itemIds: string[] | null,
  ): Promise<number> {
    const needs = await q<{ stock_item_id: string; q: string }>(
      tx,
      `WITH need AS (
         SELECT r.stock_item_id, r.quantity * i.quantity AS q
           FROM order_items i JOIN product_recipes r ON r.product_id = i.product_id
          WHERE i.order_id = $1 AND i.status <> 'cancelled' AND ($2::uuid[] IS NULL OR i.id = ANY($2::uuid[]))
         UNION ALL
         SELECT r.stock_item_id, r.quantity * i.quantity
           FROM order_item_options io
           JOIN order_items i ON i.id = io.order_item_id
           JOIN option_recipes r ON r.option_id = io.option_id
          WHERE i.order_id = $1 AND i.status <> 'cancelled' AND ($2::uuid[] IS NULL OR i.id = ANY($2::uuid[])))
       SELECT stock_item_id, round(sum(q), 3)::text AS q FROM need GROUP BY stock_item_id
       HAVING round(sum(q), 3) > 0 ORDER BY stock_item_id`,
      [orderId, itemIds],
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
      throw new ConflictException({
        message: `Estoque insuficiente: ${short.map((i) => i.name).join(', ')}. Registre a entrada ou ajuste o estoque.`,
        code: 'stock_out',
      });
    }
    for (const n of needs) {
      await this.move(tx, ctx, n.stock_item_id, 'sale', `-${n.q}`, { orderId });
    }
    return needs.length;
  }

  /**
   * Devolve ao estoque o que um item cancelado consumiu (produto + adicionais). Só age se o
   * pedido já baixou estoque; o movimento leva o pedido, então cancelar o pedido depois não
   * devolve duas vezes (restoreForOrder soma o que sobrou).
   */
  async restoreForItem(
    tx: Tx,
    ctx: Ctx,
    orderId: string,
    itemId: string,
    note = 'Item cancelado',
  ): Promise<number> {
    const consumed = await one(
      tx,
      `SELECT 1 FROM stock_movements WHERE order_id = $1 AND kind = 'sale' LIMIT 1`,
      [orderId],
    );
    if (!consumed) return 0;
    const back = await q<{ stock_item_id: string; q: string }>(
      tx,
      `WITH need AS (
         SELECT r.stock_item_id, r.quantity * i.quantity AS q
           FROM order_items i JOIN product_recipes r ON r.product_id = i.product_id
          WHERE i.id = $1
         UNION ALL
         SELECT r.stock_item_id, r.quantity * i.quantity
           FROM order_item_options io
           JOIN order_items i ON i.id = io.order_item_id
           JOIN option_recipes r ON r.option_id = io.option_id
          WHERE i.id = $1)
       SELECT n.stock_item_id, least(round(sum(n.q), 3),
                -(SELECT coalesce(sum(m.quantity), 0) FROM stock_movements m
                   WHERE m.order_id = $2 AND m.stock_item_id = n.stock_item_id
                     AND m.kind IN ('sale','sale_reversal')))::text AS q
         FROM need n GROUP BY n.stock_item_id
       HAVING least(round(sum(n.q), 3),
                -(SELECT coalesce(sum(m.quantity), 0) FROM stock_movements m
                   WHERE m.order_id = $2 AND m.stock_item_id = n.stock_item_id
                     AND m.kind IN ('sale','sale_reversal'))) > 0
        ORDER BY n.stock_item_id`,
      [itemId, orderId],
    );
    if (!back.length) return 0;
    await q(tx, `SELECT id FROM stock_items WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [
      back.map((b) => b.stock_item_id),
    ]);
    for (const b of back)
      await this.move(tx, ctx, b.stock_item_id, 'sale_reversal', b.q, {
        orderId,
        note,
      });
    return back.length;
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

  /**
   * Aplica um delta já validado (o insumo já deve estar travado). Fora da entrada sem custo,
   * o movimento guarda o custo médio do momento: assim venda, perda e contagem ficam
   * valorizadas (CMV e perdas em R$) mesmo que o custo mude depois.
   */
  async move(
    tx: Tx,
    ctx: Ctx,
    itemId: string,
    kind: string,
    delta: string,
    extra: {
      orderId?: string;
      note?: string;
      unitCost?: string;
      countId?: string;
      receiptId?: string;
      productionId?: string;
      lotId?: string;
    } = {},
  ) {
    const r = await one<{ quantity: string; avg_cost: string }>(
      tx,
      `UPDATE stock_items SET quantity = quantity + $2::numeric WHERE id = $1
       RETURNING quantity::text, avg_cost::text`,
      [itemId, delta],
    );
    await q(
      tx,
      `INSERT INTO stock_movements (tenant_id, stock_item_id, kind, quantity, unit_cost, balance_after, order_id,
                                    note, created_by, count_id, receipt_id, production_id, lot_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        ctx.tenantId,
        itemId,
        kind,
        delta,
        extra.unitCost ?? (kind === 'purchase' ? null : r!.avg_cost),
        r!.quantity,
        extra.orderId ?? null,
        extra.note ?? null,
        ctx.userId,
        extra.countId ?? null,
        extra.receiptId ?? null,
        extra.productionId ?? null,
        extra.lotId ?? null,
      ],
    );
    return r!.quantity;
  }

  /**
   * Movimento manual:
   *  - purchase (entrada): soma e recalcula o custo médio ponderado se vier custo unitário;
   *  - loss (perda/quebra) e withdrawal (saída avulsa: consumo interno, doação…): subtrai, com motivo;
   *  - count (contagem/inventário): ajusta o saldo para o valor contado, com motivo.
   */
  async entry(
    ctx: Ctx,
    itemId: string,
    b: { kind: StockEntryKind; quantity: string; unitCost?: string; note?: string },
  ) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      // Entrada com preço pode mudar o custo: fotografa antes (e trava os preparos atingidos).
      const snap =
        b.kind === 'purchase' && b.unitCost !== undefined
          ? await this.costs.before(tx, [itemId])
          : null;
      const it = await one<{ id: string; quantity: string; allow_negative: boolean; name: string }>(
        tx,
        `SELECT id, name, quantity::text, allow_negative FROM stock_items WHERE id = $1 FOR UPDATE`,
        [itemId],
      );
      if (!it) throw new NotFoundException('Insumo não encontrado');
      if (b.kind !== 'purchase' && !b.note)
        throw new UnprocessableEntityException('Informe o motivo');
      let delta: string;
      if (b.kind === 'purchase') {
        delta = b.quantity;
        if (b.unitCost !== undefined) await this.averageIn(tx, itemId, b.quantity, b.unitCost);
      } else if (b.kind === 'loss' || b.kind === 'withdrawal') {
        const ok = await one<{ ok: boolean }>(tx, `SELECT ($1::numeric - $2::numeric) >= 0 AS ok`, [
          it.quantity,
          b.quantity,
        ]);
        if (!ok!.ok && !it.allow_negative)
          throw new ConflictException(`Saldo insuficiente (${it.quantity})`);
        delta = `-${b.quantity}`;
      } else {
        // Conferir também conta como contagem, mesmo sem diferença.
        await q(tx, `UPDATE stock_items SET counted_at = now() WHERE id = $1`, [itemId]);
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
      const costChange: CostChange | null = snap
        ? await this.costs.after(tx, ctx, snap, 'purchase', b.note ?? 'Entrada')
        : null;
      return { ...(await this.item(tx, itemId)), costChange };
    });
    this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    return res;
  }

  /**
   * Quantidade em estoque do item do cardápio, informada na lista ou no cadastro do item.
   * Reaproveita o estoque: item sem ficha ganha um insumo com o nome dele e a ficha "1 por
   * venda" (o controle simples); item com ficha de um insumo só, 1 por venda, tem esse insumo
   * contado (ajuste com motivo). Ficha com vários insumos não tem um número para digitar: a
   * quantidade sai da ficha. Cada venda baixa o insumo e, quando zera, o item sai do cardápio.
   */
  async setProductQuantity(ctx: Ctx, productId: string, quantity: string) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const p = await one<{ name: string; sold_by_weight: boolean }>(
        tx,
        `SELECT name, sold_by_weight FROM products WHERE id = $1 FOR UPDATE`,
        [productId],
      );
      if (!p) throw new NotFoundException('Item não encontrado');
      if (!p.sold_by_weight && !/^\d+(\.0+)?$/.test(quantity))
        throw new UnprocessableEntityException('Item vendido por unidade: use um número inteiro');
      const lines = await q<{ stock_item_id: string; direct: boolean }>(
        tx,
        `SELECT stock_item_id, quantity = 1 AS direct FROM product_recipes WHERE product_id = $1`,
        [productId],
      );
      if (lines.length > 1 || (lines.length === 1 && !lines[0]!.direct))
        throw new ConflictException(
          'Este item usa uma ficha técnica: a quantidade sai dos insumos. Ajuste-os no Estoque.',
        );
      let itemId = lines[0]?.stock_item_id;
      let created = false;
      if (!itemId) {
        const r = await one<{ id: string }>(
          tx,
          `INSERT INTO stock_items (tenant_id, name, unit) VALUES ($1, $2, $3) RETURNING id`,
          [ctx.tenantId, p.name.slice(0, 80), p.sold_by_weight ? 'kg' : 'un'],
        );
        itemId = r!.id;
        created = true;
        await q(
          tx,
          `INSERT INTO product_recipes (tenant_id, product_id, stock_item_id, quantity) VALUES ($1,$2,$3,1)`,
          [ctx.tenantId, productId, itemId],
        );
      }
      const it = await one<{ quantity: string }>(
        tx,
        `UPDATE stock_items SET counted_at = now() WHERE id = $1 RETURNING quantity::text`,
        [itemId],
      );
      const d = await one<{ d: string }>(tx, `SELECT ($1::numeric - $2::numeric)::text AS d`, [
        quantity,
        it!.quantity,
      ]);
      if (Number(d!.d) !== 0)
        await this.move(tx, ctx, itemId, 'adjustment', d!.d, {
          note: created ? 'Saldo inicial (cardápio)' : 'Quantidade ajustada no cardápio',
        });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'stock.product_quantity',
        entity: 'product',
        entityId: productId,
        data: { name: p.name, quantity, delta: d!.d, stockItemId: itemId, created },
        ip: ctx.ip,
      });
      const av = await one(tx, `SELECT * FROM (${AVAILABILITY_SQL}) a WHERE "productId" = $1`, [
        productId,
      ]);
      return av!;
    });
    this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    return res;
  }

  /**
   * Contagem em lote (inventário): ajusta todos os insumos contados numa única transação e
   * registra a sessão com o resultado valorizado pelo custo médio. Insumos sem diferença
   * também ficam marcados como conferidos.
   */
  async count(ctx: Ctx, b: { note: string; lines: { stockItemId: string; quantity: string }[] }) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const lines = [...b.lines].sort((x, y) => x.stockItemId.localeCompare(y.stockItemId));
      const rows = await q<{ id: string; name: string; delta: string; value: string }>(
        tx,
        `SELECT s.id, s.name, (n.q - s.quantity)::text AS delta,
                round((n.q - s.quantity) * s.avg_cost, 2)::text AS value
           FROM stock_items s JOIN unnest($1::uuid[], $2::numeric[]) AS n(id, q) ON n.id = s.id
          ORDER BY s.id FOR UPDATE OF s`,
        [lines.map((l) => l.stockItemId), lines.map((l) => l.quantity)],
      );
      if (rows.length !== lines.length) throw new NotFoundException('Insumo não encontrado');
      const changed = rows.filter((r) => Number(r.delta) !== 0);
      const valueDelta = await one<{ v: string }>(
        tx,
        `SELECT coalesce(sum(v), 0)::text AS v FROM unnest($1::numeric[]) v`,
        [changed.map((r) => r.value)],
      );
      const c = await one<{ id: string }>(
        tx,
        `INSERT INTO stock_counts (tenant_id, note, items_counted, items_changed, value_delta, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [ctx.tenantId, b.note, rows.length, changed.length, valueDelta!.v, ctx.userId],
      );
      await q(tx, `UPDATE stock_items SET counted_at = now() WHERE id = ANY($1::uuid[])`, [
        rows.map((r) => r.id),
      ]);
      for (const r of changed) {
        await this.move(tx, ctx, r.id, 'adjustment', r.delta, { note: b.note, countId: c!.id });
      }
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'stock.count_batch',
        entity: 'stock_count',
        entityId: c!.id,
        data: {
          note: b.note,
          counted: rows.length,
          changed: changed.map((r) => ({ name: r.name, delta: r.delta })),
          valueDelta: valueDelta!.v,
        },
        ip: ctx.ip,
      });
      return {
        id: c!.id,
        itemsCounted: rows.length,
        itemsChanged: changed.length,
        valueDelta: valueDelta!.v,
      };
    });
    this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    return res;
  }

  /**
   * Custo médio ponderado sobre o saldo positivo existente (chame antes de somar a entrada) e o
   * último custo de entrada. Se o custo médio muda, o gatilho do banco recalcula os preparos.
   */
  async averageIn(tx: Tx, itemId: string, quantity: string, unitCost: string) {
    await q(
      tx,
      `UPDATE stock_items SET avg_cost = round(
         (GREATEST(quantity, 0) * avg_cost + $2::numeric * $3::numeric) / (GREATEST(quantity, 0) + $2::numeric), 4),
         last_cost = $3::numeric, cost_changed_at = now()
       WHERE id = $1`,
      [itemId, quantity, unitCost],
    );
  }

  async item(tx: Tx, id: string) {
    const it = await one(tx, `${ITEM_SELECT} WHERE s.id = $1`, [id]);
    if (!it) throw new NotFoundException('Insumo não encontrado');
    return it;
  }
}
