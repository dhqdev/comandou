import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DRIVER_ACTIVE,
  COURIER_SCORE_DAYS,
  courierScore,
  deliveryPay,
  fromCents,
  PaymentMethod,
  roleHas,
  routeDistanceM,
  toCents,
} from '@comandou/shared';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { open as openSecret, seal } from '../common/secret-box';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { assertNoPixPending, CashService } from '../cash/cash.service';
import { withIdempotency } from '../common/idempotency';
import { OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';
import { courierRule, rideEstimates } from './courier-pay.service';

/** Validade do link de rastreio enquanto o pedido está na rua. */
export const TRACKING_TTL_HOURS = 4;

/** Erros de código aceitos antes de travar a entrega (aí só o restaurante conclui). */
export const CONFIRM_MAX_ATTEMPTS = 5;

/** Código de entrega de 4 dígitos (como o do iFood): o cliente informa ao entregador. */
export const newConfirmCode = () => String(randomInt(0, 10_000)).padStart(4, '0');

const trackingHash = (token: string) => createHash('sha256').update(token).digest();
/** Contexto da cópia cifrada do link: não decifra em outro restaurante nem em outro entregador. */
const linkContext = (tenantId: string, courierId: string) =>
  `courier-link:${tenantId}:${courierId}`;

/** Posição enviada pelo celular do entregador. Velocidade em m/s, rumo em graus, precisão em m. */
export interface CourierFix {
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
}

/** Pontos com precisão pior que isso atualizam a posição, mas não entram no trajeto. */
const TRAIL_MAX_ACCURACY_M = 150;
/** Quantos pontos do trajeto vão para o mapa (os mais recentes). */
const TRAIL_LIMIT = 400;

type Point = [number, number];

/** Trajeto de uma ou mais corridas, do mais antigo para o mais novo. */
async function trailsOf(tx: Tx, ids: string[]): Promise<Record<string, Point[]>> {
  if (!ids.length) return {};
  const rows = await q<{ delivery_id: string; lat: string; lng: string }>(
    tx,
    `SELECT delivery_id, lat::text, lng::text FROM (
       SELECT delivery_id, lat, lng, recorded_at,
              row_number() OVER (PARTITION BY delivery_id ORDER BY recorded_at DESC) AS n
         FROM delivery_positions WHERE delivery_id = ANY($1::uuid[])) x
      WHERE n <= $2 ORDER BY recorded_at`,
    [ids, TRAIL_LIMIT],
  );
  const out: Record<string, Point[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (const r of rows) out[r.delivery_id]!.push([Number(r.lat), Number(r.lng)]);
  return out;
}

/** Ponto da loja no mapa (cadastrado em Entregas → Área de entrega). */
export async function storePoint(tx: Tx): Promise<{ lat: number; lng: number } | null> {
  const s = await one<{ lat: string | null; lng: string | null }>(
    tx,
    `SELECT store_lat::text AS lat, store_lng::text AS lng FROM tenant_store_settings`,
  );
  return s?.lat && s.lng ? { lat: Number(s.lat), lng: Number(s.lng) } : null;
}

/** Trajeto e loja para o mapa do cliente (pedido ou link de rastreio). */
export async function customerMapOf(tx: Tx, deliveryId: string) {
  const store = await storePoint(tx);
  const trails = await trailsOf(tx, [deliveryId]);
  return { store, trail: trails[deliveryId] ?? [] };
}

/** Corridas na rua levam a estimativa do ganho do entregador (o encerrado já tem o valor gravado). */
async function withEstimates<T extends { id: string; courierId: string; status: string }>(
  tx: Tx,
  rows: T[],
) {
  const est = await rideEstimates(tx, rows);
  return rows.map((r) => ({ ...r, payEstimate: est[r.id] ?? null }));
}

export const DELIVERY_SELECT = `
  SELECT d.id, d.status, d.order_id AS "orderId", o.number AS "orderNumber", o.status AS "orderStatus",
         o.customer_name AS "customerName", o.customer_phone AS "customerPhone",
         o.delivery_address AS "deliveryAddress", o.total::text, (o.total - o.paid_amount)::text AS balance,
         o.payment_status AS "paymentStatus", o.payment_hint AS "paymentHint", o.change_for::text AS "changeFor",
         o.delivery_lat::text AS "deliveryLat", o.delivery_lng::text AS "deliveryLng", o.notes,
         d.courier_id AS "courierId", c.name AS "courierName",
         d.dispatched_at AS "dispatchedAt", d.finished_at AS "finishedAt", d.failure_reason AS "failureReason",
         d.last_lat::text AS "lastLat", d.last_lng::text AS "lastLng", d.last_location_at AS "lastLocationAt",
         d.last_heading AS "lastHeading", d.last_speed::float AS "lastSpeed", d.last_accuracy AS "lastAccuracy",
         d.tracking_expires_at AS "trackingExpiresAt",
         d.courier_pay::text AS "courierPay", d.distance_m AS "distanceM",
         d.collect_status AS "collectStatus", d.collect_amount::text AS "collectAmount",
         d.collect_method AS "collectMethod", d.settled_at AS "settledAt"
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN couriers c ON c.id = d.courier_id`;

/**
 * Entregas. O status do pedido continua sendo a fonte da verdade da operação
 * (pronto → saiu para entrega → concluído); a entrega registra quem levou, quando,
 * a última localização informada e o link público de rastreio (só o hash fica no banco).
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
    private readonly cash: CashService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private newToken() {
    const token = randomBytes(24).toString('base64url');
    return { token, hash: trackingHash(token) };
  }

  private canManage(ctx: Ctx) {
    return roleHas(ctx.user.role, 'delivery:manage');
  }

  list(ctx: Ctx, scope: 'active' | 'today') {
    return this.db.withTenant(ctx, async (tx) => {
      const mine = !this.canManage(ctx);
      // Entregador com login abriu o app: situação "disponível" em Entregas (no máximo a cada 30 s).
      if (mine && ctx.userId)
        await q(
          tx,
          `UPDATE couriers SET app_seen_at = now()
            WHERE user_id = $1 AND (app_seen_at IS NULL OR app_seen_at < now() - interval '30 seconds')`,
          [ctx.userId],
        );
      const rows = await q<{ id: string; courierId: string; status: string }>(
        tx,
        `${DELIVERY_SELECT} CROSS JOIN tenants tz
          WHERE ($1 = 'active' AND d.status = 'out'
                 OR $1 = 'today' AND (d.dispatched_at AT TIME ZONE tz.timezone)::date = (now() AT TIME ZONE tz.timezone)::date)
            AND (NOT $2 OR c.user_id = $3)
          ORDER BY d.dispatched_at DESC LIMIT 200`,
        [scope, mine, ctx.userId],
      );
      return withEstimates(tx, rows);
    });
  }

  /**
   * Despacha um pedido de delivery pronto com um entregador. Devolve o link de rastreio (uma vez).
   * `self`: foi o próprio entregador que pegou a corrida pelo app (aba Disponíveis).
   */
  async dispatch(ctx: Ctx, orderId: string, courierId: string, self = false) {
    const token = this.newToken();
    const res = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.orders.lock(tx, orderId);
      if (o.channel !== 'delivery')
        throw new ConflictException('Só pedidos de delivery saem para entrega');
      // Pedido de aplicativo que o entregador do aplicativo leva: o motoboy da loja não sai com ele.
      const app = await one<{ delivered_by: string | null; driver: string | null }>(
        tx,
        `SELECT o.delivered_by, c.driver_status AS driver
           FROM orders o LEFT JOIN channel_orders c ON c.order_id = o.id WHERE o.id = $1`,
        [orderId],
      );
      if (app?.delivered_by === 'channel')
        throw new ConflictException('Quem entrega este pedido é o entregador do aplicativo');
      if (app?.driver && (DRIVER_ACTIVE as readonly string[]).includes(app.driver))
        throw new ConflictException(
          'Um entregador do aplicativo foi chamado para este pedido. Cancele o chamado antes de mandar o seu.',
        );
      if (o.status !== 'ready')
        throw new ConflictException(
          self
            ? 'Este pedido não está mais disponível: outro entregador pegou ou ele saiu da fila.'
            : 'O pedido precisa estar pronto para sair',
        );
      const c = await one<{ active: boolean }>(tx, `SELECT active FROM couriers WHERE id = $1`, [
        courierId,
      ]);
      if (!c) throw new NotFoundException('Entregador não encontrado');
      if (!c.active) throw new ConflictException('Entregador inativo');
      // A corrida (com o código de entrega) nasce antes da mudança de status: o aviso de
      // "saiu para entrega" no WhatsApp, gravado na transição, já leva o código.
      const d = await one<{ id: string }>(
        tx,
        `INSERT INTO deliveries (tenant_id, order_id, courier_id, tracking_hash, tracking_expires_at, created_by, confirm_code)
         VALUES ($1,$2,$3,$4, now() + make_interval(hours => $5), $6, $7) RETURNING id`,
        [
          ctx.tenantId,
          orderId,
          courierId,
          token.hash,
          TRACKING_TTL_HOURS,
          ctx.userId,
          newConfirmCode(),
        ],
      );
      await this.orders.transitionInTx(tx, ctx, o, 'dispatched');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: self ? 'delivery.claimed' : 'delivery.dispatched',
        entity: 'delivery',
        entityId: d!.id,
        data: { orderId, courierId },
        ip: ctx.ip,
      });
      return one<{ id: string }>(tx, `${DELIVERY_SELECT} WHERE d.id = $1`, [d!.id]);
    });
    this.publish(ctx, res!.id, orderId);
    this.orders.notifyDispatched(ctx, orderId);
    return { delivery: res, trackingPath: `/rastreio/${token.token}` };
  }

  // ------------------------------------------------- app do entregador: pegar corrida e perfil
  /** Entregador de quem está usando o app: o do link ou o ligado ao login. */
  private async courierIdOf(tx: Tx, ctx: Ctx, viaLink?: string) {
    if (viaLink) return viaLink;
    const c = await one<{ id: string; active: boolean }>(
      tx,
      `SELECT id, active FROM couriers WHERE user_id = $1`,
      [ctx.userId],
    );
    if (!c)
      throw new ForbiddenException(
        'Seu login ainda não está ligado a um entregador. Peça ao restaurante.',
      );
    if (!c.active) throw new ForbiddenException('Entregador desativado. Fale com o restaurante.');
    return c.id;
  }

  /**
   * Pedidos de delivery prontos e ainda sem entregador: o que o motoboy pode pegar sozinho.
   * Mostra o destino, a distância da loja, quanto cobrar e quanto ele ganha pela regra dele.
   * Telefone do cliente só aparece depois de pegar a corrida.
   */
  available(ctx: Ctx, viaLink?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const courierId = await this.courierIdOf(tx, ctx, viaLink);
      const rows = await q<{
        orderId: string;
        fee: string;
        deliveryLat: string | null;
        deliveryLng: string | null;
      }>(
        tx,
        `SELECT o.id AS "orderId", o.number AS "orderNumber", o.customer_name AS "customerName",
                o.delivery_address AS "deliveryAddress", o.delivery_lat::text AS "deliveryLat",
                o.delivery_lng::text AS "deliveryLng", o.total::text,
                (o.total - o.paid_amount)::text AS balance, o.payment_hint AS "paymentHint",
                o.delivery_fee::text AS fee,
                (SELECT max(h.created_at) FROM order_status_history h
                  WHERE h.order_id = o.id AND h.to_status = 'ready') AS "readyAt",
                (SELECT count(*)::int FROM order_items i
                  WHERE i.order_id = o.id AND i.status <> 'cancelled') AS items
           FROM orders o
          WHERE o.channel = 'delivery' AND o.status = 'ready'
            AND o.delivered_by IS DISTINCT FROM 'channel'
            AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.status = 'out')
            AND NOT EXISTS (SELECT 1 FROM channel_orders c WHERE c.order_id = o.id
                             AND c.driver_status = ANY($1::text[]))
          ORDER BY "readyAt" NULLS LAST, o.number LIMIT 50`,
        [DRIVER_ACTIVE],
      );
      if (!rows.length) return [];
      const store = await storePoint(tx);
      const rule = await courierRule(tx, courierId);
      return rows.map(({ fee, ...r }) => {
        const distanceM = routeDistanceM(
          store,
          r.deliveryLat && r.deliveryLng
            ? { lat: Number(r.deliveryLat), lng: Number(r.deliveryLng) }
            : null,
        );
        return {
          ...r,
          distanceM,
          payEstimate: deliveryPay(rule, { fee, distanceM, status: 'delivered' }).amount,
        };
      });
    });
  }

  /** O entregador pega sozinho um pedido pronto. Dois ao mesmo tempo: só o primeiro leva. */
  async claim(ctx: Ctx, orderId: string, viaLink?: string) {
    const courierId = await this.db.withTenant(ctx, (tx) => this.courierIdOf(tx, ctx, viaLink));
    const { delivery } = await this.dispatch(ctx, orderId, courierId, true);
    return delivery;
  }

  /** Corridas encerradas do entregador, da mais nova para a mais antiga, em páginas de 30. */
  history(ctx: Ctx, before: Date | null, viaLink?: string) {
    const PAGE = 30;
    return this.db.withTenant(ctx, async (tx) => {
      const courierId = await this.courierIdOf(tx, ctx, viaLink);
      const rows = await q<{ finishedAt: Date | null; dispatchedAt: Date }>(
        tx,
        `${DELIVERY_SELECT}
          WHERE d.courier_id = $1 AND d.status <> 'out'
            AND ($2::timestamptz IS NULL OR COALESCE(d.finished_at, d.dispatched_at) < $2)
          ORDER BY COALESCE(d.finished_at, d.dispatched_at) DESC LIMIT $3`,
        [courierId, before, PAGE + 1],
      );
      const items = rows.slice(0, PAGE);
      const last = items[items.length - 1];
      return {
        items,
        next: rows.length > PAGE && last ? (last.finishedAt ?? last.dispatchedAt) : null,
      };
    });
  }

  /**
   * Perfil do entregador: desde quando entrega, os números de sempre e o score dos últimos 90
   * dias (concluir a entrega e chegar no prazo; a conta fica em @comandou/shared).
   */
  profile(ctx: Ctx, viaLink?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const courierId = await this.courierIdOf(tx, ctx, viaLink);
      // No prazo: do despacho à entrega em até 10 min + 5 min por km (piso de 20), como em
      // rideTargetMinutes.
      const r = await one<{
        name: string;
        phone: string | null;
        since: Date;
        delivered: number;
        failed: number;
        delivered_recent: number;
        failed_recent: number;
        on_time_recent: number;
        avg_minutes: number | null;
        km: number;
        today: number;
      }>(
        tx,
        `SELECT c.name, c.phone, c.created_at AS since,
                count(d.id) FILTER (WHERE d.status = 'delivered')::int AS delivered,
                count(d.id) FILTER (WHERE d.status = 'failed')::int AS failed,
                count(d.id) FILTER (WHERE d.status = 'delivered' AND d.finished_at >= now() - make_interval(days => $2))::int AS delivered_recent,
                count(d.id) FILTER (WHERE d.status = 'failed' AND d.finished_at >= now() - make_interval(days => $2))::int AS failed_recent,
                count(d.id) FILTER (
                  WHERE d.status = 'delivered' AND d.finished_at >= now() - make_interval(days => $2)
                    AND EXTRACT(EPOCH FROM (d.finished_at - d.dispatched_at)) / 60
                        <= GREATEST(20, round(10 + 5 * COALESCE(d.distance_m, 0) / 1000.0)))::int AS on_time_recent,
                round(avg(EXTRACT(EPOCH FROM (d.finished_at - d.dispatched_at)) / 60)
                  FILTER (WHERE d.status = 'delivered' AND d.finished_at >= now() - make_interval(days => $2)))::int AS avg_minutes,
                COALESCE(sum(d.distance_m) FILTER (WHERE d.status = 'delivered'), 0)::float / 1000 AS km,
                count(d.id) FILTER (
                  WHERE d.status = 'delivered'
                    AND (d.finished_at AT TIME ZONE tz.timezone)::date = (now() AT TIME ZONE tz.timezone)::date)::int AS today
           FROM couriers c
           CROSS JOIN tenants tz
           LEFT JOIN deliveries d ON d.courier_id = c.id AND d.status <> 'out'
          WHERE c.id = $1
          GROUP BY c.id`,
        [courierId, COURIER_SCORE_DAYS],
      );
      if (!r) throw new NotFoundException('Entregador não encontrado');
      return {
        name: r.name,
        phone: r.phone,
        since: r.since,
        delivered: r.delivered,
        failed: r.failed,
        today: r.today,
        km: Math.round(r.km * 10) / 10,
        avgMinutes: r.avg_minutes,
        recent: {
          days: COURIER_SCORE_DAYS,
          delivered: r.delivered_recent,
          failed: r.failed_recent,
        },
        ...courierScore({
          delivered: r.delivered_recent,
          failed: r.failed_recent,
          onTime: r.on_time_recent,
        }),
      };
    });
  }

  /** Trava pedido → entrega (mesma ordem do resto do sistema) e confere quem pode mexer. */
  private async lockOut(tx: Tx, ctx: Ctx, id: string, viaLink?: string) {
    const cur = await one<{ order_id: string }>(
      tx,
      `SELECT order_id FROM deliveries WHERE id = $1`,
      [id],
    );
    if (!cur) throw new NotFoundException('Entrega não encontrada');
    const o = await this.orders.lock(tx, cur.order_id);
    const d = await one<{
      id: string;
      status: string;
      courier_user: string | null;
      courier_id: string;
      confirm_code: string | null;
      confirm_attempts: number;
    }>(
      tx,
      `SELECT d.id, d.status, c.user_id AS courier_user, d.courier_id, d.confirm_code, d.confirm_attempts
         FROM deliveries d JOIN couriers c ON c.id = d.courier_id
        WHERE d.id = $1 FOR UPDATE OF d`,
      [id],
    );
    const mine = viaLink ? d!.courier_id === viaLink : d!.courier_user === ctx.userId;
    if ((viaLink || !this.canManage(ctx)) && !mine)
      throw new ForbiddenException('Esta entrega é de outro entregador');
    if (d!.status !== 'out') throw new ConflictException('Esta entrega já foi encerrada');
    return { o, d: d! };
  }

  /**
   * Conclui a entrega. O entregador (login ou link) precisa do código que o cliente recebeu;
   * quem gerencia as entregas conclui pelo painel sem código (cliente sem o código, por exemplo).
   * Cada código errado conta; no limite, a corrida trava para o entregador.
   */
  async complete(
    ctx: Ctx,
    id: string,
    opts: { viaLink?: string; code?: string; method?: PaymentMethod } = {},
  ) {
    let orderId = '';
    let wrong = false;
    const byCourier = !!opts.viaLink || !this.canManage(ctx);
    try {
      const res = await this.db.withTenant(ctx, async (tx) => {
        const { o, d } = await this.lockOut(tx, ctx, id, opts.viaLink);
        // Corrida que saiu antes do código existir (migração 0026) conclui sem ele.
        if (byCourier && d.confirm_code) {
          if (d.confirm_attempts >= CONFIRM_MAX_ATTEMPTS)
            throw new ConflictException(
              'Código bloqueado depois de várias tentativas. Peça para o restaurante concluir.',
            );
          if (!opts.code) throw new UnprocessableEntityException('Digite o código do cliente');
          if (opts.code !== d.confirm_code) {
            wrong = true;
            const left = CONFIRM_MAX_ATTEMPTS - d.confirm_attempts - 1;
            throw new UnprocessableEntityException(
              left > 0
                ? `Código errado. Confira com o cliente (${left} ${left === 1 ? 'tentativa' : 'tentativas'}).`
                : 'Código errado. Peça para o restaurante concluir.',
            );
          }
        }
        orderId = o.id;
        await this.orders.transitionInTx(
          tx,
          ctx,
          o,
          'completed',
          byCourier || !d.confirm_code ? 'Entrega concluída' : 'Entrega concluída pelo restaurante',
          { collectMethod: opts.method ?? null },
        );
        return one(tx, `${DELIVERY_SELECT} WHERE d.id = $1`, [id]);
      });
      this.publish(ctx, id, orderId);
      return res;
    } catch (e) {
      // A transação foi desfeita: o erro conta numa gravação à parte.
      if (wrong)
        await this.db.withTenant(ctx, (tx) =>
          q(tx, `UPDATE deliveries SET confirm_attempts = confirm_attempts + 1 WHERE id = $1`, [
            id,
          ]),
        );
      throw e;
    }
  }

  // ------------------------------------------------------------------ acerto do entregador
  /**
   * Entregas concluídas com dinheiro na mão do entregador, ainda sem acerto no caixa, por
   * entregador. É a lista que o caixa confere quando o motoboy volta.
   */
  pendingCollections(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await q<{
        id: string;
        courierId: string;
        courierName: string;
        collectAmount: string;
        collectMethod: PaymentMethod | null;
      }>(
        tx,
        `${DELIVERY_SELECT} WHERE d.collect_status = 'pending' ORDER BY c.name, d.finished_at`,
      );
      const byCourier = new Map<
        string,
        { courierId: string; courierName: string; total: number; deliveries: typeof rows }
      >();
      for (const r of rows) {
        const g = byCourier.get(r.courierId) ?? {
          courierId: r.courierId,
          courierName: r.courierName,
          total: 0,
          deliveries: [],
        };
        g.total += toCents(r.collectAmount ?? '0');
        g.deliveries.push(r);
        byCourier.set(r.courierId, g);
      }
      return [...byCourier.values()].map((g) => ({ ...g, total: fromCents(g.total) }));
    });
  }

  /**
   * Acerto de uma entrega: o caixa recebe do entregador o que ficou em aberto no pedido. Vira um
   * pagamento normal na sessão de caixa informada (entra no esperado do fechamento).
   */
  async settle(
    ctx: Ctx,
    id: string,
    b: { cashSessionId: string; method?: PaymentMethod },
    idemKey: string,
  ) {
    let orderId = '';
    let paid = false;
    const res = await this.db.withTenant(ctx, (tx) =>
      withIdempotency(tx, ctx.tenantId, 'delivery.settle', idemKey, { id, ...b }, async () => {
        const session = await one<{ status: string }>(
          tx,
          `SELECT status FROM cash_sessions WHERE id = $1 FOR SHARE`,
          [b.cashSessionId],
        );
        if (!session) throw new NotFoundException('Sessão de caixa não encontrada');
        if (session.status !== 'open')
          throw new ConflictException('Caixa fechado: abra um caixa para continuar');
        const cur = await one<{ order_id: string }>(
          tx,
          `SELECT order_id FROM deliveries WHERE id = $1`,
          [id],
        );
        if (!cur) throw new NotFoundException('Entrega não encontrada');
        const o = await this.orders.lock(tx, cur.order_id);
        orderId = o.id;
        const d = await one<{ collect_status: string; collect_method: PaymentMethod | null }>(
          tx,
          `SELECT collect_status, collect_method FROM deliveries WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (d!.collect_status !== 'pending')
          throw new ConflictException('Esta entrega não tem acerto pendente');
        const balance = toCents(o.total) - toCents(o.paid_amount);
        const method = b.method ?? d!.collect_method ?? 'cash';
        if (balance > 0) {
          await assertNoPixPending(tx, o);
          const p = await this.cash.applyPayment(tx, ctx, o, {
            cashSessionId: b.cashSessionId,
            method,
            amountCents: balance,
          });
          paid = p.paymentStatus === 'paid';
        }
        await q(
          tx,
          `UPDATE deliveries SET collect_status = 'settled', settled_at = now(), settled_by = $2,
                  collect_method = $3 WHERE id = $1`,
          [id, ctx.userId, method],
        );
        await this.audit.record(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: 'delivery.settled',
          entity: 'delivery',
          entityId: id,
          data: { orderId: o.id, amount: fromCents(Math.max(balance, 0)), method },
          ip: ctx.ip,
        });
        return one(tx, `${DELIVERY_SELECT} WHERE d.id = $1`, [id]);
      }),
    );
    this.publish(ctx, id, orderId);
    this.realtime.publish(ctx.tenantId, { type: 'cash.changed', sessionId: b.cashSessionId });
    if (paid) this.cash.notifyPaid(ctx, orderId);
    return res;
  }

  /** Entrega não realizada: o pedido volta para "pronto" e pode sair de novo. */
  async fail(ctx: Ctx, id: string, reason: string, viaLink?: string) {
    let orderId = '';
    const res = await this.db.withTenant(ctx, async (tx) => {
      const { o } = await this.lockOut(tx, ctx, id, viaLink);
      orderId = o.id;
      await this.orders.transitionInTx(tx, ctx, o, 'ready', reason);
      return one(tx, `${DELIVERY_SELECT} WHERE d.id = $1`, [id]);
    });
    this.publish(ctx, id, orderId);
    return res;
  }

  async location(ctx: Ctx, id: string, fix: CourierFix, viaLink?: string) {
    const at = await this.db.withTenant(ctx, async (tx) => {
      const d = await one<{ status: string; courier_user: string | null; courier_id: string }>(
        tx,
        `SELECT d.status, c.user_id AS courier_user, d.courier_id FROM deliveries d JOIN couriers c ON c.id = d.courier_id WHERE d.id = $1`,
        [id],
      );
      if (!d) throw new NotFoundException('Entrega não encontrada');
      if (viaLink ? d.courier_id !== viaLink : d.courier_user !== ctx.userId)
        throw new ForbiddenException('Só o entregador da corrida envia a localização');
      if (d.status !== 'out') throw new ConflictException('Esta entrega já foi encerrada');
      const lat = fix.lat.toFixed(6);
      const lng = fix.lng.toFixed(6);
      const accuracy = fix.accuracy == null ? null : Math.round(fix.accuracy);
      const speed = fix.speed == null ? null : fix.speed.toFixed(2);
      const heading = fix.heading == null ? null : Math.round(fix.heading) % 360;
      const r = await one<{ at: Date }>(
        tx,
        `UPDATE deliveries SET last_lat = $2, last_lng = $3, last_location_at = now(),
                last_accuracy = $4, last_speed = $5, last_heading = COALESCE($6, last_heading)
          WHERE id = $1 RETURNING last_location_at AS at`,
        [id, lat, lng, accuracy, speed, heading],
      );
      if (accuracy == null || accuracy <= TRAIL_MAX_ACCURACY_M)
        await q(
          tx,
          `INSERT INTO delivery_positions (tenant_id, delivery_id, lat, lng, accuracy, speed, heading)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [ctx.tenantId, id, lat, lng, accuracy, speed, heading],
        );
      return r!.at;
    });
    // A posição vai junto no aviso: o mapa do painel move a moto sem recarregar a tela.
    this.realtime.publish(ctx.tenantId, {
      type: 'delivery.location',
      deliveryId: id,
      lat: Number(fix.lat.toFixed(6)),
      lng: Number(fix.lng.toFixed(6)),
      heading: fix.heading == null ? null : Math.round(fix.heading) % 360,
      speed: fix.speed ?? null,
      at: at.toISOString(),
    });
    return { ok: true, at };
  }

  /** Mapa ao vivo do painel: ponto da loja e o trajeto de cada corrida pedida. */
  liveMap(ctx: Ctx, ids: string[]) {
    return this.db.withTenant(ctx, async (tx) => {
      const mine = !this.canManage(ctx);
      const allowed = await q<{ id: string }>(
        tx,
        `SELECT d.id FROM deliveries d JOIN couriers c ON c.id = d.courier_id
          WHERE d.id = ANY($1::uuid[]) AND (NOT $2 OR c.user_id = $3)`,
        [ids, mine, ctx.userId],
      );
      const store = await storePoint(tx);
      const trails = await trailsOf(
        tx,
        allowed.map((a) => a.id),
      );
      return { store, trails };
    });
  }

  /** Gera um novo link de rastreio (o anterior deixa de funcionar). */
  async newTrackingLink(ctx: Ctx, id: string) {
    const token = this.newToken();
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(
        tx,
        `UPDATE deliveries SET tracking_hash = $2, tracking_expires_at = now() + make_interval(hours => $3)
          WHERE id = $1 AND status = 'out' RETURNING id`,
        [id, token.hash, TRACKING_TTL_HOURS],
      );
      if (!r) throw new ConflictException('Só entregas em andamento têm link de rastreio');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'delivery.tracking_link',
        entity: 'delivery',
        entityId: id,
        ip: ctx.ip,
      });
    });
    return { trackingPath: `/rastreio/${token.token}` };
  }

  // ------------------------------------------------------------ link do entregador
  /**
   * Gera o link do entregador (o anterior para de funcionar). Quem tem o link vê e conclui só as
   * próprias corridas, sem login: serve para motoboy freelancer que não tem conta na equipe.
   */
  async newCourierLink(ctx: Ctx, courierId: string) {
    const token = randomBytes(24).toString('base64url');
    // Cópia cifrada do token: o botão Copiar link mostra o mesmo link de novo, sem trocar.
    const key = this.env.INTEGRATIONS_KEY;
    const enc = key ? seal(key, token, linkContext(ctx.tenantId, courierId)) : null;
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(
        tx,
        `UPDATE couriers SET access_token_hash = $2, access_token_enc = $3, access_created_at = now(),
                link_seen_at = NULL
          WHERE id = $1 RETURNING id`,
        [courierId, trackingHash(token), enc],
      );
      if (!r) throw new NotFoundException('Entregador não encontrado');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'courier.link_created',
        entity: 'courier',
        entityId: courierId,
        ip: ctx.ip,
      });
    });
    return { path: `/entregador/${token}` };
  }

  /**
   * Link atual do entregador, para copiar ou mandar de novo (o mesmo, sem trocar). Link gerado
   * antes da cópia cifrada (ou sem INTEGRATIONS_KEY) devolve null: aí só gerando outro.
   */
  async currentCourierLink(ctx: Ctx, courierId: string) {
    const key = this.env.INTEGRATIONS_KEY;
    return this.db.withTenant(ctx, async (tx) => {
      const c = await one<{ enc: Buffer | null; hash: Buffer | null }>(
        tx,
        `SELECT access_token_enc AS enc, access_token_hash AS hash FROM couriers WHERE id = $1`,
        [courierId],
      );
      if (!c) throw new NotFoundException('Entregador não encontrado');
      if (!c.hash || !c.enc || !key) return { path: null };
      let token: string;
      try {
        token = openSecret(key, c.enc, linkContext(ctx.tenantId, courierId));
      } catch {
        return { path: null }; // chave trocada: o link segue valendo, mas não dá para mostrar
      }
      // Confere que a cópia é do link que vale agora (nunca mostra um link morto).
      if (!trackingHash(token).equals(c.hash)) return { path: null };
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'courier.link_viewed',
        entity: 'courier',
        entityId: courierId,
        ip: ctx.ip,
      });
      return { path: `/entregador/${token}` };
    });
  }

  async revokeCourierLink(ctx: Ctx, courierId: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(
        tx,
        `UPDATE couriers SET access_token_hash = NULL, access_token_enc = NULL, access_created_at = NULL,
                link_seen_at = NULL
          WHERE id = $1 RETURNING id`,
        [courierId],
      );
      if (!r) throw new NotFoundException('Entregador não encontrado');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'courier.link_revoked',
        entity: 'courier',
        entityId: courierId,
        ip: ctx.ip,
      });
    });
    return { ok: true };
  }

  /** Confere o link e devolve o contexto do entregador (sem login, papel "driver"). */
  async courierCtx(tenantId: string, token: string, ip?: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new NotFoundException('Link inválido');
    const c = await this.db.withTenant({ tenantId }, (tx) =>
      // Marca quando o link foi usado (situação "disponível" em Entregas), no máximo a cada 30 s.
      one<{ id: string; name: string; active: boolean }>(
        tx,
        `WITH c AS (SELECT id, name, active, link_seen_at FROM couriers WHERE access_token_hash = $1),
              seen AS (UPDATE couriers k SET link_seen_at = now() FROM c
                        WHERE k.id = c.id AND c.active
                          AND (c.link_seen_at IS NULL OR c.link_seen_at < now() - interval '30 seconds')
                        RETURNING k.id)
         SELECT id, name, active FROM c`,
        [trackingHash(token)],
      ),
    );
    if (!c) throw new NotFoundException('Link do entregador inválido ou desativado');
    if (!c.active) throw new ForbiddenException('Entregador desativado. Fale com o restaurante.');
    const ctx: Ctx = {
      tenantId,
      userId: null,
      user: {
        id: '',
        name: `${c.name} (link do entregador)`,
        email: '',
        role: 'driver',
        sessionId: '',
      },
      ip,
    };
    return { ctx, courier: c };
  }

  /** Tela do entregador pelo link: corridas na rua e as encerradas hoje. */
  async courierHome(tenantId: string, tenantName: string, token: string) {
    const { courier } = await this.courierCtx(tenantId, token);
    const deliveries = await this.db.withTenant({ tenantId }, async (tx) =>
      withEstimates(
        tx,
        await q<{ id: string; courierId: string; status: string }>(
          tx,
          `${DELIVERY_SELECT} CROSS JOIN tenants tz
            WHERE d.courier_id = $1
              AND (d.status = 'out'
                   OR (d.dispatched_at AT TIME ZONE tz.timezone)::date = (now() AT TIME ZONE tz.timezone)::date)
            ORDER BY d.status = 'out' DESC, d.dispatched_at DESC LIMIT 100`,
          [courier.id],
        ),
      ),
    );
    const store = await this.db.withTenant({ tenantId }, (tx) => storePoint(tx));
    return { restaurant: tenantName, courier: { name: courier.name }, deliveries, store };
  }

  /**
   * Prévia do app de um entregador da equipe para o administrador (Equipe › Abrir): as corridas
   * dele na rua e as de hoje, como no app. Só leitura: quem chama não age pelo entregador.
   */
  previewHome(ctx: Ctx, userId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const courier = await one<{ id: string; name: string }>(
        tx,
        `SELECT id, name FROM couriers WHERE user_id = $1`,
        [userId],
      );
      if (!courier)
        throw new NotFoundException('Esta pessoa ainda não está ligada a um entregador.');
      const deliveries = await withEstimates(
        tx,
        await q<{ id: string; courierId: string; status: string }>(
          tx,
          `${DELIVERY_SELECT} CROSS JOIN tenants tz
            WHERE d.courier_id = $1
              AND (d.status = 'out'
                   OR (d.dispatched_at AT TIME ZONE tz.timezone)::date = (now() AT TIME ZONE tz.timezone)::date)
            ORDER BY d.status = 'out' DESC, d.dispatched_at DESC LIMIT 100`,
          [courier.id],
        ),
      );
      return { courier, deliveries, store: await storePoint(tx) };
    });
  }

  /**
   * Consulta pública do link de rastreio. Mostra o mínimo: número e situação do pedido, primeiro
   * nome do entregador, a última localização e o trajeto (só enquanto está na rua) e o destino
   * arredondado. Nunca endereço ou telefone.
   */
  async publicTrack(tenantId: string, tenantName: string, token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token))
      throw new NotFoundException('Link de rastreio inválido');
    const d = await this.db.withTenant({ tenantId }, (tx) =>
      one<{
        status: string;
        expired: boolean;
        order_number: number;
        courier: string;
        dispatched_at: Date;
        finished_at: Date | null;
        lat: string | null;
        lng: string | null;
        location_at: Date | null;
        heading: number | null;
        speed: number | null;
        accuracy: number | null;
        dest_lat: string | null;
        dest_lng: string | null;
        id: string;
        code: string | null;
      }>(
        tx,
        `SELECT d.id, d.status, d.confirm_code AS code, d.tracking_expires_at < now() AS expired, o.number AS order_number,
                split_part(c.name, ' ', 1) AS courier, d.dispatched_at, d.finished_at,
                d.last_lat::text AS lat, d.last_lng::text AS lng, d.last_location_at AS location_at,
                d.last_heading AS heading, d.last_speed::float AS speed, d.last_accuracy AS accuracy,
                round(o.delivery_lat, 3)::text AS dest_lat, round(o.delivery_lng, 3)::text AS dest_lng
           FROM deliveries d JOIN orders o ON o.id = d.order_id JOIN couriers c ON c.id = d.courier_id
          WHERE d.tracking_hash = $1`,
        [trackingHash(token)],
      ),
    );
    if (!d) throw new NotFoundException('Link de rastreio inválido');
    if (d.expired) throw new GoneException('Este link de rastreio expirou');
    const out = d.status === 'out';
    const map = await this.db.withTenant({ tenantId }, (tx) => customerMapOf(tx, d.id));
    return {
      restaurant: tenantName,
      orderNumber: d.order_number,
      status: d.status,
      courier: d.courier,
      // Quem tem o link é o cliente: ele passa este código ao entregador na porta.
      code: out ? d.code : null,
      dispatchedAt: d.dispatched_at,
      finishedAt: d.finished_at,
      location:
        out && d.lat && d.lng
          ? {
              lat: d.lat,
              lng: d.lng,
              at: d.location_at,
              heading: d.heading,
              speed: d.speed,
              accuracy: d.accuracy,
            }
          : null,
      // Destino aproximado (~100 m): mostra "perto de você" sem expor o endereço exato.
      destination: d.dest_lat && d.dest_lng ? { lat: d.dest_lat, lng: d.dest_lng } : null,
      store: map.store,
      trail: out ? map.trail : [],
    };
  }

  private publish(ctx: Ctx, deliveryId: string, orderId: string) {
    this.realtime.publish(ctx.tenantId, { type: 'delivery.changed', deliveryId });
    this.realtime.publish(ctx.tenantId, { type: 'order.changed', orderId });
    // O app do entregador com login não está na sala da loja: o aviso vai direto para ele.
    void this.db
      .withTenant({ tenantId: ctx.tenantId }, (tx) =>
        one<{ user_id: string | null }>(
          tx,
          `SELECT c.user_id FROM deliveries d JOIN couriers c ON c.id = d.courier_id WHERE d.id = $1`,
          [deliveryId],
        ),
      )
      .then((r) => {
        if (r?.user_id)
          this.realtime.publishToUsers(ctx.tenantId, [r.user_id], {
            type: 'delivery.changed',
            deliveryId,
          });
      })
      .catch(() => undefined);
  }
}
