import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';
import { MessagingService, normalizePhone } from '../messaging/messaging.service';
import { PlatformDb } from '../platform/platform-db.service';

export interface EventInput {
  title: string;
  notes?: string | null;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  tagId?: string | null;
  done?: boolean;
  /** Quando sai o lembrete pelo WhatsApp (null = sem lembrete). */
  remindAt?: string | null;
}

interface EventRow {
  id: string;
  title: string;
  notes: string | null;
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
  tag_id: string | null;
  done: boolean;
  remind_at: Date | null;
  reminded_at: Date | null;
  remind_error: string | null;
}

const EVENT_COLS = `id, title, notes, starts_at, ends_at, all_day, tag_id, done, remind_at, reminded_at,
  remind_error`;

/** Lembrete que perdeu a hora por mais que isto (servidor parado) não sai mais. */
const LATE_LIMIT_MS = 6 * 3600_000;

const present = (e: EventRow) => ({
  id: e.id,
  title: e.title,
  notes: e.notes,
  startsAt: e.starts_at,
  endsAt: e.ends_at,
  allDay: e.all_day,
  tagId: e.tag_id,
  done: e.done,
  remindAt: e.remind_at,
  remindedAt: e.reminded_at,
  remindError: e.remind_error,
});

/**
 * Agenda pessoal de cada pessoa da equipe (docs/agenda.md): compromissos e tarefas por dia, tags
 * próprias e lembrete pelo WhatsApp do restaurante, se a pessoa permitir. Tudo filtrado pelo
 * user_id de quem está logado: ninguém vê a agenda do outro.
 */
