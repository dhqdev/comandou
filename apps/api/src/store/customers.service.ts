import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
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
import { CustomerMailService } from './customer-mail.service';
import { resetEmail } from './reset-email';
import { siteUrlOf } from '../mail/templates/urls';
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
  /** CPF (ou CNPJ cadastrado pela equipe), só números: já vai na nota do pedido da mesa. */
  cpf: string | null;
  createdAt: Date;
  /** Avatar desenhado escolhido (null = o automático pelo id). */
  avatar: string | null;
  /** Foto enviada pelo cliente (null = mostra o avatar). */
  photoUrl: string | null;
  /** Aniversário (dia e mês; o ano é opcional) e se aceita o parabéns da loja. */
  birthDay: number | null;
  birthMonth: number | null;
  birthYear: number | null;
  birthdayOptOut: boolean;
}
/** Aniversário informado (null apaga). */
export type BirthdayInput = { day: number; month: number; year?: number | null } | null;
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

/** URL da foto do cliente com a versão (photo_at) para o cache do navegador. */
const photoUrlSql = (p: string, base: string) =>
  `CASE WHEN ${p}photo_at IS NULL THEN NULL ELSE ${base} || '?v=' || floor(extract(epoch FROM ${p}photo_at) * 1000)::bigint END`;
/** Foto vista pelo próprio cliente (cookie da conta). */
const OWN_PHOTO = `'/api/v1/store/account/photo'`;
/** Foto vista pela equipe (aba Clientes). */
const staffPhoto = (p: string) => `'/api/v1/customers/' || ${p}id || '/photo'`;
const BIRTHDAY_COLS = (p = '') =>
  `${p}birth_day AS "birthDay", ${p}birth_month AS "birthMonth", ${p}birth_year AS "birthYear",
   ${p}birthday_opt_out AS "birthdayOptOut"`;
const customerCols = (p = '') =>
  `${p}id, ${p}name, ${p}phone, ${p}email, ${p}marketing_opt_in AS "marketingOptIn", ${p}document AS cpf, ${p}created_at AS "createdAt",
   ${p}avatar, ${photoUrlSql(p, OWN_PHOTO)} AS "photoUrl", ${BIRTHDAY_COLS(p)}`;
const CUSTOMER_COLS = customerCols();
/** Foto do perfil: até 1 MB (o navegador já manda ~30 KB, 320 × 320). */
export const MAX_CUSTOMER_PHOTO_BYTES = 1024 * 1024;
const ADDRESS_COLS = `id, label, street, number, district, complement, reference, cep, city, state,
  is_default AS "isDefault", lat::text, lng::text`;
const MAX_ADDRESSES = 10;
/** Código de "esqueci minha senha": 6 dígitos, 15 minutos, 5 tentativas, 3 pedidos por hora. */
const RESET_TTL_MIN = 15;
const RESET_MAX_ATTEMPTS = 5;
const RESET_PER_HOUR = 3;
const resetHash = (customerId: string, code: string) => hashToken(`reset:${customerId}:${code}`);
const phoneCodeHash = (tenantId: string, phone: string, code: string) =>
  hashToken(`phone:${tenantId}:${phone}:${code}`);
