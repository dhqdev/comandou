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
import type { PoolClient } from 'pg';
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
import { SiteAiService } from './site-ai.service';
import { MailService } from '../../mail/mail.service';
import { resetEmail } from '../../store/reset-email';

const SECRET_CONTEXT = 'site:trial';
const MAIL_OFF = 'Envio de e-mail não configurado (Super Admin › E-mail)';
/** O link que abre o restaurante novo já logado vale este tempo depois do cadastro. */
const ENTRY_MINUTES = 60;

/** Ações automáticas (sem Super Admin logado): a auditoria fica sem administrador. */
const SYSTEM: Actor = { admin: { id: null } as unknown as PlatformAdmin };

interface SettingsRow {
  signup_enabled: boolean;
  daily_limit: number;
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

/** O plano de quem chega pelo site e os dias de teste dele (os mesmos do sistema todo). */
interface SitePlan {
  code: string;
  name: string;
  trial_days: number;
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
 * (mesmo caminho do painel), no plano padrão e com os dias de teste dele (Super Admin › Preço:
 * um tempo só para o site e para o sistema), e os primeiros passos começam pelo cardápio
 * informado. O login vai por e-mail (envio do próprio Comandou) e aparece na tela. Teste vencido
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
    private readonly siteAi: SiteAiService,
    private readonly mail: MailService,
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
      `SELECT signup_enabled, daily_limit FROM platform_site_settings WHERE id`,
    );
    return s!;
  }

  /**
   * O plano em que o restaurante do site nasce. Os dias de teste são os dele, os mesmos de
   * qualquer restaurante novo: muda em Super Admin › Preço, num lugar só.
   */
  private async sitePlan(): Promise<SitePlan | null> {
    const [p] = await this.db.query<SitePlan>(
      `SELECT code, name, trial_days FROM plans
        WHERE active ORDER BY is_default DESC, (code = 'comandou') DESC, sort_order, code LIMIT 1`,
    );
    return p ?? null;
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
    if (!this.db.enabled)
      return { signup: false, trialDays: 0, demoUrl: null, salesContact: '', ai: false };
    const s = await this.settingsRow();
    const plan = await this.sitePlan();
    // Plano sem dias de teste: não há teste para oferecer, o botão de criar fica fechado.
    const signup = s.signup_enabled && (plan?.trial_days ?? 0) > 0;
    const [demo] = await this.db.query<{ slug: string }>(
      `SELECT slug FROM tenants WHERE slug = $1 AND status = 'provisioned'`,
      [(process.env.COMANDOU_DEMO_SLUG ?? '').trim().toLowerCase() || 'fumaca'],
    );
    const [b] = await this.db.query<{ sales_contact: string }>(
      `SELECT sales_contact FROM platform_billing_settings WHERE id`,
    );
    return {
      signup,
      trialDays: plan?.trial_days ?? 0,
      demoUrl: demo ? `${this.tenantUrl(demo.slug)}/pedir` : null,
      salesContact: b?.sales_contact ?? '',
      /** Monta o site com IA (Super Admin › Site › Site com IA ligado, com chave e dentro do limite). */
      ai: signup && (await this.siteAi.available()),
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
    // Um cadastro por e-mail de cada vez: dois cliques (ou duas abas) ao mesmo tempo passariam
    // juntos pela conferência de "já existe" e criariam dois restaurantes. A trava é do banco,
    // então vale entre réplicas, e solta sozinha se a conexão cair.
    const lock = await this.db.pool!.connect();
    try {
      const { rows } = await lock.query<{ ok: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS ok`,
        [`comandou:trial:${b.email}`],
      );
      if (!rows[0]?.ok)
        throw new ConflictException(
          'Já estamos criando um teste com este e-mail. Aguarde alguns segundos.',
        );
      try {
        return await this.createLocked(b, ip);
      } finally {
        await lock.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`comandou:trial:${b.email}`]);
      }
    } finally {
      lock.release();
    }
  }

  private async createLocked(b: TrialInput, ip: string | undefined) {
    const s = await this.settingsRow();
    const plan = await this.sitePlan();
    if (!s.signup_enabled || !plan || plan.trial_days <= 0)
      throw new ServiceUnavailableException(
        'O cadastro pelo site está fechado no momento. Fale com a gente.',
      );
    const days = plan.trial_days;
    const [{ today }] = await this.db.query<{ today: number }>(
      `SELECT count(*)::int AS today FROM trial_signups WHERE created_at > now() - interval '24 hours'`,
    );
    if (today >= s.daily_limit)
      throw new HttpException(
        'Recebemos muitos cadastros hoje. Tente de novo amanhã ou fale com a gente.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const emailOn = await this.mail.ready();
    const dup = await this.db.query(`SELECT 1 FROM trial_signups WHERE email = $1`, [b.email]);
    if (dup.length)
      throw new ConflictException(
        emailOn
          ? 'Já existe um teste com este e-mail. O login está na sua caixa de entrada.'
          : 'Já existe um teste com este e-mail. Entre com o login que apareceu no cadastro ou fale com a gente.',
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
    const input = {
      slug,
      name: b.restaurant,
      adminEmail: b.email,
      adminName: b.name,
      adminPassword: password,
      planCode: plan.code,
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
    // Site montado pela IA na página: o rascunho vai junto para os primeiros passos.
    const aiGeneration = await this.siteAi.claim(b.aiSite, tenantId).catch(() => null);
    const trialEndsAt = await this.db.tx(async (c) => {
      // Teste do site: os dias do plano (os mesmos do sistema), contados de agora.
      await c.query(
        `UPDATE subscriptions SET status = 'trialing', trial_ends_at = now() + make_interval(days => $2)
          WHERE tenant_id = $1 AND status <> 'cancelled'`,
        [tenantId, days],
      );
      const { rows } = await c.query<{ trial_ends_at: Date }>(
        `INSERT INTO trial_signups (tenant_id, email, contact_name, phone, source_kind, source_value,
                                    status_hash, ip, trial_ends_at, pending_enc, ai_generation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9), $10, $11)
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
          days,
          pending,
          aiGeneration,
        ],
      );
      await platformAudit(c, {
        action: 'site.trial_created',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: {
          slug,
          email: b.email,
          source: b.source.kind,
          trialDays: days,
          aiSite: !!aiGeneration,
        },
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
      trialDays: days,
      trialEndsAt,
      emailOn,
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
  /**
   * Restaurantes que ficaram prontos e ainda não receberam o e-mail de boas-vindas. A senha
   * guardada sai de `pending_enc` e entra na fila de envio (cifrada) NA MESMA transação: duas
   * réplicas nunca mandam o mesmo e-mail e, se o provedor estiver fora, a fila tenta de novo
   * (antes, com o webhook fora, a senha já tinha sido apagada e o e-mail se perdia).
   */
  async deliverPending() {
    if (!this.db.enabled || !this.env.INTEGRATIONS_KEY) return;
    const ready = await this.mail.ready();
    const queued = await this.db.tx(async (c) => {
      const { rows } = await c.query<PendingRow & { status: string }>(
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
      const out: { signupId: string; outboxId: string; slug: string }[] = [];
      for (const r of rows) {
        // Uma hora sem ficar pronto: a senha guardada some e nenhum e-mail sai.
        if (r.status !== 'provisioned') continue;
        if (!ready) {
          await c.query(`UPDATE trial_signups SET email_error = $2 WHERE id = $1`, [
            r.id,
            MAIL_OFF,
          ]);
          continue;
        }
        let password: string;
        try {
          password = open(this.env.INTEGRATIONS_KEY!, r.pending_enc, SECRET_CONTEXT);
        } catch {
          continue;
        }
        out.push({
          signupId: r.id,
          outboxId: await this.enqueueWelcome(c, r, password),
          slug: r.slug,
        });
      }
      return out;
    });
    for (const q of queued) await this.deliverWelcome(q.signupId, q.outboxId, q.slug);
    // O que a fila conseguiu entregar numa tentativa posterior.
    await this.db.query(
      `UPDATE trial_signups s SET email_sent_at = o.sent_at, email_error = NULL
         FROM mail_outbox o
        WHERE o.kind = 'trial.welcome' AND o.tenant_id = s.tenant_id AND o.status = 'sent'
          AND s.email_sent_at IS NULL`,
    );
  }

  private async deliverNow(tenantId: string, password: string) {
    const [r] = await this.db.query<Omit<PendingRow, 'pending_enc'>>(
      `SELECT s.id, s.tenant_id, s.email::text AS email, s.contact_name, s.trial_ends_at, t.slug, t.name
         FROM trial_signups s JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1`,
      [tenantId],
    );
    if (!r) return;
    if (!(await this.mail.ready())) {
      await this.db.query(`UPDATE trial_signups SET email_error = $2 WHERE id = $1`, [
        r.id,
        MAIL_OFF,
      ]);
      return;
    }
    const outboxId = await this.db.tx((c) => this.enqueueWelcome(c, r, password));
    await this.deliverWelcome(r.id, outboxId, r.slug);
  }

  /** Monta o e-mail de boas-vindas e o põe na fila (cifrado: tem a senha inicial). */
  private async enqueueWelcome(
    c: PoolClient,
    r: Omit<PendingRow, 'pending_enc'>,
    password: string,
  ): Promise<string> {
    const b = await c.query<{ sales_contact: string }>(
      `SELECT sales_contact FROM platform_billing_settings WHERE id`,
    );
    const sub = await c.query<{ trial_days: number }>(
      `SELECT GREATEST(1, round(extract(epoch FROM (trial_ends_at - created_at)) / 86400))::int AS trial_days
         FROM trial_signups WHERE id = $1`,
      [r.id],
    );
    const mail = welcomeEmail({
      restaurant: r.name,
      contactName: r.contact_name,
      url: this.tenantUrl(r.slug),
      loginEmail: r.email,
      password,
      trialDays: sub.rows[0]?.trial_days ?? 1,
      trialEndsAt: r.trial_ends_at,
      siteUrl: this.siteUrl(),
      salesContact: b.rows[0]?.sales_contact,
    });
    return this.mail.enqueue(c, {
      kind: 'trial.welcome',
      tenantId: r.tenant_id,
      to: [{ email: r.email, name: r.contact_name }],
      ...mail,
      sensitive: true,
    });
  }

  private async deliverWelcome(signupId: string, outboxId: string, slug: string) {
    const r = await this.mail.deliver(outboxId);
    await this.db.query(
      `UPDATE trial_signups SET email_sent_at = CASE WHEN $2::text IS NULL THEN now() END,
              email_error = $2 WHERE id = $1`,
      [signupId, r.ok ? null : (r.error ?? 'O envio falhou').slice(0, 300)],
    );
    if (!r.ok) this.logger.warn(`e-mail de boas-vindas (${slug}) ainda não saiu: ${r.error}`);
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
    const plan = await this.sitePlan();
    return {
      signupEnabled: s.signup_enabled,
      /** Só leitura: os dias de teste do plano (Super Admin › Preço). */
      trialDays: plan?.trial_days ?? 0,
      trialPlan: plan?.name ?? null,
      dailyLimit: s.daily_limit,
      /** O envio de e-mail (Super Admin › E-mail) está configurado? */
      emailReady: await this.mail.ready(),
      siteUrl: this.siteUrl(),
    };
  }

  async saveSettings(b: SiteSettingsInput, a: Actor) {
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_site_settings SET signup_enabled = $1, daily_limit = $2, updated_at = now()
          WHERE id`,
        [b.signupEnabled, b.dailyLimit],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'site.settings_saved',
        entity: 'site',
        data: { signupEnabled: b.signupEnabled, dailyLimit: b.dailyLimit },
        ip: a.ip,
      });
    });
    return this.settings();
  }

  private async sendTest(
    kind: string,
    to: string,
    mail: { subject: string; html: string; text: string },
    fromName?: string,
  ) {
    if (!(await this.mail.ready())) throw new UnprocessableEntityException(MAIL_OFF);
    const r = await this.mail.send({
      kind,
      from: fromName ? { name: fromName } : undefined,
      to: [{ email: to, name: 'Teste' }],
      ...mail,
    });
    if (!r.ok) throw new UnprocessableEntityException(r.error ?? 'O envio falhou');
    return { ok: true };
  }

  /** E-mail de boas-vindas de exemplo, para conferir antes de abrir o cadastro. */
  async testEmail(to: string) {
    const days = (await this.sitePlan())?.trial_days || 7;
    return this.sendTest(
      'trial.test',
      to,
      welcomeEmail({
        restaurant: 'Seu Restaurante',
        contactName: 'Teste',
        url: this.tenantUrl('seu-restaurante'),
        loginEmail: to,
        password: 'abcd-efgh-2345',
        trialDays: days,
        trialEndsAt: new Date(Date.now() + days * 86_400_000),
        siteUrl: this.siteUrl(),
      }),
    );
  }

  /** E-mail de exemplo com o código de nova senha, como o cliente de um restaurante recebe. */
  async testCustomerEmail(to: string) {
    return this.sendTest(
      'customer.test',
      to,
      resetEmail({
        restaurant: 'Seu Restaurante',
        customerName: 'Teste',
        code: '123456',
        minutes: 15,
        assets: this.siteUrl(),
      }),
      'Seu Restaurante',
    );
  }

  /** Prévia do e-mail com o código de nova senha do cliente (sai com o nome do restaurante). */
  customerEmailPreview() {
    return resetEmail({
      restaurant: 'Fumaça Burger & Co.',
      customerName: 'Marina Souza',
      code: '482915',
      minutes: 15,
      assets: this.siteUrl(),
    }).html;
  }

  /** Prévia do e-mail (HTML) para o painel mostrar. */
  async emailPreview() {
    const days = (await this.sitePlan())?.trial_days || 7;
    return welcomeEmail({
      restaurant: 'Fumaça Burger',
      contactName: 'Marina Souza',
      url: this.tenantUrl('fumaca-burger'),
      loginEmail: 'marina@fumacaburger.com.br',
      password: 'k7mf-2xqp-9dhw',
      trialDays: days,
      trialEndsAt: new Date(Date.now() + days * 86_400_000),
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
              ts.email_error AS "emailError", ts.expired_at AS "expiredAt",
              ts.ai_generation_id IS NOT NULL AS "aiSite"
         FROM trial_signups ts JOIN tenants t ON t.id = ts.tenant_id
         LEFT JOIN subscriptions s ON s.tenant_id = ts.tenant_id AND s.status <> 'cancelled'
        ORDER BY ts.created_at DESC LIMIT 200`,
    );
  }
}
