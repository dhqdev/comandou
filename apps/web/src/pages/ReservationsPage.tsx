import {
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  MessageCircle,
  Phone,
  Plus,
  Settings2,
  Users,
} from 'lucide-react';
import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  DateInput,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { SelectField } from '../features/forms';
import { api, ApiError } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { useArrivalSound } from '../lib/sounds';
import { useAuth } from '../app/auth';
import './reservations.css';

export type ReservationStatus =
  'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';

export interface Reservation {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  partySize: number;
  startsAt: string;
  durationMinutes: number;
  occasion: string | null;
  notes: string | null;
  staffNotes: string | null;
  status: ReservationStatus;
  tableId: string | null;
  tableLabel: string | null;
  source: 'online' | 'staff' | 'whatsapp';
  cancelReason: string | null;
  cancelledBy: 'customer' | 'staff' | null;
  createdAt: string;
}

interface Settings {
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

interface DiningTable {
  id: string;
  label: string;
  seats: number;
  area: string | null;
  active?: boolean;
}

export const RESERVATION_STATUS: Record<
  ReservationStatus,
  { label: string; tone: 'warning' | 'info' | 'success' | 'neutral' | 'danger' | 'brand' }
> = {
  pending: { label: 'Aguardando', tone: 'warning' },
  confirmed: { label: 'Confirmada', tone: 'info' },
  seated: { label: 'Chegou', tone: 'success' },
  completed: { label: 'Concluída', tone: 'neutral' },
  cancelled: { label: 'Cancelada', tone: 'danger' },
  no_show: { label: 'Não veio', tone: 'danger' },
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const OCCASIONS = ['Aniversário', 'Encontro', 'Negócios', 'Família', 'Comemoração'];

/** AAAA-MM-DD no fuso do aparelho. */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayStart = (day: string) => new Date(`${day}T00:00:00`);
const shiftDay = (day: string, n: number) => {
  const d = dayStart(day);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtPhone = (p: string) =>
  p.length === 11
    ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
    : p.length === 10
      ? `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`
      : p;
const longDay = (day: string) =>
  dayStart(day).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

/** Agenda de reservas: dia a dia, com a semana em volta, confirmação e mesa de cada grupo. */
export function ReservationsPage() {
  const { me } = useAuth();
  const toast = useToast();
  const canManage = !!me?.permissions.includes('settings:manage');
  const [day, setDay] = useState(() => isoDay(new Date()));
  const [list, setList] = useState<Reservation[] | null>(null);
  const [week, setWeek] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Reservation | 'new' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('open');

  // A semana (domingo a sábado) que contém o dia escolhido.
  const weekStart = useMemo(() => shiftDay(day, -dayStart(day).getDay()), [day]);

  const load = useCallback(async () => {
    try {
      const from = dayStart(weekStart);
      const to = dayStart(shiftDay(weekStart, 7));
      const all = await api<Reservation[]>(
        `/reservations?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      );
      setWeek(all);
      setList(all.filter((r) => isoDay(new Date(r.startsAt)) === day));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [day, weekStart]);

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

  useRealtime((e) => {
    if (e.type === 'reservation.changed') void load();
  }, load);
  // Toca o aviso de novidade quando chega uma reserva do cardápio esperando confirmação.
  useArrivalSound(
    'order',
    list === null ? null : week.filter((r) => r.status === 'pending').map((r) => r.id),
  );

  async function update(
    r: Reservation,
    patch: Partial<Reservation> & { tableBusyOk?: boolean },
    msg?: string,
  ) {
    try {
      await api(`/reservations/${r.id}`, { method: 'PATCH', json: patch });
      if (msg) toast(msg, 'success');
      void load();
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
      void load();
    }
  }

  const counts = useMemo(() => {
    const live = (list ?? []).filter((r) => !['cancelled', 'no_show'].includes(r.status));
    return {
      total: live.length,
      people: live.reduce((n, r) => n + r.partySize, 0),
      pending: live.filter((r) => r.status === 'pending').length,
      seated: live.filter((r) => r.status === 'seated').length,
    };
  }, [list]);

  const shown = (list ?? []).filter((r) =>
    filter === 'all'
      ? true
      : filter === 'open'
        ? ['pending', 'confirmed', 'seated'].includes(r.status)
        : ['completed', 'cancelled', 'no_show'].includes(r.status),
  );

  // Reservas agrupadas pelo horário de chegada.
  const groups = useMemo(() => {
    const m = new Map<string, Reservation[]>();
    for (const r of shown) {
      const k = hhmm(r.startsAt);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [shown]);

  const storeLink = `${window.location.origin}/pedir/reservar`;

  return (
    <div className="rv">
      <div className="page-head">
        <div>
          <h1 className="page-title">Reservas</h1>
          <p className="page-sub">
            {settings?.enabled
              ? 'Clientes reservam pelo cardápio online. Confirme, escolha a mesa e receba o grupo.'
              : 'Lance reservas por telefone ou ligue as reservas pelo cardápio online.'}
          </p>
        </div>
        <div className="rv-head-actions">
          {canManage && (
            <Button
              variant="secondary"
              icon={<Settings2 size={16} />}
              onClick={() => setShowSettings(true)}
            >
              Configurar
            </Button>
          )}
          <Button icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Nova reserva
          </Button>
        </div>
      </div>

      {settings && !settings.enabled && canManage && (
        <div className="rv-banner">
          <CalendarCheck size={20} aria-hidden />
          <span>
            <strong>Reservas online desligadas.</strong> Ligue para o cliente reservar mesa direto
            pelo cardápio, com os horários que você escolher.
          </span>
          <Button size="sm" onClick={() => setShowSettings(true)}>
            Ligar reservas
          </Button>
        </div>
      )}

      <div className="rv-daybar">
        <Button
          variant="ghost"
          aria-label="Semana anterior"
          icon={<ChevronLeft size={18} />}
          onClick={() => setDay(shiftDay(day, -7))}
        />
        <div className="rv-week" role="tablist" aria-label="Dias da semana">
          {Array.from({ length: 7 }, (_, i) => {
            const d = shiftDay(weekStart, i);
            const rs = week.filter(
              (r) =>
                isoDay(new Date(r.startsAt)) === d && !['cancelled', 'no_show'].includes(r.status),
            );
            const pend = rs.some((r) => r.status === 'pending');
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={d === day}
                className="rv-week__day"
                data-today={d === isoDay(new Date()) || undefined}
                onClick={() => setDay(d)}
              >
                <span className="rv-week__wd">{WEEKDAYS[i]}</span>
                <strong>{Number(d.slice(8))}</strong>
                <span className="rv-week__count" data-pending={pend || undefined}>
                  {rs.length ? `${rs.length} · ${rs.reduce((n, r) => n + r.partySize, 0)}p` : '–'}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          aria-label="Próxima semana"
          icon={<ChevronRight size={18} />}
          onClick={() => setDay(shiftDay(day, 7))}
        />
        <label className="rv-datepick">
          <span className="cm-sr-only">Ir para o dia</span>
          <DateInput value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
      </div>

      <div className="rv-summary">
        <h2>{longDay(day)}</h2>
        <div className="rv-kpis">
          <Kpi icon={<CalendarDays size={16} />} label="Reservas" value={counts.total} />
          <Kpi icon={<Users size={16} />} label="Pessoas" value={counts.people} />
          <Kpi
            icon={<Clock size={16} />}
            label="Aguardando"
            value={counts.pending}
            tone={counts.pending ? 'warning' : undefined}
          />
          <Kpi icon={<CalendarCheck size={16} />} label="No salão" value={counts.seated} />
        </div>
      </div>

      <div className="rv-filter" role="tablist" aria-label="Filtro">
        {(
          [
            ['open', 'Em aberto'],
            ['done', 'Encerradas'],
            ['all', 'Todas'],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={filter === v}
            onClick={() => setFilter(v)}
          >
            {l}
          </button>
        ))}
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {!list ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <EmptyState
          mascot
          title={list.length ? 'Nada neste filtro' : 'Nenhuma reserva neste dia'}
          description={
            settings?.enabled
              ? 'Quando um cliente reservar pelo cardápio, ela aparece aqui na hora.'
              : 'Use “Nova reserva” para anotar as reservas feitas por telefone.'
          }
        />
      ) : (
        <div className="rv-timeline">
          {groups.map(([t, rs]) => (
            <section key={t} className="rv-slot">
              <div className="rv-slot__time">
                <strong>{t}</strong>
                <span>{rs.reduce((n, r) => n + r.partySize, 0)} pessoas</span>
              </div>
              <div className="rv-slot__cards">
                {rs.map((r, i) => (
                  <ReservationCard
                    key={r.id}
                    r={r}
                    i={i}
                    tables={tables}
                    onUpdate={update}
                    onEdit={() => setEditing(r)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <ReservationForm
          initial={editing === 'new' ? null : editing}
          day={day}
          tables={tables}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {showSettings && settings && (
        <SettingsModal
          initial={settings}
          storeLink={storeLink}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => {
            setSettings(s);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: 'warning';
}) {
  return (
    <div className="rv-kpi" data-tone={tone}>
      <span className="rv-kpi__icon">{icon}</span>
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}

function ReservationCard({
  r,
  i,
  tables,
  onUpdate,
  onEdit,
}: {
  r: Reservation;
  i: number;
  tables: DiningTable[];
  onUpdate(
    r: Reservation,
    patch: Partial<Reservation> & { tableBusyOk?: boolean },
    msg?: string,
  ): void;
  onEdit(): void;
}) {
  const st = RESERVATION_STATUS[r.status];
  const closed = ['completed', 'cancelled', 'no_show'].includes(r.status);
  const wa = `https://wa.me/55${r.phone}`;
  return (
    <article
      className="rv-card"
      data-status={r.status}
      style={{ '--i': i } as CSSProperties}
      aria-label={`Reserva de ${r.name}`}
    >
      <header className="rv-card__head">
        <div className="rv-card__who">
          <strong>{r.name}</strong>
          <span className="rv-card__meta">
            <Users size={14} aria-hidden /> {r.partySize} {r.partySize === 1 ? 'pessoa' : 'pessoas'}
            <span aria-hidden>·</span> #{r.code}
            {r.source !== 'staff' && (
              <>
                <span aria-hidden>·</span>{' '}
                {r.source === 'whatsapp' ? 'pelo WhatsApp' : 'pelo cardápio'}
              </>
            )}
          </span>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </header>

      {(r.occasion || r.notes || r.staffNotes || r.cancelReason) && (
        <div className="rv-card__notes">
          {r.occasion && <span className="rv-chip">{r.occasion}</span>}
          {r.notes && <p>“{r.notes}”</p>}
          {r.staffNotes && (
            <p className="rv-card__staff">
              <strong>Equipe:</strong> {r.staffNotes}
            </p>
          )}
          {r.cancelReason && r.status === 'cancelled' && (
            <p className="rv-card__staff">
              {r.cancelledBy === 'customer' ? 'Cancelada pelo cliente' : r.cancelReason}
            </p>
          )}
        </div>
      )}

      <div className="rv-card__row">
        <a className="rv-contact" href={`tel:+55${r.phone}`}>
          <Phone size={14} aria-hidden /> {fmtPhone(r.phone)}
        </a>
        <a className="rv-contact" href={wa} target="_blank" rel="noreferrer">
          <MessageCircle size={14} aria-hidden /> WhatsApp
        </a>
        <label className="rv-table">
          <span>Mesa</span>
          <select
            className="cm-input"
            value={r.tableId ?? ''}
            disabled={closed}
            onChange={(e) =>
              onUpdate(
                r,
                { tableId: e.target.value || null },
                e.target.value ? 'Mesa marcada' : undefined,
              )
            }
          >
            <option value="">Sem mesa</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} ({t.seats} lugares{t.area ? ` · ${t.area}` : ''})
              </option>
            ))}
          </select>
        </label>
      </div>

      <footer className="rv-card__actions">
        {r.status === 'pending' && (
          <Button
            size="sm"
            variant="success"
            onClick={() => onUpdate(r, { status: 'confirmed' }, 'Reserva confirmada')}
          >
            Confirmar
          </Button>
        )}
        {(r.status === 'pending' || r.status === 'confirmed') && (
          <Button size="sm" onClick={() => onUpdate(r, { status: 'seated' }, 'Grupo no salão')}>
            Chegou
          </Button>
        )}
        {r.status === 'seated' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onUpdate(r, { status: 'completed' })}
          >
            Concluir
          </Button>
        )}
        {(r.status === 'pending' || r.status === 'confirmed') && (
          <Button size="sm" variant="ghost" onClick={() => onUpdate(r, { status: 'no_show' })}>
            Não veio
          </Button>
        )}
        {closed && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onUpdate(r, { status: 'confirmed' }, 'Reserva reaberta')}
          >
            Reabrir
          </Button>
        )}
        <span className="rv-card__spacer" />
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Editar
        </Button>
        {!closed && (
          <Button
            size="sm"
            variant="ghost"
            className="rv-danger"
            onClick={() => {
              const reason = window.prompt('Motivo do cancelamento (opcional)');
              if (reason === null) return;
              onUpdate(
                r,
                { status: 'cancelled', cancelReason: reason || null },
                'Reserva cancelada',
              );
            }}
          >
            Cancelar
          </Button>
        )}
      </footer>
    </article>
  );
}

