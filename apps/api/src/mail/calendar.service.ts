import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { PlatformDb, platformAudit } from '../platform/platform-db.service';
import type { Actor } from '../platform/platform.service';
import { esc } from './html';
import {
  Attendee,
  buildIcs,
  freeSlots,
  IcsEvent,
  occurrences,
  parseIcsReply,
  Repeat,
  zonedDate,
  zonedToUtc,
} from './ics';
import { BookingPageInput, EventInput, PublicBookingInput } from './mail.schemas';
import { MailService } from './mail.service';

interface EventRow {
  id: string;
  uid: string;
  mailbox_id: string | null;
  booking_page_id: string | null;
  title: string;
  description: string;
  location: string;
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
  time_zone: string;
  color: string;
  repeat: Repeat;
  repeat_until: string | null;
  attendees: Attendee[];
  sequence: number;
  cancelled_at: Date | null;
}

const EVENT_COLS = `id, uid, mailbox_id, booking_page_id, title, description, location, starts_at,
  ends_at, all_day, time_zone, color, repeat, repeat_until::text AS repeat_until, attendees, sequence,
  cancelled_at`;

interface PageRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  location: string;
  duration_min: number;
  buffer_min: number;
  min_notice_hours: number;
  days_ahead: number;
  availability: Record<string, [string, string][]>;
  time_zone: string;
  mailbox_id: string | null;
  enabled: boolean;
}

const PAGE_COLS = `id, slug::text AS slug, title, description, location, duration_min, buffer_min,
  min_notice_hours, days_ahead, availability, time_zone, mailbox_id, enabled`;

const eventView = (e: EventRow, start = e.starts_at) => ({
  id: e.id,
  mailboxId: e.mailbox_id,
  bookingPageId: e.booking_page_id,
  title: e.title,
  description: e.description,
  location: e.location,
  /** Início desta ocorrência (igual ao do evento quando ele não se repete). */
  startsAt: start,
  endsAt: new Date(start.getTime() + (e.ends_at.getTime() - e.starts_at.getTime())),
  /** Início do evento original (para editar a série). */
  seriesStartsAt: e.starts_at,
  seriesEndsAt: e.ends_at,
  allDay: e.all_day,
  timeZone: e.time_zone,
  color: e.color,
  repeat: e.repeat,
  repeatUntil: e.repeat_until,
  attendees: e.attendees,
});

const pageView = (p: PageRow) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  description: p.description,
  location: p.location,
  durationMin: p.duration_min,
  bufferMin: p.buffer_min,
  minNoticeHours: p.min_notice_hours,
  daysAhead: p.days_ahead,
  availability: p.availability,
  timeZone: p.time_zone,
  mailboxId: p.mailbox_id,
  enabled: p.enabled,
});

const fmt = (d: Date, timeZone: string, allDay = false) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(allDay ? {} : { hour: '2-digit', minute: '2-digit' }),
  }).format(d);