@Injectable()
export class AgendaService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Agenda');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly platformDb: PlatformDb,
    private readonly messaging: MessagingService,
  ) {}

  onApplicationBootstrap() {
    const s = this.env.AGENDA_INTERVAL_SECONDS;
    if (!s) return;
    this.timer = setInterval(() => void this.sweepSafely(), s * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ leitura

  async list(ctx: Ctx, from: string, to: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await q<EventRow>(
        tx,
        `SELECT ${EVENT_COLS} FROM agenda_events
          WHERE user_id = $1 AND starts_at < $3 AND ends_at >= $2
          ORDER BY all_day DESC, starts_at, created_at`,
        [ctx.userId, from, to],
      );
      return rows.map(present);
    });
  }

  /** Tags, a permissão do WhatsApp e se o WhatsApp do restaurante consegue mandar o lembrete. */
  async setup(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => ({
      tags: await this.tagsIn(tx, ctx),
      settings: await this.settingsIn(tx, ctx),
    }));
  }

  private tagsIn(tx: Tx, ctx: Ctx) {
    return q<{ id: string; name: string; color: string }>(
      tx,
      `SELECT id, name, color FROM agenda_tags WHERE user_id = $1 ORDER BY lower(name)`,
      [ctx.userId],
    );
  }

  private async settingsIn(tx: Tx, ctx: Ctx) {
    const s = await one<{ whatsapp_enabled: boolean; phone: string | null }>(
      tx,
      `SELECT whatsapp_enabled, phone FROM agenda_settings WHERE user_id = $1`,
      [ctx.userId],
    );
    return {
      whatsappEnabled: s?.whatsapp_enabled ?? false,
      phone: s?.phone ?? null,
      whatsappReady: await this.messaging.canSendText(tx),
    };
  }

  // ------------------------------------------------------------------ compromissos

  async create(ctx: Ctx, b: EventInput) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.checkTag(tx, ctx, b.tagId);
      const remind = this.remindFields(b.remindAt ?? null);
      const row = await one<EventRow>(
        tx,
        `INSERT INTO agenda_events (tenant_id, user_id, title, notes, starts_at, ends_at, all_day,
                                    tag_id, done, remind_at, reminded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${EVENT_COLS}`,
        [
          ctx.tenantId,
          ctx.userId,
          b.title,
          b.notes ?? null,
          b.startsAt,
          b.endsAt,
          b.allDay ?? false,
          b.tagId ?? null,
          b.done ?? false,
          remind.at,
          remind.done,
        ],
      );
      return present(row!);
    });
  }

  async update(ctx: Ctx, id: string, b: Partial<EventInput>) {
    return this.db.withTenant(ctx, async (tx) => {
      const cur = await one<EventRow>(
        tx,
        `SELECT ${EVENT_COLS} FROM agenda_events WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, ctx.userId],
      );
      if (!cur) throw new NotFoundException('Compromisso não encontrado');
      if (b.tagId !== undefined) await this.checkTag(tx, ctx, b.tagId);
      const startsAt = b.startsAt ? new Date(b.startsAt) : cur.starts_at;
      const endsAt = b.endsAt ? new Date(b.endsAt) : cur.ends_at;
      if (endsAt < startsAt) throw new UnprocessableEntityException('O fim vem antes do começo');
      // Mudou o horário sem mexer no lembrete: o lembrete anda junto (mesma antecedência).
      let remindAt: Date | null = cur.remind_at;
      if (b.remindAt !== undefined) remindAt = b.remindAt ? new Date(b.remindAt) : null;
      else if (cur.remind_at && b.startsAt)
        remindAt = new Date(
          cur.remind_at.getTime() + (startsAt.getTime() - cur.starts_at.getTime()),
        );
      const changed = (remindAt?.getTime() ?? null) !== (cur.remind_at?.getTime() ?? null);
      const remind = changed
        ? this.remindFields(remindAt?.toISOString() ?? null)
        : { at: cur.remind_at, done: cur.reminded_at, error: cur.remind_error };
      const row = await one<EventRow>(
        tx,
        `UPDATE agenda_events SET title = $2, notes = $3, starts_at = $4, ends_at = $5,
                all_day = $6, tag_id = $7, done = $8, remind_at = $9, reminded_at = $10,
                remind_error = $11
          WHERE id = $1 RETURNING ${EVENT_COLS}`,
        [
          id,
          b.title ?? cur.title,
          b.notes !== undefined ? b.notes : cur.notes,
          startsAt,
          endsAt,
          b.allDay ?? cur.all_day,
          b.tagId !== undefined ? b.tagId : cur.tag_id,
          b.done ?? cur.done,
          remind.at,
          remind.done,
          remind.error ?? null,
        ],
      );
      return present(row!);
    });
  }

  async remove(ctx: Ctx, id: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const r = await tx.$client.query(`DELETE FROM agenda_events WHERE id = $1 AND user_id = $2`, [
        id,
        ctx.userId,
      ]);
      if (!r.rowCount) throw new NotFoundException('Compromisso não encontrado');
    });
  }

  /** Lembrete com horário que já passou não sai (fica marcado como resolvido). */
  private remindFields(at: string | null) {
    if (!at) return { at: null, done: null, error: null };
    const d = new Date(at);
    return d.getTime() < Date.now() - 60_000
      ? { at: d, done: new Date(), error: null }
      : { at: d, done: null, error: null };
  }

  private async checkTag(tx: Tx, ctx: Ctx, tagId: string | null | undefined) {
    if (!tagId) return;
    const t = await one(tx, `SELECT 1 FROM agenda_tags WHERE id = $1 AND user_id = $2`, [
      tagId,
      ctx.userId,
    ]);
    if (!t) throw new UnprocessableEntityException('Tag não encontrada');
  }

  // ------------------------------------------------------------------ tags

  async createTag(ctx: Ctx, b: { name: string; color: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      const n = await one<{ n: string }>(
        tx,
        `SELECT count(*) n FROM agenda_tags WHERE user_id = $1`,
        [ctx.userId],
      );
      if (Number(n?.n ?? 0) >= 50) throw new ConflictException('Limite de 50 tags');
      try {
        return await one(
          tx,
          `INSERT INTO agenda_tags (tenant_id, user_id, name, color) VALUES ($1,$2,$3,$4)
           RETURNING id, name, color`,
          [ctx.tenantId, ctx.userId, b.name, b.color],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new ConflictException('Já existe uma tag com esse nome');
        throw e;
      }
    });
  }

  async updateTag(ctx: Ctx, id: string, b: { name?: string; color?: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      try {
        const t = await one(
          tx,
          `UPDATE agenda_tags SET name = COALESCE($3, name), color = COALESCE($4, color)
            WHERE id = $1 AND user_id = $2 RETURNING id, name, color`,
          [id, ctx.userId, b.name ?? null, b.color ?? null],
        );
        if (!t) throw new NotFoundException('Tag não encontrada');
        return t;
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new ConflictException('Já existe uma tag com esse nome');
        throw e;
      }
    });
  }

  async removeTag(ctx: Ctx, id: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const r = await tx.$client.query(`DELETE FROM agenda_tags WHERE id = $1 AND user_id = $2`, [
        id,
        ctx.userId,
      ]);
      if (!r.rowCount) throw new NotFoundException('Tag não encontrada');
    });
  }

  // ------------------------------------------------------------------ WhatsApp

  async saveSettings(ctx: Ctx, b: { whatsappEnabled: boolean; phone: string | null }) {
    const phone = b.phone ? normalizePhone(b.phone) : null;
    if (b.phone && !phone)
      throw new UnprocessableEntityException('Número inválido: use DDD + número');
    if (b.whatsappEnabled && !phone)
      throw new UnprocessableEntityException('Informe o número que recebe os lembretes');
    return this.db.withTenant(ctx, async (tx) => {
      await tx.$client.query(
        `INSERT INTO agenda_settings (tenant_id, user_id, whatsapp_enabled, phone)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET whatsapp_enabled = EXCLUDED.whatsapp_enabled, phone = EXCLUDED.phone`,
        [ctx.tenantId, ctx.userId, b.whatsappEnabled, phone],
      );
      return this.settingsIn(tx, ctx);
    });
  }

  /** Manda uma mensagem de teste para o número salvo. */
  async sendTest(ctx: Ctx) {
    const s = await this.db.withTenant(ctx, async (tx) => ({
      cfg: await one<{ phone: string | null }>(
        tx,
        `SELECT phone FROM agenda_settings WHERE user_id = $1`,
        [ctx.userId],
      ),
      store: await this.storeInfo(tx),
    }));
    if (!s.cfg?.phone) throw new UnprocessableEntityException('Salve o número antes de testar');
    const r = await this.messaging.sendText(
      ctx.tenantId,
      s.cfg.phone,
      `Oi, ${ctx.user.name.split(' ')[0]}! Os lembretes da sua agenda vão chegar aqui, no horário que você escolher. 🗓️\n\n_Assistente do Comandou · ${s.store.name}_`,
    );
    if (!r.ok) throw new ConflictException(r.error ?? 'Não deu para mandar');
    return { ok: true };
  }

  private async storeInfo(tx: Tx) {
    const t = await one<{ name: string; timezone: string | null }>(
      tx,
      `SELECT name, timezone FROM tenants WHERE id = app_current_tenant()`,
    );
    return { name: t?.name ?? 'Comandou', tz: t?.timezone || 'America/Sao_Paulo' };
  }

  // ------------------------------------------------------------------ envio dos lembretes

  private async tenantsWithWork(): Promise<string[]> {
    if (!this.platformDb.enabled) return [];
    const sql = `SELECT DISTINCT tenant_id FROM agenda_events
                  WHERE remind_at <= now() AND reminded_at IS NULL`;
    const ids = new Set<string>();
    for (const r of await this.platformDb.query<{ tenant_id: string }>(sql)) ids.add(r.tenant_id);
    for (const d of await this.platformDb.eachDedicated<{ tenant_id: string }>(sql))
      for (const r of d.rows) ids.add(r.tenant_id);
    return [...ids];
  }

  async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      for (const t of await this.tenantsWithWork())
        await this.sweepTenant(t).catch((e) =>
          this.logger.warn(`lembretes de ${t}: ${(e as Error).message}`),
        );
    } finally {
      this.running = false;
    }
  }

  private async sweepSafely() {
    try {
      await this.sweep();
    } catch (e) {
      this.logger.warn(`varredura da agenda: ${(e as Error).message}`);
    }
  }

  /**
   * Manda os lembretes vencidos de um restaurante. Marca reminded_at ANTES de mandar (dentro da
   * transação, com SKIP LOCKED): duas réplicas nunca mandam o mesmo lembrete duas vezes.
   */
  async sweepTenant(tenantId: string) {
    const work = await this.db.withTenant({ tenantId }, async (tx) => {
      const due = await q<
        EventRow & {
          user_id: string;
          tag: string | null;
          enabled: boolean | null;
          phone: string | null;
        }
      >(
        tx,
        `WITH d AS (
           SELECT id FROM agenda_events
            WHERE remind_at <= now() AND reminded_at IS NULL
            ORDER BY remind_at LIMIT 50 FOR UPDATE SKIP LOCKED)
         UPDATE agenda_events e SET reminded_at = now()
           FROM d WHERE e.id = d.id
         RETURNING e.id, e.user_id, e.title, e.notes, e.starts_at, e.ends_at, e.all_day, e.done,
                   e.remind_at,
                   (SELECT name FROM agenda_tags t WHERE t.id = e.tag_id) AS tag,
                   (SELECT whatsapp_enabled FROM agenda_settings s WHERE s.user_id = e.user_id) AS enabled,
                   (SELECT phone FROM agenda_settings s WHERE s.user_id = e.user_id) AS phone`,
      );
      return { due, store: due.length ? await this.storeInfo(tx) : null };
    });
    for (const e of work.due) {
      let error: string | null = null;
      if (!e.enabled || !e.phone) error = 'Lembretes pelo WhatsApp desligados';
      else if (e.done) error = null;
      else if (Date.now() - e.remind_at!.getTime() > LATE_LIMIT_MS)
        error = 'O horário do lembrete passou com o sistema fora do ar';
      else {
        const r = await this.messaging.sendText(tenantId, e.phone, reminderText(e, work.store!));
        if (!r.ok) error = r.error ?? 'Não deu para mandar';
      }
      if (error)
        await this.db.withTenant({ tenantId }, (tx) =>
          tx.$client.query(`UPDATE agenda_events SET remind_error = $2 WHERE id = $1`, [
            e.id,
            error!.slice(0, 300),
          ]),
        );
    }
    return work.due.length;
  }
}

/** Texto do lembrete no WhatsApp (dia e hora no fuso do restaurante). */
export function reminderText(
  e: {
    title: string;
    notes: string | null;
    starts_at: Date;
    ends_at: Date;
    all_day: boolean;
    tag: string | null;
  },
  store: { name: string; tz: string },
) {
  const day = e.starts_at.toLocaleDateString('pt-BR', {
    timeZone: store.tz,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  });
  const time = (d: Date) =>
    d.toLocaleTimeString('pt-BR', { timeZone: store.tz, hour: '2-digit', minute: '2-digit' });
  const when = e.all_day
    ? `${day} · dia todo`
    : e.ends_at.getTime() > e.starts_at.getTime()
      ? `${day} · ${time(e.starts_at)} às ${time(e.ends_at)}`
      : `${day} · ${time(e.starts_at)}`;
  return [
    '⏰ *Lembrete da sua agenda*',
    '',
    `*${e.title}*`,
    `🗓️ ${when.charAt(0).toUpperCase()}${when.slice(1)}`,
    e.tag ? `🏷️ ${e.tag}` : null,
    e.notes ? `\n${e.notes}` : null,
    '',
    `_Assistente do Comandou · ${store.name}_`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}
