import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { validateTenantSlug } from '@comandou/shared';
import { hashToken } from '../../auth/session.service';
import { extractPage } from '../../chat/store-import';
import { safeFetch, SafeFetchError } from '../../common/safe-fetch';
import { open, seal } from '../../common/secret-box';
import { ENV, Env } from '../../config/env';
import { tenantDatabaseName } from '../../database/tenant-database';
import { provisionTenant } from '../../provisioning/provision';
import type { PlatformAdmin } from '../platform-auth';
import { PlatformDatabasesService } from '../platform-databases.service';
import { PlatformDb, platformAudit } from '../platform-db.service';
import { type Actor, PlatformService } from '../platform.service';
import { saveProfile } from '../tenant-profile';
import type { SiteSettingsInput, TrialInput } from './site.schemas';
import { mapsPlaceName } from '../../common/maps-link';
import { trialSlug } from './site-util';
import { welcomeEmail } from './welcome-email';

const SECRET_CONTEXT = 'site:trial';
/** O link que abre o restaurante novo já logado vale este tempo depois do cadastro. */
const ENTRY_MINUTES = 60;

/** Ações automáticas (sem Super Admin logado): a auditoria fica sem administrador. */
const SYSTEM: Actor = { admin: { id: null } as unknown as PlatformAdmin };

interface SettingsRow {
  signup_enabled: boolean;
  trial_days: number;
  daily_limit: number;
  email_webhook_url: string;
  email_token_enc: Buffer | null;
}

interface PendingRow {
  id: string;
  tenant_id: string;
  email: string;
  contact_name: string;
  trial_ends_at: Date;
  pending_enc: Buffer;
  slug: string;
  name: string;
}

