import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { customerStep } from '@comandou/shared';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password';
import { hashToken } from '../auth/session.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';

export const CUSTOMER_COOKIE = 'cm_cid';
export const cookieOf = (req: Request, name: string) =>
  (req.cookies as Record<string, string> | undefined)?.[name];
/** A conta do cliente fica aberta no aparelho por 90 dias. */
export const CUSTOMER_SESSION_DAYS = 90;

/** Só dígitos; tira o 55 do Brasil para o mesmo número não virar duas contas. */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d;
}
export const phoneOk = (d: string) => /^[0-9]{10,11}$/.test(d);

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  marketingOptIn: boolean;
  createdAt: Date;
}
export interface AddressInput {
  label?: string | null;
  street: string;
  number: string;
  district: string;
  complement?: string | null;
  reference?: string | null;
  isDefault?: boolean;
}

const CUSTOMER_COLS = `id, name, phone, email, marketing_opt_in AS "marketingOptIn", created_at AS "createdAt"`;
const ADDRESS_COLS = `id, label, street, number, district, complement, reference, is_default AS "isDefault"`;
const MAX_ADDRESSES = 10;

/** Texto livre vindo do cliente vira padrão ILIKE seguro. */
const likeOf = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Conta do cliente final no cardápio online de um restaurante: cadastro com telefone e senha,
 * sessão em cookie próprio (cm_cid, separado do login da equipe), endereços e histórico.
 * Tudo com RLS: a conta só existe no restaurante em que foi criada.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async newSession(tx: Tx, tenantId: string, customerId: string, userAgent?: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_DAYS * 86_400_000);
    await q(
      tx,
      `INSERT INTO customer_sessions (tenant_id, customer_id, token_hash, expires_at, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, customerId, hashToken(token), expiresAt, userAgent?.slice(0, 300) ?? null],
    );
    return { token, expiresAt };
  }

  async signup(
    tenantId: string,
    input: {
      name: string;
      phone: string;
      email?: string;
      password: string;
      marketingOptIn?: boolean;
    },
    meta: { ip?: string; userAgent?: string },
  ) {
    const phone = normalizePhone(input.phone);
    if (!phoneOk(phone)) throw new ConflictException('Telefone inválido');
    const hash = await hashPassword(input.password);
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await one<{ enabled: boolean }>(
        tx,
        `SELECT accounts_enabled AS enabled FROM tenant_store_settings`,
      );
      if (s && !s.enabled) throw new ForbiddenException('Este restaurante não usa contas');
      const dup = await one(tx, `SELECT 1 FROM customers WHERE phone = $1`, [phone]);
      if (dup) throw new ConflictException('Já existe uma conta com este telefone. Entre com ela.');
      if (input.email) {
        const e = await one(tx, `SELECT 1 FROM customers WHERE lower(email) = lower($1)`, [
          input.email,
        ]);
        if (e) throw new ConflictException('Este e-mail já está em outra conta');
      }
      const c = await one<Customer>(
        tx,
        `INSERT INTO customers (tenant_id, name, phone, email, password_hash, marketing_opt_in, last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING ${CUSTOMER_COLS}`,
        [tenantId, input.name, phone, input.email ?? null, hash, input.marketingOptIn ?? false],
      );
      await this.audit.record(tx, {
        tenantId,
        action: 'customer.signup',
        entity: 'customer',
        entityId: c!.id,
        ip: meta.ip,
      });
      const session = await this.newSession(tx, tenantId, c!.id, meta.userAgent);
      return { customer: c!, session };
    });
  }

  async login(
    tenantId: string,
    input: { phone: string; password: string },
    meta: { ip?: string; userAgent?: string },
  ) {
    const phone = normalizePhone(input.phone);
    // Bloqueio por telefone antes de conferir a senha (vale exista a conta ou não).
    const failures = await this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM audit_log
          WHERE tenant_id = $1 AND action = 'customer.login_failed' AND data->>'phone' = $2
            AND created_at > now() - make_interval(mins => $3)`,
        [tenantId, phone, this.env.AUTH_ACCOUNT_LOCK_MINUTES],
      );
      return r?.n ?? 0;
    });
    if (failures >= this.env.AUTH_ACCOUNT_LOCK_THRESHOLD)
      throw new ThrottlerException('Muitas tentativas com senha errada. Aguarde alguns minutos.');
    const row = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ id: string; password_hash: string; blocked: boolean }>(
        tx,
        `SELECT id, password_hash, blocked_at IS NOT NULL AS blocked FROM customers WHERE phone = $1`,
        [phone],
      ),
    );
    const valid = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !valid) {
      await this.db.withTenant({ tenantId }, (tx) =>
        this.audit.record(tx, {
          tenantId,
          action: 'customer.login_failed',
          entity: 'customer',
          data: { phone },
          ip: meta.ip,
        }),
      );
      throw new UnauthorizedException('Telefone ou senha inválidos');
    }
    if (row.blocked)
      throw new ForbiddenException('Esta conta está bloqueada. Fale com o restaurante.');
    return this.db.withTenant({ tenantId }, async (tx) => {
      await q(tx, `UPDATE customers SET last_login_at = now() WHERE id = $1`, [row.id]);
      await this.audit.record(tx, {
        tenantId,
        action: 'customer.login',
        entity: 'customer',
        entityId: row.id,
        ip: meta.ip,
      });
      const session = await this.newSession(tx, tenantId, row.id, meta.userAgent);
      const customer = await one<Customer>(
        tx,
        `SELECT ${CUSTOMER_COLS} FROM customers WHERE id = $1`,
        [row.id],
      );
      return { customer: customer!, session };
    });
  }

  /** Cliente dono do cookie, ou null (sem conta, sessão vencida ou conta bloqueada). */
  async resolve(tenantId: string, token: string | undefined): Promise<Customer | null> {
    if (!token || token.length > 100) return null;
    return this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<Customer & { sid: string; seen: Date }>(
        tx,
        `SELECT c.id, c.name, c.phone, c.email, c.marketing_opt_in AS "marketingOptIn",
                c.created_at AS "createdAt", s.id AS sid, s.last_seen_at AS seen
           FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
          WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
            AND c.blocked_at IS NULL`,
        [hashToken(token)],
      );
      if (!r) return null;
      if (Date.now() - new Date(r.seen).getTime() > 60_000)
        await q(tx, `UPDATE customer_sessions SET last_seen_at = now() WHERE id = $1`, [r.sid]);
      const { sid: _sid, seen: _seen, ...c } = r;
      return c;
    });
  }

  async logout(tenantId: string, token: string | undefined) {
    if (!token || token.length > 100) return;
    await this.db.withTenant({ tenantId }, (tx) =>
      q(
        tx,
        `UPDATE customer_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashToken(token)],
      ),
    );
  }

  /** Perfil + endereços (o que a tela "Conta" precisa de uma vez). */
  account(tenantId: string, c: Customer) {
    return this.db.withTenant({ tenantId }, async (tx) => ({
      customer: c,
      addresses: await q(
        tx,
        `SELECT ${ADDRESS_COLS} FROM customer_addresses WHERE customer_id = $1
          ORDER BY is_default DESC, created_at`,
        [c.id],
      ),
    }));
  }

  updateProfile(
    tenantId: string,
    c: Customer,
    p: { name?: string; email?: string | null; marketingOptIn?: boolean },
  ) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      if (p.email) {
        const e = await one(
          tx,
          `SELECT 1 FROM customers WHERE lower(email) = lower($1) AND id <> $2`,
          [p.email, c.id],
        );
        if (e) throw new ConflictException('Este e-mail já está em outra conta');
      }
      return one<Customer>(
        tx,
        `UPDATE customers SET name = COALESCE($2, name),
                email = CASE WHEN $3::boolean THEN $4 ELSE email END,
                marketing_opt_in = COALESCE($5, marketing_opt_in)
          WHERE id = $1 RETURNING ${CUSTOMER_COLS}`,
        [c.id, p.name ?? null, p.email !== undefined, p.email ?? null, p.marketingOptIn ?? null],
      );
    });
  }

  async changePassword(
    tenantId: string,
    c: Customer,
    current: string,
    next: string,
    keepToken?: string,
  ) {
    const row = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ h: string }>(tx, `SELECT password_hash AS h FROM customers WHERE id = $1`, [c.id]),
    );
    if (!row || !(await verifyPassword(current, row.h)))
      throw new UnauthorizedException('Senha atual incorreta');
    const hash = await hashPassword(next);
    await this.db.withTenant({ tenantId }, async (tx) => {
      await q(tx, `UPDATE customers SET password_hash = $2 WHERE id = $1`, [c.id, hash]);
      // Outros aparelhos saem; este continua entrando.
      await q(
        tx,
        `UPDATE customer_sessions SET revoked_at = now()
          WHERE customer_id = $1 AND revoked_at IS NULL AND token_hash <> $2`,
        [c.id, hashToken(keepToken ?? '')],
      );
      await this.audit.record(tx, {
        tenantId,
        action: 'customer.password_changed',
        entity: 'customer',
        entityId: c.id,
      });
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ endereços
  addAddress(tenantId: string, c: Customer, a: AddressInput) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const n = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM customer_addresses WHERE customer_id = $1`,
        [c.id],
      );
      if (n!.n >= MAX_ADDRESSES)
        throw new ConflictException(`Limite de ${MAX_ADDRESSES} endereços; apague um antigo`);
      const isDefault = a.isDefault || n!.n === 0;
      if (isDefault)
        await q(tx, `UPDATE customer_addresses SET is_default = false WHERE customer_id = $1`, [
          c.id,
        ]);
      return one(
        tx,
        `INSERT INTO customer_addresses (tenant_id, customer_id, label, street, number, district, complement, reference, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${ADDRESS_COLS}`,
        [
          tenantId,
          c.id,
          a.label ?? null,
          a.street,
          a.number,
          a.district,
          a.complement ?? null,
          a.reference ?? null,
          isDefault,
        ],
      );
    });
  }

  updateAddress(tenantId: string, c: Customer, id: string, a: Partial<AddressInput>) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const cur = await one(
        tx,
        `SELECT 1 FROM customer_addresses WHERE id = $1 AND customer_id = $2`,
        [id, c.id],
      );
      if (!cur) throw new NotFoundException('Endereço não encontrado');
      if (a.isDefault)
        await q(tx, `UPDATE customer_addresses SET is_default = false WHERE customer_id = $1`, [
          c.id,
        ]);
      const cols: [keyof AddressInput, string][] = [
        ['label', 'label'],
        ['street', 'street'],
        ['number', 'number'],
        ['district', 'district'],
        ['complement', 'complement'],
        ['reference', 'reference'],
        ['isDefault', 'is_default'],
      ];
      const set = cols.filter(([k]) => a[k] !== undefined);
      if (set.length)
        await q(
          tx,
          `UPDATE customer_addresses SET ${set.map(([, col], i) => `${col} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [id, ...set.map(([k]) => a[k] ?? null)],
        );
      return one(tx, `SELECT ${ADDRESS_COLS} FROM customer_addresses WHERE id = $1`, [id]);
    });
  }

  deleteAddress(tenantId: string, c: Customer, id: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<{ isDefault: boolean }>(
        tx,
        `DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2 RETURNING is_default AS "isDefault"`,
        [id, c.id],
      );
      if (!r) throw new NotFoundException('Endereço não encontrado');
      // O mais antigo vira o padrão.
      if (r.isDefault)
        await q(
          tx,
          `UPDATE customer_addresses SET is_default = true WHERE id = (
             SELECT id FROM customer_addresses WHERE customer_id = $1 ORDER BY created_at LIMIT 1)`,
          [c.id],
        );
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ pedidos
  orders(tenantId: string, c: Customer) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const rows = await q<{
        id: string;
        number: number;
        status: Parameters<typeof customerStep>[0];
        channel: string;
        total: string;
        createdAt: Date;
        items: { name: string; quantity: number }[];
      }>(
        tx,
        `SELECT o.id, o.number, o.status, o.channel, o.total::text, o.created_at AS "createdAt",
                COALESCE((SELECT json_agg(json_build_object('name', i.name, 'quantity', i.quantity::float8)
                                   ORDER BY i.created_at)
                            FROM order_items i WHERE i.order_id = o.id), '[]') AS items
           FROM orders o WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
        [c.id],
      );
      return rows.map(({ status, ...r }) => ({ ...r, step: customerStep(status) }));
    });
  }

  /** Id do pedido, se for deste cliente. */
  async ownOrderId(tenantId: string, c: Customer, id: string) {
    const r = await this.db.withTenant({ tenantId }, (tx) =>
      one(tx, `SELECT 1 FROM orders WHERE id = $1 AND customer_id = $2`, [id, c.id]),
    );
    if (!r) throw new NotFoundException('Pedido não encontrado');
    return id;
  }

  // ------------------------------------------------------------------ painel do restaurante
  list(ctx: Ctx, search: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const s = search.trim();
      const digits = s.replace(/\D/g, '');
      const customers = await q(
        tx,
        `SELECT c.id, c.name, c.phone, c.email, c.marketing_opt_in AS "marketingOptIn",
                c.blocked_at IS NOT NULL AS blocked, c.created_at AS "createdAt",
                c.last_login_at AS "lastLoginAt",
                COALESCE(st.orders, 0) AS orders, COALESCE(st.spent, '0.00') AS spent,
                st.last_order_at AS "lastOrderAt"
           FROM customers c
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE o.status <> 'cancelled')::int AS orders,
                    COALESCE(sum(o.total) FILTER (WHERE o.status <> 'cancelled'), 0)::text AS spent,
                    max(o.created_at) AS last_order_at
               FROM orders o WHERE o.customer_id = c.id) st ON true
          WHERE $1 = '' OR c.name ILIKE $2 OR c.email ILIKE $2 OR ($3 <> '' AND c.phone LIKE $4)
          ORDER BY COALESCE(st.last_order_at, c.created_at) DESC
          LIMIT 300`,
        [s, likeOf(s), digits, `%${digits}%`],
      );
      const summary = await one(
        tx,
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS "new30",
                count(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM orders o WHERE o.customer_id = customers.id
                     AND o.created_at > now() - interval '30 days'))::int AS "active30"
           FROM customers`,
      );
      return { summary, customers };
    });
  }

  detail(ctx: Ctx, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const c = await one(
        tx,
        `SELECT ${CUSTOMER_COLS}, staff_notes AS "staffNotes", blocked_at IS NOT NULL AS blocked,
                last_login_at AS "lastLoginAt"
           FROM customers WHERE id = $1`,
        [id],
      );
      if (!c) throw new NotFoundException('Cliente não encontrado');
      const addresses = await q(
        tx,
        `SELECT ${ADDRESS_COLS} FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at`,
        [id],
      );
      const orders = await q(
        tx,
        `SELECT id, number, status, channel, total::text, created_at AS "createdAt"
           FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [id],
      );
      const stats = await one(
        tx,
        `SELECT count(*) FILTER (WHERE status <> 'cancelled')::int AS orders,
                COALESCE(sum(total) FILTER (WHERE status <> 'cancelled'), 0)::text AS spent,
                COALESCE(avg(total) FILTER (WHERE status <> 'cancelled'), 0)::numeric(14,2)::text AS "avgTicket",
                min(created_at) AS "firstOrderAt", max(created_at) AS "lastOrderAt"
           FROM orders WHERE customer_id = $1`,
        [id],
      );
      const favorites = await q(
        tx,
        `SELECT i.name, sum(i.quantity)::int AS quantity
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.customer_id = $1 AND o.status <> 'cancelled'
          GROUP BY i.name ORDER BY 2 DESC, 1 LIMIT 5`,
        [id],
      );
      return { ...c, addresses, orders, stats, favorites };
    });
  }

  async update(ctx: Ctx, id: string, p: { staffNotes?: string | null; blocked?: boolean }) {
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(
        tx,
        `UPDATE customers SET
           staff_notes = CASE WHEN $2::boolean THEN $3 ELSE staff_notes END,
           blocked_at = CASE WHEN $4::boolean IS NULL THEN blocked_at
                             WHEN $4 THEN COALESCE(blocked_at, now()) ELSE NULL END
          WHERE id = $1 RETURNING id`,
        [id, p.staffNotes !== undefined, p.staffNotes ?? null, p.blocked ?? null],
      );
      if (!r) throw new NotFoundException('Cliente não encontrado');
      // Bloquear encerra as sessões abertas do cliente.
      if (p.blocked)
        await q(
          tx,
          `UPDATE customer_sessions SET revoked_at = now() WHERE customer_id = $1 AND revoked_at IS NULL`,
          [id],
        );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'customer.updated',
        entity: 'customer',
        entityId: id,
        data: { blocked: p.blocked, notes: p.staffNotes !== undefined },
        ip: ctx.ip,
      });
    });
    return this.detail(ctx, id);
  }
}
