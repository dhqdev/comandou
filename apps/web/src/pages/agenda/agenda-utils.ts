/** Contas de data da Agenda, sempre no fuso do aparelho. A semana começa no domingo. */

export interface AgendaEvent {
  id: string;
  title: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  tagId: string | null;
  done: boolean;
  remindAt: string | null;
  remindedAt: string | null;
  remindError: string | null;
  /** Fiado: o pedido e quanto ainda falta pagar. */
  order?: { id: string; number: number; status: string; balance: string } | null;
  /** Fiado: a cobrança que vai para o WhatsApp de quem deve, no horário do compromisso. */
  charge?: {
    name: string | null;
    phone: string;
    at: string;
    sentAt: string | null;
    error: string | null;
  } | null;
}

export interface AgendaTag {
  id: string;
  name: string;
  color: string;
}

export interface AgendaSettings {
  whatsappEnabled: boolean;
  phone: string | null;
  /** O WhatsApp do restaurante está conectado pelo QR Code e consegue mandar o lembrete. */
  whatsappReady: boolean;
}

export type AgendaView = 'day' | 'week' | 'month' | 'list';

/** Cores das tags (o usuário escolhe uma). Todas leem bem com texto escuro ou claro por cima. */
export const TAG_COLORS = [
  '#E03150',
  '#E8710A',
  '#C98A04',
  '#0C8040',
  '#0F8B8D',
  '#0369A1',
  '#2A6FDB',
  '#4F46E5',
  '#7C3AED',
  '#D63384',
  '#64748B',
];

export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const pad = (n: number) => String(n).padStart(2, '0');
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
/** AAAA-MM-DD. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const weekStart = (d: Date) => addDays(startOfDay(d), -d.getDay());
export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** Junta "AAAA-MM-DD" e "HH:MM" numa data local. */
export function joinLocal(day: string, time: string) {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return new Date(y!, m! - 1, d!, h ?? 0, mi ?? 0);
}

/** As 42 casas (6 semanas) do mês, começando no domingo. */
export function monthGrid(anchor: Date) {
  const start = weekStart(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Período que cada visão carrega. */
export function rangeOf(view: AgendaView, cursor: Date) {
  if (view === 'month') {
    const g = monthGrid(cursor);
    return { from: g[0]!, to: addDays(g[41]!, 1) };
  }
  if (view === 'week') {
    const from = weekStart(cursor);
    return { from, to: addDays(from, 7) };
  }
  if (view === 'day') return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 1) };
  return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 60) };
}

/** Anda um passo (dia, semana ou mês) para frente ou para trás. */
export function stepCursor(view: AgendaView, cursor: Date, dir: number) {
  if (view === 'month') return new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
  if (view === 'week') return addDays(cursor, dir * 7);
  if (view === 'list') return addDays(cursor, dir * 30);
  return addDays(cursor, dir);
}

/** Título da barra: "Novembro de 2026", "16 – 22 de nov. de 2026", "Quarta, 18 de novembro". */
export function titleOf(view: AgendaView, cursor: Date, short = false) {
  if (view === 'month')
    return `${cap(MONTHS[cursor.getMonth()]!)} ${short ? '' : 'de '}${cursor.getFullYear()}`;
  if (view === 'week') {
    const a = weekStart(cursor);
    // Celular: só o mês (o do sábado) e o ano, para caber na barra.
    if (short) return `${cap(MONTHS[addDays(a, 6).getMonth()]!)} ${addDays(a, 6).getFullYear()}`;
    const b = addDays(a, 6);
    const m = (d: Date) => MONTHS[d.getMonth()]!.slice(0, 3);
    if (a.getMonth() === b.getMonth())
      return `${a.getDate()} – ${b.getDate()} de ${m(b)}. de ${b.getFullYear()}`;
    if (a.getFullYear() === b.getFullYear())
      return `${a.getDate()} de ${m(a)}. – ${b.getDate()} de ${m(b)}. de ${b.getFullYear()}`;
    return `${a.getDate()} de ${m(a)}. de ${a.getFullYear()} – ${b.getDate()} de ${m(b)}. de ${b.getFullYear()}`;
  }
  if (view === 'day')
    return cap(
      cursor.toLocaleDateString('pt-BR', {
        weekday: short ? 'short' : 'long',
        day: 'numeric',
        month: short ? 'short' : 'long',
      }),
    ).replace(/\./g, '');
  return 'Próximos dias';
}

