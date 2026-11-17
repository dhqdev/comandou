import { ChevronLeft, ChevronRight, Plus, Repeat as RepeatIcon, Users } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { Alert, Button, Modal, Spinner, TextField, useToast } from '../../design-system';
import { CheckField, SelectField } from '../../features/forms';
import { api } from '../../lib/api';
import { useLoad } from '../OverviewPages';
import { Tag } from '../ui';
import type { Attendee, CalendarEvent, Mailbox, Repeat } from './types';

const TZ = 'America/Sao_Paulo';
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const REPEAT: [Repeat, string][] = [
  ['none', 'Não repete'],
  ['daily', 'Todo dia'],
  ['weekly', 'Toda semana'],
  ['monthly', 'Todo mês'],
  ['yearly', 'Todo ano'],
];
const COLORS: [CalendarEvent['color'], string][] = [
  ['brand', 'Laranja'],
  ['blue', 'Azul'],
  ['green', 'Verde'],
  ['purple', 'Roxo'],
  ['gray', 'Cinza'],
];
const STATUS: Record<Attendee['status'], [string, 'ok' | 'bad' | 'warn' | 'off']> = {
  accepted: ['Vai', 'ok'],
  declined: ['Não vai', 'bad'],
  tentative: ['Talvez', 'warn'],
  'needs-action': ['Sem resposta', 'off'],
};

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** Agenda: mês com os compromissos de cada dia; clicar no dia cria, clicar no evento edita. */
export function CalendarTab({ mailboxes }: { mailboxes: Mailbox[] }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [editing, setEditing] = useState<CalendarEvent | { day: string } | null>(null);
  // A grade começa no domingo antes do dia 1 e mostra 6 semanas.
  const first = new Date(month);
  first.setDate(1 - month.getDay());
  const last = new Date(first);
  last.setDate(first.getDate() + 42);
  const events = useLoad<CalendarEvent[]>(
    `/platform/mail/events?from=${first.toISOString()}&to=${last.toISOString()}`,
  );
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events.data ?? []) {
      const k = isoDay(new Date(e.startsAt));
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [events.data]);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
  const today = isoDay(new Date());
  const upcoming = (events.data ?? []).filter((e) => new Date(e.endsAt) >= new Date()).slice(0, 8);

  return (
    <div className="cal">
      <div className="cal__head">
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLeft size={16} />}
          aria-label="Mês anterior"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        />
        <h2 className="cal__title">
          {month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronRight size={16} />}
          aria-label="Próximo mês"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        />
        <Button variant="ghost" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
          Hoje
        </Button>
        <span className="mail__spacer" />
        <Button size="sm" icon={<Plus size={15} />} onClick={() => setEditing({ day: today })}>
          Novo evento
        </Button>
      </div>
      {events.error && <Alert tone="danger">{events.error}</Alert>}
      <div className="cal__grid" role="grid" aria-label="Mês">
        {WEEK.map((w) => (
          <div key={w} className="cal__dow" role="columnheader">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const k = isoDay(d);
          const list = byDay.get(k) ?? [];
          return (
            <div
              key={k}
              role="gridcell"
              className="cal__day"
              data-other={d.getMonth() !== month.getMonth() || undefined}
              data-today={k === today || undefined}
            >
              <button
                type="button"
                className="cal__num"
                aria-label={`Novo evento em ${d.toLocaleDateString('pt-BR')}`}
                onClick={() => setEditing({ day: k })}
              >
                {d.getDate()}
              </button>
              {list.slice(0, 3).map((e) => (
                <button
                  key={`${e.id}-${e.startsAt}`}
                  type="button"
                  className="cal__event"
                  data-color={e.color}
                  onClick={() => setEditing(e)}
                  title={e.title}
                >
                  {!e.allDay && <span className="cal__time">{hhmm(new Date(e.startsAt))}</span>}
                  {e.title}
                </button>
              ))}
              {list.length > 3 && <span className="cal__more">+{list.length - 3}</span>}
            </div>
          );
        })}
      </div>
      {!events.data && <Spinner />}
      {upcoming.length > 0 && (
        <section className="cal__upcoming">
          <h3 className="cal__subtitle">Próximos</h3>
          <ul>
            {upcoming.map((e) => (
              <li key={`${e.id}-${e.startsAt}`}>
                <button type="button" className="cal__row" onClick={() => setEditing(e)}>
                  <span className="cal__dot" data-color={e.color} aria-hidden />
                  <span className="cal__row-when">
                    {new Date(e.startsAt).toLocaleDateString('pt-BR', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                    {!e.allDay && ` · ${hhmm(new Date(e.startsAt))}`}
                  </span>
                  <strong>{e.title}</strong>
                  {e.repeat !== 'none' && <RepeatIcon size={13} aria-label="Repete" />}
                  {e.attendees.length > 0 && (
                    <span className="cal__row-people">
                      <Users size={13} aria-hidden /> {e.attendees.length}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {editing && (
        <EventForm
          event={'id' in editing ? editing : null}
          day={'day' in editing ? editing.day : null}
          mailboxes={mailboxes.filter((m) => !m.archived)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            events.reload();
          }}
        />
      )}
    </div>
  );
}

function EventForm({
  event,
  day,
  mailboxes,
  onClose,
  onSaved,
}: {
  event: CalendarEvent | null;
  day: string | null;
  mailboxes: Mailbox[];
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  // Editar uma repetição mexe na série inteira: usa as datas do evento original.
  const s = event ? new Date(event.seriesStartsAt) : null;
  const e = event ? new Date(event.seriesEndsAt) : null;
  const [f, setF] = useState({
    title: event?.title ?? '',
    date: s ? isoDay(s) : (day ?? isoDay(new Date())),
    start: s ? hhmm(s) : '09:00',
    end: e ? hhmm(e) : '10:00',
    endDate: e ? isoDay(e) : (day ?? isoDay(new Date())),
    allDay: event?.allDay ?? false,
    repeat: event?.repeat ?? ('none' as Repeat),
    repeatUntil: event?.repeatUntil ?? '',
    location: event?.location ?? '',
    description: event?.description ?? '',
    color: event?.color ?? 'brand',
    mailboxId: event?.mailboxId ?? mailboxes[0]?.id ?? '',
    attendees:
      event?.attendees.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ') ?? '',
    notify: true,
  });
  const [busy, setBusy] = useState<'save' | 'cancel' | null>(null);
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) =>
    setF({ ...f, [k]: ev.target.value });

  const attendees = f.attendees
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^(.*)<([^<>]+)>$/.exec(p);
      return {
        email: (m ? m[2]! : p).trim().toLowerCase(),
        name: m ? m[1]!.replace(/"/g, '').trim() : '',
      };
    })
    .filter((a) => /^\S+@\S+\.\S+$/.test(a.email));

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    const startsAt = f.allDay
      ? new Date(`${f.date}T00:00:00`)
      : new Date(`${f.date}T${f.start}:00`);
    const endsAt = f.allDay
      ? new Date(new Date(`${f.endDate}T00:00:00`).getTime() + 86_400_000)
      : new Date(`${f.endDate}T${f.end}:00`);
    if (!(endsAt > startsAt)) {
      toast('O fim precisa ser depois do começo', 'danger');
      return;
    }
    setBusy('save');
    try {
      await api(event ? `/platform/mail/events/${event.id}` : '/platform/mail/events', {
        method: event ? 'PUT' : 'POST',
        json: {
          mailboxId: f.mailboxId || null,
          title: f.title,
          description: f.description,
          location: f.location,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          allDay: f.allDay,
          timeZone: TZ,
          color: f.color,
          repeat: f.repeat,
          repeatUntil: f.repeat !== 'none' && f.repeatUntil ? f.repeatUntil : null,
          attendees,
          notify: f.notify,
        },
      });
      toast(attendees.length && f.notify ? 'Salvo e convites enviados' : 'Salvo', 'success');
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (
      !event ||
      !window.confirm(
        event.attendees.length ? 'Cancelar o evento e avisar os convidados?' : 'Apagar o evento?',
      )
    )
      return;
    setBusy('cancel');
    try {
      await api(`/platform/mail/events/${event.id}`, { method: 'DELETE' });
      toast('Evento cancelado', 'success');
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      title={event ? 'Editar evento' : 'Novo evento'}
      onClose={onClose}
      footer={
        <>
          {event && (
            <Button variant="ghost" onClick={cancel} loading={busy === 'cancel'} disabled={!!busy}>
              Cancelar evento
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={!!busy}>
            Fechar
          </Button>
          <Button
            type="submit"
            form="cal-event"
            loading={busy === 'save'}
            disabled={!!busy || !f.title.trim()}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form id="cal-event" className="cm-form" onSubmit={save}>
        <TextField
          label="Título"
          wrapClass="cm-form__wide"
          autoFocus
          value={f.title}
          onChange={set('title')}
          maxLength={200}
        />
        <TextField
          label="Começa"
          type="date"
          value={f.date}
          onChange={(ev) =>
            setF({
              ...f,
              date: ev.target.value,
              endDate: f.endDate < ev.target.value ? ev.target.value : f.endDate,
            })
          }
        />
        {!f.allDay && (
          <TextField label="Hora" type="time" value={f.start} onChange={set('start')} />
        )}
        <TextField label="Termina" type="date" value={f.endDate} onChange={set('endDate')} />
        {!f.allDay && (
          <TextField label="Hora do fim" type="time" value={f.end} onChange={set('end')} />
        )}
        <div className="cm-form__block">
          <CheckField
            label="Dia inteiro"
            checked={f.allDay}
            onChange={(v) => setF({ ...f, allDay: v })}
          />
        </div>
        <SelectField label="Repetir" value={f.repeat} onChange={set('repeat')}>
          {REPEAT.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </SelectField>
        {f.repeat !== 'none' && (
          <TextField
            label="Repetir até"
            type="date"
            hint="Vazio: sem fim"
            value={f.repeatUntil}
            onChange={set('repeatUntil')}
          />
        )}
        <TextField
          label="Local ou link da chamada"
          wrapClass="cm-form__wide"
          value={f.location}
          onChange={set('location')}
          maxLength={300}
        />
        <label className="cm-field cm-form__wide">
          <span className="cm-label">Descrição</span>
          <textarea
            className="cm-input"
            rows={3}
            value={f.description}
            onChange={set('description')}
            maxLength={4000}
          />
        </label>
        <SelectField label="Cor" value={f.color} onChange={set('color')}>
          {COLORS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </SelectField>
        <h3 className="cm-form__section">Convidados</h3>
        <TextField
          label="E-mails dos convidados"
          wrapClass="cm-form__wide"
          placeholder="dono@restaurante.com, socio@restaurante.com"
          hint="Cada um recebe o convite com o arquivo da agenda e pode responder Sim, Não ou Talvez."
          value={f.attendees}
          onChange={set('attendees')}
        />
        {attendees.length > 0 && (
          <>
            <SelectField
              label="Enviar o convite de"
              value={f.mailboxId}
              onChange={set('mailboxId')}
            >
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.address}
                </option>
              ))}
            </SelectField>
            <div className="cm-form__block">
              <CheckField
                label={event ? 'Mandar a atualização aos convidados' : 'Mandar o convite agora'}
                checked={f.notify}
                onChange={(v) => setF({ ...f, notify: v })}
              />
            </div>
          </>
        )}
        {event && event.attendees.length > 0 && (
          <ul className="cal__people cm-form__wide">
            {event.attendees.map((a) => {
              const [label, level] = STATUS[a.status];
              return (
                <li key={a.email}>
                  <span>{a.name || a.email}</span>
                  <Tag level={level}>{label}</Tag>
                </li>
              );
            })}
          </ul>
        )}
        {!mailboxes.length && attendees.length > 0 && (
          <Alert tone="warning">Crie uma caixa de e-mail para mandar convites.</Alert>
        )}
      </form>
    </Modal>
  );
}
