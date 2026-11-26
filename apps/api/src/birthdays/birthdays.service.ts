import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  addLocalDays,
  BIRTHDAY_LAST_HOUR,
  birthdayMessage,
  type BirthdayGiftKind,
  type BirthdayTheme,
  daysUntilBirthday,
  DEFAULT_BIRTHDAY_LINE,
  DEFAULT_BIRTHDAY_MESSAGE,
  firstName,
  giftArt,
  giftMessageLine,
  isLeapYear,
  isoDay,
  type LocalDay,
  localNow,
} from '@comandou/shared';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GatewayClient } from '../messaging/gateway.client';
import { MessagingService, normalizePhone } from '../messaging/messaging.service';
import { WhatsAppUnavailableError } from '../messaging/whatsapp.client';
import { PlanService } from '../plans/plan.service';
import { PlatformDb } from '../platform/platform-db.service';
import { QueueService, TenantJob } from '../queue/queue.service';
import { logoForArt, renderBirthdayArt } from './birthday-image';

export interface BirthdaySettings {
  enabled: boolean;
  sendHour: number;
  theme: BirthdayTheme;
  artLine: string;
  /** null = o texto padrão. */
  message: string | null;
  giftKind: BirthdayGiftKind;
  giftPoints: number | null;
  giftText: string | null;
  giftDays: number;
}

/** O que a tela manda para a prévia e para o teste (ainda sem salvar). */
export type BirthdayDraft = Partial<
  Pick<
    BirthdaySettings,
    'theme' | 'artLine' | 'message' | 'giftKind' | 'giftPoints' | 'giftText' | 'giftDays'
  >
>;

const DEFAULTS: BirthdaySettings = {
  enabled: false,
  sendHour: 10,
  theme: 'festa',
  artLine: DEFAULT_BIRTHDAY_LINE,
  message: null,
  giftKind: 'none',
  giftPoints: null,
  giftText: null,
  giftDays: 7,
};
const SETTINGS_COLS = `enabled, send_hour AS "sendHour", theme, art_line AS "artLine", message,
  gift_kind AS "giftKind", gift_points AS "giftPoints", gift_text AS "giftText",
  gift_days AS "giftDays", updated_at AS "updatedAt"`;
const COLUMN: Record<keyof BirthdaySettings, string> = {
  enabled: 'enabled',
  sendHour: 'send_hour',
  theme: 'theme',
  artLine: 'art_line',
  message: 'message',
  giftKind: 'gift_kind',
  giftPoints: 'gift_points',
  giftText: 'gift_text',
  giftDays: 'gift_days',
};

const SEND_JOB = 'birthday.send';
/** Um parabéns a cada 25 s por restaurante: o número da loja não parece robô. */
const PACE_MS = 25_000;
/** Aniversariantes de um dia que saem numa volta da varredura (o resto na próxima). */
const PER_SWEEP = 120;
const FILE_NAME = 'Feliz aniversario.png';
/** Legenda da foto no WhatsApp: até 1000 caracteres no gateway. */
const CAPTION_MAX = 1000;

const dayOf = (iso: string | Date | null): LocalDay | null => {
  if (!iso) return null;
  const s = typeof iso === 'string' ? iso : iso.toISOString();
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return { year: y!, month: m!, day: d! };
};

type WhatsReason = 'ok' | 'off' | 'meta' | 'plan' | 'server';

/**
 * Parabéns de aniversário pelo WhatsApp do restaurante (Clientes › Aniversários, docs/whatsapp.md).
 * Uma varredura (BIRTHDAY_INTERVAL_SECONDS) acha, depois da hora escolhida e no fuso da loja, os
 * clientes que fazem aniversário hoje, grava um parabéns por cliente por ano (UNIQUE: nunca dois)
 * e põe na fila; o envio desenha a arte com o nome do cliente e manda pela conexão por QR Code
 * (a API oficial da Meta só manda modelo aprovado). Presente opcional: pontos da fidelidade
 * (lançados junto com o parabéns, na mesma transação) ou um texto livre com validade.
 */
