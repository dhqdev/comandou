import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { normalizePhone, phoneOk } from '../store/customers.service';
import { publicTokenHash } from '../store/store.service';

export const RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'seated',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
/** Reservas que ainda ocupam lugar no salão. */
const ACTIVE: ReservationStatus[] = ['pending', 'confirmed', 'seated'];

export interface ReservationSettings {
  enabled: boolean;
  autoConfirm: boolean;
  weekdays: number[];
  opensAt: string;
  closesAt: string;
  slotMinutes: number;
  durationMinutes: number;
  maxParty: number;
  capacity: number | null;
  minAdvanceMinutes: number;
  maxDaysAhead: number;
  note: string | null;
}

const SETTINGS_COLS = `enabled, auto_confirm AS "autoConfirm", weekdays::int[] AS weekdays,
  to_char(opens_at, 'HH24:MI') AS "opensAt", to_char(closes_at, 'HH24:MI') AS "closesAt",
  slot_minutes AS "slotMinutes", duration_minutes AS "durationMinutes", max_party AS "maxParty",
  capacity, min_advance_minutes AS "minAdvanceMinutes", max_days_ahead AS "maxDaysAhead", note`;

const DEFAULTS: ReservationSettings = {
  enabled: false,
  autoConfirm: false,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  opensAt: '18:00',
  closesAt: '22:00',
  slotMinutes: 30,
  durationMinutes: 90,
  maxParty: 10,
  capacity: null,
  minAdvanceMinutes: 60,
  maxDaysAhead: 30,
  note: null,
};

const COLUMN: Record<keyof ReservationSettings, string> = {
  enabled: 'enabled',
  autoConfirm: 'auto_confirm',
  weekdays: 'weekdays',
  opensAt: 'opens_at',
  closesAt: 'closes_at',
  slotMinutes: 'slot_minutes',
  durationMinutes: 'duration_minutes',
  maxParty: 'max_party',
  capacity: 'capacity',
  minAdvanceMinutes: 'min_advance_minutes',
  maxDaysAhead: 'max_days_ahead',
  note: 'note',
};

const RES_COLS = `r.id, r.code, r.name, r.phone, r.email, r.party_size AS "partySize",
  r.starts_at AS "startsAt", r.duration_minutes AS "durationMinutes", r.occasion, r.notes,
  r.staff_notes AS "staffNotes", r.status, r.table_id AS "tableId", t.label AS "tableLabel",
  r.source, r.cancel_reason AS "cancelReason", r.cancelled_by AS "cancelledBy",
  r.customer_id AS "customerId", r.created_at AS "createdAt", r.status_changed_at AS "statusChangedAt"`;
const RES_FROM = `reservations r LEFT JOIN dining_tables t ON t.id = r.table_id`;

export interface Slot {
  time: string;
  startsAt: string;
  /** Lugares que sobram no horário (null = sem limite configurado). */
  remaining: number | null;
  available: boolean;
}

export interface PublicReservationInput {
  token: string;
  name: string;
  phone: string;
  email?: string;
  partySize: number;
  startsAt: string;
  occasion?: string;
  notes?: string;
  customerId?: string;
}

export interface StaffReservationInput {
  name: string;
  phone: string;
  email?: string | null;
  partySize: number;
  startsAt: string;
  occasion?: string | null;
  notes?: string | null;
  staffNotes?: string | null;
  tableId?: string | null;
  /** Tempo na mesa (minutos); sem ele, o tempo médio das configurações. */
  durationMinutes?: number;
  status?: ReservationStatus;
  cancelReason?: string | null;
  /** A equipe já conferiu: a comanda aberta na mesa é deste grupo (ao marcar "Chegou"). */
  tableBusyOk?: boolean;
}

/** Reserva pedida pela IA no WhatsApp: o telefone é o da própria conversa. */
export interface WhatsAppReservationInput {
  phone: string;
  name: string;
  partySize: number;
  /** Dia do expediente (AAAA-MM-DD), no relógio do restaurante. */
  date: string;
  /** Horário HH:MM; depois da meia-noite pertence ao expediente do dia anterior. */
  time: string;
  notes?: string | null;
}

/** Um dia do calendário de reservas (IA e PDF). */
export interface ReservationDay {
  date: string;
  weekday: number;
  /** O restaurante abre reservas neste dia (dia da semana liberado e dentro do prazo). */
  open: boolean;
  /** Horários que ainda aceitam reserva. */
  free: string[];
  /** Abre reservas, mas nenhum horário sobrou. */
  full: boolean;
}