/** O compromisso aparece neste dia? (vale para os que atravessam a meia-noite e os de vários dias). */
export function onDay(e: AgendaEvent, day: Date) {
  const s = new Date(e.startsAt);
  const end = new Date(e.endsAt);
  const a = startOfDay(day);
  const b = addDays(a, 1);
  if (e.allDay) return startOfDay(s) <= a && startOfDay(end) >= a;
  if (end.getTime() === s.getTime()) return s >= a && s < b;
  return s < b && end > a;
}

/** Ocupa o dia inteiro na grade de horas? (dia todo ou mais de 24 h): vai para a faixa de cima. */
export const isAllDayLike = (e: AgendaEvent) =>
  e.allDay || new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime() >= 86_400_000;

export interface Placed {
  ev: AgendaEvent;
  /** Minuto do dia em que começa e termina neste dia (corta o que vem de ontem ou vai para amanhã). */
  top: number;
  bottom: number;
  col: number;
  cols: number;
}

/**
 * Posição dos compromissos com hora num dia: os que se sobrepõem dividem a largura em colunas,
 * como no Google Agenda. Mínimo de 20 minutos de altura para dar para ler.
 */
export function layoutDay(events: AgendaEvent[], day: Date): Placed[] {
  const a = startOfDay(day).getTime();
  const items = events
    .filter((e) => !isAllDayLike(e) && onDay(e, day))
    .map((ev) => {
      const s = Math.max(0, (new Date(ev.startsAt).getTime() - a) / 60_000);
      const e = Math.min(1440, (new Date(ev.endsAt).getTime() - a) / 60_000);
      return { ev, top: s, bottom: Math.max(e, s + 20), col: 0, cols: 1 };
    })
    .sort((x, y) => x.top - y.top || y.bottom - x.bottom);
  // Agrupa os que se encostam e reparte as colunas dentro de cada grupo.
  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => {
    const ends: number[] = [];
    for (const it of group) {
      let c = ends.findIndex((end) => end <= it.top);
      if (c < 0) c = ends.length;
      ends[c] = it.bottom;
      it.col = c;
    }
    for (const it of group) it.cols = ends.length;
    group = [];
  };
  for (const it of items) {
    if (group.length && it.top >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    group.push(it);
    groupEnd = Math.max(groupEnd, it.bottom);
  }
  if (group.length) flush();
  return items;
}

/** Ordem dentro de um dia: dia todo primeiro, depois por horário. */
export function sortEvents(list: AgendaEvent[]) {
  return [...list].sort(
    (a, b) =>
      Number(isAllDayLike(b)) - Number(isAllDayLike(a)) ||
      a.startsAt.localeCompare(b.startsAt) ||
      a.title.localeCompare(b.title),
  );
}

/** "14:00 – 15:30", "Dia todo" ou "14:00". */
export function timeLabel(e: AgendaEvent) {
  if (e.allDay) return 'Dia todo';
  const s = new Date(e.startsAt);
  const end = new Date(e.endsAt);
  if (end.getTime() === s.getTime()) return hhmm(s);
  if (!sameDay(s, end))
    return `${hhmm(s)} – ${end.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hhmm(end)}`;
  return `${hhmm(s)} – ${hhmm(end)}`;
}

/** Opções de lembrete: quantos minutos antes do começo (dia todo: a partir da meia-noite). */
export const REMIND_PRESETS: { value: string; label: string; minutes: number; allDay: boolean }[] =
  [
    { value: '0', label: 'Na hora', minutes: 0, allDay: false },
    { value: '10', label: '10 minutos antes', minutes: 10, allDay: false },
    { value: '30', label: '30 minutos antes', minutes: 30, allDay: false },
    { value: '60', label: '1 hora antes', minutes: 60, allDay: false },
    { value: '120', label: '2 horas antes', minutes: 120, allDay: false },
    { value: '1440', label: '1 dia antes', minutes: 1440, allDay: false },
    // Dia todo: no próprio dia às 8h, ou na véspera às 18h.
    { value: '-480', label: 'No dia, às 8h', minutes: -480, allDay: true },
    { value: '360', label: 'Na véspera, às 18h', minutes: 360, allDay: true },
  ];

/** Qual opção bate com o lembrete salvo ('' = sem lembrete; 'custom' = outro horário). */
export function presetOf(start: Date, remindAt: Date | null, allDay: boolean) {
  if (!remindAt) return '';
  const diff = Math.round((start.getTime() - remindAt.getTime()) / 60_000);
  const p = REMIND_PRESETS.find((x) => x.allDay === allDay && x.minutes === diff);
  return p ? p.value : 'custom';
}

/** "(11) 98765-4321" a partir de 5511987654321. */
export function fmtPhone(p: string | null) {
  if (!p) return '';
  const d = p.replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
}