@Injectable()
export class BirthdaysService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Birthdays');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly platformDb: PlatformDb,
    private readonly queue: QueueService,
    private readonly messaging: MessagingService,
    private readonly gateway: GatewayClient,
    private readonly loyalty: LoyaltyService,
    private readonly plans: PlanService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.queue.register(SEND_JOB, (d, _attempt, final) => this.runSend(d, final));
  }

  onApplicationBootstrap() {
    const s = this.env.BIRTHDAY_INTERVAL_SECONDS;
    if (!s) return;
    this.timer = setInterval(() => void this.sweepSafely(), s * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ ajustes

  async settingsIn(tx: Tx): Promise<BirthdaySettings & { updatedAt: Date | null }> {
    const s = await one<BirthdaySettings & { updatedAt: Date }>(
      tx,
      `SELECT ${SETTINGS_COLS} FROM tenant_birthday_settings`,
    );
    return s ?? { ...DEFAULTS, updatedAt: null };
  }

  /** O WhatsApp da loja manda o parabéns? E se não, por quê. */
  private async whatsIn(tx: Tx): Promise<{ ready: boolean; reason: WhatsReason }> {
    const m = await one<{ enabled: boolean; provider: string }>(
      tx,
      `SELECT enabled, provider FROM tenant_messaging_settings`,
    );
    if (!m?.enabled) return { ready: false, reason: 'off' };
    if (m.provider !== 'baileys') return { ready: false, reason: 'meta' };
    if (!(await this.plans.hasFeature(tx, 'whatsapp'))) return { ready: false, reason: 'plan' };
    if (!this.gateway.configured) return { ready: false, reason: 'server' };
    return { ready: true, reason: 'ok' };
  }

  private async storeIn(tx: Tx) {
    const t = await one<{
      name: string;
      tz: string | null;
      brand: string | null;
      logo_type: string | null;
      logo: Buffer | null;
    }>(
      tx,
      `SELECT t.name, t.timezone AS tz, s.brand_color AS brand,
              m.content_type AS logo_type, m.bytes AS logo
         FROM tenants t
         LEFT JOIN tenant_store_settings s ON s.tenant_id = t.id
         LEFT JOIN media m ON m.id = COALESCE(s.logo_image_id, s.favicon_image_id)
        WHERE t.id = app_current_tenant()`,
    );
    return {
      name: t?.name ?? 'Restaurante',
      tz: t?.tz || 'America/Sao_Paulo',
      brand: t?.brand ?? null,
      logo: t?.logo && t.logo_type ? { type: t.logo_type, bytes: t.logo } : null,
    };
  }

  /** Tela Clientes › Aniversários: ajustes, situação do WhatsApp, próximos e o que já saiu. */
  overview(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const settings = await this.settingsIn(tx);
      const store = await this.storeIn(tx);
      const today = localNow(new Date(), store.tz);
      const next = addLocalDays(today, 31);
      const rows = await q<{
        id: string;
        name: string;
        day: number;
        month: number;
        year: number | null;
        optOut: boolean;
        blocked: boolean;
        status: string | null;
      }>(
        tx,
        `SELECT c.id, c.name, c.birth_day AS day, c.birth_month AS month, c.birth_year AS year,
                c.birthday_opt_out AS "optOut", c.blocked_at IS NOT NULL AS blocked,
                g.status
           FROM customers c
           LEFT JOIN birthday_greetings g ON g.customer_id = c.id AND g.year = $3
          WHERE c.birth_month IN ($1, $2)`,
        [today.month, next.month, today.year],
      );
      const upcoming = rows
        .map((r) => ({ ...r, inDays: daysUntilBirthday(r, today) }))
        .filter((r) => r.inDays <= 30)
        .sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name, 'pt-BR'))
        .slice(0, 200)
        // O parabéns deste ano só vale para quem faz aniversário ainda neste ano (em dezembro,
        // quem faz em janeiro já é do ano que vem).
        .map((r) => ({
          ...r,
          status: addLocalDays(today, r.inDays).year === today.year ? r.status : null,
        }));
      const counts = await one<{ total: number; withBirthday: number; optedOut: number }>(
        tx,
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE birth_month IS NOT NULL)::int AS "withBirthday",
                count(*) FILTER (WHERE birth_month IS NOT NULL AND birthday_opt_out)::int AS "optedOut"
           FROM customers`,
      );
      const history = await q(
        tx,
        `SELECT g.id, g.customer_id AS "customerId", c.name, g.year, g.status,
                g.last_error AS "lastError", g.gift_kind AS "giftKind", g.gift_points AS "giftPoints",
                g.gift_text AS "giftText", g.created_at AS "createdAt", g.sent_at AS "sentAt"
           FROM birthday_greetings g JOIN customers c ON c.id = g.customer_id
          ORDER BY g.created_at DESC LIMIT 60`,
      );
      const loyalty = await this.loyalty.settingsIn(tx);
      return {
        settings: { ...settings, defaultMessage: DEFAULT_BIRTHDAY_MESSAGE },
        whatsapp: await this.whatsIn(tx),
        loyaltyEnabled: loyalty.enabled,
        loyaltyMode: loyalty.mode,
        timezone: store.tz,
        today: isoDay(today),
        stats: counts,
        upcoming,
        history,
      };
    });
  }

  saveSettings(ctx: Ctx, patch: Partial<BirthdaySettings>) {
    return this.db.withTenant(ctx, async (tx) => {
      const cur = await this.settingsIn(tx);
      const next: BirthdaySettings = { ...cur, ...patch };
      if (next.giftKind === 'points') {
        const loyalty = await this.loyalty.settingsIn(tx);
        const unit = loyalty.mode === 'stamps' ? 'carimbos' : 'pontos';
        if (!next.giftPoints)
          throw new UnprocessableEntityException(`Diga quantos ${unit} o cliente ganha`);
        if (!loyalty.enabled)
          throw new UnprocessableEntityException(
            'Para dar pontos, ligue antes o programa de fidelidade (Loja online › Fidelidade)',
          );
      }
      if (next.giftKind === 'text' && !next.giftText?.trim())
        throw new UnprocessableEntityException('Escreva qual é o presente');
      if (next.enabled && !cur.enabled) {
        const w = await this.whatsIn(tx);
        if (w.reason === 'plan') await this.plans.assertFeature(tx, 'whatsapp');
      }
      const keys = Object.keys(COLUMN) as (keyof BirthdaySettings)[];
      const values = keys.map((k) => next[k]);
      await tx.$client.query(
        `INSERT INTO tenant_birthday_settings (tenant_id, ${keys.map((k) => COLUMN[k]).join(', ')}, updated_by)
         VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}, $${keys.length + 2})
         ON CONFLICT (tenant_id) DO UPDATE SET
           ${keys.map((k) => `${COLUMN[k]} = EXCLUDED.${COLUMN[k]}`).join(', ')},
           updated_by = EXCLUDED.updated_by`,
        [ctx.tenantId, ...values, ctx.userId],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'birthday.settings_updated',
        entity: 'tenant_birthday_settings',
        entityId: ctx.tenantId,
        data: { ...next, message: next.message ? 'personalizada' : 'padrão' },
        ip: ctx.ip,
      });
      return { ...(await this.settingsIn(tx)), defaultMessage: DEFAULT_BIRTHDAY_MESSAGE };
    });
  }

  // ------------------------------------------------------------------ arte, prévia e teste

  /** Arte e legenda de um parabéns (do dia ou de teste). */
  private async compose(
    tx: Tx,
    s: BirthdaySettings,
    customer: string,
    gift: {
      kind: BirthdayGiftKind;
      points: number | null;
      text: string | null;
      until: LocalDay | null;
    },
    today: LocalDay,
  ) {
    const store = await this.storeIn(tx);
    const stamps = gift.kind === 'points' && (await this.loyalty.settingsIn(tx)).mode === 'stamps';
    const g = { ...gift, today, stamps };
    const png = await renderBirthdayArt({
      theme: s.theme,
      name: firstName(customer),
      line: s.artLine,
      restaurant: store.name,
      brand: store.brand,
      logo: await logoForArt(store.logo),
      gift: giftArt(g),
    });
    const caption = birthdayMessage(s.message, {
      cliente: firstName(customer) || 'cliente',
      restaurante: store.name,
      presente: giftMessageLine(g),
    }).slice(0, CAPTION_MAX);
    return { png, caption };
  }

  private draftGift(s: BirthdaySettings, today: LocalDay) {
    return {
      kind: s.giftKind,
      points: s.giftPoints,
      text: s.giftText,
      until: s.giftKind === 'text' ? addLocalDays(today, s.giftDays) : null,
    };
  }

  /** Prévia da arte com o que está na tela (ainda sem salvar). */
  preview(ctx: Ctx, draft: BirthdayDraft, name: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const s = { ...(await this.settingsIn(tx)), ...draft };
      const today = localNow(new Date(), (await this.storeIn(tx)).tz);
      return (await this.compose(tx, s, name, this.draftGift(s, today), today)).png;
    });
  }

  /** Manda um parabéns de teste (arte + texto) para o número informado, na hora. */
  async sendTest(ctx: Ctx, phoneRaw: string, draft: BirthdayDraft, name: string) {
    const phone = normalizePhone(phoneRaw);
    if (!phone) throw new UnprocessableEntityException('Telefone inválido: use DDD + número');
    const msg = await this.db.withTenant(ctx, async (tx) => {
      const w = await this.whatsIn(tx);
      if (!w.ready)
        throw new ConflictException(
          w.reason === 'meta'
            ? 'O parabéns sai só pelo WhatsApp conectado por QR Code'
            : 'Conecte o WhatsApp da loja antes de testar',
        );
      const s = { ...(await this.settingsIn(tx)), ...draft };
      const today = localNow(new Date(), (await this.storeIn(tx)).tz);
      return this.compose(tx, s, name, this.draftGift(s, today), today);
    });
    try {
      const r = await this.gateway.sendDocument(ctx.tenantId, phone, {
        data: msg.png,
        fileName: FILE_NAME,
        caption: msg.caption,
      });
      if (!r.ok) throw new ConflictException(r.error);
    } catch (err) {
      if (err instanceof WhatsAppUnavailableError) throw new ConflictException(err.message);
      throw err;
    }
    return { ok: true };
  }

  /** Manda de novo um parabéns que falhou. */
  async retry(ctx: Ctx, id: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const g = await one<{ status: string }>(
        tx,
        `SELECT status FROM birthday_greetings WHERE id = $1`,
        [id],
      );
      if (!g) throw new NotFoundException('Parabéns não encontrado');
      if (g.status !== 'failed') throw new ConflictException('Este parabéns não falhou');
      await q(
        tx,
        `UPDATE birthday_greetings SET status = 'queued', last_error = NULL
          WHERE id = $1 AND status = 'failed'`,
        [id],
      );
    });
    await this.enqueue(ctx.tenantId, id, 0, `-${Date.now()}`);
    return { ok: true };
  }

  // ------------------------------------------------------------------ varredura e envio

  private async tenantsWithWork(): Promise<string[]> {
    if (!this.platformDb.enabled) return [];
    const sql = `SELECT tenant_id FROM tenant_birthday_settings WHERE enabled`;
    const ids = new Set<string>();
    for (const r of await this.platformDb.query<{ tenant_id: string }>(sql)) ids.add(r.tenant_id);
    for (const d of await this.platformDb.eachDedicated<{ tenant_id: string }>(sql))
      for (const r of d.rows) ids.add(r.tenant_id);
    return [...ids];
  }

  async sweep(now = new Date()) {
    if (this.running) return 0;
    this.running = true;
    let n = 0;
    try {
      for (const t of await this.tenantsWithWork())
        n += await this.sweepTenant(t, now).catch((e) => {
          this.logger.warn(`aniversários de ${t}: ${(e as Error).message}`);
          return 0;
        });
    } finally {
      this.running = false;
    }
    return n;
  }

  private async sweepSafely() {
    try {
      await this.sweep();
    } catch (e) {
      this.logger.warn(`varredura dos aniversários: ${(e as Error).message}`);
    }
  }

  /**
   * Aniversariantes de hoje de um restaurante: grava o parabéns (um por ano, ON CONFLICT) e os
   * pontos de presente na mesma transação, e põe na fila espaçados. Fora da janela (antes da hora
   * escolhida ou depois das 22 h) ou com o WhatsApp desconectado, não faz nada e tenta na próxima.
   */
  async sweepTenant(tenantId: string, now = new Date()) {
    const scope = { tenantId };
    const plan = await this.db.withTenant(scope, async (tx) => {
      const s = await this.settingsIn(tx);
      if (!s.enabled || !(await this.whatsIn(tx)).ready) return null;
      const today = localNow(now, (await this.storeIn(tx)).tz);
      if (today.hour < s.sendHour || today.hour >= BIRTHDAY_LAST_HOUR) return null;
      return { s, today };
    });
    if (!plan) return 0;
    const session = await this.gateway.session(tenantId).catch(() => null);
    if (session?.status !== 'connected') return 0;
    const { s, today } = plan;
    const created = await this.db.withTenant(scope, async (tx) => {
      const loyalty = await this.loyalty.settingsIn(tx);
      // Pontos com a fidelidade desligada depois: sai o parabéns sem prometer pontos.
      const kind: BirthdayGiftKind =
        s.giftKind === 'points' && !loyalty.enabled ? 'none' : s.giftKind;
      const until = kind === 'text' ? isoDay(addLocalDays(today, s.giftDays)) : null;
      const feb28 = today.month === 2 && today.day === 28 && !isLeapYear(today.year);
      const rows = await q<{ id: string; customer_id: string }>(
        tx,
        `INSERT INTO birthday_greetings (tenant_id, customer_id, year, gift_kind, gift_points, gift_text, gift_until)
         SELECT $1, c.id, $2, $3, $4, $5, $6::date FROM customers c
          WHERE c.birth_month = $7 AND (c.birth_day = $8 OR ($9 AND c.birth_day = 29))
            AND NOT c.birthday_opt_out AND c.blocked_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM birthday_greetings x
                             WHERE x.customer_id = c.id AND x.year = $2)
          ORDER BY c.created_at LIMIT ${PER_SWEEP}
         ON CONFLICT (tenant_id, customer_id, year) DO NOTHING
         RETURNING id, customer_id`,
        [
          tenantId,
          today.year,
          kind,
          kind === 'points' ? s.giftPoints : null,
          kind === 'text' ? s.giftText : null,
          until,
          today.month,
          today.day,
          feb28,
        ],
      );
      if (kind === 'points' && s.giftPoints && rows.length)
        await q(
          tx,
          `INSERT INTO loyalty_entries (tenant_id, customer_id, kind, points, note)
           SELECT $1, unnest($2::uuid[]), 'adjust', $3, 'Presente de aniversário'`,
          [tenantId, rows.map((r) => r.customer_id), s.giftPoints],
        );
      return rows;
    });
    for (const [i, r] of created.entries()) await this.enqueue(tenantId, r.id, i * PACE_MS);
    if (created.length)
      this.logger.log(`${created.length} parabéns na fila (${tenantId}, ${isoDay(today)})`);
    return created.length;
  }

  private async enqueue(tenantId: string, id: string, delayMs: number, suffix = '') {
    try {
      await this.queue.add(
        SEND_JOB,
        { tenantId, greetingId: id },
        { jobId: `${SEND_JOB}-${id}${suffix}`, attempts: 4, delayMs: delayMs + 1000 },
      );
    } catch (err) {
      this.logger.error(`falha ao enfileirar o parabéns ${id}: ${(err as Error).message}`);
    }
  }

  private async mark(tenantId: string, id: string, fields: Record<string, unknown>) {
    const cols = Object.keys(fields);
    await this.db.withTenant({ tenantId }, (tx) =>
      tx.$client.query(
        `UPDATE birthday_greetings SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...cols.map((c) => fields[c])],
      ),
    );
  }

  /** Consumidor de "birthday.send": confere tudo de novo, desenha a arte e manda. */
  async runSend(job: TenantJob, final: boolean) {
    const id = String(job.greetingId ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('trabalho sem greetingId');
    const fail = (e: string) =>
      this.mark(job.tenantId, id, { status: 'failed', last_error: e.slice(0, 300) });
    type Work =
      | { state: 'missing' }
      | { state: 'skip' }
      | { state: 'fail'; error: string }
      | { state: 'send'; phone: string; png: Buffer; caption: string };
    const work = await this.db.withTenant({ tenantId: job.tenantId }, async (tx): Promise<Work> => {
      const g = await one<{
        status: string;
        attempts: number;
        name: string;
        phone: string;
        optOut: boolean;
        gift_kind: BirthdayGiftKind;
        gift_points: number | null;
        gift_text: string | null;
        gift_until: string | null;
        created_at: Date;
      }>(
        tx,
        `SELECT g.status, g.attempts, c.name, c.phone, c.birthday_opt_out AS "optOut",
                g.gift_kind, g.gift_points, g.gift_text, g.gift_until::text, g.created_at
           FROM birthday_greetings g JOIN customers c ON c.id = g.customer_id
          WHERE g.id = $1`,
        [id],
      );
      if (!g) return { state: 'missing' };
      if (g.status !== 'queued') return { state: 'skip' };
      const s = await this.settingsIn(tx);
      if (!s.enabled) return { state: 'fail', error: 'O parabéns automático foi desligado' };
      if (g.optOut) return { state: 'fail', error: 'O cliente pediu para não receber' };
      const phone = normalizePhone(g.phone);
      if (!phone) return { state: 'fail', error: 'Celular do cliente inválido' };
      // Trava a tentativa: dois trabalhos do mesmo parabéns nunca mandam duas vezes.
      const claimed = await tx.$client.query(
        `UPDATE birthday_greetings SET status = 'sending', attempts = attempts + 1
          WHERE id = $1 AND status = 'queued' AND attempts = $2`,
        [id, g.attempts],
      );
      if (!claimed.rowCount) return { state: 'skip' };
      try {
        const today = localNow(g.created_at, (await this.storeIn(tx)).tz);
        const gift = {
          kind: g.gift_kind,
          points: g.gift_points,
          text: g.gift_text,
          until: dayOf(g.gift_until),
        };
        const msg = await this.compose(tx, s, g.name, gift, today);
        return { state: 'send', phone, ...msg };
      } catch (e) {
        this.logger.warn(`arte do parabéns ${id}: ${(e as Error).message}`);
        return { state: 'fail', error: 'Não deu para montar a arte do parabéns' };
      }
    });
    if (work.state === 'missing') {
      // A transação que gravou o parabéns ainda não terminou (ou foi desfeita).
      if (!final) throw new Error('parabéns ainda não gravado');
      return;
    }
    if (work.state === 'skip') return;
    if (work.state === 'fail') return fail(work.error);
    try {
      const r = await this.gateway.sendDocument(job.tenantId, work.phone, {
        data: work.png,
        fileName: FILE_NAME,
        caption: work.caption,
      });
      if (r.ok)
        await this.mark(job.tenantId, id, {
          status: 'sent',
          sent_at: new Date(),
          provider_message_id: r.messageId?.slice(0, 200) ?? null,
          last_error: null,
        });
      else await fail(r.error);
    } catch (err) {
      // WhatsApp fora do ar ou religando: volta para a fila e tenta de novo (até a última).
      if (err instanceof WhatsAppUnavailableError && !final) {
        await this.mark(job.tenantId, id, {
          status: 'queued',
          last_error: err.message.slice(0, 300),
        });
        throw err;
      }
      await fail((err as Error).message || 'Não deu para mandar');
    }
  }
}
