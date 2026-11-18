import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  Search,
  Settings2,
  Store,
  Users,
  X,
} from 'lucide-react';
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '../app/auth';
import { Alert, Button, Calendar, Modal, Segmented, Spinner, useToast } from '../design-system';
import { api, ApiError } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { useArrivalSound } from '../lib/sounds';
import {
  addDays,
  addMinutes,
  AgendaEvent,
  AgendaView,
  cap,
  dayKey,
  hhmm,
  layoutDay,
  minutesOfDay,
  monthGrid,
  onDay,
  rangeOf,
  sameDay,
  sortEvents,
  startOfDay,
  stepCursor,
  titleOf,
  weekStart,
  WEEKDAYS_SHORT,
} from './agenda/agenda-utils';
import {
  DiningTable,
  isClosed,
  isoDay,
  Reservation,
  RESERVATION_STATUS,
  ReservationCard,
  ReservationForm,
  ReservationStatus,
  Settings,
  SettingsModal,
  STATUS_COLOR,
  STATUS_ORDER,
} from './reservations/parts';
import './agenda/agenda.css';
import './reservations.css';

export { RESERVATION_STATUS };
export type { Reservation, ReservationStatus };

const HOUR_PX = 56;
const PHONE_MQ = '(max-width: 860px)';
const VIEW_KEY = 'cm-rv-view';
/** Quanto tempo o cartão que mudou fica marcado depois de um aviso em tempo real. */
const FRESH_MS = 2400;

const readLocal = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeLocal = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sem armazenamento */
  }
};

