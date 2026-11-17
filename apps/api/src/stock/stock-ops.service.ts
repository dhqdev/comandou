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
import { StockCostsService } from './stock-costs.service';
import { StockService } from './stock.service';

export interface ReceiptLineInput {
  stockItemId: string;
  /** Quantidade como veio na nota, na unidade `unit`. */
  quantity: string;
  unit: string;
  /** Quanto 1 `unit` vale na unidade de controle do insumo. */
  factor: string;
  /** Custo por `unit`. */
  unitCost?: string;
  lotCode?: string;
  madeOn?: string;
  expiresOn?: string;
}

export interface ProductionLineInput {
  stockItemId: string;
  quantity: string;
  lotCode?: string;
  expiresOn?: string | null;
}

/**
 * Recebimento, produção e lotes. Mesmas regras do StockService: travar os insumos em ordem de
 * id, gravar cada mudança de saldo como movimento e contas em NUMERIC no Postgres.
 */
@Injectable()
export class StockOpsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly costs: StockCostsService,
  ) {}

  private async lock(tx: Tx, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    const rows = await q<{ id: string }>(
      tx,
      `SELECT id FROM stock_items WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [unique],
    );
    if (rows.length !== unique.length) throw new NotFoundException('Insumo não encontrado');
  }

  /** Mercadoria que chegou: cada linha vira entrada (com custo médio) e, se tiver validade, lote. */
  async receive(
    ctx: Ctx,
    b: {
      supplier?: string | null;
      invoice?: string | null;
      receivedOn?: string;
      note?: string | null;
      lines: ReceiptLineInput[];
    },
  ) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      // Linhas com preço mudam o custo: fotografa antes (trava também os preparos atingidos).
      const priced = b.lines.filter((l) => l.unitCost != null).map((l) => l.stockItemId);
      const snap = priced.length
        ? await this.costs.before(
            tx,
            priced,
            b.lines.map((l) => l.stockItemId),
          )
        : null;
      await this.lock(
        tx,
        b.lines.map((l) => l.stockItemId),
      );
      const r = await one<{ id: string; code: string }>(
        tx,
        `INSERT INTO stock_receipts (tenant_id, supplier, invoice, received_on, note, created_by)
         VALUES ($1,$2,$3,coalesce($4::date, current_date),$5,$6) RETURNING id, code`,
        [
          ctx.tenantId,
          b.supplier ?? null,
          b.invoice ?? null,
          b.receivedOn ?? null,
          b.note ?? null,
          ctx.userId,
        ],
      );
      let totalCents = 0;
      for (const l of b.lines) {
        const conv = await one<{ qty: string; cost: string | null; total: string | null }>(
          tx,
          `SELECT round($1::numeric * $2::numeric, 3)::text AS qty,
                  CASE WHEN $3::numeric IS NULL THEN NULL ELSE round($3::numeric / $2::numeric, 4)::text END AS cost,
                  CASE WHEN $3::numeric IS NULL THEN NULL ELSE round($1::numeric * $3::numeric, 2)::text END AS total`,
          [l.quantity, l.factor, l.unitCost ?? null],
        );
        if (Number(conv!.qty) <= 0)
          throw new UnprocessableEntityException('Quantidade convertida ficou zerada');
        if (conv!.total) totalCents += Math.round(Number(conv!.total) * 100);
        let lotId: string | undefined;
        if (l.lotCode || l.expiresOn) {
          const lot = await one<{ id: string }>(
            tx,
            `INSERT INTO stock_lots (tenant_id, stock_item_id, code, quantity, made_on, expires_on, origin, receipt_id, created_by)
             VALUES ($1,$2,$3,$4,coalesce($5::date, $6::date),$7,'receipt',$8,$9) RETURNING id`,
            [
              ctx.tenantId,
              l.stockItemId,
              l.lotCode ?? null,
              conv!.qty,
              l.madeOn ?? null,
              b.receivedOn ?? new Date().toISOString().slice(0, 10),
              l.expiresOn ?? null,
              r!.id,
              ctx.userId,
            ],
          );
          lotId = lot!.id;
        }
        await q(
          tx,
          `INSERT INTO stock_receipt_lines (tenant_id, receipt_id, stock_item_id, quantity, unit_cost,
                                            entered_quantity, entered_unit, factor, lot_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            ctx.tenantId,
            r!.id,
            l.stockItemId,
            conv!.qty,
            conv!.cost,
            l.quantity,
            l.unit,
            l.factor,
            lotId ?? null,
          ],
        );
        if (conv!.cost !== null)
          await this.stock.averageIn(tx, l.stockItemId, conv!.qty, conv!.cost);
        await this.stock.move(tx, ctx, l.stockItemId, 'purchase', conv!.qty, {
          note: [`Recebimento ${r!.code}`, b.supplier, b.invoice && `NF ${b.invoice}`]
            .filter(Boolean)
            .join(' · '),
          unitCost: conv!.cost ?? undefined,
          receiptId: r!.id,
          lotId,
        });
      }
      const total = (totalCents / 100).toFixed(2);
      await q(tx, `UPDATE stock_receipts SET total = $2 WHERE id = $1`, [r!.id, total]);
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'stock.receipt',
        entity: 'stock_receipt',
        entityId: r!.id,
        data: { code: r!.code, supplier: b.supplier ?? null, lines: b.lines.length, total },
        ip: ctx.ip,
      });
      const costChange = snap
        ? await this.costs.after(
            tx,
            ctx,
            snap,
            'receipt',
            [`Recebimento ${r!.code}`, b.supplier].filter(Boolean).join(' · '),
          )
        : null;
      return { id: r!.id, code: r!.code, total, costChange };
    });
    this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    return res;
  }

  /**
   * Produção de preparos: baixa os insumos da ficha de preparo (proporcional ao rendimento),
   * dá entrada no preparo com o custo do que foi gasto e cria um lote com a validade.
   */
  async produce(ctx: Ctx, b: { note?: string | null; lines: ProductionLineInput[] }) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const ids = b.lines.map((l) => l.stockItemId);
      const needs = await q<{ idx: string; ingredient_id: string; need: string }>(
        tx,
        `SELECT l.idx::text, r.ingredient_id, round(r.quantity * l.q / s.recipe_yield, 3)::text AS need
           FROM unnest($1::uuid[], $2::numeric[]) WITH ORDINALITY AS l(item, q, idx)
           JOIN stock_items s ON s.id = l.item
           JOIN stock_item_recipes r ON r.stock_item_id = l.item
          ORDER BY l.idx, r.ingredient_id`,
        [ids, b.lines.map((l) => l.quantity)],
      );
      // O custo do preparo produzido muda: fotografa antes (trava preparos e ingredientes juntos).
      const snap = await this.costs.before(tx, ids, [...ids, ...needs.map((n) => n.ingredient_id)]);
      await this.lock(tx, [...ids, ...needs.map((n) => n.ingredient_id)]);
      // Saldo suficiente para tudo o que a produção vai gastar (somado entre as linhas).
      const short = await q<{ name: string }>(
        tx,
        `SELECT s.name FROM stock_items s
           JOIN (SELECT id, sum(n) AS n FROM unnest($1::uuid[], $2::numeric[]) AS x(id, n) GROUP BY id) t
             ON t.id = s.id
          WHERE NOT s.allow_negative AND s.quantity < t.n ORDER BY s.name`,
        [needs.map((n) => n.ingredient_id), needs.map((n) => n.need)],
      );
      if (short.length)
        throw new ConflictException(
          `Insumo insuficiente para a produção: ${short.map((s) => s.name).join(', ')}`,
        );
      const out: { id: string; code: string; stockItemId: string; totalCost: string | null }[] = [];
      for (const [i, l] of b.lines.entries()) {
        const mine = needs.filter((n) => Number(n.idx) === i + 1 && Number(n.need) > 0);
        const item = await one<{ name: string; shelf_life_days: number | null }>(
          tx,
          `SELECT name, shelf_life_days FROM stock_items WHERE id = $1`,
          [l.stockItemId],
        );
        const cost = mine.length
          ? await one<{ total: string }>(
              tx,
              `SELECT round(coalesce(sum(n.q * s.avg_cost), 0), 2)::text AS total
                 FROM unnest($1::uuid[], $2::numeric[]) AS n(id, q) JOIN stock_items s ON s.id = n.id`,
              [mine.map((n) => n.ingredient_id), mine.map((n) => n.need)],
            )
          : null;
        const p = await one<{ id: string; code: string }>(
          tx,
          `INSERT INTO stock_productions (tenant_id, stock_item_id, quantity, total_cost, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, code`,
          [
            ctx.tenantId,
            l.stockItemId,
            l.quantity,
            cost?.total ?? null,
            b.note ?? null,
            ctx.userId,
          ],
        );
        const note = `Produção ${p!.code} · ${item!.name}`;
        for (const n of mine) {
          await this.stock.move(tx, ctx, n.ingredient_id, 'production', `-${n.need}`, {
            note,
            productionId: p!.id,
          });
        }
        const lot = await one<{ id: string }>(
          tx,
          `INSERT INTO stock_lots (tenant_id, stock_item_id, code, quantity, expires_on, origin, production_id, created_by)
           VALUES ($1,$2,$3,$4,
                   CASE WHEN $5 THEN $6::date
                        WHEN $7::int IS NULL THEN NULL ELSE current_date + $7::int END,
                   'production',$8,$9) RETURNING id`,
          [
            ctx.tenantId,
            l.stockItemId,
            l.lotCode ?? null,
            l.quantity,
            l.expiresOn !== undefined,
            l.expiresOn ?? null,
            item!.shelf_life_days,
            p!.id,
            ctx.userId,
          ],
        );
        let unitCost: string | undefined;
        if (cost) {
          const u = await one<{ c: string }>(
            tx,
            `SELECT round($1::numeric / $2::numeric, 4)::text AS c`,
            [cost.total, l.quantity],
          );
          unitCost = u!.c;
          await this.stock.averageIn(tx, l.stockItemId, l.quantity, unitCost);
        }
        await this.stock.move(tx, ctx, l.stockItemId, 'production', l.quantity, {
          note,
          unitCost,
          productionId: p!.id,
          lotId: lot!.id,
        });
        out.push({
          id: p!.id,
          code: p!.code,
          stockItemId: l.stockItemId,
          totalCost: cost?.total ?? null,
        });
      }
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'stock.production',
        entity: 'stock_production',
        entityId: out[0]!.id,
        data: { lines: b.lines, codes: out.map((o) => o.code) },
        ip: ctx.ip,
      });
      await this.costs.after(
        tx,
        ctx,
        snap,
        'production',
        `Produção ${out.map((o) => o.code).join(', ')}`,
      );
      return out;
    });
    this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    return res;
  }

  /**
   * Fecha um lote: "usado" só tira da lista de validade; "descartado" também registra a perda
   * do que o lote tinha (limitado ao saldo do insumo, que nunca fica negativo por isso).
   */
  async closeLot(ctx: Ctx, id: string, b: { status: 'used' | 'discarded'; note?: string }) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const lot = await one<{
        stock_item_id: string;
        code: string;
        status: string;
        quantity: string;
      }>(
        tx,
        `SELECT stock_item_id, code, status, quantity::text FROM stock_lots WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!lot) throw new NotFoundException('Lote não encontrado');
      if (lot.status !== 'available') throw new ConflictException('Este lote já foi encerrado');
      if (b.status === 'discarded') {
        await this.lock(tx, [lot.stock_item_id]);
        const d = await one<{ q: string }>(
          tx,
          `SELECT least($2::numeric, greatest(quantity, 0))::text AS q FROM stock_items WHERE id = $1`,
          [lot.stock_item_id, lot.quantity],
        );
        if (Number(d!.q) > 0) {
          await this.stock.move(tx, ctx, lot.stock_item_id, 'loss', `-${d!.q}`, {
            note: `Lote ${lot.code} descartado${b.note ? `: ${b.note}` : ''}`,
            lotId: id,
          });
        }
      }
      await q(
        tx,
        `UPDATE stock_lots SET status = $2, closed_at = now(),
                note = CASE WHEN $3::text IS NULL THEN note ELSE $3 END
          WHERE id = $1`,
        [id, b.status, b.note ?? null],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: `stock.lot_${b.status}`,
        entity: 'stock_lot',
        entityId: id,
        data: { code: lot.code, note: b.note ?? null },
        ip: ctx.ip,
      });
      return { id, status: b.status };
    });
    this.realtime.publish(ctx.tenantId, { type: 'stock.changed' });
    return res;
  }
}
