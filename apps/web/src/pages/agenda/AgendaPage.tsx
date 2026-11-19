import {
  BellRing,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Settings2,
  Tags,
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
import { useAuth } from '../../app/auth';
import { Alert, Button, Calendar, Modal, Segmented, Spinner, useToast } from '../../design-system';
import { api } from '../../lib/api';
import { useLiveData } from '../../lib/realtime';
import { TagsDialog, WhatsAppDialog } from './AgendaDialogs';
import {
  addDays,
  addMinutes,
  AgendaEvent,
  AgendaSettings,
  AgendaTag,
  AgendaView,
  cap,
  dayKey,
  fmtPhone,
  hhmm,
  isAllDayLike,
  layoutDay,
  minutesOfDay,
  monthGrid,
  onDay,
  rangeOf,
  sameDay,
  sortEvents,
  startOfDay,
  stepCursor,
  timeLabel,
  titleOf,
  weekStart,
  WEEKDAYS_SHORT,
} from './agenda-utils';
import { Draft, EventDialog } from './EventDialog';
import './agenda.css';

const HOUR_PX = 48;
const PHONE_MQ = '(max-width: 860px)';
const HIDDEN_KEY = 'cm-agenda-hidden';
const VIEW_KEY = 'cm-agenda-view';
/** Compromisso sem tag usa a cor da marca do restaurante. */
const NO_TAG = 'sem-tag';

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

/**
 * Agenda pessoal no jeito do Google Agenda: painel do lado (Criar, minicalendário, tags e
 * lembretes pelo WhatsApp) e as visões Dia, Semana, Mês e Lista. No celular, o mês mostra
 * pontinhos e a lista do dia tocado embaixo; as tags e o WhatsApp ficam num botão do topo.
 */
export function AgendaPage() {
  const { me } = useAuth();
  const toast = useToast();
  const phone = usePhone();
  const [view, setView] = useState<AgendaView>(() =>
    readLocal<AgendaView>(VIEW_KEY, matchMedia(PHONE_MQ).matches ? 'month' : 'week'),
  );
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [events, setEvents] = useState<AgendaEvent[] | null>(null);
  const [tags, setTags] = useState<AgendaTag[]>([]);
  const [settings, setSettings] = useState<AgendaSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>(() => readLocal(HIDDEN_KEY, []));
  const [search, setSearch] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ event: AgendaEvent | null; draft: Draft | null } | null>(
    null,
  );
  const [dialog, setDialog] = useState<'whatsapp' | 'tags' | 'side' | null>(null);
  const canManageWhatsApp = !!me?.permissions.includes('settings:manage');

  const range = useMemo(() => rangeOf(view, cursor), [view, cursor]);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const list = await api<AgendaEvent[]>(
        `/agenda/events?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
      );
      if (n !== seq.current) return;
      setEvents(list);
      setError(null);
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    }
  }, [range]);
  const loadSetup = useCallback(async () => {
    try {
      const s = await api<{ tags: AgendaTag[]; settings: AgendaSettings }>('/agenda/setup');
      setTags(s.tags);
      setSettings(s.settings);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);
  // Compromisso salvo em outro aparelho ou aba da mesma pessoa chega sozinho.
  useLiveData(['agenda'], () => {
    void load();
    void loadSetup();
  });
  // Lembrete enviado muda a situação do compromisso: relê de vez em quando com a tela aberta.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const tagOf = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const shown = useMemo(() => {
    const q = search?.trim().toLowerCase();
    return (events ?? []).filter((e) => {
      const tag = e.tagId ? tagOf.get(e.tagId) : undefined;
      if (hidden.includes(tag ? tag.id : NO_TAG)) return false;
      if (!q) return true;
      return `${e.title} ${e.notes ?? ''} ${tag?.name ?? ''}`.toLowerCase().includes(q);
    });
  }, [events, hidden, search, tagOf]);

  const colorOf = useCallback(
    (e: AgendaEvent) =>
      ({
        ['--ev' as string]: (e.tagId && tagOf.get(e.tagId)?.color) || 'var(--cm-brand-500)',
      }) as CSSProperties,
    [tagOf],
  );

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
  const toggleHidden = (k: string) => {
    const next = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k];
    setHidden(next);
    writeLocal(HIDDEN_KEY, next);
  };

  const create = (start?: Date, allDay = false) => {
    let s = start;
    if (!s) {
      // Botão Criar: no dia escolhido, na próxima meia hora.
      const now = new Date();
      s = sameDay(selected, now)
        ? addMinutes(startOfDay(now), Math.ceil((minutesOfDay(now) + 1) / 30) * 30)
        : addMinutes(selected, 9 * 60);
    }
    const draft: Draft = allDay
      ? { start: startOfDay(s), end: addMinutes(startOfDay(s), 1439), allDay: true }
      : { start: s, end: addMinutes(s, 60), allDay: false };
    setEditing({ event: null, draft });
  };
  const open = (e: AgendaEvent) => setEditing({ event: e, draft: null });

  /** Arrastou para outro dia/horário: grava já na tela e depois no servidor. */
  const move = async (e: AgendaEvent, start: Date, end: Date) => {
    setEvents((list) =>
      (list ?? []).map((x) =>
        x.id === e.id ? { ...x, startsAt: start.toISOString(), endsAt: end.toISOString() } : x,
      ),
    );
    try {
      await api(`/agenda/events/${e.id}`, {
        method: 'PATCH',
        json: { startsAt: start.toISOString(), endsAt: end.toISOString() },
      });
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
    void load();
  };

  const toggleDone = async (e: AgendaEvent) => {
    setEvents((list) => (list ?? []).map((x) => (x.id === e.id ? { ...x, done: !x.done } : x)));
    try {
      await api(`/agenda/events/${e.id}`, { method: 'PATCH', json: { done: !e.done } });
    } catch (err) {
      toast((err as Error).message, 'danger');
      void load();
    }
  };

  // Altura da agenda: o que sobra na tela abaixo dela (a grade de horas rola por dentro).
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
  const title = titleOf(view, cursor, phone);
  const waOn = !!settings?.whatsappEnabled;

  const side = (
    <>
      <div className="ag-side__block">
        <Calendar value={dayKey(selected)} onPick={(v) => pick(new Date(`${v}T00:00:00`))} />
      </div>
      <div className="ag-side__block">
        <div className="ag-side__head">
          <span>Tags</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Gerenciar tags"
            icon={<Settings2 size={15} />}
            onClick={() => setDialog('tags')}
          />
        </div>
        <ul className="ag-filter">
          {[{ id: NO_TAG, name: 'Sem tag', color: 'var(--cm-brand-500)' }, ...tags].map((t) => {
            const on = !hidden.includes(t.id);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className="ag-filter__item"
                  aria-pressed={on}
                  style={{ ['--tag' as string]: t.color }}
                  onClick={() => toggleHidden(t.id)}
                >
                  <span className="ag-check" aria-hidden>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="ag-filter__name">{t.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="ag-side__link" onClick={() => setDialog('tags')}>
          <Plus size={15} aria-hidden /> Nova tag
        </button>
      </div>
      <div className="ag-side__block">
        <button type="button" className="ag-wa" onClick={() => setDialog('whatsapp')}>
          <BellRing size={18} aria-hidden />
          <span className="ag-wa__text">
            <span className="ag-wa__title">Lembretes no WhatsApp</span>
            <span className="ag-wa__sub">
              <span
                className={`ag-wa__dot ${waOn && settings?.whatsappReady ? 'is-on' : waOn ? 'is-warn' : ''}`}
                aria-hidden
              />
              {waOn
                ? settings?.whatsappReady
                  ? `Ligados · ${fmtPhone(settings.phone)}`
                  : 'Ligados, WhatsApp do restaurante desconectado'
                : 'Desligados · toque para permitir'}
            </span>
          </span>
        </button>
      </div>
    </>
  );

  return (
    <div className={`ag ${phone ? 'ag--phone' : ''}`} ref={root}>
      {!phone && (
        <aside className="ag-side" aria-label="Painel da agenda">
          <Button
            size="lg"
            icon={<Plus size={18} />}
            onClick={() => create()}
            className="ag-create"
          >
            Criar
          </Button>
          {side}
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
                aria-label="Tags e lembretes"
                icon={<Tags size={18} />}
                onClick={() => setDialog('side')}
              />
              <Button
                size="sm"
                aria-label="Novo compromisso"
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
              {search !== null && (
                <input
                  className="cm-input ag-search"
                  type="search"
                  aria-label="Buscar na agenda"
                  placeholder="Buscar na agenda…"
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
        {phone && (
          <Segmented
            label="Visualização"
            value={view}
            onChange={changeView}
            options={views}
            block
            className="ag-phone-views"
          />
        )}

        {error && <Alert tone="danger">{error}</Alert>}
        {search?.trim() && events && !shown.length && (
          <p className="cm-hint ag-empty" role="status">
            Nada encontrado para “{search.trim()}” neste período.
          </p>
        )}

        <div className={`ag-body ag-body--${view}`}>
          {events === null ? (
            <div className="ag-loading">
              <Spinner />
            </div>
          ) : view === 'month' ? (
            <MonthView
              cursor={cursor}
              selected={selected}
              events={shown}
              phone={phone}
              colorOf={colorOf}
              onPick={(d) => setSelected(d)}
              onCreate={(d) => create(d, true)}
              onOpen={open}
              onMove={move}
              onDayView={(d) => {
                setSelected(d);
                setCursor(d);
                changeViewTo('day');
              }}
            />
          ) : view === 'list' ? (
            <ListView
              from={range.from}
              events={shown}
              colorOf={colorOf}
              tagOf={tagOf}
              onOpen={open}
              onToggle={toggleDone}
              onCreate={() => create()}
            />
          ) : (
            <TimeGrid
              days={
                view === 'week'
                  ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(cursor), i))
                  : [startOfDay(cursor)]
              }
              events={shown}
              phone={phone}
              colorOf={colorOf}
              onCreate={create}
              onOpen={open}
              onMove={move}
              onOpenDay={(d) => {
                setSelected(d);
                setCursor(d);
                changeViewTo('day');
              }}
            />
          )}
          {phone && view === 'month' && events && (
            <DayList
              day={selected}
              events={shown.filter((e) => onDay(e, selected))}
              colorOf={colorOf}
              tagOf={tagOf}
              onOpen={open}
              onToggle={toggleDone}
              onCreate={() => create(addMinutes(selected, 9 * 60))}
            />
          )}
        </div>
      </section>

      {editing && (
        <EventDialog
          event={editing.event}
          draft={editing.draft}
          tags={tags}
          settings={settings}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onTagCreated={(t) =>
            setTags((list) => [...list, t].sort((a, b) => a.name.localeCompare(b.name)))
          }
          onOpenSettings={() => setDialog('whatsapp')}
        />
      )}
      {dialog === 'whatsapp' && (
        <WhatsAppDialog
          settings={settings}
          canManageWhatsApp={canManageWhatsApp}
          onClose={() => setDialog(null)}
          onSaved={setSettings}
        />
      )}
      {dialog === 'tags' && (
        <TagsDialog
          tags={tags}
          onClose={() => setDialog(null)}
          onChanged={() => {
            void loadSetup();
            void load();
          }}
        />
      )}
      {dialog === 'side' && (
        <Modal open title="Agenda pessoal" onClose={() => setDialog(null)}>
          <div className="ag-side ag-side--sheet">
            {search === null ? (
              <Button
                variant="secondary"
                icon={<Search size={16} />}
                onClick={() => {
                  setSearch('');
                }}
              >
                Buscar na agenda
              </Button>
            ) : (
              <input
                className="cm-input"
                type="search"
                aria-label="Buscar na agenda"
                placeholder="Buscar na agenda…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
            {side}
          </div>
        </Modal>
      )}
    </div>
  );

  function changeViewTo(v: AgendaView) {
    setView(v);
    writeLocal(VIEW_KEY, v);
  }
}

type ColorOf = (e: AgendaEvent) => CSSProperties;

// ------------------------------------------------------------------ mês

function MonthView({
  cursor,
  selected,
  events,
  phone,
  colorOf,
  onPick,
  onCreate,
  onOpen,
  onMove,
  onDayView,
}: {
  cursor: Date;
  selected: Date;
  events: AgendaEvent[];
  phone: boolean;
  colorOf: ColorOf;
  onPick: (d: Date) => void;
  onCreate: (d: Date) => void;
  onOpen: (e: AgendaEvent) => void;
  onMove: (e: AgendaEvent, start: Date, end: Date) => void;
  onDayView: (d: Date) => void;
}) {
  const grid = monthGrid(cursor);
  const now = new Date();
  const [over, setOver] = useState<string | null>(null);
  const dragged = useRef<AgendaEvent | null>(null);
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
          const list = sortEvents(events.filter((e) => onDay(e, d)));
          const out = d.getMonth() !== cursor.getMonth();
          const isToday = sameDay(d, now);
          const isSel = sameDay(d, selected);
          return (
            <div
              key={k}
              role="gridcell"
              aria-selected={phone ? isSel : undefined}
              className={`ag-cell ${out ? 'is-out' : ''} ${isSel && phone ? 'is-sel' : ''} ${over === k ? 'is-over' : ''}`}
              onClick={(ev) => {
                if (
                  ev.target !== ev.currentTarget &&
                  !(ev.target as HTMLElement).closest('.ag-cell__fill')
                )
                  return;
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
                onMove(e, addDays(s, delta), addDays(new Date(e.endsAt), delta));
              }}
            >
              <button
                type="button"
                className={`ag-cell__num ${isToday ? 'is-today' : ''}`}
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
              {phone ? (
                <span className="ag-cell__dots ag-cell__fill" aria-hidden>
                  {list.slice(0, 4).map((e) => (
                    <span key={e.id} className="ag-dot" style={colorOf(e)} />
                  ))}
                </span>
              ) : (
                <div className="ag-cell__fill">
                  {list.slice(0, list.length > max ? max - 1 : max).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      draggable
                      onDragStart={(ev) => {
                        dragged.current = e;
                        ev.dataTransfer.effectAllowed = 'move';
                        ev.dataTransfer.setData('text/plain', e.id);
                      }}
                      onDragEnd={() => {
                        dragged.current = null;
                        setOver(null);
                      }}
                      className={`ag-chip ${isAllDayLike(e) ? 'ag-chip--solid' : ''} ${e.done ? 'is-done' : ''}`}
                      style={colorOf(e)}
                      onClick={() => onOpen(e)}
                      title={`${timeLabel(e)} · ${e.title}`}
                    >
                      {!isAllDayLike(e) && <span className="ag-dot" aria-hidden />}
                      {!isAllDayLike(e) && sameDay(new Date(e.startsAt), d) && (
                        <span className="ag-chip__time">{hhmm(new Date(e.startsAt))}</span>
                      )}
                      <span className="ag-chip__title">{e.title}</span>
                      {e.remindAt && !e.remindedAt && (
                        <BellRing size={11} aria-label="com lembrete" />
                      )}
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
  ev: AgendaEvent;
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
  colorOf,
  onCreate,
  onOpen,
  onMove,
  onOpenDay,
}: {
  days: Date[];
  events: AgendaEvent[];
  phone: boolean;
  colorOf: ColorOf;
  onCreate: (start: Date, allDay?: boolean) => void;
  onOpen: (e: AgendaEvent) => void;
  onMove: (e: AgendaEvent, start: Date, end: Date) => void;
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
  // Abre perto da hora atual (ou às 7h), como o Google Agenda.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const h = days.some((d) => sameDay(d, new Date())) ? Math.max(0, new Date().getHours() - 2) : 7;
    el.scrollTop = h * HOUR_PX;
  }, [days.length]);

  // Durante o arrasto, o compromisso aparece no lugar novo.
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

  const allDay = (d: Date) => sortEvents(list.filter((e) => isAllDayLike(e) && onDay(e, d)));
  const hasAllDay = days.some((d) => allDay(d).length > 0);

  const snap = (min: number) => Math.round(min / 15) * 15;
  const startDrag = (
    ev: ReactPointerEvent,
    e: AgendaEvent,
    mode: DragState['mode'],
    dayIdx: number,
  ) => {
    if (ev.button !== 0 || ev.pointerType === 'touch') return;
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
      setDrag({
        ...drag,
        moved: true,
        end: end.getTime() - s0.getTime() < 15 * 60_000 ? addMinutes(s0, 15) : end,
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
    if (!d.moved) return onOpen(d.ev);
    if (d.start.toISOString() !== d.ev.startsAt || d.end.toISOString() !== d.ev.endsAt)
      onMove(d.ev, d.start, d.end);
  };

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const style = { ['--days' as string]: days.length } as CSSProperties;

  return (
    <div className={`ag-tg ${days.length === 1 ? 'ag-tg--day' : ''}`} style={style}>
      <div className="ag-tg__head">
        <span className="ag-tg__gutter" />
        {days.map((d) => {
          const isToday = sameDay(d, now);
          return (
            <button
              type="button"
              key={dayKey(d)}
              className={`ag-tg__day ${isToday ? 'is-today' : ''}`}
              onClick={() => onOpenDay(d)}
            >
              <span className="ag-tg__wd">{WEEKDAYS_SHORT[d.getDay()]}</span>
              <span className="ag-tg__num">{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      {hasAllDay && (
        <div className="ag-tg__allday">
          <span className="ag-tg__gutter ag-tg__gutter--label">dia todo</span>
          {days.map((d) => (
            <div key={dayKey(d)} className="ag-tg__allcol">
              {allDay(d).map((e) => (
                <button
                  type="button"
                  key={e.id}
                  className={`ag-chip ag-chip--solid ${e.done ? 'is-done' : ''}`}
                  style={colorOf(e)}
                  onClick={() => onOpen(e)}
                >
                  <span className="ag-chip__title">{e.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
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
                    const y = ev.nativeEvent.offsetY;
                    const min = Math.floor((y / HOUR_PX) * 2) * 30;
                    onCreate(addMinutes(startOfDay(d), Math.min(min, 23 * 60 + 30)));
                  }}
                >
                  {placed.map((p) => {
                    const e = p.ev;
                    const h = ((p.bottom - p.top) / 60) * HOUR_PX;
                    const short = h < 36;
                    return (
                      <div
                        key={e.id}
                        role="button"
                        tabIndex={0}
                        className={`ag-ev ${short ? 'is-short' : ''} ${e.done ? 'is-done' : ''} ${drag?.ev.id === e.id && drag.moved ? 'is-drag' : ''}`}
                        style={{
                          ...colorOf(e),
                          top: (p.top / 60) * HOUR_PX,
                          height: Math.max(h - 2, 16),
                          left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                          width: `calc(${100 / p.cols}% - ${p.cols > 1 ? 3 : 6}px)`,
                        }}
                        onPointerDown={(ev) => startDrag(ev, e, 'move', i)}
                        onClick={(ev) => {
                          // Mouse: abre no soltar (endDrag). Toque e teclado: abre aqui.
                          ev.stopPropagation();
                          if (
                            phone ||
                            (ev.nativeEvent as PointerEvent).pointerType === 'touch' ||
                            ev.detail === 0
                          )
                            onOpen(e);
                        }}
                        onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && onOpen(e)}
                      >
                        <span className="ag-ev__title">{e.title}</span>
                        <span className="ag-ev__time">
                          {timeLabel(
                            drag?.ev.id === e.id
                              ? {
                                  ...e,
                                  startsAt: drag.start.toISOString(),
                                  endsAt: drag.end.toISOString(),
                                }
                              : e,
                          )}
                          {e.remindAt && !e.remindedAt && (
                            <BellRing size={11} aria-label="com lembrete" />
                          )}
                        </span>
                        {!phone && (
                          <span
                            className="ag-ev__resize"
                            aria-hidden
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

// ------------------------------------------------------------------ lista

function EventRow({
  e,
  colorOf,
  tagOf,
  onOpen,
  onToggle,
}: {
  e: AgendaEvent;
  colorOf: ColorOf;
  tagOf: Map<string, AgendaTag>;
  onOpen: (e: AgendaEvent) => void;
  onToggle: (e: AgendaEvent) => void;
}) {
  const tag = e.tagId ? tagOf.get(e.tagId) : undefined;
  return (
    <li className={`ag-row ${e.done ? 'is-done' : ''}`} style={colorOf(e)}>
      <button
        type="button"
        className="ag-row__check"
        aria-pressed={e.done}
        aria-label={e.done ? 'Marcar como não concluído' : 'Marcar como concluído'}
        onClick={() => onToggle(e)}
      >
        {e.done && <Check size={13} strokeWidth={3} />}
      </button>
      <button type="button" className="ag-row__main" onClick={() => onOpen(e)}>
        <span className="ag-row__time">{timeLabel(e)}</span>
        <span className="ag-row__title">{e.title}</span>
        {(tag || e.remindAt) && (
          <span className="ag-row__meta">
            {tag && (
              <span className="ag-tag" style={{ ['--tag' as string]: tag.color }}>
                <span className="ag-dot" aria-hidden />
                {tag.name}
              </span>
            )}
            {e.remindAt && (
              <span className="ag-row__remind">
                <BellRing size={12} aria-hidden />
                {e.remindError
                  ? 'Lembrete não saiu'
                  : e.remindedAt
                    ? 'Lembrete enviado'
                    : `Lembrete ${new Date(e.remindAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

function ListView({
  from,
  events,
  colorOf,
  tagOf,
  onOpen,
  onToggle,
  onCreate,
}: {
  from: Date;
  events: AgendaEvent[];
  colorOf: ColorOf;
  tagOf: Map<string, AgendaTag>;
  onOpen: (e: AgendaEvent) => void;
  onToggle: (e: AgendaEvent) => void;
  onCreate: () => void;
}) {
  const days = Array.from({ length: 60 }, (_, i) => addDays(from, i))
    .map((d) => ({ d, list: sortEvents(events.filter((e) => onDay(e, d))) }))
    .filter((x) => x.list.length);
  if (!days.length)
    return (
      <div className="ag-blank">
        <CalendarDays size={28} aria-hidden />
        <p>Nada marcado nos próximos 60 dias.</p>
        <Button variant="secondary" icon={<Plus size={16} />} onClick={onCreate}>
          Novo compromisso
        </Button>
      </div>
    );
  const now = new Date();
  return (
    <div className="ag-list">
      {days.map(({ d, list }) => (
        <section key={dayKey(d)} className="ag-list__day">
          <h2 className={`ag-list__date ${sameDay(d, now) ? 'is-today' : ''}`}>
            <span className="ag-list__num">{d.getDate()}</span>
            <span>
              {cap(d.toLocaleDateString('pt-BR', { weekday: 'long' }))} ·{' '}
              {d.toLocaleDateString('pt-BR', { month: 'long' })}
            </span>
          </h2>
          <ul className="ag-rows">
            {list.map((e) => (
              <EventRow
                key={e.id}
                e={e}
                colorOf={colorOf}
                tagOf={tagOf}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Celular, visão Mês: o que tem no dia tocado, embaixo do calendário. */
function DayList({
  day,
  events,
  colorOf,
  tagOf,
  onOpen,
  onToggle,
  onCreate,
}: {
  day: Date;
  events: AgendaEvent[];
  colorOf: ColorOf;
  tagOf: Map<string, AgendaTag>;
  onOpen: (e: AgendaEvent) => void;
  onToggle: (e: AgendaEvent) => void;
  onCreate: () => void;
}) {
  return (
    <section className="ag-daylist" aria-live="polite">
      <h2 className="ag-daylist__title">
        {cap(day.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}
      </h2>
      {events.length ? (
        <ul className="ag-rows">
          {sortEvents(events).map((e) => (
            <EventRow
              key={e.id}
              e={e}
              colorOf={colorOf}
              tagOf={tagOf}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : (
        <button type="button" className="ag-daylist__empty" onClick={onCreate}>
          <Plus size={16} aria-hidden /> Nada marcado. Toque para adicionar.
        </button>
      )}
    </section>
  );
}