/** Senha inicial fácil de digitar: três grupos de quatro, sem letras e números que confundem. */
export function trialPassword(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const group = () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

/**
 * Site público (comandou.com): o visitante cria o próprio restaurante de teste informando o site
 * atual, o link do Google Maps ou descrevendo os itens. O restaurante nasce como qualquer outro
 * (mesmo caminho do painel), com teste de poucos dias, e os primeiros passos começam pelo
 * cardápio informado. O login vai por e-mail (webhook do n8n) e aparece na tela. Teste vencido
 * sem fechar: o restaurante é suspenso (nada é apagado) e volta pelo painel.
 */
@Injectable()
export class SiteService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Site');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly databases: PlatformDatabasesService,
    private readonly platform: PlatformService,
  ) {}

  onApplicationBootstrap() {
    if (!this.db.enabled) return;
    // E-mails de boas-vindas pendentes (restaurante acabou de ficar pronto) e testes vencidos.
    const mail = setInterval(() => void this.deliverPending().catch(() => undefined), 20_000);
    const sweep = setInterval(() => void this.sweepSafely(), 15 * 60_000);
    const first = setTimeout(() => void this.sweepSafely(), 90_000);
    for (const t of [mail, sweep, first]) t.unref();
    this.timers = [mail, sweep, first];
  }

  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
  }

  private async settingsRow(): Promise<SettingsRow> {
    const [s] = await this.db.query<SettingsRow>(
      `SELECT signup_enabled, trial_days, daily_limit, email_webhook_url, email_token_enc
         FROM platform_site_settings WHERE id`,
    );
    return s!;
  }

  private tenantUrl(slug: string) {
    const port = this.env.SITE_CHECK_PORT ? `:${this.env.SITE_CHECK_PORT}` : '';
    return `${this.env.COOKIE_SECURE ? 'https' : 'http'}://${slug}.${this.env.COMANDOU_BASE_DOMAIN}${port}`;
  }

  private siteUrl() {
    const port = this.env.SITE_CHECK_PORT ? `:${this.env.SITE_CHECK_PORT}` : '';
    return `${this.env.COOKIE_SECURE ? 'https' : 'http'}://${this.env.COMANDOU_BASE_DOMAIN}${port}`;
  }

  // ------------------------------------------------------------------ público
  /** O que a página precisa saber antes de mostrar o formulário. */
  async config() {
    if (!this.db.enabled) return { signup: false, trialDays: 3, demoUrl: null, salesContact: '' };
    const s = await this.settingsRow();
    const [demo] = await this.db.query<{ slug: string }>(
      `SELECT slug FROM tenants WHERE slug = $1 AND status = 'provisioned'`,
      [(process.env.COMANDOU_DEMO_SLUG ?? '').trim().toLowerCase() || 'fumaca'],
    );
    const [b] = await this.db.query<{ sales_contact: string }>(
      `SELECT sales_contact FROM platform_billing_settings WHERE id`,
    );
    return {
      signup: s.signup_enabled,
      trialDays: s.trial_days,
      demoUrl: demo ? `${this.tenantUrl(demo.slug)}/pedir` : null,
      salesContact: b?.sales_contact ?? '',
    };
  }

  /**
   * Prévia do site do restaurante (sem IA): nome, ícone, cor e foto de capa, para a pessoa ver
   * que achamos o lugar certo antes de criar. Link do Google Maps: só o nome que vem no link.
   */
  async preview(raw: string) {
    const place = mapsPlaceName(raw);
    if (place !== undefined) return { kind: 'maps' as const, name: place, host: 'Google Maps' };
    let page;
    try {
      page = await safeFetch(raw, { maxBytes: 1024 * 1024, truncate: true, timeoutMs: 8000 });
    } catch (e) {
      throw new UnprocessableEntityException(
        e instanceof SafeFetchError ? e.message : 'Não consegui abrir esse link',
      );
    }
    if (page.status >= 400 || !page.contentType.includes('html'))
      throw new UnprocessableEntityException('Não consegui abrir esse link');
    const info = extractPage(page.body.toString('utf8'), page.url);
    const clean = (s: string | null) =>
      s
        ?.split(/\s[|–—-]\s/)[0]
        ?.trim()
        .slice(0, 80) || null;
    return {
      kind: 'site' as const,
      name: clean(info.siteName) ?? clean(info.title),
      host: new URL(page.url).hostname.replace(/^www\./, ''),
      description: info.description?.slice(0, 180) ?? null,
      icon: info.icons[0] ?? null,
      image: info.ogImage,
      color: info.themeColor ?? info.colors[0] ?? null,
    };
  }

  /** Cria o restaurante de teste. Devolve o login (uma única vez) e o token para acompanhar. */
  async create(b: TrialInput, ip: string | undefined) {
    if (!this.db.enabled) throw new ServiceUnavailableException('Cadastro indisponível agora');
    const s = await this.settingsRow();
    if (!s.signup_enabled)
      throw new ServiceUnavailableException(
        'O cadastro pelo site está fechado no momento. Fale com a gente.',
      );
    const [{ today }] = await this.db.query<{ today: number }>(
      `SELECT count(*)::int AS today FROM trial_signups WHERE created_at > now() - interval '24 hours'`,
    );
    if (today >= s.daily_limit)
      throw new HttpException(
        'Recebemos muitos cadastros hoje. Tente de novo amanhã ou fale com a gente.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const dup = await this.db.query(`SELECT 1 FROM trial_signups WHERE email = $1`, [b.email]);
    if (dup.length)
      throw new ConflictException(
        'Já existe um teste com este e-mail. O login está na sua caixa de entrada.',
      );
    if (this.env.TENANT_DATABASE_MODE !== 'dedicated') {
      const used = await this.db.query(`SELECT 1 FROM users WHERE email = $1`, [b.email]);
      if (used.length) throw new ConflictException('Este e-mail já tem acesso ao Comandou.');
    }

    const slug = await this.freeSlug(b.restaurant);
    const password = trialPassword();
    const statusToken = randomBytes(32).toString('base64url');
    const entryToken = randomBytes(32).toString('base64url');
    const entryHash = hashToken(entryToken);
    const [plan] = await this.db.query<{ code: string }>(
      `SELECT code FROM plans WHERE active ORDER BY is_default DESC, (code = 'comandou') DESC LIMIT 1`,
    );
    const input = {
      slug,
      name: b.restaurant,
      adminEmail: b.email,
      adminName: b.name,
      adminPassword: password,
      planCode: plan?.code,
      profile: { contactName: b.name, phone: b.phone ?? null, billingEmail: b.email },
    };

    let tenantId: string;
    if (this.env.TENANT_DATABASE_MODE === 'dedicated') {
      tenantId = await this.databases.create(input, SYSTEM, {
        entryTokenHash: entryHash.toString('hex'),
      });
    } else {
      try {
        tenantId = (await provisionTenant(this.env.PLATFORM_DATABASE_URL!, input)).tenantId;
      } catch (e) {
        this.logger.warn(`cadastro pelo site falhou: ${(e as Error).message}`);
        throw new UnprocessableEntityException('Não deu para criar o restaurante agora');
      }
      await this.db.tx(async (c) => {
        await saveProfile(c, tenantId, input.profile);
        await c.query(
          `INSERT INTO signup_entry_tokens (tenant_id, user_id, token_hash, expires_at)
           SELECT $1, id, $3, now() + make_interval(mins => $4) FROM users WHERE email = $2`,
          [tenantId, b.email, entryHash, ENTRY_MINUTES],
        );
      });
    }

    const pending = this.env.INTEGRATIONS_KEY
      ? seal(this.env.INTEGRATIONS_KEY, password, SECRET_CONTEXT)
      : null;
    const trialEndsAt = await this.db.tx(async (c) => {
      // Teste do site: os dias vêm de Super Admin › Site (não do plano).
      await c.query(
        `UPDATE subscriptions SET status = 'trialing', trial_ends_at = now() + make_interval(days => $2)
          WHERE tenant_id = $1 AND status <> 'cancelled'`,
        [tenantId, s.trial_days],
      );
      const { rows } = await c.query<{ trial_ends_at: Date }>(
        `INSERT INTO trial_signups (tenant_id, email, contact_name, phone, source_kind, source_value,
                                    status_hash, ip, trial_ends_at, pending_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9), $10)
         RETURNING trial_ends_at`,
        [
          tenantId,
          b.email,
          b.name,
          b.phone ?? null,
          b.source.kind,
          b.source.value,
          hashToken(statusToken),
          ip ?? null,
          s.trial_days,
          pending,
        ],
      );
      await platformAudit(c, {
        action: 'site.trial_created',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: { slug, email: b.email, source: b.source.kind, trialDays: s.trial_days },
        ip,
      });
      return rows[0]!.trial_ends_at;
    });
    // Sem chave para guardar a senha até o restaurante ficar pronto: o e-mail sai já.
    if (!pending) void this.deliverNow(tenantId, password).catch(() => undefined);

    return {
      token: statusToken,
      entry: entryToken,
      slug,
      url: this.tenantUrl(slug),
      email: b.email,
      password,
      trialDays: s.trial_days,
      trialEndsAt,
      emailOn: !!s.email_webhook_url,
    };
  }

  /** Endereço livre a partir do nome do restaurante (fumaca-burger, fumaca-burger-2...). */
  private async freeSlug(name: string): Promise<string> {
    const base = trialSlug(name);
    for (let i = 0; i < 40; i++) {
      const slug = i === 0 ? base : i < 8 ? `${base}-${i + 1}` : `${base}-${randomInt(1000, 9999)}`;
      if (!validateTenantSlug(slug).ok) continue;
      const taken = await this.db.query(
        `SELECT 1 FROM tenants WHERE slug = $1
         UNION ALL SELECT 1 FROM tenant_databases WHERE db_name = $2`,
        [slug, tenantDatabaseName(slug)],
      );
      if (!taken.length) return slug;
    }
    throw new ConflictException('Não achei um endereço livre para esse nome. Tente outro nome.');
  }

  /** A tela do site acompanha a criação por aqui (a cada 2 segundos). */
  async status(token: string) {
    if (!this.db.enabled) throw new NotFoundException();
    const [r] = await this.db.query<{
      slug: string;
      status: string;
      step: string | null;
      email_sent_at: Date | null;
    }>(
      `SELECT t.slug, t.status, s.email_sent_at,
              (SELECT j.step FROM tenant_db_jobs j WHERE j.tenant_id = t.id
                ORDER BY j.created_at DESC LIMIT 1) AS step
         FROM trial_signups s JOIN tenants t ON t.id = s.tenant_id
        WHERE s.status_hash = $1 AND s.created_at > now() - interval '2 hours'`,
      [hashToken(token)],
    );
    if (!r) throw new NotFoundException('Cadastro não encontrado');
    const state =
      r.status === 'provisioned' ? 'ready' : r.status === 'failed' ? 'failed' : 'creating';
    if (state === 'ready' && !r.email_sent_at) void this.deliverPending().catch(() => undefined);
    return { state, step: r.step, url: this.tenantUrl(r.slug), emailSent: !!r.email_sent_at };
  }

  // ------------------------------------------------------------------ e-mail
  /** Restaurantes que ficaram prontos e ainda não receberam o e-mail de boas-vindas. */
  async deliverPending() {
    if (!this.db.enabled || !this.env.INTEGRATIONS_KEY) return;
    // "Pega" a linha apagando a senha guardada: duas réplicas nunca mandam o mesmo e-mail.
    const rows = await this.db.query<PendingRow>(
      `WITH due AS (
         SELECT s.id, s.pending_enc FROM trial_signups s JOIN tenants t ON t.id = s.tenant_id
          WHERE s.pending_enc IS NOT NULL
            AND (t.status = 'provisioned' OR s.created_at < now() - interval '1 hour')
          FOR UPDATE OF s SKIP LOCKED LIMIT 10)
       UPDATE trial_signups s SET pending_enc = NULL
         FROM due, tenants t
        WHERE s.id = due.id AND t.id = s.tenant_id
       RETURNING s.id, s.tenant_id, s.email::text AS email, s.contact_name, s.trial_ends_at,
                 due.pending_enc, t.slug, t.name, t.status`,
    );
    for (const r of rows) {
      // Uma hora sem ficar pronto: a senha guardada some e nenhum e-mail sai.
      if ((r as PendingRow & { status: string }).status !== 'provisioned') continue;
      let password: string;
      try {
        password = open(this.env.INTEGRATIONS_KEY, r.pending_enc, SECRET_CONTEXT);
      } catch {
        continue;
      }
      await this.send(r, password);
    }
  }

  private async deliverNow(tenantId: string, password: string) {
    const [r] = await this.db.query<PendingRow>(
      `SELECT s.id, s.tenant_id, s.email::text AS email, s.contact_name, s.trial_ends_at, t.slug, t.name
         FROM trial_signups s JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1`,
      [tenantId],
    );
    if (r) await this.send(r, password);
  }

  private async send(r: Omit<PendingRow, 'pending_enc'>, password: string) {
    const s = await this.settingsRow();
    if (!s.email_webhook_url) {
      await this.db.query(`UPDATE trial_signups SET email_error = $2 WHERE id = $1`, [
        r.id,
        'Webhook de e-mail não configurado',
      ]);
      return;
    }
    const [b] = await this.db.query<{ sales_contact: string }>(
      `SELECT sales_contact FROM platform_billing_settings WHERE id`,
    );
    const [sub] = await this.db.query<{ trial_days: number }>(
      `SELECT GREATEST(1, round(extract(epoch FROM (trial_ends_at - created_at)) / 86400))::int AS trial_days
         FROM trial_signups WHERE id = $1`,
      [r.id],
    );
    const url = this.tenantUrl(r.slug);
    const mail = welcomeEmail({
      restaurant: r.name,
      contactName: r.contact_name,
      url,
      loginEmail: r.email,
      password,
      trialDays: sub?.trial_days ?? s.trial_days,
      trialEndsAt: r.trial_ends_at,
      siteUrl: this.siteUrl(),
      salesContact: b?.sales_contact,
    });
    const error = await this.postWebhook(s, {
      event: 'trial.welcome',
      to: r.email,
      toName: r.contact_name,
      ...mail,
      restaurant: r.name,
      url,
      loginEmail: r.email,
      password,
      trialEndsAt: r.trial_ends_at.toISOString(),
    });
    await this.db.query(
      `UPDATE trial_signups SET email_sent_at = CASE WHEN $2::text IS NULL THEN now() END,
              email_error = $2 WHERE id = $1`,
      [r.id, error],
    );
    if (error) this.logger.warn(`e-mail de boas-vindas (${r.slug}) falhou: ${error}`);
  }

  /** Chama o webhook do n8n. Devolve o erro (ou null se saiu). Nunca registra a senha. */
  private async postWebhook(s: SettingsRow, body: Record<string, unknown>): Promise<string | null> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (s.email_token_enc && this.env.INTEGRATIONS_KEY) {
      try {
        headers['X-Comandou-Token'] = open(
          this.env.INTEGRATIONS_KEY,
          s.email_token_enc,
          SECRET_CONTEXT,
        );
      } catch {
        return 'O segredo do webhook precisa ser salvo de novo';
      }
    }
    try {
      const res = await fetch(s.email_webhook_url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      await res.body?.cancel().catch(() => undefined);
      return res.ok ? null : `O webhook respondeu ${res.status}`;
    } catch (e) {
      return `Não deu para chamar o webhook: ${(e as Error).message}`.slice(0, 300);
    }
  }

  // ------------------------------------------------------------------ teste vencido
  private async sweepSafely() {
    try {
      const n = await this.expireTrials();
      if (n) this.logger.log(`${n} teste(s) do site vencido(s): restaurante(s) suspenso(s)`);
    } catch (e) {
      this.logger.warn(`conferência dos testes do site falhou: ${(e as Error).message}`);
    }
  }

  /**
   * Teste do site vencido e ainda "em teste" (ninguém fechou nem estendeu no painel): suspende o
   * restaurante. Nada é apagado; reativar é pelo painel, que também pode estender o teste antes.
   */
  async expireTrials(): Promise<number> {
    const due = await this.db.query<{ id: string; tenant_id: string }>(
      `SELECT ts.id, ts.tenant_id
         FROM trial_signups ts
         JOIN tenants t ON t.id = ts.tenant_id
         LEFT JOIN subscriptions s ON s.tenant_id = ts.tenant_id AND s.status <> 'cancelled'
        WHERE ts.expired_at IS NULL AND t.status = 'provisioned'
          AND ((s.id IS NULL AND ts.trial_ends_at < now())
            OR (s.status = 'trialing' AND COALESCE(s.trial_ends_at, ts.trial_ends_at) < now()))
        LIMIT 50`,
    );
    let n = 0;
    for (const d of due) {
      const claimed = await this.db.query(
        `UPDATE trial_signups SET expired_at = now() WHERE id = $1 AND expired_at IS NULL RETURNING id`,
        [d.id],
      );
      if (!claimed.length) continue;
      try {
        await this.platform.setStatus(
          d.tenant_id,
          { status: 'suspended', reason: 'Teste grátis pelo site terminou sem contratação' },
          SYSTEM,
        );
        n++;
      } catch (e) {
        this.logger.warn(`não suspendeu o teste ${d.tenant_id}: ${(e as Error).message}`);
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ painel
  async settings() {
    const s = await this.settingsRow();
    return {
      signupEnabled: s.signup_enabled,
      trialDays: s.trial_days,
      dailyLimit: s.daily_limit,
      emailWebhookUrl: s.email_webhook_url,
      emailTokenSet: !!s.email_token_enc,
      siteUrl: this.siteUrl(),
    };
  }

  async saveSettings(b: SiteSettingsInput, a: Actor) {
    if (b.emailToken && !this.env.INTEGRATIONS_KEY)
      throw new UnprocessableEntityException('Defina a INTEGRATIONS_KEY para guardar o segredo');
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_site_settings
            SET signup_enabled = $1, trial_days = $2, daily_limit = $3, email_webhook_url = $4,
                email_token_enc = CASE WHEN $5::boolean THEN NULL
                                       WHEN $6::bytea IS NOT NULL THEN $6 ELSE email_token_enc END,
                updated_at = now()
          WHERE id`,
        [
          b.signupEnabled,
          b.trialDays,
          b.dailyLimit,
          b.emailWebhookUrl,
          b.emailToken === '',
          b.emailToken ? seal(this.env.INTEGRATIONS_KEY!, b.emailToken, SECRET_CONTEXT) : null,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'site.settings_saved',
        entity: 'site',
        data: {
          signupEnabled: b.signupEnabled,
          trialDays: b.trialDays,
          dailyLimit: b.dailyLimit,
          webhook: !!b.emailWebhookUrl,
        },
        ip: a.ip,
      });
    });
    return this.settings();
  }

  /** E-mail de exemplo pelo webhook, para conferir o n8n antes de abrir o cadastro. */
  async testEmail(to: string) {
    const s = await this.settingsRow();
    if (!s.email_webhook_url)
      throw new UnprocessableEntityException('Salve o endereço do webhook antes de testar');
    const url = this.tenantUrl('seu-restaurante');
    const mail = welcomeEmail({
      restaurant: 'Seu Restaurante',
      contactName: 'Teste',
      url,
      loginEmail: to,
      password: 'abcd-efgh-2345',
      trialDays: s.trial_days,
      trialEndsAt: new Date(Date.now() + s.trial_days * 86_400_000),
      siteUrl: this.siteUrl(),
    });
    const error = await this.postWebhook(s, {
      event: 'trial.test',
      to,
      toName: 'Teste',
      ...mail,
      restaurant: 'Seu Restaurante',
      url,
      loginEmail: to,
      password: 'abcd-efgh-2345',
      trialEndsAt: new Date(Date.now() + s.trial_days * 86_400_000).toISOString(),
    });
    if (error) throw new UnprocessableEntityException(error);
    return { ok: true };
  }

  /** Prévia do e-mail (HTML) para o painel mostrar. */
  async emailPreview() {
    const s = await this.settingsRow();
    return welcomeEmail({
      restaurant: 'Fumaça Burger',
      contactName: 'Marina Souza',
      url: this.tenantUrl('fumaca-burger'),
      loginEmail: 'marina@fumacaburger.com.br',
      password: 'k7mf-2xqp-9dhw',
      trialDays: s.trial_days,
      trialEndsAt: new Date(Date.now() + s.trial_days * 86_400_000),
      siteUrl: this.siteUrl(),
    }).html;
  }

  /** Testes criados pelo site, do mais novo para o mais antigo. */
  trials() {
    return this.db.query(
      `SELECT ts.id, ts.tenant_id AS "tenantId", t.slug, t.name, t.status, ts.email::text AS email,
              ts.contact_name AS "contactName", ts.phone, ts.source_kind AS "sourceKind",
              ts.source_value AS "sourceValue", ts.created_at AS "createdAt",
              COALESCE(s.trial_ends_at, ts.trial_ends_at) AS "trialEndsAt",
              s.status AS "subscription", ts.email_sent_at AS "emailSentAt",
              ts.email_error AS "emailError", ts.expired_at AS "expiredAt"
         FROM trial_signups ts JOIN tenants t ON t.id = ts.tenant_id
         LEFT JOIN subscriptions s ON s.tenant_id = ts.tenant_id AND s.status <> 'cancelled'
        ORDER BY ts.created_at DESC LIMIT 200`,
    );
  }
}
