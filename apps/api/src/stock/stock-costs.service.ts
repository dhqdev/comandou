import { Injectable } from '@nestjs/common';
import type { Ctx } from '../common/context';
import { q } from '../common/sql';
import type { Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

export type CostSource = 'purchase' | 'receipt' | 'production' | 'manual' | 'prep_recipe';

export interface CostItemChange {
  id: string;
  name: string;
  unit: string;
  oldCost: string;
  newCost: string;
}
export interface CostProductChange {
  kind: 'product' | 'option';
  id: string;
  name: string;
  price: string;
  oldCost: string;
  newCost: string;
}
export interface CostChange {
  id: string;
  source: CostSource;
  label: string | null;
  items: CostItemChange[];
  products: CostProductChange[];
  createdAt: Date;
}

/** Fotografia dos custos antes de uma mudança (o que pode ser afetado e quanto custava). */
export interface CostSnapshot {
  /** Os insumos que a operação mexeu (sem os preparos da cascata). */
  origin: string[];
  ids: string[];
  items: Map<string, { name: string; unit: string; cost: string }>;
  products: Map<string, Omit<CostProductChange, 'oldCost' | 'newCost'> & { cost: string }>;
}

/**
 * Insumos atingidos: os informados e, em cascata, todo preparo que leva algum deles (direto ou
 * por outro preparo). UNION (sem ALL) para parar mesmo se alguém montar ficha circular.
 */
const AFFECTED = `
  WITH RECURSIVE aff(id) AS (
    SELECT unnest($1::uuid[])
    UNION
    SELECT r.stock_item_id FROM stock_item_recipes r JOIN aff ON r.ingredient_id = aff.id)
  SELECT id FROM aff`;

/** Custo atual de cada item do cardápio e complemento que leva algum dos insumos. */
const MENU_COSTS = `
  SELECT 'product' AS kind, p.id, p.name, p.price::text AS price,
         round(sum(r.quantity * si.avg_cost), 4)::text AS cost
    FROM products p
    JOIN product_recipes r ON r.product_id = p.id
    JOIN stock_items si ON si.id = r.stock_item_id
   WHERE p.id IN (SELECT product_id FROM product_recipes WHERE stock_item_id = ANY($1::uuid[]))
   GROUP BY p.id
  UNION ALL
  SELECT 'option', o.id, o.name, o.price_delta::text,
         round(sum(r.quantity * si.avg_cost), 4)::text
    FROM options o
    JOIN option_recipes r ON r.option_id = o.id
    JOIN stock_items si ON si.id = r.stock_item_id
   WHERE o.id IN (SELECT option_id FROM option_recipes WHERE stock_item_id = ANY($1::uuid[]))
   GROUP BY o.id`;

/**
 * Custo automático das fichas. O gatilho do banco (migração 0076) recalcula os preparos quando
 * o custo de um insumo muda; aqui ficam a fotografia de antes e depois, o histórico com o
 * impacto no cardápio e o aviso para quem cuida dos preços.
 *
 * Uso: `const snap = await costs.before(tx, ids)` antes de mexer no custo (trava os insumos
 * atingidos em ordem de id, como o resto do estoque) e `await costs.after(tx, ctx, snap, …)`
 * depois, na mesma transação.
 */
@Injectable()
export class StockCostsService {
  constructor(private readonly realtime: RealtimeService) {}

  /**
   * `lockAlso`: outros insumos que a operação vai travar (as linhas sem preço do recebimento,
   * os ingredientes da produção), travados aqui junto e na mesma ordem de id.
   */
  async before(tx: Tx, itemIds: string[], lockAlso: string[] = []): Promise<CostSnapshot> {
    const unique = [...new Set(itemIds)];
    const aff = await q<{ id: string }>(tx, AFFECTED, [unique]);
    const ids = aff.map((a) => a.id).sort();
    await q(tx, `SELECT id FROM stock_items WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [
      [...new Set([...ids, ...lockAlso])],
    ]);
    const items = await q<{ id: string; name: string; unit: string; cost: string }>(
      tx,
      `SELECT id, name, unit, avg_cost::text AS cost FROM stock_items WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const menu = await q<{
      kind: 'product' | 'option';
      id: string;
      name: string;
      price: string;
      cost: string;
    }>(tx, MENU_COSTS, [ids]);
    return {
      origin: unique,
      ids,
      items: new Map(items.map((i) => [i.id, { name: i.name, unit: i.unit, cost: i.cost }])),
      products: new Map(menu.map((m) => [`${m.kind}:${m.id}`, m])),
    };
  }

  /** Compara com a fotografia e, se algo mudou, grava o histórico. Devolve a mudança (ou null). */
  async after(
    tx: Tx,
    ctx: Ctx,
    snap: CostSnapshot,
    source: CostSource,
    label: string | null,
  ): Promise<CostChange | null> {
    if (!snap.ids.length) return null;
    const now = await q<{ id: string; cost: string }>(
      tx,
      `SELECT id, avg_cost::text AS cost FROM stock_items WHERE id = ANY($1::uuid[]) ORDER BY name`,
      [snap.ids],
    );
    const items: CostItemChange[] = [];
    for (const n of now) {
      const old = snap.items.get(n.id);
      if (old && Number(old.cost) !== Number(n.cost))
        items.push({
          id: n.id,
          name: old.name,
          unit: old.unit,
          oldCost: old.cost,
          newCost: n.cost,
        });
    }
    if (!items.length) return null;
    const menu = await q<{
      kind: 'product' | 'option';
      id: string;
      name: string;
      price: string;
      cost: string;
    }>(tx, MENU_COSTS, [snap.ids]);
    const products: CostProductChange[] = [];
    for (const m of menu) {
      const old = snap.products.get(`${m.kind}:${m.id}`);
      if (!old || Number(old.cost) === Number(m.cost)) continue;
      products.push({
        kind: m.kind,
        id: m.id,
        name: m.name,
        price: m.price,
        oldCost: old.cost,
        newCost: m.cost,
      });
    }
    products.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const [row] = await q<{ id: string; createdAt: Date }>(
      tx,
      `INSERT INTO stock_cost_changes (tenant_id, source, label, items, products, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at AS "createdAt"`,
      [
        ctx.tenantId,
        source,
        label ? label.slice(0, 300) : null,
        JSON.stringify(items),
        JSON.stringify(products),
        ctx.userId,
      ],
    );
    await this.notify(
      tx,
      ctx,
      source,
      items.filter((i) => snap.origin.includes(i.id)),
      products,
    );
    return { id: row!.id, source, label, items, products, createdAt: row!.createdAt };
  }

  /**
   * Custo que subiu sem a pessoa pedir (recebimento, entrada, produção): avisa gerentes e
   * administradores, com os itens do cardápio cuja margem mais caiu. Mudança manual não avisa
   * (quem mudou já viu o impacto na tela).
   */
  private async notify(
    tx: Tx,
    ctx: Ctx,
    source: CostSource,
    items: CostItemChange[],
    products: CostProductChange[],
  ) {
    if (source === 'manual' || source === 'prep_recipe' || !products.length) return;
    const up = items.filter((i) => Number(i.newCost) > Number(i.oldCost));
    if (!up.length) return;
    const names = up.slice(0, 3).map((i) => i.name);
    const title =
      up.length === 1
        ? `O custo de ${names[0]} subiu: ${products.length} item(ns) do cardápio recalculado(s)`
        : `O custo de ${up.length} insumos subiu: ${products.length} item(ns) do cardápio recalculado(s)`;
    const worst = products
      .filter((p) => Number(p.price) > 0)
      .map((p) => ({ p, cmv: Number(p.newCost) / Number(p.price) }))
      .sort((a, b) => b.cmv - a.cmv)
      .slice(0, 3)
      .map(
        ({ p, cmv }) => `${p.name} (custo ${brl(p.newCost)}, ${Math.round(cmv * 100)}% do preço)`,
      );
    const body = worst.length
      ? `Maior peso do custo agora: ${worst.join('; ')}. Confira em Estoque › Custo e preço.`
      : 'Confira em Estoque › Custo e preço.';
    const users = await q<{ id: string }>(
      tx,
      `SELECT user_id AS id FROM memberships WHERE status = 'active' AND role IN ('owner','manager')`,
    );
    for (const u of users)
      await q(
        tx,
        `INSERT INTO chat_notices (tenant_id, user_id, kind, title, body, actor_id)
         VALUES ($1, $2, 'system', $3, $4, $5)`,
        [ctx.tenantId, u.id, title.slice(0, 120), body.slice(0, 300), ctx.userId],
      );
    if (users.length)
      this.realtime.publishToUsers(
        ctx.tenantId,
        users.map((u) => u.id),
        { type: 'chat.notice' },
      );
  }

  /** Últimas mudanças de custo (tela de precificação e o assistente). */
  recent(tx: Tx, limit = 20, itemId?: string) {
    return q<CostChange & { createdByName: string | null }>(
      tx,
      `SELECT c.id, c.source, c.label, c.items, c.products, c.created_at AS "createdAt",
              u.name AS "createdByName"
         FROM stock_cost_changes c LEFT JOIN users u ON u.id = c.created_by
        WHERE ($2::uuid IS NULL OR c.items @> jsonb_build_array(jsonb_build_object('id', $2::text)))
        ORDER BY c.created_at DESC LIMIT $1`,
      [limit, itemId ?? null],
    );
  }

  /**
   * Onde o insumo é usado: preparos que o levam (em cascata) e itens do cardápio/complementos,
   * com o custo atual da ficha e o preço de venda.
   */
  async usage(tx: Tx, itemId: string) {
    const aff = await q<{ id: string }>(tx, AFFECTED, [[itemId]]);
    const ids = aff.map((a) => a.id);
    const preps = await q<{ id: string; name: string; unit: string; cost: string }>(
      tx,
      `SELECT id, name, unit, avg_cost::text AS cost FROM stock_items
        WHERE id = ANY($1::uuid[]) AND id <> $2 ORDER BY name`,
      [ids, itemId],
    );
    const menu = await q<{
      kind: 'product' | 'option';
      id: string;
      name: string;
      price: string;
      cost: string;
    }>(tx, `${MENU_COSTS} ORDER BY name`, [ids]);
    return { preps, menu };
  }
}

function brl(v: string): string {
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
}