/** Código pedido sem o WhatsApp da loja poder mandar: a conta nasce sem o telefone confirmado. */
export const PHONE_CODE_REQUIRED = 'phone_code_required';

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
    private readonly mail: CustomerMailService,
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

  /**
   * Cadastro, passo 1: código de 6 números pelo WhatsApp da loja para confirmar que o telefone é
   * de quem está cadastrando (senão alguém cadastra o número de outra pessoa e fica com os pedidos
   * e pontos dela). Sem WhatsApp que mande código, responde `none` e o cadastro segue sem ele.
   */
  async requestSignupCode(tenantId: string, tenantName: string, phoneRaw: string, ip?: string) {
    const phone = normalizePhone(phoneRaw);
    if (!phoneOk(phone)) throw new UnprocessableEntityException('Telefone inválido');
    const r = await this.db.withTenant({ tenantId }, async (tx) => {
      if (!(await this.messaging.canSendCode(tx))) return null;
      const recent = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM customer_phone_codes
          WHERE phone = $1 AND created_at > now() - interval '1 hour'`,
        [phone],
      );
      if ((recent?.n ?? 0) >= RESET_PER_HOUR)
        throw new ThrottlerException(
          'Você já pediu vários códigos. Use o último que chegou ou aguarde uma hora.',
        );
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await q(
        tx,
        `UPDATE customer_phone_codes SET used_at = now() WHERE phone = $1 AND used_at IS NULL`,
        [phone],
      );
      await q(
        tx,
        `INSERT INTO customer_phone_codes (tenant_id, phone, code_hash, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
        [tenantId, phone, phoneCodeHash(tenantId, phone, code), RESET_TTL_MIN],
      );
      await this.audit.record(tx, {
        tenantId,
        action: 'customer.phone_code_requested',
        entity: 'customer',
        data: { phone: `…${phone.slice(-4)}` },
        ip,
      });
      return code;
    });
    if (!r) return { channel: 'none' as const };
    const sent = await this.messaging.sendCode(tenantId, phone, r, tenantName, 'signup');
    if (!sent)
      throw new ServiceUnavailableException(
        'Não conseguimos mandar o código agora. Tente de novo em alguns minutos.',
      );
    return { channel: 'whatsapp' as const, expiresInMinutes: RESET_TTL_MIN };
  }

  /** Confere o código do cadastro (erro conta em transação própria, como no "esqueci a senha"). */
  private async checkSignupCode(tenantId: string, phone: string, codeRaw: string | undefined) {
    const code = (codeRaw ?? '').replace(/\D/g, '');
    const ok = await this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<{ id: string; code_hash: Buffer; attempts: number }>(
        tx,
        `SELECT id, code_hash, attempts FROM customer_phone_codes
          WHERE phone = $1 AND used_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [phone],
      );
      if (!r || r.attempts >= RESET_MAX_ATTEMPTS) return false;
      if (code.length !== 6 || !phoneCodeHash(tenantId, phone, code).equals(r.code_hash)) {
        await q(tx, `UPDATE customer_phone_codes SET attempts = attempts + 1 WHERE id = $1`, [
          r.id,
        ]);
        return false;
      }
      await q(tx, `UPDATE customer_phone_codes SET used_at = now() WHERE id = $1`, [r.id]);
      return true;
    });
    if (!ok) throw new UnauthorizedException('Código inválido ou vencido. Peça um novo.');
  }

  async signup(
    tenantId: string,
    input: {
      name: string;
      phone: string;
      email?: string;
      password: string;
      marketingOptIn?: boolean;
      /** CPF (só números, já conferido): vai na nota do pedido da mesa. */
      cpf?: string;
      /** Código que chegou no WhatsApp (obrigatório quando a loja manda código). */
      code?: string;
    },
    meta: { ip?: string; userAgent?: string },
  ) {
    const phone = normalizePhone(input.phone);
    if (!phoneOk(phone)) throw new ConflictException('Telefone inválido');
    const confirm = await this.db.withTenant({ tenantId }, (tx) => this.messaging.canSendCode(tx));
    if (confirm) {
      if (!input.code)
        throw new UnprocessableEntityException({
          message: 'Confirme o celular com o código que chega no WhatsApp',
          code: PHONE_CODE_REQUIRED,
        });
      await this.checkSignupCode(tenantId, phone, input.code);
    }
    const hash = await hashPassword(input.password);
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await one<{ enabled: boolean }>(
        tx,
        `SELECT accounts_enabled AS enabled FROM tenant_store_settings`,
      );
      if (s && !s.enabled) throw new ForbiddenException('Este restaurante não usa contas');
      const dup = await one<{ neverIn: boolean }>(
        tx,
        `SELECT last_login_at IS NULL AS "neverIn" FROM customers WHERE phone = $1`,
        [phone],
      );
      // Cadastro feito pela equipe no pedido: o cliente ainda não tem senha.
      if (dup?.neverIn)
        throw new ConflictException(
          'Este telefone já está cadastrado na loja. Toque em "Esqueci minha senha" para criar a sua.',
        );
      if (dup) throw new ConflictException('Já existe uma conta com este telefone. Entre com ela.');
      if (input.email) {
        const e = await one(tx, `SELECT 1 FROM customers WHERE lower(email) = lower($1)`, [
          input.email,
        ]);
        if (e) throw new ConflictException('Este e-mail já está em outra conta');
      }
      const c = await one<Customer>(
        tx,
        `INSERT INTO customers (tenant_id, name, phone, email, password_hash, marketing_opt_in, last_login_at,
                                phone_verified_at, document)
         VALUES ($1,$2,$3,$4,$5,$6, now(), CASE WHEN $7::boolean THEN now() END, $8) RETURNING ${CUSTOMER_COLS}`,
        [
          tenantId,
          input.name,
          phone,
          input.email ?? null,
          hash,
          input.marketingOptIn ?? false,
          confirm,
          input.cpf ?? null,
        ],
      );
      await this.audit.record(tx, {
        tenantId,
        action: 'customer.signup',
        entity: 'customer',
        entityId: c!.id,
        data: { phoneVerified: confirm },
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

  /**
   * Link de entrada no cardápio mandado pelo WhatsApp da loja (0.280) para o próprio número da
   * conta: quem recebe é o dono do número (a mesma prova do código do WhatsApp). Uso único, vale 30
   * minutos, só o hash fica gravado e no máximo 6 por hora por conta.
   */
  async createLoginLink(tenantId: string, customerId: string): Promise<string | null> {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const recent = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM customer_login_links
          WHERE customer_id = $1 AND created_at > now() - interval '1 hour'`,
        [customerId],
      );
      if ((recent?.n ?? 0) >= 6) return null;
      const ok = await one(tx, `SELECT 1 FROM customers WHERE id = $1 AND blocked_at IS NULL`, [
        customerId,
      ]);
      if (!ok) return null;
      const token = randomBytes(24).toString('base64url');
      await q(
        tx,
        `INSERT INTO customer_login_links (tenant_id, customer_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 minutes')`,
        [tenantId, customerId, hashToken(`link:${tenantId}:${token}`)],
      );
      return token;
    });
  }

  /** Entra na conta pelo link do WhatsApp (gasta o link). */
  async loginByLink(tenantId: string, token: string, meta: { ip?: string; userAgent?: string }) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const link = await one<{ customerId: string }>(
        tx,
        `UPDATE customer_login_links SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING customer_id AS "customerId"`,
        [hashToken(`link:${tenantId}:${token}`)],
      );
      if (!link)
        throw new UnauthorizedException(
          'Este link já foi usado ou venceu. Peça outro no WhatsApp.',
        );
      const customer = await one<Customer & { blocked: boolean }>(
        tx,
        `SELECT ${CUSTOMER_COLS}, blocked_at IS NOT NULL AS blocked FROM customers WHERE id = $1`,
        [link.customerId],
      );
      if (!customer) throw new UnauthorizedException('Conta não encontrada');
      if (customer.blocked)
        throw new ForbiddenException('Esta conta está bloqueada. Fale com o restaurante.');
      await q(tx, `UPDATE customers SET last_login_at = now() WHERE id = $1`, [customer.id]);
      await this.audit.record(tx, {
        tenantId,
        action: 'customer.login',
        entity: 'customer',
        entityId: customer.id,
        data: { via: 'whatsapp_link' },
        ip: meta.ip,
      });
      const session = await this.newSession(tx, tenantId, customer.id, meta.userAgent);
      const { blocked: _b, ...c } = customer;
      return { customer: c as Customer, session };
    });
  }

  /**
   * Confere a senha de quem já está dentro da conta (antes de apagar a conta). Senha errada conta
   * no mesmo bloqueio do login.
   */
  async confirmPassword(tenantId: string, c: Customer, password: string, ip?: string) {
    const phone = c.phone;
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
      one<{ password_hash: string }>(tx, `SELECT password_hash FROM customers WHERE id = $1`, [
        c.id,
      ]),
    );
    if (await verifyPassword(password, row?.password_hash ?? DUMMY_HASH)) return;
    await this.db.withTenant({ tenantId }, (tx) =>
      this.audit.record(tx, {
        tenantId,
        action: 'customer.login_failed',
        entity: 'customer',
        data: { phone },
        ip,
      }),
    );
    throw new UnprocessableEntityException('Senha incorreta');
  }

  /** Cliente dono do cookie, ou null (sem conta, sessão vencida ou conta bloqueada). */
  async resolve(tenantId: string, token: string | undefined): Promise<Customer | null> {
    if (!token || token.length > 100) return null;
    return this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<Customer & { sid: string; seen: Date }>(
        tx,
        `SELECT ${customerCols('c.')}, s.id AS sid, s.last_seen_at AS seen
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

  /** Sacola guardada na conta (o aparelho junta com a dele ao entrar). */
  cart(tenantId: string, c: Customer) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<{ lines: unknown[]; updatedAt: Date | null }>(
        tx,
        `SELECT online_cart AS lines, online_cart_at AS "updatedAt" FROM customers WHERE id = $1`,
        [c.id],
      );
      return { lines: r?.lines ?? [], updatedAt: r?.updatedAt ?? null };
    });
  }

  /** Grava a sacola da conta como o aparelho mandou (vazia limpa). */
  saveCart(tenantId: string, c: Customer, lines: unknown[]) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<{ updatedAt: Date }>(
        tx,
        `UPDATE customers SET online_cart = $2::jsonb, online_cart_at = now()
          WHERE id = $1 RETURNING online_cart_at AS "updatedAt"`,
        [c.id, JSON.stringify(lines)],
      );
      return { lines, updatedAt: r?.updatedAt ?? null };
    });
  }

  updateProfile(
    tenantId: string,
    c: Customer,
    p: {
      name?: string;
      email?: string | null;
      marketingOptIn?: boolean;
      avatar?: string | null;
      cpf?: string | null;
      birthday?: BirthdayInput;
      birthdayOptOut?: boolean;
    },
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
                marketing_opt_in = COALESCE($5, marketing_opt_in),
                -- Escolher um avatar troca a foto por ele.
                avatar = CASE WHEN $6::boolean THEN $7 ELSE avatar END,
                photo = CASE WHEN $6::boolean THEN NULL ELSE photo END,
                photo_type = CASE WHEN $6::boolean THEN NULL ELSE photo_type END,
                photo_at = CASE WHEN $6::boolean THEN NULL ELSE photo_at END,
                document = CASE WHEN $8::boolean THEN $9 ELSE document END,
                birth_day = CASE WHEN $10::boolean THEN $11 ELSE birth_day END,
                birth_month = CASE WHEN $10::boolean THEN $12 ELSE birth_month END,
                birth_year = CASE WHEN $10::boolean THEN $13 ELSE birth_year END,
                birthday_opt_out = COALESCE($14, birthday_opt_out)
          WHERE id = $1 RETURNING ${CUSTOMER_COLS}`,
        [
          c.id,
          p.name ?? null,
          p.email !== undefined,
          p.email ?? null,
          p.marketingOptIn ?? null,
          p.avatar !== undefined,
          p.avatar ?? null,
          p.cpf !== undefined,
          p.cpf ?? null,
          p.birthday !== undefined,
          p.birthday?.day ?? null,
          p.birthday?.month ?? null,
          p.birthday?.year ?? null,
          p.birthdayOptOut ?? null,
        ],
      );
    });
  }

  /** Guarda a foto do perfil (já conferida: tipo, tamanho e assinatura). */
  setPhoto(tenantId: string, c: Customer, photo: { mime: string; bytes: Buffer } | null) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const next = await one<Customer>(
        tx,
        `UPDATE customers SET photo = $2, photo_type = $3,
                photo_at = CASE WHEN $2::bytea IS NULL THEN NULL ELSE clock_timestamp() END
          WHERE id = $1 RETURNING ${CUSTOMER_COLS}`,
        [c.id, photo?.bytes ?? null, photo?.mime ?? null],
      );
      return next!;
    });
  }

  /** Bytes da foto (do próprio cliente ou, pela equipe, de qualquer cliente do restaurante). */
  photo(scope: { tenantId: string; userId?: string | null }, id: string) {
    return this.db.withTenant(scope, async (tx) => {
      const r = await one<{ type: string; bytes: Buffer }>(
        tx,
        `SELECT photo_type AS type, photo AS bytes FROM customers WHERE id = $1 AND photo IS NOT NULL`,
        [id],
      );
      if (!r) throw new NotFoundException('Sem foto');
      return r;
    });
  }

  async changePassword(tenantId: string, c: Customer, next: string, keepToken?: string) {
    // Quem já está dentro da conta não precisa digitar a senha atual.
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
    channel: 'whatsapp' | 'email' | 'staff',
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
   * Pede o código pelo WhatsApp da loja e/ou pelo e-mail da conta (envio do Comandou, para a loja sem
   * WhatsApp conectado). Manda um código, nunca uma senha nova: quem digita o celular de outra
   * pessoa não troca a senha dela. A resposta é a mesma exista a conta ou não (ninguém descobre
   * quem tem conta): diz só por onde a loja manda o código ou se é preciso falar com o restaurante.
   */
  async requestReset(tenantId: string, tenantName: string, phoneRaw: string, ip?: string) {
    const phone = normalizePhone(phoneRaw);
    const emailReady = await this.mail.ready();
    const r = await this.db.withTenant({ tenantId }, async (tx) => {
      const canSend = await this.messaging.canSendCode(tx);
      if ((!canSend && !emailReady) || !phoneOk(phone)) return { canSend, code: null };
      const c = await one<{
        id: string;
        name: string;
        email: string | null;
        recent: number;
        blocked: boolean;
      }>(
        tx,
        `SELECT c.id, c.name, c.email::text AS email, c.blocked_at IS NOT NULL AS blocked,
                (SELECT count(*)::int FROM customer_password_resets r
                  WHERE r.customer_id = c.id AND r.created_at > now() - interval '1 hour') AS recent
           FROM customers c WHERE c.phone = $1`,
        [phone],
      );
      if (!c || c.blocked) return { canSend, code: null };
      // Sem WhatsApp e sem e-mail na conta: não há por onde mandar.
      const email = emailReady ? c.email : null;
      if (!canSend && !email) return { canSend, code: null };
      if (c.recent >= RESET_PER_HOUR)
        throw new ThrottlerException(
          'Você já pediu vários códigos. Use o último que chegou ou aguarde uma hora.',
        );
      const code = await this.newResetCode(tx, tenantId, c.id, canSend ? 'whatsapp' : 'email');
      await this.audit.record(tx, {
        tenantId,
        action: 'customer.password_reset_requested',
        entity: 'customer',
        entityId: c.id,
        ip,
      });
      return { canSend, code, email, name: c.name };
    });
    if (!r.canSend && !emailReady) return { channel: 'restaurant' as const };
    if (r.code) {
      const [wa, mail] = await Promise.all([
        r.canSend ? this.messaging.sendCode(tenantId, phone, r.code, tenantName) : false,
        r.email
          ? this.mail.send({
              event: 'customer.password_reset',
              tenantId,
              to: r.email,
              toName: r.name,
              fromName: tenantName,
              ...resetEmail({
                restaurant: tenantName,
                customerName: r.name,
                code: r.code,
                minutes: RESET_TTL_MIN,
                assets: siteUrlOf(this.env),
              }),
            })
          : false,
      ]);
      if (!wa && !mail)
        throw new ServiceUnavailableException(
          'Não conseguimos mandar o código agora. Tente de novo ou fale com o restaurante.',
        );
    }
    return { channel: r.canSend ? ('whatsapp' as const) : ('email' as const) };
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
      const r = await one<{
        id: string;
        customer_id: string;
        code_hash: Buffer;
        attempts: number;
        channel: string;
      }>(
        tx,
        `SELECT r.id, r.customer_id, r.code_hash, r.attempts, r.channel
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
      // Código que chegou no WhatsApp do número: o telefone é de quem está aqui.
      if (r.channel === 'whatsapp')
        await q(
          tx,
          `UPDATE customers SET phone_verified_at = coalesce(phone_verified_at, now()) WHERE id = $1`,
          [r.customer_id],
        );
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
        served: boolean;
        items: { name: string; quantity: number; unit: string; imageUrl: string | null }[];
      }>(
        tx,
        `SELECT o.id, o.number, o.status, o.channel, o.total::text, o.created_at AS "createdAt",
                o.served_at IS NOT NULL AS served,
                COALESCE((SELECT json_agg(json_build_object('name', i.name, 'quantity', i.quantity::float8, 'unit', i.unit,
                                   'imageUrl', (SELECT '/api/v1/media/' || p.image_id FROM products p WHERE p.id = i.product_id))
                                   ORDER BY i.created_at)
                            FROM order_items i WHERE i.order_id = o.id), '[]') AS items
           FROM orders o WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
        [c.id],
      );
      return rows.map(({ status, served, ...r }) => ({ ...r, step: customerStep(status, served) }));
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
  list(ctx: Ctx, search: string, limit = 300) {
    return this.db.withTenant(ctx, async (tx) => {
      const s = search.trim();
      const digits = s.replace(/\D/g, '');
      const customers = await q(
        tx,
        `SELECT c.id, c.name, c.phone, c.email, c.marketing_opt_in AS "marketingOptIn",
                c.avatar, ${photoUrlSql('c.', staffPhoto('c.'))} AS "photoUrl",
                c.blocked_at IS NOT NULL AS blocked, c.created_at AS "createdAt",
                c.last_login_at AS "lastLoginAt", c.document,
                c.birth_day AS "birthDay", c.birth_month AS "birthMonth",
                COALESCE(st.orders, 0) AS orders, COALESCE(st.spent, '0.00') AS spent,
                st.last_order_at AS "lastOrderAt", fav.name AS "topItem"
           FROM customers c
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE o.status <> 'cancelled')::int AS orders,
                    COALESCE(sum(o.total) FILTER (WHERE o.status <> 'cancelled'), 0)::text AS spent,
                    max(o.created_at) AS last_order_at
               FROM orders o WHERE o.customer_id = c.id) st ON true
           LEFT JOIN LATERAL (
             SELECT i.name FROM order_items i JOIN orders o ON o.id = i.order_id
              WHERE o.customer_id = c.id AND o.status <> 'cancelled' AND i.status <> 'cancelled'
              GROUP BY i.name
              ORDER BY sum(CASE WHEN i.unit = 'kg' THEN 1 ELSE i.quantity END) DESC, i.name
              LIMIT 1) fav ON true
          WHERE $1 = '' OR c.name ILIKE $2 OR c.email ILIKE $2 OR ($3 <> '' AND (c.phone LIKE $4 OR c.document LIKE $4))
          ORDER BY COALESCE(st.last_order_at, c.created_at) DESC
          LIMIT $5`,
        [s, likeOf(s), digits, `%${digits}%`, limit],
      );
      const summary = await one(
        tx,
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS "new30",
                count(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM orders o WHERE o.customer_id = customers.id
                     AND o.created_at > now() - interval '30 days'))::int AS "active30",
                (SELECT COALESCE(sum(total), 0)::text FROM orders
                  WHERE customer_id IS NOT NULL AND status <> 'cancelled') AS spent,
                (SELECT COALESCE(avg(total), 0)::numeric(14,2)::text FROM orders
                  WHERE customer_id IS NOT NULL AND status <> 'cancelled') AS "avgTicket"
           FROM customers`,
      );
      return { summary, customers };
    });
  }

  /**
   * Cliente cadastrado pela equipe no pedido (nome e telefone). A senha é aleatória e ninguém a
   * conhece: para usar o cardápio online, o cliente cria a dele em "Esqueci minha senha", que
   * confirma o telefone. Telefone já cadastrado devolve o cliente que existe.
   */
  async staffCreate(ctx: Ctx, input: { name: string; phone: string }) {
    const phone = normalizePhone(input.phone);
    if (!phoneOk(phone)) throw new UnprocessableEntityException('Telefone inválido (DDD + número)');
    const hash = await hashPassword(randomBytes(32).toString('base64url'));
    return this.db.withTenant(ctx, async (tx) => {
      const created = await one<Customer>(
        tx,
        // A equipe cadastrou com o cliente na frente: o telefone vale como confirmado.
        `INSERT INTO customers (tenant_id, name, phone, password_hash, phone_verified_at)
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (tenant_id, phone) DO NOTHING RETURNING ${CUSTOMER_COLS}`,
        [ctx.tenantId, input.name, phone, hash],
      );
      if (created) {
        await this.audit.record(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: 'customer.created',
          entity: 'customer',
          entityId: created.id,
          ip: ctx.ip,
        });
        return { ...created, existing: false };
      }
      const found = await one<Customer & { blocked: boolean }>(
        tx,
        `SELECT ${CUSTOMER_COLS}, blocked_at IS NOT NULL AS blocked FROM customers WHERE phone = $1`,
        [phone],
      );
      if (!found) throw new ConflictException('Tente de novo');
      const { blocked, ...existing } = found;
      if (blocked) throw new ConflictException('Este telefone é de um cliente bloqueado');
      return { ...existing, existing: true };
    });
  }

  detail(ctx: Ctx, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const c = await one(
        tx,
        `SELECT id, name, phone, email, marketing_opt_in AS "marketingOptIn", created_at AS "createdAt",
                avatar, ${photoUrlSql('', staffPhoto(''))} AS "photoUrl",
                staff_notes AS "staffNotes", blocked_at IS NOT NULL AS blocked,
                last_login_at AS "lastLoginAt", document, state_registration AS "stateRegistration",
                ie_indicator AS "ieIndicator", ${BIRTHDAY_COLS()}
           FROM customers WHERE id = $1`,
        [id],
      );
      if (!c) throw new NotFoundException('Cliente não encontrado');
      const greetings = await q(
        tx,
        `SELECT id, year, status, last_error AS "lastError", gift_kind AS "giftKind",
                gift_points AS "giftPoints", gift_text AS "giftText", gift_until::text AS "giftUntil",
                sent_at AS "sentAt", created_at AS "createdAt"
           FROM birthday_greetings WHERE customer_id = $1 ORDER BY year DESC LIMIT 5`,
        [id],
      );
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
                min(created_at) FILTER (WHERE status <> 'cancelled') AS "firstOrderAt",
                max(created_at) FILTER (WHERE status <> 'cancelled') AS "lastOrderAt"
           FROM orders WHERE customer_id = $1`,
        [id],
      );
      const favorites = await q(
        tx,
        `SELECT i.name, sum(CASE WHEN i.unit = 'kg' THEN 1 ELSE i.quantity END)::int AS quantity,
                sum(i.total)::text AS spent, count(DISTINCT o.id)::int AS orders,
                max(cat.name) AS category, max(o.created_at) AS "lastAt"
           FROM order_items i JOIN orders o ON o.id = i.order_id
           LEFT JOIN products p ON p.id = i.product_id
           LEFT JOIN categories cat ON cat.id = p.category_id
          WHERE o.customer_id = $1 AND o.status <> 'cancelled' AND i.status <> 'cancelled'
          GROUP BY i.name ORDER BY 2 DESC, 1 LIMIT 8`,
        [id],
      );
      const insights = await this.insights(tx, id);
      return { ...c, addresses, orders, stats, favorites, insights, greetings };
    });
  }

  /**
   * Leituras do perfil (gráficos da ficha): categorias, pedidos por mês (12 meses), canais, dia da
   * semana, hora e forma de pagamento. Pedidos cancelados ficam de fora; mês, dia e hora no fuso do
   * restaurante.
   */
  private async insights(tx: Parameters<typeof q>[0], id: string) {
    const tz = `COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()), 'America/Sao_Paulo')`;
    const ok = `customer_id = $1 AND status <> 'cancelled'`;
    const [categories, months, channels, weekdays, hours, payments] = await Promise.all([
      q(
        tx,
        `SELECT COALESCE(cat.name, 'Sem categoria') AS name,
                sum(CASE WHEN i.unit = 'kg' THEN 1 ELSE i.quantity END)::int AS quantity,
                sum(i.total)::text AS spent
           FROM order_items i JOIN orders o ON o.id = i.order_id
           LEFT JOIN products p ON p.id = i.product_id
           LEFT JOIN categories cat ON cat.id = p.category_id
          WHERE o.customer_id = $1 AND o.status <> 'cancelled' AND i.status <> 'cancelled'
          GROUP BY 1 ORDER BY sum(i.total) DESC, 1 LIMIT 8`,
        [id],
      ),
      q(
        tx,
        `WITH m AS (
           SELECT generate_series(date_trunc('month', now() AT TIME ZONE ${tz}) - interval '11 months',
                                  date_trunc('month', now() AT TIME ZONE ${tz}), interval '1 month') AS month)
         SELECT to_char(m.month, 'YYYY-MM') AS month, count(o.id)::int AS orders,
                COALESCE(sum(o.total), 0)::text AS spent
           FROM m LEFT JOIN orders o
             ON o.customer_id = $1 AND o.status <> 'cancelled'
            AND date_trunc('month', o.created_at AT TIME ZONE ${tz}) = m.month
          GROUP BY m.month ORDER BY m.month`,
        [id],
      ),
      q(
        tx,
        `SELECT channel, count(*)::int AS orders, sum(total)::text AS spent
           FROM orders WHERE ${ok} GROUP BY channel ORDER BY 2 DESC`,
        [id],
      ),
      q(
        tx,
        `SELECT extract(dow FROM created_at AT TIME ZONE ${tz})::int AS day, count(*)::int AS orders
           FROM orders WHERE ${ok} GROUP BY 1 ORDER BY 1`,
        [id],
      ),
      q(
        tx,
        `SELECT extract(hour FROM created_at AT TIME ZONE ${tz})::int AS hour, count(*)::int AS orders
           FROM orders WHERE ${ok} GROUP BY 1 ORDER BY 1`,
        [id],
      ),
      q(
        tx,
        `SELECT p.method, sum(p.amount - p.refunded_amount)::text AS amount, count(*)::int AS count
           FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE o.customer_id = $1 AND o.status <> 'cancelled'
          GROUP BY 1 HAVING sum(p.amount - p.refunded_amount) > 0 ORDER BY sum(p.amount - p.refunded_amount) DESC`,
        [id],
      ),
    ]);
    return { categories, months, channels, weekdays, hours, payments };
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
      birthday?: BirthdayInput;
      birthdayOptOut?: boolean;
    },
  ) {
    await this.db.withTenant(ctx, async (tx) => {
      // Aniversário (a equipe preenche na ficha quando o cliente conta).
      if (p.birthday !== undefined || p.birthdayOptOut !== undefined)
        await q(
          tx,
          `UPDATE customers SET
             birth_day = CASE WHEN $2::boolean THEN $3 ELSE birth_day END,
             birth_month = CASE WHEN $2::boolean THEN $4 ELSE birth_month END,
             birth_year = CASE WHEN $2::boolean THEN $5 ELSE birth_year END,
             birthday_opt_out = COALESCE($6, birthday_opt_out)
           WHERE id = $1`,
          [
            id,
            p.birthday !== undefined,
            p.birthday?.day ?? null,
            p.birthday?.month ?? null,
            p.birthday?.year ?? null,
            p.birthdayOptOut ?? null,
          ],
        );
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
          birthday: p.birthday !== undefined || p.birthdayOptOut !== undefined,
        },
        ip: ctx.ip,
      });
    });
    return this.detail(ctx, id);
  }
}
