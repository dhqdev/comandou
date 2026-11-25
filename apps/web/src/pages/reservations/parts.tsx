import { Copy, MessageCircle, Phone, Smartphone, Users } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Alert, Badge, Button, Modal, TextField, useToast } from '../../design-system';
import { CustomerPicker, maskPhone, type OrderCustomer } from '../../features/CustomerPicker';
import { SelectField } from '../../features/forms';
import { api, ApiError } from '../../lib/api';

/* Peças da tela de Reservas: tipos, cartão com as ações, formulário e configurações. */

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show';

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
  /** Cadastro do cliente (conta do cardápio): ele acompanha a reserva pelo app. */
  customerId: string | null;
  customerName: string | null;
  createdAt: string;
}

export interface Settings {
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

export interface DiningTable {
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

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const OCCASIONS = ['Aniversário', 'Encontro', 'Negócios', 'Família', 'Comemoração'];

/** Cor de cada situação no calendário (bolinha, bloco e filtro). Só tokens: seguem o tema. */
export const STATUS_COLOR: Record<ReservationStatus, string> = {
  pending: 'var(--cm-warning)',
  confirmed: 'var(--cm-info)',
  seated: 'var(--cm-success)',
  completed: 'var(--cm-text-subtle)',
  cancelled: 'var(--cm-danger)',
  no_show: 'var(--cm-danger)',
};
export const STATUS_ORDER: ReservationStatus[] = [
  'pending',
  'confirmed',
  'seated',
  'completed',
  'cancelled',
  'no_show',
];
export const isClosed = (s: ReservationStatus) =>
  s === 'completed' || s === 'cancelled' || s === 'no_show';

/** AAAA-MM-DD no fuso do aparelho. */
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const hhmmOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const fmtPhone = (p: string) =>
  p.length === 11
    ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
    : p.length === 10
      ? `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`
      : p;
/** "1h30", "2h", "45 min". */
export const durLabel = (m: number) =>
  m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;

/**
 * Cartão da reserva com tudo o que a equipe faz nela: confirmar, chegou, mesa, contato.
 * `plain` tira a borda (dentro da janela de detalhe).
 */
export function ReservationCard({
  r,
  tables,
  onUpdate,
  onEdit,
  plain,
  fresh,
}: {
  r: Reservation;
  tables: DiningTable[];
  plain?: boolean;
  /** Acabou de mudar (cliente, sistema ou outra pessoa): pisca de leve para chamar o olho. */
  fresh?: boolean;
  onUpdate(
    r: Reservation,
    patch: Partial<Reservation> & { tableBusyOk?: boolean },
    msg?: string,
  ): void;
  onEdit(): void;
}) {
  const st = RESERVATION_STATUS[r.status];
  const closed = isClosed(r.status);
  const wa = `https://wa.me/55${r.phone}`;
  // Cancelar pede o motivo ali mesmo, no rodapé do cartão (antes era o prompt() do navegador,
  // que no app instalado nem sempre aparece).
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <article
      className={`rv-card ${plain ? 'rv-card--plain' : ''} ${fresh ? 'is-fresh' : ''}`}
      data-status={r.status}
      aria-label={`Reserva de ${r.name}`}
    >
      <header className="rv-card__head">
        <span className="rv-card__time">
          <strong>{hhmmOf(r.startsAt)}</strong>
          <small>{durLabel(r.durationMinutes)}</small>
        </span>
        <div className="rv-card__who">
          <strong>{r.name}</strong>
          <span className="rv-card__meta">
            <Users size={14} aria-hidden /> {r.partySize} {r.partySize === 1 ? 'pessoa' : 'pessoas'}
            {r.tableLabel && (
              <>
                <span aria-hidden>·</span> Mesa {r.tableLabel}
              </>
            )}
            <span aria-hidden>·</span> #{r.code}
            {r.source !== 'staff' && (
              <>
                <span aria-hidden>·</span>{' '}
                {r.source === 'whatsapp' ? 'pelo WhatsApp' : 'pelo cardápio'}
              </>
            )}
            {r.customerId && (
              <>
                <span aria-hidden>·</span>{' '}
                <span
                  className="rv-card__app"
                  title={`Na conta de ${r.customerName ?? r.name}: acompanha pelo cardápio`}
                >
                  <Smartphone size={13} aria-hidden /> acompanha pelo app
                </span>
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

      {cancelling ? (
        <form
          className="rv-card__cancel"
          onSubmit={(e) => {
            e.preventDefault();
            onUpdate(
              r,
              { status: 'cancelled', cancelReason: reason.trim() || null },
              'Reserva cancelada',
            );
            setCancelling(false);
            setReason('');
          }}
        >
          <input
            className="cm-input"
            aria-label="Motivo do cancelamento"
            placeholder="Motivo (opcional)"
            maxLength={200}
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
          />
          <Button size="sm" variant="danger" type="submit">
            Cancelar reserva
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCancelling(false)}>
            Voltar
          </Button>
        </form>
      ) : (
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
              onClick={() => setCancelling(true)}
            >
              Cancelar
            </Button>
          )}
        </footer>
      )}
    </article>
  );
}