/**
 * Agenda do Super Admin: eventos (com repetição), convite por e-mail em .ics, resposta dos
 * convidados e a página pública para marcar horário.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly db: PlatformDb,
    private readonly mail: MailService,
  ) {}

  // ------------------------------------------------------------------ eventos
  /** Ocorrências que começam (ou ainda estão acontecendo) entre `from` e `to`. */
  async events(from: Date, to: Date) {
    if (!(to > from) || to.getTime() - from.getTime() > 400 * 86_400_000)
      throw new UnprocessableEntityException('Período inválido');
    const rows = await this.db.query<EventRow>(
      `SELECT ${EVENT_COLS} FROM mail_events
        WHERE cancelled_at IS NULL
          AND ((repeat = 'none' AND starts_at < $2 AND ends_at > $1)
            OR (repeat <> 'none' AND starts_at < $2
                AND (repeat_until IS NULL OR repeat_until >= $1::date)))
        ORDER BY starts_at LIMIT 2000`,
      [from, to],
    );
    const out = [];
    for (const e of rows) {
      if (e.repeat === 'none') out.push(eventView(e));
      else {
        const len = e.ends_at.getTime() - e.starts_at.getTime();
        for (const s of occurrences(
          { start: e.starts_at, repeat: e.repeat, repeatUntil: e.repeat_until },
          new Date(from.getTime() - len),
          to,
        ))
          out.push(eventView(e, s));
      }
    }
    return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  private async eventRow(id: string, c: PoolClient, lock = false): Promise<EventRow> {
    const { rows } = await c.query<EventRow>(
      `SELECT ${EVENT_COLS} FROM mail_events WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Evento não encontrado');
    return rows[0];
  }

  private async organizer(c: PoolClient, mailboxId: string | null) {
    if (!mailboxId) return null;
    const { rows } = await c.query<{ address: string; display_name: string }>(
      `SELECT address::text AS address, display_name FROM mail_mailboxes
        WHERE id = $1 AND archived_at IS NULL`,
      [mailboxId],
    );
    if (!rows[0]) throw new UnprocessableEntityException('Caixa do organizador não encontrada');
    return { email: rows[0].address, name: rows[0].display_name };
  }

  /** Convite (ou cancelamento) por e-mail, com o .ics que os programas de agenda entendem. */
  private async invite(
    c: PoolClient,
    e: EventRow,
    organizer: { email: string; name?: string },
    method: 'REQUEST' | 'CANCEL',
    to: Attendee[],
  ): Promise<string[]> {
    if (!to.length) return [];
    const ics: IcsEvent = {
      uid: e.uid,
      sequence: e.sequence,
      title: e.title,
      description: e.description,
      location: e.location,
      start: e.starts_at,
      end: e.ends_at,
      allDay: e.all_day,
      repeat: e.repeat,
      repeatUntil: e.repeat_until,
      organizer,
      attendees: e.attendees,
    };
    const when = fmt(e.starts_at, e.time_zone, e.all_day);
    const cancelled = method === 'CANCEL';
    const title = cancelled ? `Cancelado: ${e.title}` : e.title;
    const lines = [
      cancelled ? 'Este compromisso foi cancelado.' : 'Você foi convidado para um compromisso.',
      `Quando: ${when}`,
      ...(e.location ? [`Onde: ${e.location}`] : []),
      ...(e.description ? ['', e.description] : []),
    ];
    const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<div style="background:#fff;border:1px solid #e3e3e6;border-radius:14px;padding:28px">
<div style="font-size:13px;color:#5d5d65;margin:0 0 6px">${cancelled ? 'Compromisso cancelado' : 'Convite'}</div>
<h1 style="font-size:21px;line-height:28px;margin:0 0 16px">${esc(e.title)}</h1>
<p style="font-size:15px;line-height:23px;margin:0 0 6px"><strong>Quando:</strong> ${esc(when)}</p>
${e.location ? `<p style="font-size:15px;line-height:23px;margin:0 0 6px"><strong>Onde:</strong> ${esc(e.location)}</p>` : ''}
${e.description ? `<p style="font-size:15px;line-height:23px;margin:14px 0 0;white-space:pre-line">${esc(e.description)}</p>` : ''}
<p style="font-size:13px;line-height:20px;color:#5d5d65;margin:20px 0 0">Organizado por ${esc(organizer.name || organizer.email)}. ${cancelled ? '' : 'Abra o anexo para responder e pôr na sua agenda.'}</p>
</div></div></body></html>`;
    const data = Buffer.from(buildIcs(ics, method), 'utf8');
    const ids: string[] = [];
    for (const a of to)
      ids.push(
        await this.mail.enqueue(c, {
          kind: cancelled ? 'calendar.cancel' : 'calendar.invite',
          from: { address: organizer.email, name: organizer.name },
          to: [{ email: a.email, name: a.name }],
          subject: cancelled ? title : `Convite: ${e.title} (${when})`,
          html,
          text: lines.join('\n'),
          attachments: [
            {
              filename: cancelled ? 'cancelamento.ics' : 'convite.ics',
              contentType: `text/calendar; charset=utf-8; method=${method}`,
              data,
            },
          ],
        }),
      );
    return ids;
  }

  /** Tenta entregar agora; o que falhar fica na fila e sai depois sozinho. */
  private async deliverAll(ids: string[]) {
    for (const id of ids) await this.mail.deliver(id).catch(() => undefined);
  }

  async saveEvent(id: string | null, b: EventInput, a: Actor) {
    const attendees: Attendee[] = [];
    for (const x of b.attendees)
      if (!attendees.some((y) => y.email === x.email))
        attendees.push({ email: x.email, name: x.name, status: 'needs-action' });
    const queued: string[] = [];
    const saved = await this.db.tx(async (c) => {
      const organizer = await this.organizer(c, b.mailboxId);
      if (attendees.length && !organizer)
        throw new UnprocessableEntityException(
          'Escolha a caixa que envia o convite aos convidados',
        );
      const cur = id ? await this.eventRow(id, c, true) : null;
      if (cur?.cancelled_at) throw new ConflictException('Evento cancelado');
      // Quem já tinha respondido continua com a resposta, se o horário não mudou.
      const sameTime =
        cur &&
        cur.starts_at.getTime() === new Date(b.startsAt).getTime() &&
        cur.ends_at.getTime() === new Date(b.endsAt).getTime();
      const merged = attendees.map((x) => {
        const old = cur?.attendees.find((y) => y.email === x.email);
        return old && sameTime ? { ...x, status: old.status } : x;
      });
      const p = [
        b.mailboxId,
        b.title,
        b.description,
        b.location,
        b.startsAt,
        b.endsAt,
        b.allDay,
        b.timeZone,
        b.color,
        b.repeat,
        b.repeat === 'none' ? null : b.repeatUntil,
        JSON.stringify(merged),
      ];
      const { rows } = cur
        ? await c.query<EventRow>(
            `UPDATE mail_events
                SET mailbox_id = $1, title = $2, description = $3, location = $4, starts_at = $5,
                    ends_at = $6, all_day = $7, time_zone = $8, color = $9, repeat = $10,
                    repeat_until = $11, attendees = $12, sequence = sequence + 1, updated_at = now()
              WHERE id = $13 RETURNING ${EVENT_COLS}`,
            [...p, id],
          )
        : await c.query<EventRow>(
            `INSERT INTO mail_events (mailbox_id, title, description, location, starts_at, ends_at,
                                      all_day, time_zone, color, repeat, repeat_until, attendees, uid,
                                      created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${EVENT_COLS}`,
            [...p, `${randomUUID()}@comandou`, a.admin.id],
          );
      const e = rows[0]!;
      if (organizer && b.notify) {
        queued.push(...(await this.invite(c, e, organizer, 'REQUEST', e.attendees)));
        // Quem saiu da lista recebe o cancelamento.
        const removed = (cur?.attendees ?? []).filter(
          (x) => !e.attendees.some((y) => y.email === x.email),
        );
        queued.push(...(await this.invite(c, e, organizer, 'CANCEL', removed)));
      }
      await platformAudit(c, {
        adminId: a.admin.id,
        action: cur ? 'mail.event_updated' : 'mail.event_created',
        entity: 'mail_event',
        entityId: e.id,
        data: { title: e.title, attendees: e.attendees.length },
        ip: a.ip,
      });
      return e;
    });
    await this.deliverAll(queued);
    return eventView(saved);
  }

  async cancelEvent(id: string, a: Actor) {
    const queued: string[] = [];
    await this.db.tx(async (c) => {
      const cur = await this.eventRow(id, c, true);
      if (cur.cancelled_at) return;
      const { rows } = await c.query<EventRow>(
        `UPDATE mail_events SET cancelled_at = now(), sequence = sequence + 1, updated_at = now()
          WHERE id = $1 RETURNING ${EVENT_COLS}`,
        [id],
      );
      const organizer = await this.organizer(c, cur.mailbox_id).catch(() => null);
      if (organizer && cur.ends_at > new Date())
        queued.push(...(await this.invite(c, rows[0]!, organizer, 'CANCEL', cur.attendees)));
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.event_cancelled',
        entity: 'mail_event',
        entityId: id,
        data: { title: cur.title },
        ip: a.ip,
      });
    });
    await this.deliverAll(queued);
    return { ok: true };
  }

  /** Resposta de um convidado que chegou por e-mail (anexo .ics com METHOD:REPLY). */
  async applyReply(ics: string) {
    const r = parseIcsReply(ics);
    if (!r) return false;
    const rows = await this.db.query(
      `UPDATE mail_events e
          SET attendees = (
                SELECT jsonb_agg(CASE WHEN lower(x->>'email') = $2
                                      THEN jsonb_set(x, '{status}', to_jsonb($3::text)) ELSE x END)
                  FROM jsonb_array_elements(e.attendees) x),
              updated_at = now()
        WHERE e.uid = $1 AND e.cancelled_at IS NULL
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.attendees) x WHERE lower(x->>'email') = $2)
        RETURNING e.id`,
      [r.uid, r.email, r.status],
    );
    return rows.length > 0;
  }

  // ------------------------------------------------------------------ páginas de agendamento
  async pages() {
    return (
      await this.db.query<PageRow>(`SELECT ${PAGE_COLS} FROM mail_booking_pages ORDER BY title`)
    ).map(pageView);
  }

  async savePage(id: string | null, b: BookingPageInput, a: Actor) {
    for (const windows of Object.values(b.availability))
      for (const [from, to] of windows)
        if (to <= from)
          throw new UnprocessableEntityException('Em cada janela, o fim vem depois do começo');
    const p = [
      b.slug,
      b.title,
      b.description,
      b.location,
      b.durationMin,
      b.bufferMin,
      b.minNoticeHours,
      b.daysAhead,
      JSON.stringify(b.availability),
      b.timeZone,
      b.mailboxId,
      b.enabled,
    ];
    try {
      return await this.db.tx(async (c) => {
        const { rows } = id
          ? await c.query<PageRow>(
              `UPDATE mail_booking_pages
                  SET slug = $1, title = $2, description = $3, location = $4, duration_min = $5,
                      buffer_min = $6, min_notice_hours = $7, days_ahead = $8, availability = $9,
                      time_zone = $10, mailbox_id = $11, enabled = $12
                WHERE id = $13 RETURNING ${PAGE_COLS}`,
              [...p, id],
            )
          : await c.query<PageRow>(
              `INSERT INTO mail_booking_pages (slug, title, description, location, duration_min,
                                               buffer_min, min_notice_hours, days_ahead, availability,
                                               time_zone, mailbox_id, enabled)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${PAGE_COLS}`,
              p,
            );
        if (!rows[0]) throw new NotFoundException('Página não encontrada');
        await platformAudit(c, {
          adminId: a.admin.id,
          action: id ? 'mail.booking_page_updated' : 'mail.booking_page_created',
          entity: 'mail_booking_page',
          entityId: rows[0].id,
          data: { slug: b.slug },
          ip: a.ip,
        });
        return pageView(rows[0]);
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('Já existe uma página com este endereço');
      throw e;
    }
  }

  async deletePage(id: string, a: Actor) {
    await this.db.tx(async (c) => {
      const r = await c.query(`DELETE FROM mail_booking_pages WHERE id = $1`, [id]);
      if (!r.rowCount) throw new NotFoundException('Página não encontrada');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.booking_page_deleted',
        entity: 'mail_booking_page',
        entityId: id,
        ip: a.ip,
      });
    });
    return { ok: true };
  }

  private async publicPage(slug: string, c?: PoolClient): Promise<PageRow> {
    const sql = `SELECT ${PAGE_COLS} FROM mail_booking_pages WHERE slug = $1 AND enabled`;
    const rows = c
      ? (await c.query<PageRow>(sql, [slug])).rows
      : await this.db.query<PageRow>(sql, [slug]);
    if (!rows[0]) throw new NotFoundException('Página de agendamento não encontrada');
    return rows[0];
  }

  /** O que a página pública mostra (sem nada interno). */
  async pageInfo(slug: string) {
    const p = await this.publicPage(slug);
    return {
      slug: p.slug,
      title: p.title,
      description: p.description,
      location: p.location,
      durationMin: p.duration_min,
      timeZone: p.time_zone,
      daysAhead: p.days_ahead,
      /** Dias da semana com atendimento (0 = domingo), para o calendário apagar os outros. */
      weekdays: Object.entries(p.availability)
        .filter(([, w]) => w.length)
        .map(([d]) => Number(d)),
    };
  }

  /** Tudo o que ocupa a agenda entre dois instantes (com as repetições). */
  private async busy(from: Date, to: Date, c?: PoolClient) {
    const sql = `SELECT starts_at, ends_at, repeat, repeat_until::text AS repeat_until FROM mail_events
      WHERE cancelled_at IS NULL AND NOT all_day AND starts_at < $2
        AND ((repeat = 'none' AND ends_at > $1)
          OR (repeat <> 'none' AND (repeat_until IS NULL OR repeat_until >= $1::date)))`;
    type Row = { starts_at: Date; ends_at: Date; repeat: Repeat; repeat_until: string | null };
    const rows = c
      ? (await c.query<Row>(sql, [from, to])).rows
      : await this.db.query<Row>(sql, [from, to]);
    const out: { start: Date; end: Date }[] = [];
    for (const e of rows) {
      const len = e.ends_at.getTime() - e.starts_at.getTime();
      for (const s of occurrences(
        { start: e.starts_at, repeat: e.repeat, repeatUntil: e.repeat_until },
        new Date(from.getTime() - len),
        to,
      ))
        out.push({ start: s, end: new Date(s.getTime() + len) });
    }
    return out;
  }

  private async slotsOf(p: PageRow, date: string, c?: PoolClient): Promise<Date[]> {
    const dayStart = zonedToUtc(date, '00:00', p.time_zone);
    const dayEnd = new Date(dayStart.getTime() + 36 * 3600_000);
    const weekday = zonedDate(new Date(dayStart.getTime() + 12 * 3600_000), p.time_zone).weekday;
    const windows = p.availability[String(weekday)] ?? [];
    if (!windows.length) return [];
    const now = Date.now();
    return freeSlots({
      date,
      windows,
      timeZone: p.time_zone,
      durationMin: p.duration_min,
      bufferMin: p.buffer_min,
      busy: await this.busy(new Date(dayStart.getTime() - 12 * 3600_000), dayEnd, c),
      earliest: new Date(now + p.min_notice_hours * 3600_000),
      latest: new Date(now + p.days_ahead * 86_400_000),
    });
  }

  /** Horários livres de um dia (AAAA-MM-DD no fuso da página). */
  async slots(slug: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
      throw new UnprocessableEntityException('Data inválida');
    const p = await this.publicPage(slug);
    return { date, slots: (await this.slotsOf(p, date)).map((d) => d.toISOString()) };
  }

  /**
   * Marca um horário pela página pública. A conferência do horário e a gravação acontecem com a
   * página travada: duas pessoas não ficam com o mesmo horário. Limite por e-mail e por IP.
   */
  async book(slug: string, b: PublicBookingInput) {
    if (b.company) return { ok: true }; // robô: finge que deu certo
    const start = new Date(b.start);
    const queued: string[] = [];
    const result = await this.db.tx(async (c) => {
      const p = await this.publicPage(slug, c);
      await c.query(`SELECT 1 FROM mail_booking_pages WHERE id = $1 FOR UPDATE`, [p.id]);
      const recent = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM mail_events
          WHERE booking_page_id = $1 AND created_at > now() - interval '1 day'
            AND attendees->0->>'email' = $2`,
        [p.id, b.email],
      );
      if (recent.rows[0]!.n >= 5)
        throw new ThrottlerException('Muitos agendamentos em pouco tempo. Tente mais tarde.');
      const date = zonedDate(start, p.time_zone).date;
      const free = await this.slotsOf(p, date, c);
      if (!free.some((d) => d.getTime() === start.getTime()))
        throw new ConflictException('Este horário acabou de ser ocupado. Escolha outro.');
      const organizer = await this.organizer(c, p.mailbox_id).catch(() => null);
      const end = new Date(start.getTime() + p.duration_min * 60_000);
      const notes = [
        b.phone ? `Telefone: ${b.phone}` : '',
        b.notes ? `Observações: ${b.notes}` : '',
        `Marcado pela página /agendar/${p.slug}`,
      ]
        .filter(Boolean)
        .join('\n');
      const { rows } = await c.query<EventRow>(
        `INSERT INTO mail_events (mailbox_id, booking_page_id, title, description, location, starts_at,
                                  ends_at, time_zone, attendees, uid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${EVENT_COLS}`,
        [
          organizer ? p.mailbox_id : null,
          p.id,
          `${p.title}: ${b.name}`.slice(0, 200),
          notes,
          p.location,
          start,
          end,
          p.time_zone,
          JSON.stringify([{ email: b.email, name: b.name, status: 'accepted' }]),
          `${randomUUID()}@comandou`,
        ],
      );
      const e = rows[0]!;
      if (organizer) {
        // Confirmação para quem marcou (sem as anotações internas) e aviso para a caixa.
        queued.push(
          ...(await this.invite(
            c,
            { ...e, description: p.description },
            organizer,
            'REQUEST',
            e.attendees,
          )),
        );
        queued.push(
          await this.mail.enqueue(c, {
            kind: 'calendar.booking',
            to: [{ email: organizer.email, name: organizer.name }],
            replyTo: b.email,
            subject: `Novo agendamento: ${b.name} (${fmt(start, p.time_zone)})`,
            text: [
              `${b.name} <${b.email}> marcou "${p.title}".`,
              `Quando: ${fmt(start, p.time_zone)}`,
              ...(b.phone ? [`Telefone: ${b.phone}`] : []),
              ...(b.notes ? [`Observações: ${b.notes}`] : []),
            ].join('\n'),
          }),
        );
      }
      return { ok: true, startsAt: start, endsAt: end, title: p.title, timeZone: p.time_zone };
    });
    await this.deliverAll(queued);
    return result;
  }
}