/** Sem letras/números que se confundem ao telefone (0/O, 1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () =>
  Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Mensagem de erro de regra (422/409/404) em texto para a IA explicar; o resto vira genérico. */
function bookingError(e: unknown): string {
  if (
    e instanceof UnprocessableEntityException ||
    e instanceof ConflictException ||
    e instanceof NotFoundException
  ) {
    const r = e.getResponse() as string | { message?: string | string[] };
    const m = typeof r === 'string' ? r : r.message;
    return (Array.isArray(m) ? m[0] : m) ?? e.message;
  }
  return 'Não consegui conferir a reserva agora';
}

/**
 * Reservas de mesa: o cliente pede pelo cardápio online (horários livres conforme as regras do
 * restaurante) e a equipe confirma, marca a mesa, recebe o grupo e acompanha a agenda do dia.
 */
/** "2026-11-21" do instante no fuso da loja. */
export function dayInZone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async settingsIn(tx: Tx): Promise<ReservationSettings> {
    const s = await one<ReservationSettings>(
      tx,
      `SELECT ${SETTINGS_COLS} FROM reservation_settings`,
    );
    return s ?? { ...DEFAULTS };
  }

  /** Fuso do restaurante: os horários de reserva são sempre no relógio da casa. */
  private async tz(tx: Tx): Promise<string> {
    const r = await one<{ tz: string | null }>(
      tx,
      `SELECT timezone AS tz FROM tenants WHERE id = app_current_tenant()`,
    );
    return r?.tz || 'America/Sao_Paulo';
  }

  settings(ctx: Ctx) {
    return this.db.withTenant(ctx, (tx) => this.settingsIn(tx));
  }

  async updateSettings(ctx: Ctx, patch: Partial<ReservationSettings>) {
    return this.db.withTenant(ctx, async (tx) => {
      const next = { ...(await this.settingsIn(tx)), ...patch };
      if (!next.weekdays.length)
        throw new UnprocessableEntityException('Escolha ao menos um dia da semana');
      const keys = Object.keys(COLUMN) as (keyof ReservationSettings)[];
      const cols = keys.map((k) => COLUMN[k]);
      await q(
        tx,
        `INSERT INTO reservation_settings (tenant_id, ${cols.join(', ')})
         VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
         ON CONFLICT (tenant_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
        [ctx.tenantId, ...keys.map((k) => next[k])],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'reservations.settings_updated',
        entity: 'reservation_settings',
        entityId: ctx.tenantId,
        data: { changes: patch },
        ip: ctx.ip,
      });
      return this.settingsIn(tx);
    });
  }

  /** O que o cardápio precisa para montar a tela de reserva. */
  publicConfig(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.settingsIn(tx);
      // Reserva pelo cardápio só com a conta do cliente: sem contas na loja, não há reserva online.
      const accounts = await one<{ on: boolean }>(
        tx,
        `SELECT accounts_enabled AS on FROM tenant_store_settings`,
      );
      if (!s.enabled || accounts?.on === false) return { enabled: false as const };
      const tz = await this.tz(tx);
      const today = await one<{ d: string }>(
        tx,
        `SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS d`,
        [tz],
      );
      return {
        enabled: true as const,
        maxParty: s.maxParty,
        maxDaysAhead: s.maxDaysAhead,
        weekdays: s.weekdays,
        opensAt: s.opensAt,
        closesAt: s.closesAt,
        note: s.note,
        autoConfirm: s.autoConfirm,
        today: today!.d,
        timeZone: tz,
        /** Só quem tem a conta aberta reserva (o cardápio pede o login antes). */
        needsAccount: true as const,
      };
    });
  }

  /** Horários de um dia (no fuso do restaurante) e quantos lugares sobram em cada um. */
  private async slotsFor(
    tx: Tx,
    s: ReservationSettings,
    tz: string,
    date: string,
    ignoreId?: string,
  ): Promise<{ slots: Slot[]; closedReason: string | null }> {
    const today = (await one<{ d: string }>(
      tx,
      `SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS d`,
      [tz],
    ))!.d;
    if (date < today) return { slots: [], closedReason: 'Essa data já passou' };
    if (date > addDays(today, s.maxDaysAhead))
      return {
        slots: [],
        closedReason: `Reservas abertas para os próximos ${s.maxDaysAhead} dias`,
      };
    if (!s.weekdays.includes(weekdayOf(date)))
      return { slots: [], closedReason: 'Não abrimos reservas neste dia da semana' };

    let span = minutesOf(s.closesAt) - minutesOf(s.opensAt);
    if (span < 0) span += 1440; // passa da meia-noite
    const raw = await q<{ time: string; startsAt: Date }>(
      tx,
      `SELECT to_char(l, 'HH24:MI') AS time, (l AT TIME ZONE $4) AS "startsAt"
         FROM generate_series($1::date + $2::time, $1::date + $2::time + make_interval(mins => $3),
                              make_interval(mins => $5)) AS l`,
      [date, s.opensAt, span, tz, s.slotMinutes],
    );
    if (!raw.length) return { slots: [], closedReason: null };
    const first = raw[0]!.startsAt;
    const last = raw[raw.length - 1]!.startsAt;
    const dur = s.durationMinutes * 60_000;
    const booked = await q<{ startsAt: Date; dur: number; party: number }>(
      tx,
      `SELECT starts_at AS "startsAt", duration_minutes AS dur, party_size AS party
         FROM reservations
        WHERE status = ANY($1) AND starts_at < $3 AND starts_at + make_interval(mins => duration_minutes) > $2
          AND ($4::uuid IS NULL OR id <> $4)`,
      [ACTIVE, first, new Date(last.getTime() + dur), ignoreId ?? null],
    );
    const minStart = Date.now() + s.minAdvanceMinutes * 60_000;
    const slots = raw.map((r) => {
      const a = r.startsAt.getTime();
      const used = booked
        .filter((b) => {
          const b0 = b.startsAt.getTime();
          return b0 < a + dur && b0 + b.dur * 60_000 > a;
        })
        .reduce((n, b) => n + b.party, 0);
      const remaining = s.capacity === null ? null : Math.max(0, s.capacity - used);
      return {
        time: r.time,
        startsAt: r.startsAt.toISOString(),
        remaining,
        available: a >= minStart && (remaining === null || remaining > 0),
      };
    });
    return { slots, closedReason: null };
  }

  availability(tenantId: string, date: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.settingsIn(tx);
      if (!s.enabled) throw new NotFoundException('Este restaurante não está aceitando reservas');
      const r = await this.slotsFor(tx, s, await this.tz(tx), date);
      return { date, ...r };
    });
  }

  /** Reserva pedida pelo cliente no cardápio. Reenviar o mesmo token devolve a mesma reserva. */
  async createPublic(tenantId: string, input: PublicReservationInput, ip?: string) {
    // Reserva pelo cardápio só com cadastro: o restaurante sabe quem vem (e o cliente acompanha).
    if (!input.customerId)
      throw new ForbiddenException({
        message: 'Entre na sua conta para reservar',
        code: 'login_required',
      });
    const hash = publicTokenHash(input.token);
    const phone = normalizePhone(input.phone);
    if (!phoneOk(phone)) throw new UnprocessableEntityException('Telefone inválido (DDD + número)');
    const res = await this.db.withTenant({ tenantId }, async (tx) => {
      const s = await this.settingsIn(tx);
      if (!s.enabled) throw new NotFoundException('Este restaurante não está aceitando reservas');
      // Uma reserva por vez no restaurante: dois clientes não ficam com o último lugar.
      await this.lockFloor(tx, tenantId);
      const again = await one<{ id: string }>(
        tx,
        `SELECT id FROM reservations WHERE public_token_hash = $1`,
        [hash],
      );
      if (again) return { id: again.id, created: false };
      if (input.partySize > s.maxParty)
        throw new UnprocessableEntityException(
          `Para grupos com mais de ${s.maxParty} pessoas, fale com o restaurante`,
        );
      const tz = await this.tz(tx);
      const at = new Date(input.startsAt);
      const local = (await one<{ d: string }>(
        tx,
        `SELECT to_char($1::timestamptz AT TIME ZONE $2, 'YYYY-MM-DD') AS d`,
        [at, tz],
      ))!.d;
      // Horário depois da meia-noite pertence ao expediente do dia anterior.
      const days = [local, addDays(local, -1)];
      let slot: Slot | undefined;
      for (const d of days) {
        slot = (await this.slotsFor(tx, s, tz, d)).slots.find(
          (x) => Date.parse(x.startsAt) === at.getTime(),
        );
        if (slot) break;
      }
      if (!slot) throw new UnprocessableEntityException('Escolha um dos horários disponíveis');
      if (!slot.available || (slot.remaining !== null && slot.remaining < input.partySize))
        throw new ConflictException(
          slot.remaining
            ? `Só cabem mais ${slot.remaining} pessoas nesse horário. Escolha outro.`
            : 'Esse horário acabou de lotar. Escolha outro.',
        );
      const open = await one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM reservations
          WHERE phone = $1 AND status = ANY($2) AND starts_at > now()`,
        [phone, ACTIVE],
      );
      if (open!.n >= 3)
        throw new ConflictException(
          'Você já tem 3 reservas em aberto. Cancele uma ou fale com o restaurante.',
        );
      const code = await this.freeCode(tx);
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO reservations (tenant_id, code, customer_id, name, phone, email, party_size,
            starts_at, duration_minutes, occasion, notes, status, source, public_token_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'online',$13) RETURNING id`,
        [
          tenantId,
          code,
          input.customerId ?? null,
          input.name,
          phone,
          input.email ?? null,
          input.partySize,
          at,
          s.durationMinutes,
          input.occasion ?? null,
          input.notes ?? null,
          s.autoConfirm ? 'confirmed' : 'pending',
          hash,
        ],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: null,
        action: 'reservation.requested',
        entity: 'reservation',
        entityId: row!.id,
        data: { code, partySize: input.partySize, startsAt: at.toISOString() },
        ip,
      });
      return { id: row!.id, created: true };
    });
    if (res.created)
      this.realtime.publish(tenantId, { type: 'reservation.changed', reservationId: res.id });
    return this.publicView(tenantId, input.token);
  }

  /**
   * Acha o horário pedido (dia do expediente + HH:MM) e confere as regras do cardápio: dia
   * aberto, antecedência, lugares e o limite de 3 reservas em aberto por telefone.
   */
  private async checkBooking(
    tx: Tx,
    s: ReservationSettings,
    tz: string,
    input: { phone: string; partySize: number; date: string; time: string },
  ): Promise<Slot> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time))
      throw new UnprocessableEntityException('Data ou horário inválido');
    if (!Number.isInteger(input.partySize) || input.partySize < 1)
      throw new UnprocessableEntityException('Informe quantas pessoas vêm');
    if (input.partySize > s.maxParty)
      throw new UnprocessableEntityException(
        `Para grupos com mais de ${s.maxParty} pessoas, fale com o restaurante`,
      );
    const day = await this.slotsFor(tx, s, tz, input.date);
    let slot = day.slots.find((x) => x.time === input.time);
    // 00:30 de sábado pode ser do expediente de sexta (que passa da meia-noite).
    if (!slot && minutesOf(input.time) < minutesOf(s.opensAt))
      slot = (await this.slotsFor(tx, s, tz, addDays(input.date, -1))).slots.find(
        (x) => x.time === input.time,
      );
    if (!slot)
      throw new UnprocessableEntityException(
        day.closedReason ?? 'Esse horário não está na lista de horários de reserva',
      );
    if (!slot.available || (slot.remaining !== null && slot.remaining < input.partySize))
      throw new ConflictException(
        slot.remaining && Date.parse(slot.startsAt) >= Date.now() + s.minAdvanceMinutes * 60_000
          ? `Só cabem mais ${slot.remaining} pessoas nesse horário. Escolha outro.`
          : 'Esse horário não está mais disponível. Escolha outro.',
      );
    const open = await one<{ n: number }>(
      tx,
      `SELECT count(*)::int AS n FROM reservations
        WHERE phone = $1 AND status = ANY($2) AND starts_at > now()`,
      [input.phone, ACTIVE],
    );
    if (open!.n >= 3)
      throw new ConflictException(
        'Você já tem 3 reservas em aberto. Cancele uma ou fale com o restaurante.',
      );
    return slot;
  }

  /**
   * Calendário de reservas dos próximos dias (até o prazo do restaurante, no máximo `limit`):
   * quais dias abrem e os horários que sobram. Usado pela IA do WhatsApp e no PDF.
   */
  async calendarIn(tx: Tx, limit = 31) {
    const s = await this.settingsIn(tx);
    const tz = await this.tz(tx);
    const today = (await one<{ d: string }>(
      tx,
      `SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS d`,
      [tz],
    ))!.d;
    const days: ReservationDay[] = [];
    if (s.enabled)
      for (let i = 0; i <= Math.min(s.maxDaysAhead, limit); i++) {
        const date = addDays(today, i);
        const r = await this.slotsFor(tx, s, tz, date);
        const open = r.closedReason === null && r.slots.length > 0;
        const free = r.slots.filter((x) => x.available).map((x) => x.time);
        days.push({ date, weekday: weekdayOf(date), open, free, full: open && !free.length });
      }
    return { settings: s, tz, today, days };
  }

  /** Reservas futuras de um telefone (o cliente da conversa no WhatsApp). */
  upcomingByPhone(tx: Tx, phone: string) {
    return q<{
      code: string;
      name: string;
      partySize: number;
      startsAt: Date;
      status: ReservationStatus;
      day: string;
      time: string;
    }>(
      tx,
      `SELECT r.code, r.name, r.party_size AS "partySize", r.starts_at AS "startsAt", r.status,
              to_char(r.starts_at AT TIME ZONE z.tz, 'YYYY-MM-DD') AS day,
              to_char(r.starts_at AT TIME ZONE z.tz, 'HH24:MI') AS time
         FROM reservations r,
              (SELECT COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()),
                               'America/Sao_Paulo') AS tz) z
        WHERE r.phone = $1 AND r.status = ANY($2) AND r.starts_at > now() - interval '3 hours'
        ORDER BY r.starts_at LIMIT 5`,
      [phone, ACTIVE],
    );
  }

  /**
   * Confere (sem gravar) a reserva que a IA montou com o cliente. Devolve o erro em texto para a
   * IA explicar ao cliente, nunca lança.
   */
  async checkWhatsApp(
    tenantId: string,
    input: WhatsAppReservationInput,
  ): Promise<{ ok: true; startsAt: string; day: string } | { ok: false; error: string }> {
    const phone = normalizePhone(input.phone);
    // Conversa com número escondido (@lid): sem telefone não há como gravar a reserva depois do SIM.
    if (!phoneOk(phone))
      return {
        ok: false,
        error:
          'Não consigo ver o seu número nesta conversa, então não dá para reservar por aqui. Peça para falar com a equipe',
      };
    try {
      return await this.db.withTenant({ tenantId }, async (tx) => {
        const s = await this.settingsIn(tx);
        if (!s.enabled)
          return { ok: false as const, error: 'O restaurante não está aceitando reservas' };
        const tz = await this.tz(tx);
        const slot = await this.checkBooking(tx, s, tz, { ...input, phone });
        return { ok: true as const, startsAt: slot.startsAt, day: dayInZone(slot.startsAt, tz) };
      });
    } catch (e) {
      return { ok: false, error: bookingError(e) };
    }
  }

  /**
   * Grava a reserva pedida no WhatsApp (depois do SIM do cliente). Passa pelas mesmas regras do
   * cardápio e pela mesma trava; o telefone é o da conversa, então o cliente não reserva em nome
   * de outro número.
   */
  async createWhatsApp(
    tenantId: string,
    input: WhatsAppReservationInput,
  ): Promise<
    | {
        ok: true;
        code: string;
        status: ReservationStatus;
        startsAt: string;
        /** Dia de verdade no fuso da loja (00:30 do expediente de sexta já é sábado). */
        day: string;
        note: string | null;
      }
    | { ok: false; error: string }
  > {
    const phone = normalizePhone(input.phone);
    if (!phoneOk(phone)) return { ok: false, error: 'Telefone inválido' };
    let res: {
      id: string;
      code: string;
      status: ReservationStatus;
      startsAt: string;
      day: string;
      note: string | null;
    };
    try {
      res = await this.db.withTenant({ tenantId }, async (tx) => {
        const s = await this.settingsIn(tx);
        if (!s.enabled) throw new NotFoundException('O restaurante não está aceitando reservas');
        await this.lockFloor(tx, tenantId);
        const tz = await this.tz(tx);
        const slot = await this.checkBooking(tx, s, tz, { ...input, phone });
        const code = await this.freeCode(tx);
        const status: ReservationStatus = s.autoConfirm ? 'confirmed' : 'pending';
        const row = await one<{ id: string }>(
          tx,
          `INSERT INTO reservations (tenant_id, code, name, phone, party_size, starts_at,
              duration_minutes, notes, status, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'whatsapp') RETURNING id`,
          [
            tenantId,
            code,
            input.name.trim().slice(0, 80),
            phone,
            input.partySize,
            new Date(slot.startsAt),
            s.durationMinutes,
            input.notes?.trim().slice(0, 500) || null,
            status,
          ],
        );
        await this.audit.record(tx, {
          tenantId,
          actorUserId: null,
          action: 'reservation.requested',
          entity: 'reservation',
          entityId: row!.id,
          data: { code, partySize: input.partySize, startsAt: slot.startsAt, via: 'whatsapp' },
        });
        return {
          id: row!.id,
          code,
          status,
          startsAt: slot.startsAt,
          day: dayInZone(slot.startsAt, tz),
          note: s.note,
        };
      });
    } catch (e) {
      return { ok: false, error: bookingError(e) };
    }
    this.realtime.publish(tenantId, { type: 'reservation.changed', reservationId: res.id });
    return {
      ok: true,
      code: res.code,
      status: res.status,
      startsAt: res.startsAt,
      day: res.day,
      note: res.note,
    };
  }

  /** Cancela pelo WhatsApp: só reserva deste telefone, ainda por vir e não recebida. */
  async cancelWhatsApp(
    tenantId: string,
    phoneRaw: string,
    code: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const phone = normalizePhone(phoneRaw);
    const r = await this.db.withTenant({ tenantId }, async (tx) => {
      const row = await one<{ id: string; status: ReservationStatus; startsAt: Date }>(
        tx,
        `SELECT id, status, starts_at AS "startsAt" FROM reservations
          WHERE code = $1 AND phone = $2 FOR UPDATE`,
        [code.toUpperCase(), phone],
      );
      if (!row) return { ok: false as const, error: 'Não achei essa reserva neste número' };
      if (row.status === 'cancelled') return { ok: true as const, id: null };
      if (
        (row.status !== 'pending' && row.status !== 'confirmed') ||
        row.startsAt.getTime() <= Date.now()
      )
        return { ok: false as const, error: 'Essa reserva não pode mais ser cancelada por aqui' };
      await q(
        tx,
        `UPDATE reservations SET status = 'cancelled', cancelled_by = 'customer',
                cancel_reason = 'Cancelada pelo cliente no WhatsApp', status_changed_at = now()
          WHERE id = $1`,
        [row.id],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: null,
        action: 'reservation.cancelled_by_customer',
        entity: 'reservation',
        entityId: row.id,
        data: { via: 'whatsapp' },
      });
      return { ok: true as const, id: row.id };
    });
    if (!r.ok) return r;
    if (r.id) this.realtime.publish(tenantId, { type: 'reservation.changed', reservationId: r.id });
    return { ok: true };
  }

  private async freeCode(tx: Tx) {
    for (let i = 0; i < 20; i++) {
      const c = newCode();
      const used = await one(tx, `SELECT 1 FROM reservations WHERE code = $1`, [c]);
      if (!used) return c;
    }
    throw new ConflictException('Não foi possível gerar o código da reserva; tente de novo');
  }

  /** Acompanhamento da reserva pelo link do cliente (só o necessário, sem dados da equipe). */
  publicView(tenantId: string, token: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<{
        code: string;
        name: string;
        partySize: number;
        startsAt: Date;
        occasion: string | null;
        notes: string | null;
        status: ReservationStatus;
        tableLabel: string | null;
        cancelReason: string | null;
        cancelledBy: string | null;
      }>(
        tx,
        `SELECT r.code, r.name, r.party_size AS "partySize", r.starts_at AS "startsAt", r.occasion,
                r.notes, r.status, t.label AS "tableLabel", r.cancel_reason AS "cancelReason",
                r.cancelled_by AS "cancelledBy"
           FROM ${RES_FROM} WHERE r.public_token_hash = $1`,
        [publicTokenHash(token)],
      );
      if (!r) throw new NotFoundException('Reserva não encontrada');
      const s = await this.settingsIn(tx);
      return {
        ...r,
        note: s.note,
        // Horário mostrado sempre no relógio do restaurante, onde quer que o cliente esteja.
        timeZone: await this.tz(tx),
        canCancel:
          (r.status === 'pending' || r.status === 'confirmed') && r.startsAt.getTime() > Date.now(),
      };
    });
  }

  async cancelByCustomer(tenantId: string, token: string, ip?: string) {
    const id = await this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<{ id: string; status: ReservationStatus; startsAt: Date }>(
        tx,
        `SELECT id, status, starts_at AS "startsAt" FROM reservations
          WHERE public_token_hash = $1 FOR UPDATE`,
        [publicTokenHash(token)],
      );
      if (!r) throw new NotFoundException('Reserva não encontrada');
      if (r.status === 'cancelled') return r.id;
      if (
        (r.status !== 'pending' && r.status !== 'confirmed') ||
        r.startsAt.getTime() <= Date.now()
      )
        throw new ConflictException('Essa reserva não pode mais ser cancelada pelo link');
      await q(
        tx,
        `UPDATE reservations SET status = 'cancelled', cancelled_by = 'customer',
                cancel_reason = 'Cancelada pelo cliente', status_changed_at = now()
          WHERE id = $1`,
        [r.id],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: null,
        action: 'reservation.cancelled_by_customer',
        entity: 'reservation',
        entityId: r.id,
        ip,
      });
      return r.id;
    });
    this.realtime.publish(tenantId, { type: 'reservation.changed', reservationId: id });
    return this.publicView(tenantId, token);
  }

  /** Agenda da equipe: reservas que começam no período. */
  list(ctx: Ctx, from: string, to: string) {
    return this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `SELECT ${RES_COLS} FROM ${RES_FROM}
          WHERE r.starts_at >= $1 AND r.starts_at < $2 ORDER BY r.starts_at, r.created_at`,
        [from, to],
      ),
    );
  }

  private async view(tx: Tx, id: string) {
    const r = await one(tx, `SELECT ${RES_COLS} FROM ${RES_FROM} WHERE r.id = $1`, [id]);
    if (!r) throw new NotFoundException('Reserva não encontrada');
    return r;
  }

  private async checkTable(tx: Tx, tableId: string | null | undefined) {
    if (!tableId) return;
    const t = await one(tx, `SELECT 1 FROM dining_tables WHERE id = $1 AND active`, [tableId]);
    if (!t) throw new UnprocessableEntityException('Mesa não encontrada');
  }

  /**
   * Uma mudança de reserva por vez no restaurante (cardápio e equipe usam a mesma trava): duas
   * pessoas não marcam a mesma mesa no mesmo horário, nem ficam com o último lugar.
   */
  private lockFloor(tx: Tx, tenantId: string) {
    return q(tx, `SELECT pg_advisory_xact_lock(hashtext('reservations:' || $1::text))`, [tenantId]);
  }

  /** A mesa não pode estar marcada para outra reserva ativa com horário que se cruza. */
  private async assertTableFree(
    tx: Tx,
    tableId: string,
    startsAt: Date,
    durationMinutes: number,
    ignoreId?: string,
  ) {
    const clash = await one<{ name: string; time: string; label: string; day: string }>(
      tx,
      `SELECT r.name, t.label,
              to_char(r.starts_at AT TIME ZONE $5, 'HH24:MI') AS time,
              to_char(r.starts_at AT TIME ZONE $5, 'DD/MM') AS day
         FROM reservations r JOIN dining_tables t ON t.id = r.table_id
        WHERE r.table_id = $1 AND r.status = ANY($2)
          AND r.starts_at < $3::timestamptz + make_interval(mins => $4)
          AND r.starts_at + make_interval(mins => r.duration_minutes) > $3::timestamptz
          AND ($6::uuid IS NULL OR r.id <> $6)
        ORDER BY r.starts_at LIMIT 1`,
      [tableId, ACTIVE, startsAt, durationMinutes, await this.tz(tx), ignoreId ?? null],
    );
    if (clash)
      throw new ConflictException({
        message: `A mesa ${clash.label} já está reservada para ${clash.name} em ${clash.day} às ${clash.time}. Escolha outra mesa.`,
        code: 'table_reserved',
      });
  }

  /**
   * O grupo chegou e a mesa marcada tem comanda aberta: avisa a equipe (pode ser outro cliente
   * sentado ali). Se a comanda já é deste grupo, a equipe confirma e segue.
   */
  private async assertTableNotOccupied(tx: Tx, tableId: string) {
    const tab = await one<{ number: number; label: string; customer: string | null }>(
      tx,
      `SELECT tb.number, t.label, tb.customer_name AS customer
         FROM tabs tb JOIN dining_tables t ON t.id = tb.table_id
        WHERE tb.table_id = $1 AND tb.status = 'open'`,
      [tableId],
    );
    if (tab)
      throw new ConflictException({
        message: `A mesa ${tab.label} está ocupada (comanda #${tab.number}${tab.customer ? `, ${tab.customer}` : ''}). Troque a mesa da reserva ou confirme que a comanda é deste grupo.`,
        code: 'table_busy',
      });
  }

  /** Reserva lançada pela equipe (telefone, balcão). Não passa pelas regras do cardápio. */
  async create(ctx: Ctx, input: StaffReservationInput) {
    const phone = normalizePhone(input.phone);
    if (!phoneOk(phone)) throw new UnprocessableEntityException('Telefone inválido (DDD + número)');
    const res = await this.db.withTenant(ctx, async (tx) => {
      await this.checkTable(tx, input.tableId);
      const s = await this.settingsIn(tx);
      const status = input.status ?? 'confirmed';
      const duration = input.durationMinutes ?? s.durationMinutes;
      if (input.tableId && ACTIVE.includes(status)) {
        await this.lockFloor(tx, ctx.tenantId);
        await this.assertTableFree(tx, input.tableId, new Date(input.startsAt), duration);
        if (status === 'seated' && !input.tableBusyOk)
          await this.assertTableNotOccupied(tx, input.tableId);
      }
      const code = await this.freeCode(tx);
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO reservations (tenant_id, code, name, phone, email, party_size, starts_at,
            duration_minutes, occasion, notes, staff_notes, table_id, status, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'staff',$14) RETURNING id`,
        [
          ctx.tenantId,
          code,
          input.name,
          phone,
          input.email ?? null,
          input.partySize,
          new Date(input.startsAt),
          duration,
          input.occasion ?? null,
          input.notes ?? null,
          input.staffNotes ?? null,
          input.tableId ?? null,
          status,
          ctx.userId,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'reservation.created',
        entity: 'reservation',
        entityId: row!.id,
        data: { code, partySize: input.partySize },
        ip: ctx.ip,
      });
      return this.view(tx, row!.id);
    });
    this.realtime.publish(ctx.tenantId, {
      type: 'reservation.changed',
      reservationId: (res as { id: string }).id,
    });
    return res;
  }

  async update(ctx: Ctx, id: string, patch: Partial<StaffReservationInput>) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      // Trava antes de ler: outra pessoa mexendo na agenda espera esta mudança terminar.
      await this.lockFloor(tx, ctx.tenantId);
      const cur = await one<{
        status: ReservationStatus;
        tableId: string | null;
        startsAt: Date;
        dur: number;
      }>(
        tx,
        `SELECT status, table_id AS "tableId", starts_at AS "startsAt", duration_minutes AS dur
           FROM reservations WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!cur) throw new NotFoundException('Reserva não encontrada');
      if (patch.tableId) await this.checkTable(tx, patch.tableId);
      const next = {
        status: patch.status ?? cur.status,
        tableId: patch.tableId !== undefined ? patch.tableId : cur.tableId,
        startsAt: patch.startsAt !== undefined ? new Date(patch.startsAt) : cur.startsAt,
        dur: patch.durationMinutes ?? cur.dur,
      };
      if (next.tableId && ACTIVE.includes(next.status)) {
        const moved =
          next.tableId !== cur.tableId ||
          next.startsAt.getTime() !== cur.startsAt.getTime() ||
          next.dur !== cur.dur ||
          !ACTIVE.includes(cur.status);
        if (moved) await this.assertTableFree(tx, next.tableId, next.startsAt, next.dur, id);
        const arriving =
          next.status === 'seated' && (cur.status !== 'seated' || next.tableId !== cur.tableId);
        if (arriving && !patch.tableBusyOk) await this.assertTableNotOccupied(tx, next.tableId);
      }
      const sets: string[] = [];
      const vals: unknown[] = [];
      const set = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      if (patch.name !== undefined) set('name', patch.name);
      if (patch.phone !== undefined) {
        const p = normalizePhone(patch.phone);
        if (!phoneOk(p)) throw new UnprocessableEntityException('Telefone inválido (DDD + número)');
        set('phone', p);
      }
      if (patch.email !== undefined) set('email', patch.email);
      if (patch.partySize !== undefined) set('party_size', patch.partySize);
      if (patch.startsAt !== undefined) set('starts_at', new Date(patch.startsAt));
      if (patch.durationMinutes !== undefined) set('duration_minutes', patch.durationMinutes);
      if (patch.occasion !== undefined) set('occasion', patch.occasion);
      if (patch.notes !== undefined) set('notes', patch.notes);
      if (patch.staffNotes !== undefined) set('staff_notes', patch.staffNotes);
      if (patch.tableId !== undefined) set('table_id', patch.tableId);
      if (patch.status !== undefined && patch.status !== cur.status) {
        set('status', patch.status);
        sets.push('status_changed_at = now()');
        if (patch.status === 'cancelled') {
          set('cancelled_by', 'staff');
          set('cancel_reason', patch.cancelReason ?? null);
        } else if (cur.status === 'cancelled') {
          sets.push('cancelled_by = NULL', 'cancel_reason = NULL');
        }
      }
      if (sets.length) {
        vals.push(id);
        await q(tx, `UPDATE reservations SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
        await this.audit.record(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action:
            patch.status && patch.status !== cur.status
              ? `reservation.${patch.status}`
              : 'reservation.updated',
          entity: 'reservation',
          entityId: id,
          data: { changes: { ...patch, tableBusyOk: undefined } },
          ip: ctx.ip,
        });
      }
      return this.view(tx, id);
    });
    this.realtime.publish(ctx.tenantId, { type: 'reservation.changed', reservationId: id });
    return res;
  }
}
