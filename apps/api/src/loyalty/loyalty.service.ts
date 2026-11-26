import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { fromCents, orderPoints, toCents } from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';

export type LoyaltyMode = 'points' | 'stamps';

export interface LoyaltySettings {
  enabled: boolean;
  mode: LoyaltyMode;
  /** Modo pontos: pontos por R$ 1,00 (string decimal, ex.: "1.00"). */
  pointsPerReal: string;
  /** Modo carimbos: valor mínimo do pedido para ganhar o carimbo. */
  stampMinOrder: string;
  /** Dias sem comprar até os pontos vencerem. null = não vencem. */
  expiryDays: number | null;
  /** Pedidos do balcão com o celular de um cliente cadastrado também pontuam. */
  countStaffOrders: boolean;
  /** Pontos ganhos nos últimos N dias decidem o nível. null = desde sempre. */
  levelWindowDays: number | null;
  /** Indique um amigo: pontos para quem indicou (0 = desligado). */
  referralPoints: number;
  /** Indique um amigo: pontos para o amigo, no primeiro pedido concluído dele. */
  referralFriendPoints: number;
  /** O cardápio mostra "Ganhe N pts" em cada item. */
  showItemPoints: boolean;
}

export interface LevelInput {
  name: string;
  minPoints: number;
  perks: string | null;
  color: string | null;
}
export interface Level extends LevelInput {
  id: string;
}

export interface RewardInput {
  name: string;
  cost: number;
  kind: 'discount' | 'product';
  amount: string | null;
  productId: string | null;
  active: boolean;
  position: number;
}
export interface Reward extends RewardInput {
  id: string;
}

const DEFAULTS: LoyaltySettings = {
  enabled: false,
  mode: 'points',
  pointsPerReal: '1.00',
  stampMinOrder: '0.00',
  expiryDays: null,
  countStaffOrders: true,
  levelWindowDays: null,
  referralPoints: 0,
  referralFriendPoints: 0,
  showItemPoints: true,
};
const COLUMN: Record<keyof LoyaltySettings, string> = {
  enabled: 'enabled',
  mode: 'mode',
  pointsPerReal: 'points_per_real',
  stampMinOrder: 'stamp_min_order',
  expiryDays: 'expiry_days',
  countStaffOrders: 'count_staff_orders',
  levelWindowDays: 'level_window_days',
  referralPoints: 'referral_points',
  referralFriendPoints: 'referral_friend_points',
  showItemPoints: 'show_item_points',
};
const SETTINGS_COLS = `enabled, mode, points_per_real::text AS "pointsPerReal",
  stamp_min_order::text AS "stampMinOrder", expiry_days AS "expiryDays",
  count_staff_orders AS "countStaffOrders", level_window_days AS "levelWindowDays",
  referral_points AS "referralPoints", referral_friend_points AS "referralFriendPoints",
  show_item_points AS "showItemPoints"`;
const LEVEL_COLS = `id, name, min_points AS "minPoints", perks, color`;
const MAX_LEVELS = 8;
/** Letras do código de convite (sem 0/O e 1/I, que se confundem ao ditar). */
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const newCode = () =>
  Array.from({ length: 6 }, () => CODE_ABC[randomInt(0, CODE_ABC.length)]).join('');
const REWARD_COLS = `r.id, r.name, r.cost, r.kind, r.amount::text, r.product_id AS "productId",
  r.active, r.position`;
const ENTRY_COLS = `e.id, e.kind, e.points, e.discount::text, e.note, e.created_at AS "createdAt",
  o.number AS "orderNumber"`;
const MAX_REWARDS = 20;
const mediaUrl = (id: string | null) => (id ? `/api/v1/media/${id}` : null);

/** Só dígitos, sem o 55 (igual ao login do cliente). */
const digits = (raw: string) => {
  let d = raw.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d;
};

/**
 * Pontos que um pedido rende. Pontos: R$ gastos (sem a taxa de entrega, já com o desconto)
 * vezes os pontos por real, arredondado para baixo. Carimbos: 1 se passar do valor mínimo.
 */
export function pointsFor(
  s: Pick<LoyaltySettings, 'mode' | 'pointsPerReal' | 'stampMinOrder'>,
  spentCents: number,
) {
  if (spentCents <= 0) return 0;
  if (s.mode === 'stamps') return spentCents >= toCents(s.stampMinOrder) ? 1 : 0;
  return Math.floor((spentCents * toCents(s.pointsPerReal)) / 10_000);
}

/** Desconto escolhido no cardápio, ainda sem o pedido gravado. */
export interface RedeemQuote {
  rewardId: string;
  name: string;
  cost: number;
  discountCents: number;
}

