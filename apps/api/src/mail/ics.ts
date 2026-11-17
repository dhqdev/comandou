/**
 * Agenda: convite em iCalendar (.ics, RFC 5545) que o Gmail, o Outlook e o Apple Mail entendem,
 * leitura da resposta ("Aceito", "Recuso"), repetição de eventos e horário com fuso.
 */

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type PartStat = 'needs-action' | 'accepted' | 'declined' | 'tentative';

export interface Attendee {
  email: string;
  name?: string;
  status: PartStat;
}

export interface IcsEvent {
  uid: string;
  sequence: number;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  repeat: Repeat;
  /** Último dia da repetição (AAAA-MM-DD). */
  repeatUntil: string | null;
  organizer: { email: string; name?: string };
  attendees: Attendee[];
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

const dateStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

/** Texto de propriedade: barra, vírgula, ponto e vírgula e quebra de linha escapados. */
const icsText = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/\r\n?|\n/g, '\\n')
    .replace(/([,;])/g, '\\$1');

/** Parâmetro (CN=): sem aspas, ponto e vírgula, dois-pontos ou quebra de linha. */
const icsParam = (s: string) => s.replace(/["\r\n;:,]/g, ' ').trim();

/** Linhas de no máximo 75 octetos; a continuação começa com um espaço. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const RRULE: Record<Exclude<Repeat, 'none'>, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};

const PARTSTAT: Record<PartStat, string> = {
  'needs-action': 'NEEDS-ACTION',
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  tentative: 'TENTATIVE',
};

/** REQUEST: convite ou atualização. CANCEL: o evento foi cancelado. */
export function buildIcs(e: IcsEvent, method: 'REQUEST' | 'CANCEL', now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Comandou//Agenda//PT-BR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${icsText(e.uid)}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${utcStamp(now)}`,
    e.allDay ? `DTSTART;VALUE=DATE:${dateStamp(e.start)}` : `DTSTART:${utcStamp(e.start)}`,
    e.allDay ? `DTEND;VALUE=DATE:${dateStamp(e.end)}` : `DTEND:${utcStamp(e.end)}`,
    `SUMMARY:${icsText(e.title)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
  if (e.repeat !== 'none') {
    const until = e.repeatUntil ? `;UNTIL=${e.repeatUntil.replace(/-/g, '')}T235959Z` : '';
    lines.push(`RRULE:FREQ=${RRULE[e.repeat]}${until}`);
  }
  const cn = (n?: string) => (n && icsParam(n) ? `;CN=${icsParam(n)}` : '');
  lines.push(`ORGANIZER${cn(e.organizer.name)}:mailto:${e.organizer.email}`);
  for (const a of e.attendees)
    lines.push(
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=${PARTSTAT[a.status]};RSVP=TRUE${cn(a.name)}:mailto:${a.email}`,
    );
  lines.push(
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Resposta de um convidado (METHOD:REPLY): de qual evento, quem e o que respondeu. */
export function parseIcsReply(
  ics: string,
): { uid: string; email: string; status: PartStat } | null {
  const lines = ics
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
  const value = (name: string) => {
    const l = lines.find(
      (x) => x.toUpperCase().startsWith(`${name}:`) || x.toUpperCase().startsWith(`${name};`),
    );
    return l ? l.slice(l.indexOf(':') + 1).trim() : '';
  };
  if (value('METHOD').toUpperCase() !== 'REPLY') return null;
  const uid = value('UID');
  const att = lines.find((x) => /^ATTENDEE[;:]/i.test(x));
  if (!uid || !att) return null;
  const email = /mailto:([^\s;>]+)/i.exec(att)?.[1]?.toLowerCase();
  const stat = /PARTSTAT=([A-Z-]+)/i.exec(att)?.[1]?.toUpperCase();
  const status = (Object.keys(PARTSTAT) as PartStat[]).find((k) => PARTSTAT[k] === stat);
  if (!email || !status || status === 'needs-action') return null;
  return { uid: uid.slice(0, 255), email, status };
}

/** Deslocamento do fuso naquele instante, em ms (horário local = UTC + deslocamento). */
export function tzOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** "2026-11-20" + "14:30" no fuso informado → o instante exato. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = tzOffsetMs(timeZone, new Date(guess));
  let t = guess - off;
  const again = tzOffsetMs(timeZone, new Date(t));
  if (again !== off) t = guess - again;
  return new Date(t);
}

/** Data (AAAA-MM-DD) e dia da semana (0 = domingo) de um instante no fuso informado. */
export function zonedDate(
  at: Date,
  timeZone: string,
): { date: string; weekday: number; time: string } {
  const local = new Date(at.getTime() + tzOffsetMs(timeZone, at));
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    weekday: local.getUTCDay(),
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}

export const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * Inícios de um evento (com repetição) que caem em [from, to). Mensal e anual mantêm o dia do
 * mês; mês sem aquele dia (31, 29 de fevereiro) é pulado. No máximo `limit` ocorrências.
 */
export function occurrences(
  e: { start: Date; repeat: Repeat; repeatUntil: string | null },
  from: Date,
  to: Date,
  limit = 400,
): Date[] {
  if (e.repeat === 'none') return e.start >= from && e.start < to ? [e.start] : [];
  const until = e.repeatUntil ? new Date(`${e.repeatUntil}T23:59:59.999Z`).getTime() : Infinity;
  const out: Date[] = [];
  const s = e.start;
  const day = s.getUTCDate();
  for (let i = 0; i < 5000 && out.length < limit; i++) {
    let d: Date;
    if (e.repeat === 'daily') d = new Date(s.getTime() + i * 86_400_000);
    else if (e.repeat === 'weekly') d = new Date(s.getTime() + i * 7 * 86_400_000);
    else {
      const months = e.repeat === 'monthly' ? i : i * 12;
      d = new Date(
        Date.UTC(
          s.getUTCFullYear(),
          s.getUTCMonth() + months,
          day,
          s.getUTCHours(),
          s.getUTCMinutes(),
          s.getUTCSeconds(),
        ),
      );
      if (d.getUTCDate() !== day) continue;
    }
    const t = d.getTime();
    if (t > until || t >= to.getTime()) break;
    if (t >= from.getTime()) out.push(d);
  }
  return out;
}

export interface Window {
  start: Date;
  end: Date;
}

/**
 * Horários livres de um dia para a página de agendamento: fatia cada janela de atendimento em
 * blocos da duração pedida, tira o que bate com algo da agenda (mais a folga) e o que está
 * perto demais de agora.
 */
export function freeSlots(opts: {
  date: string;
  windows: [string, string][];
  timeZone: string;
  durationMin: number;
  bufferMin: number;
  busy: Window[];
  earliest: Date;
  latest: Date;
}): Date[] {
  const out: Date[] = [];
  const dur = opts.durationMin * 60_000;
  const buf = opts.bufferMin * 60_000;
  for (const [a, b] of opts.windows) {
    if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b)) continue;
    const end = zonedToUtc(opts.date, b, opts.timeZone).getTime();
    for (let t = zonedToUtc(opts.date, a, opts.timeZone).getTime(); t + dur <= end; t += dur) {
      if (t < opts.earliest.getTime() || t > opts.latest.getTime()) continue;
      const clash = opts.busy.some(
        (x) => t < x.end.getTime() + buf && t + dur + buf > x.start.getTime(),
      );
      if (!clash) out.push(new Date(t));
    }
  }
  return out.sort((x, y) => x.getTime() - y.getTime());
}