function usePhone() {
  const [phone, setPhone] = useState(() => matchMedia(PHONE_MQ).matches);
  useEffect(() => {
    const mq = matchMedia(PHONE_MQ);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** A reserva no formato da Agenda, para usar as mesmas contas de dia, semana e mês. */
type RvEvent = AgendaEvent & { r: Reservation };
const toEvent = (r: Reservation): RvEvent =>
  ({
    id: r.id,
    title: r.name,
    notes: null,
    startsAt: r.startsAt,
    endsAt: new Date(Date.parse(r.startsAt) + r.durationMinutes * 60_000).toISOString(),
    allDay: false,
    tagId: r.status,
    done: isClosed(r.status),
    remindAt: null,
    remindedAt: null,
    remindError: null,
    r,
  }) as RvEvent;

const colorOf = (r: Reservation) =>
  ({ ['--ev' as string]: STATUS_COLOR[r.status] }) as CSSProperties;
const live = (r: Reservation) => r.status !== 'cancelled' && r.status !== 'no_show';
const people = (rs: Reservation[]) => rs.reduce((n, r) => n + r.partySize, 0);

type Patch = Partial<Reservation> & { tableBusyOk?: boolean };
type Editing = { r: Reservation | null; day: string; time?: string };

/**
 * Reservas no jeito da Agenda: painel do lado (Nova reserva, minicalendário, resumo do dia,
 * filtro por situação e reservas pelo cardápio) e as visões Dia, Semana, Mês e Lista. No Dia,
 * os cartões com as ações ficam ao lado da grade de horários; no celular, o mês mostra
 * pontinhos e os cartões do dia tocado embaixo.
 */
export function ReservationsPage() {
  const { me } = useAuth();
  const toast = useToast();
  const phone = usePhone();
  const canManage = !!me?.permissions.includes('settings:manage');
  const [view, setView] = useState<AgendaView>(() =>
    readLocal<AgendaView>(VIEW_KEY, matchMedia(PHONE_MQ).matches ? 'month' : 'day'),
  );
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [list, setList] = useState<Reservation[] | null>(null);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tags de situação no topo: nenhuma escolhida = Todas (sem Cancelada e Não veio).
  const [picked, setPicked] = useState<ReservationStatus[]>([]);
  // Reservas que acabaram de mudar por outra pessoa, pelo cliente ou pelo sistema.
  const [fresh, setFresh] = useState<string[]>([]);
  const [search, setSearch] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'settings' | 'side' | null>(null);

  const range = useMemo(() => rangeOf(view, cursor), [view, cursor]);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const all = await api<Reservation[]>(
        `/reservations?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
      );
      if (n !== seq.current) return;
      setList(all);
      setError(null);
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    }
  }, [range]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<Settings>('/reservations/settings')
      .then(setSettings)
      .catch(() => undefined);
    api<DiningTable[]>('/tables')
      .then((ts) => setTables(ts.filter((t) => t.active !== false)))
      .catch(() => setTables([]));
  }, []);

  const freshTimers = useRef(new Map<string, number>());
  useEffect(() => {
    const timers = freshTimers.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  const markFresh = (id: string) => {
    const timers = freshTimers.current;
    window.clearTimeout(timers.get(id));
    setFresh((f) => (f.includes(id) ? f : [...f, id]));
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id);
        setFresh((f) => f.filter((x) => x !== id));
      }, FRESH_MS),
    );
  };
  useRealtime((e) => {
    if (e.type !== 'reservation.changed') return;
    markFresh(e.reservationId);
    void load();
  }, load);
  // Toca o aviso de novidade quando chega uma reserva do cardápio esperando confirmação.
  useArrivalSound(
    'order',
    list === null ? null : list.filter((r) => r.status === 'pending').map((r) => r.id),
  );

  async function update(r: Reservation, patch: Patch, msg?: string): Promise<void> {
    try {
      await api(`/reservations/${r.id}`, { method: 'PATCH', json: patch });
      if (msg) toast(msg, 'success');
    } catch (e) {
      const err = e as ApiError;
      // Grupo chegou e a mesa tem comanda aberta: a equipe confirma se a comanda é deste grupo.
      if (
        (err.body as { code?: string } | undefined)?.code === 'table_busy' &&
        !patch.tableBusyOk &&
        window.confirm(`${err.message}\n\nA comanda aberta é deste grupo?`)
      )
        return update(r, { ...patch, tableBusyOk: true }, msg);
      toast(err.message, 'danger');
    }
    void load();
  }

  /** Arrastou para outro dia/horário (ou esticou o tempo na mesa): já mostra e depois grava. */
  const move = (r: Reservation, start: Date, end: Date) => {
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    setList((l) =>
      (l ?? []).map((x) =>
        x.id === r.id ? { ...x, startsAt: start.toISOString(), durationMinutes } : x,
      ),
    );
    const patch: Patch = { startsAt: start.toISOString() };
    if (durationMinutes !== r.durationMinutes) patch.durationMinutes = durationMinutes;
    void update(r, patch, 'Reserva remarcada');
  };

  const all = list ?? [];
  const q = search?.trim().toLowerCase();
  const shown = all.filter((r) => {
    if (picked.length ? !picked.includes(r.status) : !live(r)) return false;
    if (!q) return true;
    return `${r.name} ${r.phone} ${r.code} ${r.tableLabel ?? ''} ${r.occasion ?? ''}`
      .toLowerCase()
      .includes(q);
  });
  const events = useMemo(() => shown.map(toEvent), [shown]);
  const dayList = all.filter((r) => sameDay(new Date(r.startsAt), selected));
  const dayLive = dayList.filter(live);
  const open = all.find((r) => r.id === openId) ?? null;

  const changeView = (v: AgendaView) => {
    setView(v);
    writeLocal(VIEW_KEY, v);
    if (v !== 'month') setCursor(selected);
  };
  const go = (dir: number) => {
    const c = stepCursor(view, cursor, dir);
    setCursor(c);
    if (view === 'day') setSelected(c);
  };
  const today = () => {
    const t = startOfDay(new Date());
    setCursor(t);
    setSelected(t);
  };
  const pick = (d: Date) => {
    setSelected(d);
    setCursor(d);
    if (phone) setDialog(null);
  };
  const toDay = (d: Date) => {
    setSelected(d);
    setCursor(d);
    setView('day');
    writeLocal(VIEW_KEY, 'day');
  };
  const togglePicked = (s: ReservationStatus) =>
    setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const create = (start?: Date) => {
    const d = start ?? selected;
    setEditing({ r: null, day: isoDay(d), time: start ? hhmm(start) : undefined });
  };

  // Altura da tela: o que sobra abaixo dela (a grade de horas rola por dentro).
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () =>
      el.style.setProperty('--ag-top', `${Math.max(0, el.getBoundingClientRect().top)}px`);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [phone]);

  const views = [
    { value: 'day' as const, label: 'Dia' },
    { value: 'week' as const, label: 'Semana' },
    { value: 'month' as const, label: 'Mês' },
    { value: 'list' as const, label: 'Lista' },
  ];
  const title = view === 'list' ? 'Próximas reservas' : titleOf(view, cursor, phone);
  const storeLink = `${window.location.origin}/pedir/reservar`;
  const openingHour = settings ? Number(settings.opensAt.slice(0, 2)) : 18;

  const cardProps = {
    tables,
    fresh,
    onUpdate: (r: Reservation, p: Patch, m?: string) => void update(r, p, m),
  };

  const copyLink = () =>
    navigator.clipboard
      ?.writeText(storeLink)
      .then(() => toast('Link copiado', 'success'))
      .catch(() => undefined);

  const calendar = (
    <div className="ag-side__block">
      <Calendar value={dayKey(selected)} onPick={(v) => pick(new Date(`${v}T00:00:00`))} />
    </div>
  );

  /** Reservas pelo cardápio: liga/desliga, regras e o link (abre as configurações). */
  const storeButton = (
    <button
      type="button"
      className="rv-store"
      disabled={!canManage}
      onClick={() => setDialog('settings')}
      title={
        settings?.enabled
          ? settings.autoConfirm
            ? 'Reservas pelo cardápio ligadas, com confirmação automática'
            : 'Reservas pelo cardápio ligadas, a equipe confirma'
          : 'Reservas pelo cardápio desligadas'
      }
    >
      <span className={`ag-wa__dot ${settings?.enabled ? 'is-on' : ''}`} aria-hidden />
      <Store size={16} aria-hidden />
      <span className="rv-store__text">Pelo cardápio</span>
    </button>
  );
  const copyButton = settings?.enabled && (
    <Button
      variant="ghost"
      aria-label="Copiar link da reserva"
      title="Copiar link da reserva"
      icon={<Copy size={17} />}
      onClick={copyLink}
    />
  );

  // Contagem do período na tela (dia, semana, mês ou os 60 dias da lista).
  const count = (s: ReservationStatus) => all.filter((r) => r.status === s).length;
  const allLive = all.filter(live);
  const tags = (
    <div className="rv-tags" role="toolbar" aria-label="Filtrar por situação">
      <button
        type="button"
        className="rv-tag"
        aria-pressed={!picked.length}
        onClick={() => setPicked([])}
        title="Todas, menos as canceladas e as que não vieram"
      >
        Todas
        <span className="rv-tag__n">{allLive.length}</span>
      </button>
      {STATUS_ORDER.map((st) => {
        const n = count(st);
        const on = picked.includes(st);
        return (
          <button
            key={st}
            type="button"
            className="rv-tag"
            aria-pressed={on}
            data-warn={(st === 'pending' && n > 0) || undefined}
            style={{ ['--tag' as string]: STATUS_COLOR[st] }}
            onClick={() => togglePicked(st)}
          >
            <span className="rv-tag__dot" aria-hidden />
            {RESERVATION_STATUS[st].label}
            {n > 0 && <span className="rv-tag__n">{n}</span>}
          </button>
        );
      })}
    </div>
  );

  // Resumo do dia escolhido (celular, na folha do título; no computador, o cabeçalho dos cartões).
  const dayPending = dayLive.filter((r) => r.status === 'pending').length;
  const daySeated = dayLive.filter((r) => r.status === 'seated').length;
  const summary = (
    <p className="rv-sum" aria-live="polite">
      <strong>
        {sameDay(selected, new Date())
          ? 'Hoje'
          : cap(
              selected.toLocaleDateString('pt-BR', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              }),
            ).replace(/\./g, '')}
      </strong>
      <span>
        {dayLive.length} {dayLive.length === 1 ? 'reserva' : 'reservas'}
      </span>
      <span>
        <Users size={14} aria-hidden /> {people(dayLive)}
      </span>
      {daySeated > 0 && <span>{daySeated} no salão</span>}
      {dayPending > 0 && <span className="rv-sum__warn">{dayPending} aguardando</span>}
    </p>
  );

  return (
    <div className={`ag rv-cal ${phone ? 'ag--phone' : ''}`} ref={root}>
      {!phone && (
        <aside className="ag-side" aria-label="Painel das reservas">
          <Button
            size="lg"
            icon={<Plus size={18} />}
            onClick={() => create()}
            className="ag-create"
          >
            Nova reserva
          </Button>
          {calendar}
        </aside>
      )}

      <section className="ag-main">
        <header className="ag-bar">
          {phone ? (
            <>
              <button type="button" className="ag-bar__title" onClick={() => setDialog('side')}>
                <span>{title}</span>
              </button>
              <span className="ag-bar__spacer" />
              <Button size="sm" variant="secondary" onClick={today}>
                Hoje
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Anterior"
                icon={<ChevronLeft size={18} />}
                onClick={() => go(-1)}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Próximo"
                icon={<ChevronRight size={18} />}
                onClick={() => go(1)}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Filtros e configurações"
                icon={<Settings2 size={18} />}
                onClick={() => setDialog('side')}
              />
              <Button
                size="sm"
                aria-label="Nova reserva"
                icon={<Plus size={18} />}
                onClick={() => create()}
              />
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={today}>
                Hoje
              </Button>
              <span className="ag-bar__arrows">
                <Button
                  variant="ghost"
                  aria-label="Anterior"
                  icon={<ChevronLeft size={18} />}
                  onClick={() => go(-1)}
                />
                <Button
                  variant="ghost"
                  aria-label="Próximo"
                  icon={<ChevronRight size={18} />}
                  onClick={() => go(1)}
                />
              </span>
              <h1 className="ag-bar__h1">{title}</h1>
              <span className="ag-bar__spacer" />
              {storeButton}
              {copyButton}
              {search !== null && (
                <input
                  className="cm-input ag-search"
                  type="search"
                  aria-label="Buscar reserva"
                  placeholder="Nome, celular, código ou mesa…"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setSearch(null)}
                />
              )}
              <Button
                variant="ghost"
                aria-label={search === null ? 'Buscar' : 'Fechar a busca'}
                icon={search === null ? <Search size={18} /> : <X size={18} />}
                onClick={() => setSearch(search === null ? '' : null)}
              />
              <Segmented label="Visualização" value={view} onChange={changeView} options={views} />
            </>
          )}
        </header>
        {!phone && tags}
        {phone && (
          <>
            <Segmented
              label="Visualização"
              value={view}
              onChange={changeView}
              options={views}
              block
              className="ag-phone-views"
            />
            {tags}
          </>
        )}

        {error && <Alert tone="danger">{error}</Alert>}
        {q && list && !shown.length && (
          <p className="cm-hint ag-empty" role="status">
            Nenhuma reserva encontrada para “{search?.trim()}” neste período.
          </p>
        )}

        <div className={`ag-body ag-body--${view}`}>
          {list === null ? (
            <div className="ag-loading">
              <Spinner />
            </div>
          ) : view === 'month' ? (
            <MonthView
              cursor={cursor}
              selected={selected}
              events={events}
              phone={phone}
              onPick={setSelected}
              onCreate={(d) => create(addMinutes(startOfDay(d), 20 * 60))}
              onOpen={setOpenId}
              onMove={move}
              onDayView={toDay}
            />
          ) : view === 'list' ? (
            <ListView
              from={range.from}
              list={shown}
              onCreate={() => create()}
              {...cardProps}
              onEdit={(r) => setEditing({ r, day: isoDay(new Date(r.startsAt)) })}
            />
          ) : (
            <div className={`rv-day ${view === 'day' && !phone ? 'rv-day--lane' : ''}`}>
              <TimeGrid
                days={
                  view === 'week'
                    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(cursor), i))
                    : [startOfDay(cursor)]
                }
                events={events}
                phone={phone}
                startHour={openingHour}
                onCreate={create}
                onOpen={setOpenId}
                onMove={move}
                onOpenDay={toDay}
              />
              {view === 'day' && !phone && (
                <DayLane
                  day={cursor}
                  list={shown.filter((r) => sameDay(new Date(r.startsAt), cursor))}
                  onCreate={() => create()}
                  onEdit={(r) => setEditing({ r, day: isoDay(new Date(r.startsAt)) })}
                  {...cardProps}
                />
              )}
            </div>
          )}
          {phone && view === 'month' && list && (
            <DayLane
              day={selected}
              list={shown.filter((r) => sameDay(new Date(r.startsAt), selected))}
              onCreate={() => create()}
              onEdit={(r) => setEditing({ r, day: isoDay(new Date(r.startsAt)) })}
              {...cardProps}
            />
          )}
        </div>
      </section>

      {open && (
        <Modal open title={`Reserva #${open.code}`} onClose={() => setOpenId(null)}>
          <ReservationCard
            r={open}
            plain
            {...cardProps}
            fresh={fresh.includes(open.id)}
            onEdit={() => {
              setOpenId(null);
              setEditing({ r: open, day: isoDay(new Date(open.startsAt)) });
            }}
          />
        </Modal>
      )}
      {editing && (
        <ReservationForm
          initial={editing.r}
          day={editing.day}
          time={editing.time}
          defaultDuration={settings?.durationMinutes ?? 90}
          tables={tables}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {dialog === 'settings' && settings && (
        <SettingsModal
          initial={settings}
          storeLink={storeLink}
          onClose={() => setDialog(null)}
          onSaved={(s) => {
            setSettings(s);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'side' && (
        <Modal open title="Reservas" onClose={() => setDialog(null)}>
          <div className="ag-side ag-side--sheet">
            <input
              className="cm-input"
              type="search"
              aria-label="Buscar reserva"
              placeholder="Buscar por nome, celular ou código…"
              value={search ?? ''}
              onChange={(e) => setSearch(e.target.value || null)}
            />
            {calendar}
            {summary}
            <div className="ag-side__block">
              <button
                type="button"
                className="ag-wa"
                disabled={!canManage}
                onClick={() => setDialog('settings')}
              >
                <Store size={18} aria-hidden />
                <span className="ag-wa__text">
                  <span className="ag-wa__title">Reservas pelo cardápio</span>
                  <span className="ag-wa__sub">
                    <span
                      className={`ag-wa__dot ${settings?.enabled ? 'is-on' : ''}`}
                      aria-hidden
                    />
                    {settings?.enabled
                      ? settings.autoConfirm
                        ? 'Ligadas · confirmação automática'
                        : 'Ligadas · a equipe confirma'
                      : canManage
                        ? 'Desligadas · toque para ligar'
                        : 'Desligadas'}
                  </span>
                </span>
              </button>
              {settings?.enabled && (
                <button type="button" className="ag-side__link" onClick={copyLink}>
                  <Copy size={15} aria-hidden /> Copiar link da reserva
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ mês

function MonthView({
  cursor,
  selected,
  events,
  phone,
  onPick,
  onCreate,
  onOpen,
  onMove,
  onDayView,
}: {
  cursor: Date;
  selected: Date;
  events: RvEvent[];
  phone: boolean;
  onPick: (d: Date) => void;
  onCreate: (d: Date) => void;
  onOpen: (id: string) => void;
  onMove: (r: Reservation, start: Date, end: Date) => void;
  onDayView: (d: Date) => void;
}) {
  const grid = monthGrid(cursor);
  const now = new Date();
  const [over, setOver] = useState<string | null>(null);
  const dragged = useRef<RvEvent | null>(null);
  const max = 3;
  return (
    <div className="ag-month" role="grid" aria-label={titleOf('month', cursor)}>
      <div className="ag-month__head" role="row">
        {WEEKDAYS_SHORT.map((w) => (
          <span key={w} role="columnheader">
            {phone ? w.charAt(0).toUpperCase() : w}
          </span>
        ))}
      </div>
      <div className="ag-month__grid">
        {grid.map((d) => {
          const k = dayKey(d);
          const list = sortEvents(events.filter((e) => onDay(e, d))) as RvEvent[];
          const total = people(list.filter((e) => live(e.r)).map((e) => e.r));
          const out = d.getMonth() !== cursor.getMonth();
          const isSel = sameDay(d, selected);
          return (
            <div
              key={k}
              role="gridcell"
              aria-selected={phone ? isSel : undefined}
              className={`ag-cell ${out ? 'is-out' : ''} ${isSel && phone ? 'is-sel' : ''} ${over === k ? 'is-over' : ''}`}
              onClick={(ev) => {
                // Clique numa reserva ou no número do dia: cada um cuida do seu.
                if ((ev.target as HTMLElement).closest('button')) return;
                if (phone) onPick(d);
                else onCreate(d);
              }}
              onDragOver={(ev) => {
                if (!dragged.current) return;
                ev.preventDefault();
                setOver(k);
              }}
              onDragLeave={() => setOver((o) => (o === k ? null : o))}
              onDrop={(ev) => {
                ev.preventDefault();
                setOver(null);
                const e = dragged.current;
                dragged.current = null;
                if (!e) return;
                const s = new Date(e.startsAt);
                const delta = Math.round(
                  (startOfDay(d).getTime() - startOfDay(s).getTime()) / 86_400_000,
                );
                if (!delta) return;
                onMove(e.r, addDays(s, delta), addDays(new Date(e.endsAt), delta));
              }}
            >
              <span className="rv-cell__top">
                <button
                  type="button"
                  className={`ag-cell__num ${sameDay(d, now) ? 'is-today' : ''}`}
                  aria-label={d.toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                  onClick={() => (phone ? onPick(d) : onDayView(d))}
                >
                  {d.getDate() === 1 && !phone
                    ? `${d.getDate()} de ${d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}`
                    : d.getDate()}
                </button>
                {!phone && total > 0 && (
                  <span className="rv-cell__people" title="Pessoas reservadas">
                    <Users size={11} aria-hidden /> {total}
                  </span>
                )}
              </span>
              {phone ? (
                <span className="ag-cell__dots ag-cell__fill" aria-hidden>
                  {list.slice(0, 4).map((e) => (
                    <span key={e.id} className="ag-dot" style={colorOf(e.r)} />
                  ))}
                </span>
              ) : (
                <div className="ag-cell__fill">
                  {list.slice(0, list.length > max ? max - 1 : max).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      draggable={!e.done}
                      onDragStart={(ev) => {
                        dragged.current = e;
                        ev.dataTransfer.effectAllowed = 'move';
                        ev.dataTransfer.setData('text/plain', e.id);
                      }}
                      onDragEnd={() => {
                        dragged.current = null;
                        setOver(null);
                      }}
                      className={`ag-chip ${e.done ? 'is-done' : ''}`}
                      style={colorOf(e.r)}
                      onClick={() => onOpen(e.id)}
                      title={`${hhmm(new Date(e.startsAt))} · ${e.title} · ${e.r.partySize} pessoas · ${RESERVATION_STATUS[e.r.status].label}`}
                    >
                      <span className="ag-dot" aria-hidden />
                      <span className="ag-chip__time">{hhmm(new Date(e.startsAt))}</span>
                      <span className="ag-chip__title">{e.title}</span>
                      <span className="rv-chip__n">{e.r.partySize}p</span>
                    </button>
                  ))}
                  {list.length > max && (
                    <button type="button" className="ag-more" onClick={() => onDayView(d)}>
                      Mais {list.length - max + 1}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dia e semana

interface DragState {
  ev: RvEvent;
  mode: 'move' | 'resize';
  x: number;
  y: number;
  dayIdx: number;
  start: Date;
  end: Date;
  moved: boolean;
}

function TimeGrid({
  days,
  events,
  phone,
  startHour,
  onCreate,
  onOpen,
  onMove,
  onOpenDay,
}: {
  days: Date[];
  events: RvEvent[];
  phone: boolean;
  /** Abre a grade perto do primeiro horário de reserva. */
  startHour: number;
  onCreate: (start: Date) => void;
  onOpen: (id: string) => void;
  onMove: (r: Reservation, start: Date, end: Date) => void;
  onOpenDay: (d: Date) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // Abre uma hora antes da primeira reserva visível (ou do primeiro horário de reserva).
  const daysKey = days.map(dayKey).join();
  const loaded = events.length > 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const firsts = days.flatMap((d) =>
      events
        .filter((e) => onDay(e, d) && sameDay(new Date(e.startsAt), d))
        .map((e) => minutesOfDay(new Date(e.startsAt)) / 60),
    );
    const first = firsts.length ? Math.min(...firsts) : startHour;
    el.scrollTop = Math.max(0, Math.floor(first) - 1) * HOUR_PX;
    // Só ao trocar de dia/semana ou ao chegar a primeira leva: recarregar não pula a grade.
  }, [daysKey, startHour, loaded]);

  const list = useMemo(
    () =>
      drag
        ? events.map((e) =>
            e.id === drag.ev.id
              ? { ...e, startsAt: drag.start.toISOString(), endsAt: drag.end.toISOString() }
              : e,
          )
        : events,
    [events, drag],
  );

  const snap = (min: number) => Math.round(min / 15) * 15;
  const startDrag = (
    ev: ReactPointerEvent,
    e: RvEvent,
    mode: DragState['mode'],
    dayIdx: number,
  ) => {
    if (ev.button !== 0 || ev.pointerType === 'touch' || e.done) return;
    ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({
      ev: e,
      mode,
      x: ev.clientX,
      y: ev.clientY,
      dayIdx,
      start: new Date(e.startsAt),
      end: new Date(e.endsAt),
      moved: false,
    });
  };
  const onDragMove = (ev: ReactPointerEvent) => {
    if (!drag) return;
    const dy = ev.clientY - drag.y;
    const dx = ev.clientX - drag.x;
    if (!drag.moved && Math.abs(dy) < 4 && Math.abs(dx) < 4) return;
    const mins = snap((dy / HOUR_PX) * 60);
    const s0 = new Date(drag.ev.startsAt);
    const e0 = new Date(drag.ev.endsAt);
    if (drag.mode === 'resize') {
      const end = addMinutes(e0, mins);
      const dur = (end.getTime() - s0.getTime()) / 60_000;
      setDrag({
        ...drag,
        moved: true,
        end: addMinutes(s0, Math.min(600, Math.max(15, dur))),
      });
      return;
    }
    let dd = 0;
    const box = cols.current?.getBoundingClientRect();
    if (box && days.length > 1) {
      const w = box.width / days.length;
      const idx = Math.min(days.length - 1, Math.max(0, Math.floor((ev.clientX - box.left) / w)));
      dd = idx - drag.dayIdx;
    }
    setDrag({
      ...drag,
      moved: true,
      start: addMinutes(addDays(s0, dd), mins),
      end: addMinutes(addDays(e0, dd), mins),
    });
  };
  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) return onOpen(d.ev.id);
    if (d.start.toISOString() !== d.ev.startsAt || d.end.toISOString() !== d.ev.endsAt)
      onMove(d.ev.r, d.start, d.end);
  };

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const style = {
    ['--days' as string]: days.length,
    ['--ag-hour' as string]: `${HOUR_PX}px`,
  } as CSSProperties;

  return (
    <div className={`ag-tg ${days.length === 1 ? 'ag-tg--day' : ''}`} style={style}>
      <div className="ag-tg__head">
        <span className="ag-tg__gutter" />
        {days.map((d) => {
          const dayLive = list.filter((e) => onDay(e, d) && live(e.r)).map((e) => e.r);
          return (
            <button
              type="button"
              key={dayKey(d)}
              className={`ag-tg__day ${sameDay(d, now) ? 'is-today' : ''}`}
              onClick={() => onOpenDay(d)}
            >
              <span className="ag-tg__wd">{WEEKDAYS_SHORT[d.getDay()]}</span>
              <span className="ag-tg__num">{d.getDate()}</span>
              {dayLive.length > 0 && (
                <span className="rv-tg__count">
                  {dayLive.length} · {people(dayLive)}p
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="ag-tg__scroll" ref={scroller}>
        <div className="ag-tg__grid" style={{ height: 24 * HOUR_PX }}>
          <div className="ag-tg__gutter ag-tg__hours" aria-hidden>
            {hours.map((h) => (
              <span key={h} style={{ top: h * HOUR_PX }}>
                {h ? `${String(h).padStart(2, '0')}:00` : ''}
              </span>
            ))}
          </div>
          <div
            className="ag-tg__cols"
            ref={cols}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={() => setDrag(null)}
          >
            {days.map((d, i) => {
              const placed = layoutDay(list, d);
              const isToday = sameDay(d, now);
              return (
                <div
                  key={dayKey(d)}
                  className={`ag-tg__col ${isToday ? 'is-today' : ''}`}
                  onClick={(ev) => {
                    if (ev.target !== ev.currentTarget) return;
                    const min = Math.floor((ev.nativeEvent.offsetY / HOUR_PX) * 4) * 15;
                    onCreate(addMinutes(startOfDay(d), Math.min(min, 23 * 60 + 45)));
                  }}
                >
                  {placed.map((p) => {
                    const e = p.ev as RvEvent;
                    const r = e.r;
                    const h = ((p.bottom - p.top) / 60) * HOUR_PX;
                    const short = h < 40;
                    const start = drag?.ev.id === e.id ? drag.start : new Date(e.startsAt);
                    const end = drag?.ev.id === e.id ? drag.end : new Date(e.endsAt);
                    return (
                      <div
                        key={e.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${hhmm(start)}, ${r.name}, ${r.partySize} pessoas, ${RESERVATION_STATUS[r.status].label}`}
                        className={`ag-ev rv-ev ${short ? 'is-short' : ''} ${e.done ? 'is-done' : ''} ${drag?.ev.id === e.id && drag.moved ? 'is-drag' : ''}`}
                        data-status={r.status}
                        style={{
                          ...colorOf(r),
                          top: (p.top / 60) * HOUR_PX,
                          height: Math.max(h - 2, 18),
                          left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                          width: `calc(${100 / p.cols}% - ${p.cols > 1 ? 3 : 6}px)`,
                        }}
                        onPointerDown={(ev) => startDrag(ev, e, 'move', i)}
                        onClick={(ev) => {
                          // Mouse: abre no soltar (endDrag). Toque, teclado ou encerrada: abre aqui.
                          ev.stopPropagation();
                          if (
                            phone ||
                            e.done ||
                            (ev.nativeEvent as PointerEvent).pointerType === 'touch' ||
                            ev.detail === 0
                          )
                            onOpen(e.id);
                        }}
                        onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && onOpen(e.id)}
                      >
                        <span className="ag-ev__title">
                          {r.name}
                          <span className="rv-ev__n">
                            <Users size={11} aria-hidden /> {r.partySize}
                          </span>
                        </span>
                        <span className="ag-ev__time">
                          {hhmm(start)} – {hhmm(end)}
                          {r.tableLabel ? ` · Mesa ${r.tableLabel}` : ''}
                        </span>
                        {!short && r.status === 'pending' && (
                          <span className="rv-ev__tag">Aguardando</span>
                        )}
                        {!phone && !e.done && (
                          <span
                            className="ag-ev__resize"
                            aria-hidden
                            title="Arraste para mudar o tempo na mesa"
                            onPointerDown={(ev) => startDrag(ev, e, 'resize', i)}
                          />
                        )}
                      </div>
                    );
                  })}
                  {isToday && (
                    <span
                      className="ag-now"
                      style={{ top: (minutesOfDay(now) / 60) * HOUR_PX }}
                      aria-hidden
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ cartões do dia e lista

type CardActions = {
  tables: DiningTable[];
  /** Reservas que acabaram de mudar (o cartão pisca de leve). */
  fresh: string[];
  onUpdate: (r: Reservation, p: Patch, msg?: string) => void;
  onEdit: (r: Reservation) => void;
};

/** Os cartões do dia, por horário: ao lado da grade (computador) ou embaixo do mês (celular). */
function DayLane({
  day,
  list,
  onCreate,
  tables,
  fresh,
  onUpdate,
  onEdit,
}: CardActions & { day: Date; list: Reservation[]; onCreate: () => void }) {
  const sorted = [...list].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const liveOnes = sorted.filter(live);
  return (
    <section className="rv-lane" aria-live="polite">
      <h2 className="rv-lane__title">
        <span>
          {cap(day.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}
        </span>
        {liveOnes.length > 0 && (
          <small>
            {liveOnes.length} {liveOnes.length === 1 ? 'reserva' : 'reservas'} · {people(liveOnes)}{' '}
            pessoas
          </small>
        )}
      </h2>
      {sorted.length ? (
        <div className="rv-lane__cards">
          {sorted.map((r) => (
            <ReservationCard
              key={r.id}
              r={r}
              tables={tables}
              fresh={fresh.includes(r.id)}
              onUpdate={onUpdate}
              onEdit={() => onEdit(r)}
            />
          ))}
        </div>
      ) : (
        <button type="button" className="ag-daylist__empty" onClick={onCreate}>
          <Plus size={16} aria-hidden /> Nenhuma reserva. Toque para anotar uma.
        </button>
      )}
    </section>
  );
}

function ListView({
  from,
  list,
  onCreate,
  tables,
  fresh,
  onUpdate,
  onEdit,
}: CardActions & { from: Date; list: Reservation[]; onCreate: () => void }) {
  const days = Array.from({ length: 60 }, (_, i) => addDays(from, i))
    .map((d) => ({
      d,
      rs: list
        .filter((r) => sameDay(new Date(r.startsAt), d))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }))
    .filter((x) => x.rs.length);
  if (!days.length)
    return (
      <div className="ag-blank">
        <CalendarDays size={28} aria-hidden />
        <p>Nenhuma reserva nos próximos 60 dias.</p>
        <Button variant="secondary" icon={<Plus size={16} />} onClick={onCreate}>
          Nova reserva
        </Button>
      </div>
    );
  const now = new Date();
  return (
    <div className="ag-list rv-list">
      {days.map(({ d, rs }) => {
        const l = rs.filter(live);
        return (
          <section key={dayKey(d)} className="ag-list__day">
            <h2 className={`ag-list__date ${sameDay(d, now) ? 'is-today' : ''}`}>
              <span className="ag-list__num">{d.getDate()}</span>
              <span>
                {cap(d.toLocaleDateString('pt-BR', { weekday: 'long' }))} ·{' '}
                {d.toLocaleDateString('pt-BR', { month: 'long' })}
                {l.length > 0 && (
                  <small className="rv-list__sum">
                    {l.length} {l.length === 1 ? 'reserva' : 'reservas'} · {people(l)} pessoas
                  </small>
                )}
              </span>
            </h2>
            <div className="rv-lane__cards rv-lane__cards--grid">
              {rs.map((r) => (
                <ReservationCard
                  key={r.id}
                  r={r}
                  tables={tables}
                  fresh={fresh.includes(r.id)}
                  onUpdate={onUpdate}
                  onEdit={() => onEdit(r)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