/**
 * Programa de fidelidade do cardápio online: o cliente com conta acumula pontos (ou carimbos) a
 * cada pedido concluído e troca por desconto ou produto grátis no próximo pedido. O saldo é a
 * soma do extrato (loyalty_entries); cada pedido credita, resgata e devolve no máximo uma vez.
 */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async settingsIn(tx: Tx): Promise<LoyaltySettings> {
    const s = await one<LoyaltySettings>(tx, `SELECT ${SETTINGS_COLS} FROM loyalty_programs`);
    return s ?? { ...DEFAULTS };
  }

  private rewardsIn(tx: Tx, onlyActive = false) {
    return q<
      Reward & { productName: string | null; productPrice: string | null; imageId: string | null }
    >(
      tx,
      `SELECT ${REWARD_COLS}, p.name AS "productName", p.price::text AS "productPrice",
              p.image_id AS "imageId"
         FROM loyalty_rewards r LEFT JOIN products p ON p.id = r.product_id
        ${onlyActive ? `WHERE r.active AND (r.product_id IS NULL OR p.active)` : ''}
        ORDER BY r.position, r.cost, r.created_at`,
    );
  }

  /**
   * Vence os pontos de quem passou do prazo sem comprar (um lançamento "venceu" zera o saldo).
   * Sem cliente, varre o restaurante todo (relatório).
   */
  private async expireIn(tx: Tx, s: LoyaltySettings, customerId?: string) {
    if (!s.expiryDays) return;
    // Uma vez de cada vez no restaurante: dois vencimentos juntos (tela aberta duas vezes, pedido
    // concluído junto do relatório) liam o mesmo saldo e zeravam duas vezes, deixando negativo.
    // O INSERT abaixo é outro comando, então já enxerga o vencimento que o outro gravou.
    await q(
      tx,
      `SELECT pg_advisory_xact_lock(hashtext('loyalty_expire:' || current_setting('app.tenant_id', true)))`,
    );
    await q(
      tx,
      `INSERT INTO loyalty_entries (tenant_id, customer_id, kind, points, note)
       SELECT tenant_id, customer_id, 'expire', -sum(points)::int, 'Pontos vencidos'
         FROM loyalty_entries
        WHERE ($2::uuid IS NULL OR customer_id = $2)
        GROUP BY tenant_id, customer_id
       HAVING sum(points) > 0
          AND COALESCE(max(created_at) FILTER (WHERE kind = 'earn'), min(created_at))
              < now() - make_interval(days => $1)`,
      [s.expiryDays, customerId ?? null],
    );
  }

  /** Saldo e validade do cliente. Trava a linha do cliente quando `lock` (resgate). */
  async balanceIn(tx: Tx, s: LoyaltySettings, customerId: string, lock = false) {
    if (lock) await q(tx, `SELECT 1 FROM customers WHERE id = $1 FOR UPDATE`, [customerId]);
    await this.expireIn(tx, s, customerId);
    const r = await one<{ balance: number; lastEarn: Date | null }>(
      tx,
      `SELECT COALESCE(sum(points), 0)::int AS balance,
              max(created_at) FILTER (WHERE kind = 'earn') AS "lastEarn"
         FROM loyalty_entries WHERE customer_id = $1`,
      [customerId],
    );
    const balance = r?.balance ?? 0;
    const expiresAt =
      s.expiryDays && balance > 0 && r?.lastEarn
        ? new Date(r.lastEarn.getTime() + s.expiryDays * 86_400_000)
        : null;
    return { balance, expiresAt };
  }

  // ---------------------------------------------------------------- equipe (painel)

  async overview(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => ({
      settings: await this.settingsIn(tx),
      rewards: (await this.rewardsIn(tx)).map(({ imageId: _i, ...r }) => r),
    }));
  }

  async updateSettings(ctx: Ctx, patch: Partial<LoyaltySettings>) {
    return this.db.withTenant(ctx, async (tx) => {
      const next = { ...(await this.settingsIn(tx)), ...patch };
      const keys = Object.keys(COLUMN) as (keyof LoyaltySettings)[];
      const cols = keys.map((k) => COLUMN[k]);
      await q(
        tx,
        `INSERT INTO loyalty_programs (tenant_id, ${cols.join(', ')})
         VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
         ON CONFLICT (tenant_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
        [ctx.tenantId, ...keys.map((k) => next[k])],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'loyalty.settings_updated',
        entity: 'loyalty_program',
        entityId: ctx.tenantId,
        data: { changes: patch },
        ip: ctx.ip,
      });
      return this.settingsIn(tx);
    });
  }

  private async checkReward(tx: Tx, r: Partial<RewardInput>) {
    if (r.kind === 'discount' && !r.amount)
      throw new UnprocessableEntityException('Informe o valor do desconto');
    if (r.kind === 'product') {
      if (!r.productId) throw new UnprocessableEntityException('Escolha o produto grátis');
      const p = await one(tx, `SELECT 1 FROM products WHERE id = $1`, [r.productId]);
      if (!p) throw new UnprocessableEntityException('Produto não encontrado');
    }
  }

  async createReward(ctx: Ctx, b: Omit<RewardInput, 'active' | 'position'> & Partial<RewardInput>) {
    return this.db.withTenant(ctx, async (tx) => {
      const n = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM loyalty_rewards`);
      if ((n?.n ?? 0) >= MAX_REWARDS)
        throw new ConflictException(`Limite de ${MAX_REWARDS} recompensas`);
      await this.checkReward(tx, b);
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO loyalty_rewards (tenant_id, name, cost, kind, amount, product_id, active, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          ctx.tenantId,
          b.name,
          b.cost,
          b.kind,
          b.kind === 'discount' ? b.amount : null,
          b.kind === 'product' ? b.productId : null,
          b.active ?? true,
          b.position ?? n?.n ?? 0,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'loyalty.reward_created',
        entity: 'loyalty_reward',
        entityId: r!.id,
        data: { name: b.name, cost: b.cost, kind: b.kind },
        ip: ctx.ip,
      });
      return (await this.rewardsIn(tx)).find((x) => x.id === r!.id)!;
    });
  }

  async updateReward(ctx: Ctx, id: string, b: Partial<RewardInput>) {
    return this.db.withTenant(ctx, async (tx) => {
      const cur = (await this.rewardsIn(tx)).find((x) => x.id === id);
      if (!cur) throw new NotFoundException('Recompensa não encontrada');
      const next = { ...cur, ...b };
      await this.checkReward(tx, next);
      await q(
        tx,
        `UPDATE loyalty_rewards SET name = $2, cost = $3, kind = $4, amount = $5, product_id = $6,
                active = $7, position = $8 WHERE id = $1`,
        [
          id,
          next.name,
          next.cost,
          next.kind,
          next.kind === 'discount' ? next.amount : null,
          next.kind === 'product' ? next.productId : null,
          next.active,
          next.position,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'loyalty.reward_updated',
        entity: 'loyalty_reward',
        entityId: id,
        data: { changes: b },
        ip: ctx.ip,
      });
      return (await this.rewardsIn(tx)).find((x) => x.id === id)!;
    });
  }

  async deleteReward(ctx: Ctx, id: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(tx, `DELETE FROM loyalty_rewards WHERE id = $1 RETURNING id`, [id]);
      if (!r) throw new NotFoundException('Recompensa não encontrada');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'loyalty.reward_deleted',
        entity: 'loyalty_reward',
        entityId: id,
        ip: ctx.ip,
      });
    });
    return { ok: true };
  }

  /**
   * Relatório do período: quanto se ganhou e trocou, desconto concedido, vendas de quem participa
   * e os clientes com mais pontos.
   */
  async report(ctx: Ctx, days: number) {
    return this.db.withTenant(ctx, async (tx) => {
      const s = await this.settingsIn(tx);
      await this.expireIn(tx, s);
      const k = await one<{
        members: number;
        outstanding: number;
        earned: number;
        redeemed: number;
        redemptions: number;
        discount: string;
        expired: number;
      }>(
        tx,
        `WITH bal AS (SELECT customer_id, sum(points) AS b FROM loyalty_entries GROUP BY customer_id)
         SELECT (SELECT count(*) FROM bal WHERE b > 0)::int AS members,
                (SELECT COALESCE(sum(b), 0) FROM bal WHERE b > 0)::int AS outstanding,
                COALESCE(sum(points) FILTER (WHERE kind = 'earn'), 0)::int AS earned,
                COALESCE(-sum(points) FILTER (WHERE kind IN ('redeem','store')), 0)::int
                  - COALESCE(sum(points) FILTER (WHERE kind = 'refund'), 0)::int AS redeemed,
                (count(*) FILTER (WHERE kind IN ('redeem','store')) - count(*) FILTER (WHERE kind = 'refund'))::int AS redemptions,
                (COALESCE(sum(discount) FILTER (WHERE kind IN ('redeem','store')), 0)
                  - COALESCE((SELECT sum(r.discount) FROM loyalty_entries f
                                JOIN loyalty_entries r ON r.order_id = f.order_id AND r.kind = 'redeem'
                               WHERE f.kind = 'refund' AND f.created_at > now() - make_interval(days => $1)), 0))::text AS discount,
                COALESCE(-sum(points) FILTER (WHERE kind = 'expire'), 0)::int AS expired
           FROM loyalty_entries WHERE created_at > now() - make_interval(days => $1)`,
        [days],
      );
      // Vendas (pedidos concluídos) de quem tem conta, no período: o peso do programa no caixa.
      const sales = await one<{ orders: number; revenue: string; customers: number }>(
        tx,
        `SELECT count(*)::int AS orders, COALESCE(sum(total), 0)::text AS revenue,
                count(DISTINCT customer_id)::int AS customers
           FROM orders o
          WHERE o.status = 'completed' AND o.created_at > now() - make_interval(days => $1)
            AND EXISTS (SELECT 1 FROM loyalty_entries e WHERE e.order_id = o.id)`,
        [days],
      );
      const top = await q<{
        id: string;
        name: string;
        phone: string;
        balance: number;
        earned: number;
        redeemed: number;
        lastAt: Date;
      }>(
        tx,
        `SELECT c.id, c.name, c.phone, sum(e.points)::int AS balance,
                COALESCE(sum(e.points) FILTER (WHERE e.kind = 'earn'), 0)::int AS earned,
                COALESCE(-sum(e.points) FILTER (WHERE e.kind IN ('redeem','refund','store')), 0)::int AS redeemed,
                max(e.created_at) AS "lastAt"
           FROM loyalty_entries e JOIN customers c ON c.id = e.customer_id
          GROUP BY c.id ORDER BY sum(e.points) DESC, max(e.created_at) DESC LIMIT 30`,
      );
      return { days, settings: s, ...k!, ...sales!, top };
    });
  }

  /** Extrato de um cliente (aba Clientes / relatório). */
  async customer(ctx: Ctx, customerId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const c = await one(tx, `SELECT 1 FROM customers WHERE id = $1`, [customerId]);
      if (!c) throw new NotFoundException('Cliente não encontrado');
      const s = await this.settingsIn(tx);
      return {
        ...(await this.balanceIn(tx, s, customerId)),
        history: await this.historyIn(tx, customerId),
      };
    });
  }

  private historyIn(tx: Tx, customerId: string) {
    return q(
      tx,
      `SELECT ${ENTRY_COLS} FROM loyalty_entries e LEFT JOIN orders o ON o.id = e.order_id
        WHERE e.customer_id = $1 ORDER BY e.created_at DESC LIMIT 30`,
      [customerId],
    );
  }

  /** Ajuste manual (cortesia ou correção), com motivo. Não deixa o saldo negativo. */
  async adjust(ctx: Ctx, customerId: string, points: number, note: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const c = await one(tx, `SELECT 1 FROM customers WHERE id = $1`, [customerId]);
      if (!c) throw new NotFoundException('Cliente não encontrado');
      const s = await this.settingsIn(tx);
      const { balance } = await this.balanceIn(tx, s, customerId, true);
      if (balance + points < 0)
        throw new UnprocessableEntityException(`O cliente tem só ${balance} pontos`);
      await q(
        tx,
        `INSERT INTO loyalty_entries (tenant_id, customer_id, kind, points, note, created_by)
         VALUES ($1,$2,'adjust',$3,$4,$5)`,
        [ctx.tenantId, customerId, points, note, ctx.userId],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'loyalty.adjusted',
        entity: 'customer',
        entityId: customerId,
        data: { points, note },
        ip: ctx.ip,
      });
      return {
        ...(await this.balanceIn(tx, s, customerId)),
        history: await this.historyIn(tx, customerId),
      };
    });
  }

  // ---------------------------------------------------------------- níveis e pontos por item

  levelsIn(tx: Tx) {
    return q<Level>(tx, `SELECT ${LEVEL_COLS} FROM loyalty_levels ORDER BY min_points`);
  }

  levels(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) => this.levelsIn(tx));
  }

  /** Troca a lista inteira de níveis (a tela edita tudo junto e salva). */
  async saveLevels(ctx: Ctx, list: LevelInput[]) {
    if (list.length > MAX_LEVELS)
      throw new UnprocessableEntityException(`No máximo ${MAX_LEVELS} níveis`);
    const mins = new Set(list.map((l) => l.minPoints));
    if (mins.size !== list.length)
      throw new UnprocessableEntityException('Dois níveis não podem começar na mesma pontuação');
    return this.db.withTenant(ctx, async (tx) => {
      await q(tx, `DELETE FROM loyalty_levels`);
      for (const l of list)
        await q(
          tx,
          `INSERT INTO loyalty_levels (tenant_id, name, min_points, perks, color) VALUES ($1,$2,$3,$4,$5)`,
          [ctx.tenantId, l.name, l.minPoints, l.perks, l.color],
        );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'loyalty.levels_updated',
        entity: 'loyalty_program',
        entityId: ctx.tenantId,
        data: { levels: list.map((l) => `${l.name} (${l.minPoints})`) },
        ip: ctx.ip,
      });
      return this.levelsIn(tx);
    });
  }

  /** Itens com pontos fixos (os outros rendem pela regra do programa). */
  itemPoints(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) =>
      q<{ productId: string; points: number }>(
        tx,
        `SELECT id AS "productId", loyalty_points AS points FROM products
          WHERE loyalty_points IS NOT NULL ORDER BY name`,
      ),
    );
  }

  async setItemPoints(ctx: Ctx, items: { productId: string; points: number | null }[]) {
    return this.db.withTenant(ctx, async (tx) => {
      let changed = 0;
      for (const it of items) {
        const r = await one(
          tx,
          `UPDATE products SET loyalty_points = $2 WHERE id = $1
             AND loyalty_points IS DISTINCT FROM $2 RETURNING id`,
          [it.productId, it.points],
        );
        if (r) changed++;
      }
      if (changed)
        await this.audit.record(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: 'loyalty.item_points_updated',
          entity: 'loyalty_program',
          entityId: ctx.tenantId,
          data: { items: changed },
          ip: ctx.ip,
        });
      return q<{ productId: string; points: number }>(
        tx,
        `SELECT id AS "productId", loyalty_points AS points FROM products
          WHERE loyalty_points IS NOT NULL ORDER BY name`,
      );
    });
  }

  /** Pontos ganhos na janela dos níveis (só os créditos de pedido e os bônus). */
  private async earnedIn(tx: Tx, s: LoyaltySettings, customerId: string) {
    const r = await one<{ n: number }>(
      tx,
      `SELECT COALESCE(sum(points), 0)::int AS n FROM loyalty_entries
        WHERE customer_id = $1 AND kind IN ('earn','bonus')
          AND ($2::int IS NULL OR created_at > now() - make_interval(days => $2))`,
      [customerId, s.levelWindowDays],
    );
    return r?.n ?? 0;
  }

  // ---------------------------------------------------------------- PIN e convite

  /** PIN e código de convite do cliente (criados na primeira vez). */
  async memberIn(tx: Tx, tenantId: string, customerId: string) {
    const read = () =>
      one<{
        pin: string;
        referralCode: string;
        referredBy: string | null;
        referralPaidAt: Date | null;
      }>(
        tx,
        `SELECT pin, referral_code AS "referralCode", referred_by AS "referredBy",
                referral_paid_at AS "referralPaidAt"
           FROM loyalty_members WHERE customer_id = $1`,
        [customerId],
      );
    for (let i = 0; i < 12; i++) {
      const cur = await read();
      if (cur) return cur;
      // ON CONFLICT sem alvo: PIN ou código já usados por outro cliente não derrubam a
      // transação; só tenta de novo com outros.
      await q(
        tx,
        `INSERT INTO loyalty_members (tenant_id, customer_id, pin, referral_code)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [tenantId, customerId, newPin(), newCode()],
      );
    }
    throw new ConflictException('Não deu para gerar o PIN agora. Tente de novo.');
  }

  /** Amigos que o cliente indicou: quantos entraram e quantos já fizeram o primeiro pedido. */
  private async friendsIn(tx: Tx, customerId: string) {
    const r = await one<{ invited: number; paid: number }>(
      tx,
      `SELECT count(*)::int AS invited, count(referral_paid_at)::int AS paid
         FROM loyalty_members WHERE referred_by = $1`,
      [customerId],
    );
    return { invited: r?.invited ?? 0, paid: r?.paid ?? 0 };
  }

  /**
   * O cliente digita o código de quem o indicou. Vale uma vez e só antes do primeiro pedido
   * concluído; os pontos entram quando esse primeiro pedido for concluído.
   */
  async useReferral(tenantId: string, customerId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.settingsIn(tx);
      if (!s.enabled || (!s.referralPoints && !s.referralFriendPoints))
        throw new UnprocessableEntityException('A loja não está com o convite de amigos agora');
      const me = await this.memberIn(tx, tenantId, customerId);
      if (me.referredBy) throw new ConflictException('Você já usou um código de convite');
      if (me.referralCode === code)
        throw new UnprocessableEntityException('Esse é o seu próprio código');
      const friend = await one<{ id: string }>(
        tx,
        `SELECT customer_id AS id FROM loyalty_members WHERE referral_code = $1`,
        [code],
      );
      if (!friend) throw new UnprocessableEntityException('Código de convite não encontrado');
      const done = await one(
        tx,
        `SELECT 1 FROM orders WHERE customer_id = $1 AND status = 'completed' LIMIT 1`,
        [customerId],
      );
      if (done)
        throw new UnprocessableEntityException('O convite vale só antes do primeiro pedido');
      await q(
        tx,
        `UPDATE loyalty_members SET referred_by = $2 WHERE customer_id = $1 AND referred_by IS NULL`,
        [customerId, friend.id],
      );
      return { ok: true, friendPoints: s.referralFriendPoints };
    });
  }

  // ---------------------------------------------------------------- balcão (PIN)

  /**
   * A equipe digita o PIN que o cliente mostra no app: quem é, o saldo, o nível e o que dá para
   * trocar ou usar agora no balcão.
   */
  async byPin(ctx: Ctx, pin: string) {
    return this.db.withTenant(ctx, async (tx) => this.pinViewIn(tx, pin));
  }

  /** O mesmo do PIN, achado pelo cliente escolhido na Nova venda (e com o PIN junto). */
  async byCustomer(ctx: Ctx, customerId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const c = await one(tx, `SELECT 1 FROM customers WHERE id = $1 AND blocked_at IS NULL`, [
        customerId,
      ]);
      if (!c) throw new NotFoundException('Cliente não encontrado');
      const { pin } = await this.memberIn(tx, ctx.tenantId, customerId);
      return { pin, ...(await this.pinViewIn(tx, pin)) };
    });
  }

  private async pinViewIn(tx: Tx, pin: string) {
    const m = await one<{ customerId: string; name: string; phone: string }>(
      tx,
      `SELECT m.customer_id AS "customerId", c.name, c.phone
         FROM loyalty_members m JOIN customers c ON c.id = m.customer_id
        WHERE m.pin = $1 AND c.blocked_at IS NULL`,
      [pin],
    );
    if (!m) throw new NotFoundException('PIN não encontrado. Confira com o cliente.');
    const s = await this.settingsIn(tx);
    const { balance, expiresAt } = await this.balanceIn(tx, s, m.customerId);
    const levels = await this.levelsIn(tx);
    const earned = await this.earnedIn(tx, s, m.customerId);
    const rewards = (await this.rewardsIn(tx, true)).map(
      ({ imageId: _i, active: _a, position: _p, ...r }) => r,
    );
    return {
      customer: {
        id: m.customerId,
        name: m.name,
        // Só o fim do telefone: a equipe confere com o cliente sem expor o número todo.
        phoneEnd: m.phone.slice(-4),
      },
      enabled: s.enabled,
      mode: s.mode,
      balance,
      expiresAt,
      earned,
      levels,
      rewards,
      history: await this.historyIn(tx, m.customerId),
    };
  }

  /** Troca uma recompensa no balcão pelo PIN do cliente (a equipe dá o desconto no caixa). */
  async redeemAtStore(ctx: Ctx, pin: string, rewardId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const view = await this.pinViewIn(tx, pin);
      const s = await this.settingsIn(tx);
      if (!s.enabled)
        throw new UnprocessableEntityException('O programa de fidelidade está pausado');
      const r = (await this.rewardsIn(tx, true)).find((x) => x.id === rewardId);
      if (!r) throw new UnprocessableEntityException('Essa recompensa não está mais disponível');
      const { balance } = await this.balanceIn(tx, s, view.customer.id, true);
      if (balance < r.cost)
        throw new UnprocessableEntityException(
          `O cliente tem ${balance} ${s.mode === 'stamps' ? 'carimbos' : 'pontos'}; essa recompensa pede ${r.cost}`,
        );
      await q(
        tx,
        `INSERT INTO loyalty_entries (tenant_id, customer_id, kind, points, reward_id, discount, note, created_by)
         VALUES ($1,$2,'store',$3,$4,$5,$6,$7)`,
        [
          ctx.tenantId,
          view.customer.id,
          -r.cost,
          r.id,
          r.kind === 'discount' ? r.amount : (r.productPrice ?? null),
          r.name.slice(0, 120),
          ctx.userId,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'loyalty.redeemed_at_store',
        entity: 'customer',
        entityId: view.customer.id,
        data: { reward: r.name, cost: r.cost },
        ip: ctx.ip,
      });
      return this.pinViewIn(tx, pin);
    });
  }

  // ---------------------------------------------------------------- cliente (cardápio)

  /** O que o cardápio mostra: regra, recompensas e, com a conta aberta, saldo e extrato. */
  async publicView(tenantId: string, customerId: string | null) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.settingsIn(tx);
      if (!s.enabled) return { enabled: false as const };
      const list = await this.rewardsIn(tx, true);
      // Produto grátis: o preço do cardápio de entrega (o mesmo que sai de desconto no pedido).
      const ids = list.map((r) => r.productId).filter((id): id is string => !!id);
      const menuPrice = new Map(
        (ids.length
          ? await q<{ id: string; price: string }>(
              tx,
              `SELECT p.id, COALESCE(mi.price, p.price)::text AS price FROM products p
                 LEFT JOIN menus m ON m.active AND m.kind = 'delivery'
                 LEFT JOIN menu_items mi ON mi.menu_id = m.id AND mi.product_id = p.id
                WHERE p.id = ANY($1::uuid[])`,
              [ids],
            )
          : []
        ).map((p) => [p.id, p.price]),
      );
      const rewards = list.map(({ active: _a, position: _p, productPrice, imageId, ...r }) => ({
        ...r,
        // Quanto ele vale hoje (sem adicionais).
        amount:
          r.kind === 'product' ? (menuPrice.get(r.productId ?? '') ?? productPrice) : r.amount,
        imageUrl: mediaUrl(imageId),
      }));
      const member = customerId ? await this.memberIn(tx, tenantId, customerId) : null;
      const account =
        customerId && member
          ? {
              ...(await this.balanceIn(tx, s, customerId)),
              history: await this.historyIn(tx, customerId),
              // Pontos dos pedidos em andamento (entram quando o pedido for concluído).
              pending: await this.pendingIn(tx, s, customerId),
              // Pontos ganhos na janela dos níveis (decide o nível).
              earned: await this.earnedIn(tx, s, customerId),
              // PIN para usar os pontos e os cupons no balcão da loja.
              pin: member.pin,
              referralCode: member.referralCode,
              referred: !!member.referredBy,
              friends: await this.friendsIn(tx, customerId),
            }
          : null;
      const referralOn = s.referralPoints > 0 || s.referralFriendPoints > 0;
      return {
        enabled: true as const,
        mode: s.mode,
        pointsPerReal: s.pointsPerReal,
        stampMinOrder: s.stampMinOrder,
        expiryDays: s.expiryDays,
        levelWindowDays: s.levelWindowDays,
        showItemPoints: s.showItemPoints,
        levels: await this.levelsIn(tx),
        referral: referralOn
          ? { points: s.referralPoints, friendPoints: s.referralFriendPoints }
          : null,
        rewards,
        account,
      };
    });
  }

  private async pendingIn(tx: Tx, s: LoyaltySettings, customerId: string) {
    const open = await q<{ spent: string }>(
      tx,
      `SELECT (subtotal - discount)::text AS spent FROM orders
        WHERE customer_id = $1 AND status NOT IN ('completed','cancelled')
          AND created_at > now() - interval '2 days'`,
      [customerId],
    );
    return open.reduce((n, o) => n + pointsFor(s, toCents(o.spent)), 0);
  }

  /**
   * Resgate no pedido do cardápio (dentro da transação que cria o pedido): confere saldo e
   * recompensa e devolve o desconto. `lines` são os itens já com o preço oficial do banco.
   */
  async quoteRedeemIn(
    tx: Tx,
    customerId: string,
    rewardId: string,
    lines: { productId: string; unitBaseCents: number; lineBaseCents: number }[],
    subtotalCents: number,
  ): Promise<RedeemQuote> {
    const s = await this.settingsIn(tx);
    if (!s.enabled) throw new UnprocessableEntityException('O programa de fidelidade está pausado');
    const r = (await this.rewardsIn(tx, true)).find((x) => x.id === rewardId);
    if (!r) throw new UnprocessableEntityException('Essa recompensa não está mais disponível');
    const { balance } = await this.balanceIn(tx, s, customerId, true);
    if (balance < r.cost)
      throw new UnprocessableEntityException(
        `Faltam ${r.cost - balance} ${s.mode === 'stamps' ? 'carimbos' : 'pontos'} para essa recompensa`,
      );
    let discountCents: number;
    if (r.kind === 'product') {
      const mine = lines.filter((l) => l.productId === r.productId);
      if (!mine.length)
        throw new UnprocessableEntityException(
          `Coloque ${r.productName ?? 'o produto'} na sacola para usar essa recompensa`,
        );
      // Uma unidade grátis; no item por peso, o que o cliente leva (o quilo pode valer mais).
      discountCents = Math.max(...mine.map((l) => Math.min(l.unitBaseCents, l.lineBaseCents)));
    } else discountCents = toCents(r.amount!);
    // O desconto nunca passa do valor dos itens (a taxa de entrega continua sendo cobrada).
    discountCents = Math.min(discountCents, subtotalCents);
    return { rewardId: r.id, name: r.name, cost: r.cost, discountCents };
  }

  async recordRedeemIn(
    tx: Tx,
    tenantId: string,
    customerId: string,
    orderId: string,
    r: RedeemQuote,
  ) {
    await q(
      tx,
      `INSERT INTO loyalty_entries (tenant_id, customer_id, kind, points, order_id, reward_id, discount, note)
       VALUES ($1,$2,'redeem',$3,$4,$5,$6,$7)`,
      [
        tenantId,
        customerId,
        -r.cost,
        orderId,
        r.rewardId,
        fromCents(r.discountCents),
        r.name.slice(0, 120),
      ],
    );
  }

  /**
   * Pedido concluído: credita os pontos do cliente (conta do cardápio ou, se a loja quiser, o
   * celular informado no balcão). Uma vez por pedido.
   */
  async earnForOrderIn(tx: Tx, tenantId: string, orderId: string) {
    const s = await this.settingsIn(tx);
    if (!s.enabled) return;
    const o = await one<{
      customerId: string | null;
      phone: string | null;
      spent: string;
      source: string;
    }>(
      tx,
      `SELECT customer_id AS "customerId", customer_phone AS phone, (subtotal - discount)::text AS spent,
              source FROM orders WHERE id = $1`,
      [orderId],
    );
    // Pedido de aplicativo de delivery não pontua: a compra foi no aplicativo, não na loja.
    if (!o || o.source === 'app') return;
    // Pedido da equipe só pontua se a loja contar os pedidos do balcão (mesmo com o cliente
    // escolhido no PDV).
    let customerId = o.source === 'online' || s.countStaffOrders ? o.customerId : null;
    if (!customerId && s.countStaffOrders && o.source !== 'online' && o.phone) {
      const d = digits(o.phone);
      if (/^[0-9]{10,11}$/.test(d))
        customerId =
          (
            await one<{ id: string }>(
              tx,
              `SELECT id FROM customers WHERE phone = $1 AND blocked_at IS NULL`,
              [d],
            )
          )?.id ?? null;
    }
    if (!customerId) return;
    // Itens com pontos fixos rendem o número deles; o resto, pela regra (customer-app.ts).
    const lines = await q<{ total: string; quantity: string; unit: string; fixed: number | null }>(
      tx,
      `SELECT i.total::text, i.quantity::text, i.unit, p.loyalty_points AS fixed
         FROM order_items i LEFT JOIN products p ON p.id = i.product_id
        WHERE i.order_id = $1 AND i.status <> 'cancelled'`,
      [orderId],
    );
    const points = orderPoints(
      s,
      toCents(o.spent),
      lines.map((l) => ({
        totalCents: toCents(l.total),
        quantity: Number(l.quantity),
        fixed: l.fixed,
        weight: l.unit === 'kg',
      })),
    );
    // Pontos que já tinham vencido não voltam com a compra nova.
    await this.expireIn(tx, s, customerId);
    if (points > 0) {
      const earned = await one(
        tx,
        `INSERT INTO loyalty_entries (tenant_id, customer_id, kind, points, order_id)
         VALUES ($1,$2,'earn',$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
        [tenantId, customerId, points, orderId],
      );
      if (!earned) return;
    }
    await this.payReferralIn(tx, tenantId, s, customerId);
  }

  /**
   * Indique um amigo: no primeiro pedido concluído de quem foi indicado, os dois ganham os pontos
   * do convite (uma vez só, marcado em referral_paid_at).
   */
  private async payReferralIn(tx: Tx, tenantId: string, s: LoyaltySettings, customerId: string) {
    if (!s.referralPoints && !s.referralFriendPoints) return;
    const m = await one<{ referredBy: string }>(
      tx,
      `SELECT referred_by AS "referredBy" FROM loyalty_members
        WHERE customer_id = $1 AND referred_by IS NOT NULL AND referral_paid_at IS NULL
        FOR UPDATE`,
      [customerId],
    );
    if (!m) return;
    await q(tx, `UPDATE loyalty_members SET referral_paid_at = now() WHERE customer_id = $1`, [
      customerId,
    ]);
    if (s.referralFriendPoints > 0)
      await q(
        tx,
        `INSERT INTO loyalty_entries (tenant_id, customer_id, kind, points, note)
         VALUES ($1,$2,'bonus',$3,'Bônus do convite de um amigo')`,
        [tenantId, customerId, s.referralFriendPoints],
      );
    if (s.referralPoints > 0)
      await q(
        tx,
        `INSERT INTO loyalty_entries (tenant_id, customer_id, kind, points, note)
         VALUES ($1,$2,'bonus',$3,'Amigo indicado fez o primeiro pedido')`,
        [tenantId, m.referredBy, s.referralPoints],
      );
  }

  /** Pedido cancelado: devolve os pontos trocados nele (uma vez). */
  async refundForOrderIn(tx: Tx, tenantId: string, orderId: string) {
    await q(
      tx,
      `INSERT INTO loyalty_entries (tenant_id, customer_id, kind, points, order_id, reward_id, note)
       SELECT $1, customer_id, 'refund', -points, order_id, reward_id, 'Pedido cancelado'
         FROM loyalty_entries WHERE order_id = $2 AND kind = 'redeem'
       ON CONFLICT DO NOTHING`,
      [tenantId, orderId],
    );
  }
}