function ReservationForm({
  initial,
  day,
  tables,
  onClose,
  onSaved,
}: {
  initial: Reservation | null;
  day: string;
  tables: DiningTable[];
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    name: initial?.name ?? '',
    phone: initial ? fmtPhone(initial.phone) : '',
    partySize: String(initial?.partySize ?? 2),
    date: initial ? isoDay(new Date(initial.startsAt)) : day,
    time: initial ? hhmm(initial.startsAt) : '20:00',
    occasion: initial?.occasion ?? '',
    notes: initial?.notes ?? '',
    staffNotes: initial?.staffNotes ?? '',
    tableId: initial?.tableId ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name.trim(),
      phone: f.phone,
      partySize: Number(f.partySize),
      startsAt: new Date(`${f.date}T${f.time}:00`).toISOString(),
      occasion: f.occasion.trim() || null,
      notes: f.notes.trim() || null,
      staffNotes: f.staffNotes.trim() || null,
      tableId: f.tableId || null,
    };
    try {
      if (initial) await api(`/reservations/${initial.id}`, { method: 'PATCH', json: body });
      else await api('/reservations', { method: 'POST', json: body });
      toast(initial ? 'Reserva atualizada' : 'Reserva anotada', 'success');
      onSaved();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={initial ? `Reserva #${initial.code}` : 'Nova reserva'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button type="submit" form="rv-form" loading={busy}>
            {initial ? 'Salvar' : 'Anotar reserva'}
          </Button>
        </>
      }
    >
      <form id="rv-form" className="cm-form" onSubmit={submit}>
        {error && <Alert tone="danger">{error}</Alert>}
        <h3 className="cm-form__section">Cliente</h3>
        <TextField label="Nome" required maxLength={80} value={f.name} onChange={set('name')} />
        <TextField
          label="Celular"
          required
          inputMode="tel"
          placeholder="(11) 98888-7777"
          value={f.phone}
          onChange={set('phone')}
        />
        <TextField
          label="Pessoas"
          type="number"
          min={1}
          max={100}
          required
          value={f.partySize}
          onChange={set('partySize')}
        />
        <h3 className="cm-form__section">Reserva</h3>
        <TextField label="Dia" type="date" required value={f.date} onChange={set('date')} />
        <TextField label="Horário" type="time" required value={f.time} onChange={set('time')} />
        <SelectField label="Mesa" value={f.tableId} onChange={set('tableId')}>
          <option value="">Escolher depois</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({t.seats} lugares)
            </option>
          ))}
        </SelectField>
        <h3 className="cm-form__section">Detalhes</h3>
        <TextField
          label="Ocasião"
          maxLength={40}
          list="rv-occasions"
          placeholder="Aniversário, encontro…"
          value={f.occasion}
          onChange={set('occasion')}
        />
        <datalist id="rv-occasions">
          {OCCASIONS.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <TextField
          label="Pedido do cliente"
          maxLength={300}
          placeholder="Cadeira de bebê, perto da janela…"
          value={f.notes}
          onChange={set('notes')}
        />
        <TextField
          label="Anotação da equipe"
          hint="O cliente não vê."
          maxLength={300}
          value={f.staffNotes}
          onChange={set('staffNotes')}
        />
      </form>
    </Modal>
  );
}

