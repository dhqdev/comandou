import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { fromCents, PaymentMethod, roleHas, toCents } from '@comandou/shared';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { CashService } from '../cash/cash.service';
import { withIdempotency } from '../common/idempotency';
import { OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';
import { rideEstimates } from './courier-pay.service';

/** Validade do link de rastreio enquanto o pedido está na rua. */
export const TRACKING_TTL_HOURS = 4;

/** Erros de código aceitos antes de travar a entrega (aí só o restaurante conclui). */
export const CONFIRM_MAX_ATTEMPTS = 5;

/** Código de entrega de 4 dígitos (como o do iFood): o cliente informa ao entregador. */
export const newConfirmCode = () => String(randomInt(0, 10_000)).padStart(4, '0');

const trackingHash = (token: string) => createHash('sha256').update(token).digest();

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

  /** Despacha um pedido de delivery pronto com um entregador. Devolve o link de rastreio (uma vez). */
  async dispatch(ctx: Ctx, orderId: string, courierId: string) {
    const token = this.newToken();
    const res = await this.db.withTenant(ctx, async (tx) => {
      const o = await this.orders.lock(tx, orderId);
      if (o.channel !== 'delivery')
        throw new ConflictException('Só pedidos de delivery saem para entrega');
      if (o.status !== 'ready')
        throw new ConflictException('O pedido precisa estar pronto para sair');
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
        action: 'delivery.dispatched',
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
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(
        tx,
        `UPDATE couriers SET access_token_hash = $2, access_created_at = now() WHERE id = $1 RETURNING id`,
        [courierId, trackingHash(token)],
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

  async revokeCourierLink(ctx: Ctx, courierId: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(
        tx,
        `UPDATE couriers SET access_token_hash = NULL, access_created_at = NULL WHERE id = $1 RETURNING id`,
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
      one<{ id: string; name: string; active: boolean }>(
        tx,
        `SELECT id, name, active FROM couriers WHERE access_token_hash = $1`,
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
