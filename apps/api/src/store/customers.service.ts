import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { customerStep } from '@comandou/shared';
import type { Request } from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password';
import { hashToken } from '../auth/session.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';
import { MessagingService } from '../messaging/messaging.service';

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
  cep?: string | null;
  city?: string | null;
  state?: string | null;
  isDefault?: boolean;
  lat?: number | null;
  lng?: number | null;
}

const CUSTOMER_COLS = `id, name, phone, email, marketing_opt_in AS "marketingOptIn", created_at AS "createdAt"`;
const ADDRESS_COLS = `id, label, street, number, district, complement, reference, cep, city, state,
  is_default AS "isDefault", lat::text, lng::text`;
const MAX_ADDRESSES = 10;
/** Código de "esqueci minha senha": 6 dígitos, 15 minutos, 5 tentativas, 3 pedidos por hora. */
const RESET_TTL_MIN = 15;
const RESET_MAX_ATTEMPTS = 5;
const RESET_PER_HOUR = 3;
const resetHash = (customerId: string, code: string) => hashToken(`reset:${customerId}:${code}`);

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
    private readonly messaging: MessagingService,
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

  // ------------------------------------------------------------------ esqueci minha senha
  private async newResetCode(
    tx: Tx,
    tenantId: string,
    customerId: string,
    channel: 'whatsapp' | 'staff',
    by?: string | null,
  ) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // Um código por vez: os anteriores deixam de valer.
    await q(
      tx,
      `UPDATE customer_password_resets SET used_at = now() WHERE customer_id = $1 AND used_at IS NULL`,
      [customerId],
    );
    await q(
      tx,
      `INSERT INTO customer_password_resets (tenant_id, customer_id, code_hash, channel, expires_at, created_by)
       VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5), $6)`,
      [tenantId, customerId, resetHash(customerId, code), channel, RESET_TTL_MIN, by ?? null],
    );
    return code;
  }

  /**
   * Pede o código pelo WhatsApp da loja. A resposta é a mesma exista a conta ou não (ninguém
   * descobre quem tem conta): diz só se a loja manda código pelo WhatsApp ou se é preciso falar
   * com o restaurante.
   */
  async requestReset(tenantId: string, tenantName: string, phoneRaw: string, ip?: string) {
    const phone = normalizePhone(phoneRaw);
    const r = await this.db.withTenant({ tenantId }, async (tx) => {
      const canSend = await this.messaging.canSendCode(tx);
      if (!canSend || !phoneOk(phone)) return { canSend, code: null };
      const c = await one<{ id: string; blocked: boolean; recent: number }>(
        tx,
        `SELECT c.id, c.blocked_at IS NOT NULL AS blocked,
                (SELECT count(*)::int FROM customer_password_resets r
                  WHERE r.customer_id = c.id AND r.created_at > now() - interval '1 hour') AS recent
           FROM customers c WHERE c.phone = $1`,
        [phone],
      );
      if (!c || c.blocked) return { canSend, code: null };
      if (c.recent >= RESET_PER_HOUR)
        throw new ThrottlerException(
          'Você já pediu vários códigos. Use o último que chegou ou aguarde uma hora.',
        );
      const code = await this.newResetCode(tx, tenantId, c.id, 'whatsapp');
      await this.audit.record(tx, {
        tenantId,
        action: 'customer.password_reset_requested',
        entity: 'customer',
        entityId: c.id,
        ip,
      });
      return { canSend, code };
    });
    if (!r.canSend) return { channel: 'restaurant' as const };
    if (r.code && !(await this.messaging.sendCode(tenantId, phone, r.code, tenantName)))
      throw new ServiceUnavailableException(
        'Não conseguimos mandar o código pelo WhatsApp agora. Tente de novo ou fale com o restaurante.',
      );
    return { channel: 'whatsapp' as const };
  }

  /** Confere o código, troca a senha, encerra as outras sessões e abre uma nova neste aparelho. */
  async resetPassword(
    tenantId: string,
    input: { phone: string; code: string; password: string },
    meta: { ip?: string; userAgent?: string },
  ) {
    const phone = normalizePhone(input.phone);
    const code = input.code.replace(/\D/g, '');
    const invalid = () => new UnauthorizedException('Código inválido ou vencido. Peça um novo.');
    const found = await this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<{ id: string; customer_id: string; code_hash: Buffer; attempts: number }>(
        tx,
        `SELECT r.id, r.customer_id, r.code_hash, r.attempts
           FROM customer_password_resets r JOIN customers c ON c.id = r.customer_id
          WHERE c.phone = $1 AND c.blocked_at IS NULL AND r.used_at IS NULL AND r.expires_at > now()
          ORDER BY r.created_at DESC LIMIT 1 FOR UPDATE OF r`,
        [phone],
      );
      if (!r || r.attempts >= RESET_MAX_ATTEMPTS) return null;
      if (code.length !== 6 || !resetHash(r.customer_id, code).equals(r.code_hash)) {
        await q(tx, `UPDATE customer_password_resets SET attempts = attempts + 1 WHERE id = $1`, [
          r.id,
        ]);
        return null;
      }
      await q(tx, `UPDATE customer_password_resets SET used_at = now() WHERE id = $1`, [r.id]);
      return r.customer_id;
    });
    if (!found) throw invalid();
    const hash = await hashPassword(input.password);
    return this.db.withTenant({ tenantId }, async (tx) => {
      await q(tx, `UPDATE customers SET password_hash = $2, last_login_at = now() WHERE id = $1`, [
        found,
        hash,
      ]);
      await q(
        tx,
        `UPDATE customer_sessions SET revoked_at = now() WHERE customer_id = $1 AND revoked_at IS NULL`,
        [found],
      );
      await this.audit.record(tx, {
        tenantId,
        action: 'customer.password_reset',
        entity: 'customer',
        entityId: found,
        ip: meta.ip,
      });
      const session = await this.newSession(tx, tenantId, found, meta.userAgent);
      const customer = await one<Customer>(
        tx,
        `SELECT ${CUSTOMER_COLS} FROM customers WHERE id = $1`,
        [found],
      );
      return { customer: customer!, session };
    });
  }

  /** A equipe gera o código para passar ao cliente (quando a loja não manda pelo WhatsApp). */
  staffResetCode(ctx: Ctx, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const c = await one(tx, `SELECT 1 FROM customers WHERE id = $1`, [id]);
      if (!c) throw new NotFoundException('Cliente não encontrado');
      const code = await this.newResetCode(tx, ctx.tenantId, id, 'staff', ctx.userId);
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'customer.password_reset_code',
        entity: 'customer',
        entityId: id,
        ip: ctx.ip,
      });
      return { code, expiresInMinutes: RESET_TTL_MIN };
    });
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
        `INSERT INTO customer_addresses (tenant_id, customer_id, label, street, number, district, complement, reference,
                                         is_default, lat, lng, cep, city, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${ADDRESS_COLS}`,
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
          a.lat?.toFixed(6) ?? null,
          a.lng?.toFixed(6) ?? null,
          a.cep ?? null,
          a.city ?? null,
          a.state ?? null,
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
        ['cep', 'cep'],
        ['city', 'city'],
        ['state', 'state'],
        ['isDefault', 'is_default'],
        ['lat', 'lat'],
        ['lng', 'lng'],
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
        items: { name: string; quantity: number; imageUrl: string | null }[];
      }>(
        tx,
        `SELECT o.id, o.number, o.status, o.channel, o.total::text, o.created_at AS "createdAt",
                COALESCE((SELECT json_agg(json_build_object('name', i.name, 'quantity', i.quantity::float8,
                                   'imageUrl', (SELECT '/api/v1/media/' || p.image_id FROM products p WHERE p.id = i.product_id))
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
                c.last_login_at AS "lastLoginAt", c.document,
                COALESCE(st.orders, 0) AS orders, COALESCE(st.spent, '0.00') AS spent,
                st.last_order_at AS "lastOrderAt"
           FROM customers c
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE o.status <> 'cancelled')::int AS orders,
                    COALESCE(sum(o.total) FILTER (WHERE o.status <> 'cancelled'), 0)::text AS spent,
                    max(o.created_at) AS last_order_at
               FROM orders o WHERE o.customer_id = c.id) st ON true
          WHERE $1 = '' OR c.name ILIKE $2 OR c.email ILIKE $2 OR ($3 <> '' AND (c.phone LIKE $4 OR c.document LIKE $4))
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
                last_login_at AS "lastLoginAt", document, state_registration AS "stateRegistration",
                ie_indicator AS "ieIndicator"
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

  async update(
    ctx: Ctx,
    id: string,
    p: {
      staffNotes?: string | null;
      blocked?: boolean;
      document?: string | null;
      stateRegistration?: string | null;
      ieIndicator?: 1 | 2 | 9 | null;
    },
  ) {
    await this.db.withTenant(ctx, async (tx) => {
      // Dados fiscais do cliente (destinatário da NF-e / CPF na nota).
      const fiscal: [string, unknown][] = (
        [
          ['document', p.document],
          ['state_registration', p.stateRegistration],
          ['ie_indicator', p.ieIndicator],
        ] as [string, unknown][]
      ).filter(([, v]) => v !== undefined);
      if (fiscal.length)
        await q(
          tx,
          `UPDATE customers SET ${fiscal.map(([c], i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [id, ...fiscal.map(([, v]) => v)],
        );
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
        data: {
          blocked: p.blocked,
          notes: p.staffNotes !== undefined,
          fiscal: p.document !== undefined || p.stateRegistration !== undefined,
        },
        ip: ctx.ip,
      });
    });
    return this.detail(ctx, id);
  }
}