/** Tempos na mesa que a equipe escolhe (o valor da reserva entra se for outro). */
const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240, 300];

export function ReservationForm({
  initial,
  day,
  time,
  defaultDuration,
  tables,
  onClose,
  onSaved,
}: {
  initial: Reservation | null;
  day: string;
  /** Horário já escolhido (clicou num horário vazio do calendário). */
  time?: string;
  defaultDuration: number;
  tables: DiningTable[];
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cliente da reserva: escolhido no cadastro (com id, acompanha pela conta no cardápio) ou só o
  // nome digitado, como no pedido.
  const [customer, setCustomer] = useState<OrderCustomer>({
    id: initial?.customerId ?? null,
    name: initial?.customerId ? (initial.customerName ?? initial.name) : (initial?.name ?? ''),
    phone: initial?.phone ?? '',
  });
  const [f, setF] = useState({
    phone: initial ? fmtPhone(initial.phone) : '',
    partySize: String(initial?.partySize ?? 2),
    date: initial ? isoDay(new Date(initial.startsAt)) : day,
    time: initial ? hhmmOf(initial.startsAt) : (time ?? '20:00'),
    duration: String(initial?.durationMinutes ?? defaultDuration),
    occasion: initial?.occasion ?? '',
    notes: initial?.notes ?? '',
    staffNotes: initial?.staffNotes ?? '',
    tableId: initial?.tableId ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!customer.name.trim()) {
      setError('Informe o nome do cliente (ou escolha um do cadastro).');
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: customer.name.trim(),
      phone: f.phone,
      customerId: customer.id,
      partySize: Number(f.partySize),
      startsAt: new Date(`${f.date}T${f.time}:00`).toISOString(),
      durationMinutes: Number(f.duration),
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
        <div className="cm-field cm-form__wide rv-customer">
          <span className="cm-label">Nome</span>
          <CustomerPicker
            value={customer}
            onChange={(c) => {
              setCustomer(c);
              // Escolheu do cadastro: o celular vem junto (dá para trocar).
              if (c.id && c.phone) setF((x) => ({ ...x, phone: fmtPhone(c.phone) }));
            }}
          />
          <span className="cm-hint">
            {customer.id
              ? 'Cliente com cadastro: a reserva aparece na conta dele no cardápio, que acompanha e cancela por lá.'
              : 'Busque pelo nome ou telefone para ligar ao cadastro (o cliente acompanha pelo app), ou só digite o nome.'}
          </span>
        </div>
        <TextField
          label="Celular"
          required
          inputMode="tel"
          placeholder="(11) 98888-7777"
          value={f.phone}
          onChange={(e) => setF((x) => ({ ...x, phone: maskPhone(e.target.value) }))}
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
        <SelectField label="Tempo na mesa" value={f.duration} onChange={set('duration')}>
          {[...new Set([...DURATIONS, Number(f.duration)])]
            .sort((a, b) => a - b)
            .map((m) => (
              <option key={m} value={m}>
                {durLabel(m)}
              </option>
            ))}
        </SelectField>
        <SelectField label="Mesa" value={f.tableId} onChange={set('tableId')}>
          <option value="">Escolher depois</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({t.seats} lugares
              {t.seats < Number(f.partySize || 0) ? ', pequena para o grupo' : ''})
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

export function SettingsModal({
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