function SettingsModal({
  initial,
  storeLink,
  onClose,
  onSaved,
}: {
  initial: Settings;
  storeLink: string;
  onClose(): void;
  onSaved(s: Settings): void;
}) {
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const out = await api<Settings>('/reservations/settings', {
        method: 'PATCH',
        json: { ...s, note: s.note?.trim() || null },
      });
      toast('Reservas salvas', 'success');
      onSaved(out);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title="Reservas pelo cardápio"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button loading={busy} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="cm-form">
        {error && <Alert tone="danger">{error}</Alert>}
        <RvToggle
          label="Aceitar reservas pelo cardápio online"
          hint="Aparece o botão “Reservar mesa” no cardápio. Só reserva quem entra na conta (com as contas de cliente ligadas na Loja online)."
          checked={s.enabled}
          onChange={(v) => set('enabled', v)}
        />
        <RvToggle
          label="Confirmar automaticamente"
          hint="Desligado, cada reserva chega como “Aguardando” para a equipe confirmar."
          checked={s.autoConfirm}
          onChange={(v) => set('autoConfirm', v)}
        />

        <h3 className="cm-form__section">Agenda</h3>
        <fieldset className="rv-fieldset cm-form__block">
          <legend>Dias com reserva</legend>
          <div className="rv-weekdays">
            {WEEKDAYS.map((w, i) => (
              <button
                key={w}
                type="button"
                aria-pressed={s.weekdays.includes(i)}
                onClick={() =>
                  set(
                    'weekdays',
                    s.weekdays.includes(i)
                      ? s.weekdays.filter((d) => d !== i)
                      : [...s.weekdays, i].sort(),
                  )
                }
              >
                {w}
              </button>
            ))}
          </div>
        </fieldset>

        <>
          <TextField
            label="Primeiro horário"
            type="time"
            value={s.opensAt}
            onChange={(e) => set('opensAt', e.target.value)}
          />
          <TextField
            label="Último horário"
            type="time"
            value={s.closesAt}
            onChange={(e) => set('closesAt', e.target.value)}
            hint="Antes do primeiro = passa da meia-noite"
          />
          <SelectField
            label="Intervalo entre horários"
            value={String(s.slotMinutes)}
            onChange={(e) => set('slotMinutes', Number(e.target.value))}
          >
            <option value="15">15 minutos</option>
            <option value="30">30 minutos</option>
            <option value="60">1 hora</option>
          </SelectField>
          <TextField
            label="Tempo médio na mesa (min)"
            type="number"
            min={15}
            max={600}
            value={String(s.durationMinutes)}
            onChange={(e) => set('durationMinutes', Number(e.target.value))}
          />
          <TextField
            label="Máximo de pessoas por reserva"
            type="number"
            min={1}
            max={100}
            value={String(s.maxParty)}
            onChange={(e) => set('maxParty', Number(e.target.value))}
          />
          <TextField
            label="Lugares para reserva ao mesmo tempo"
            type="number"
            min={1}
            placeholder="Sem limite"
            value={s.capacity === null ? '' : String(s.capacity)}
            onChange={(e) => set('capacity', e.target.value ? Number(e.target.value) : null)}
            hint="Vazio = sem limite"
          />
          <TextField
            label="Antecedência mínima (horas)"
            type="number"
            min={0}
            max={168}
            step="0.5"
            value={String(s.minAdvanceMinutes / 60)}
            onChange={(e) => set('minAdvanceMinutes', Math.round(Number(e.target.value) * 60))}
          />
          <TextField
            label="Abrir agenda para os próximos (dias)"
            type="number"
            min={1}
            max={365}
            value={String(s.maxDaysAhead)}
            onChange={(e) => set('maxDaysAhead', Number(e.target.value))}
          />
        </>
        <h3 className="cm-form__section">Cliente</h3>
        <TextField
          label="Recado para o cliente"
          maxLength={300}
          placeholder="Ex.: tolerância de 15 minutos. Mesas na varanda conforme disponibilidade."
          value={s.note ?? ''}
          onChange={(e) => set('note', e.target.value)}
        />
        <div className="rv-link">
          <span>
            <strong>Link direto da reserva</strong>
            <small>{storeLink}</small>
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy size={14} />}
            onClick={() =>
              navigator.clipboard
                ?.writeText(storeLink)
                .then(() => toast('Link copiado', 'success'))
                .catch(() => undefined)
            }
          >
            Copiar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RvToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <label className="rv-toggle cm-form__row">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <span className="rv-switch">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span aria-hidden />
      </span>
    </label>
  );
}
