import { BellRing, Check, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Modal, TextField, useToast } from '../../design-system';
import { CheckField, SelectField } from '../../features/forms';
import { api } from '../../lib/api';
import {
  AgendaEvent,
  AgendaSettings,
  AgendaTag,
  addMinutes,
  dayKey,
  hhmm,
  joinLocal,
  presetOf,
  REMIND_PRESETS,
  TAG_COLORS,
} from './agenda-utils';

/** Rascunho de compromisso novo: dia e hora já escolhidos no calendário. */
export interface Draft {
  start: Date;
  end: Date;
  allDay: boolean;
}

interface Form {
  title: string;
  notes: string;
  allDay: boolean;
  startDay: string;
  startTime: string;
  endDay: string;
  endTime: string;
  tagId: string;
  done: boolean;
  /** '' sem lembrete, minutos antes (REMIND_PRESETS) ou 'custom'. */
  remind: string;
  remindAt: string;
}

function initial(ev: AgendaEvent | null, draft: Draft | null, remindDefault: string): Form {
  const s = ev ? new Date(ev.startsAt) : draft!.start;
  const allDay = ev ? ev.allDay : draft!.allDay;
  let e = ev ? new Date(ev.endsAt) : draft!.end;
  // Dia todo é guardado até 23:59 do último dia; no formulário mostra só o dia.
  if (allDay && e.getHours() === 0 && e.getMinutes() === 0 && e > s) e = addMinutes(e, -1);
  const remindAt = ev?.remindAt ? new Date(ev.remindAt) : null;
  const remind = ev ? presetOf(s, remindAt, allDay) : remindDefault;
  return {
    title: ev?.title ?? '',
    notes: ev?.notes ?? '',
    allDay,
    startDay: dayKey(s),
    startTime: hhmm(s),
    endDay: dayKey(e),
    endTime: hhmm(e),
    tagId: ev?.tagId ?? '',
    done: ev?.done ?? false,
    remind,
    remindAt: remindAt ? `${dayKey(remindAt)}T${hhmm(remindAt)}` : '',
  };
}

/** Janela de criar ou editar um compromisso (título, quando, tag, anotações e lembrete). */
export function EventDialog({
  event,
  draft,
  tags,
  settings,
  onClose,
  onSaved,
  onTagCreated,
  onOpenSettings,
}: {
  event: AgendaEvent | null;
  draft: Draft | null;
  tags: AgendaTag[];
  settings: AgendaSettings | null;
  onClose: () => void;
  onSaved: () => void;
  onTagCreated: (t: AgendaTag) => void;
  onOpenSettings: () => void;
}) {
  const toast = useToast();
  const waOn = !!settings?.whatsappEnabled;
  const [f, setF] = useState<Form>(() =>
    initial(event, draft, waOn ? (draft?.allDay ? '-480' : '30') : ''),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState<string | null>(null);
  const set = (p: Partial<Form>) => setF((cur) => ({ ...cur, ...p }));

  const times = () => {
    if (f.allDay) {
      const start = joinLocal(f.startDay, '00:00');
      const end = joinLocal(f.endDay || f.startDay, '23:59');
      return { start, end };
    }
    const start = joinLocal(f.startDay, f.startTime);
    const end = joinLocal(f.endDay || f.startDay, f.endTime || f.startTime);
    return { start, end };
  };

  const remindDate = (start: Date) => {
    if (!f.remind) return null;
    if (f.remind === 'custom')
      return f.remindAt ? joinLocal(f.remindAt.slice(0, 10), f.remindAt.slice(11, 16)) : null;
    return addMinutes(start, -Number(f.remind));
  };

  const presets = REMIND_PRESETS.filter((p) => p.allDay === f.allDay);

  async function save() {
    if (!f.title.trim()) return setError('Dê um título ao compromisso.');
    const { start, end } = times();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
      return setError('Confira o dia e a hora.');
    if (end < start) return setError('O fim vem antes do começo.');
    const remind = remindDate(start);
    if (f.remind === 'custom' && !remind) return setError('Escolha o dia e a hora do lembrete.');
    if (
      remind &&
      remind.getTime() < Date.now() - 60_000 &&
      (!event || remind.toISOString() !== event.remindAt)
    )
      return setError('O horário do lembrete já passou. Escolha outro.');
    setBusy(true);
    setError(null);
    const body = {
      title: f.title.trim(),
      notes: f.notes.trim() || null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      allDay: f.allDay,
      tagId: f.tagId || null,
      done: f.done,
      remindAt: remind ? remind.toISOString() : null,
    };
    try {
      if (event) await api(`/agenda/events/${event.id}`, { method: 'PATCH', json: body });
      else await api('/agenda/events', { method: 'POST', json: body });
      toast(event ? 'Compromisso salvo' : 'Compromisso criado', 'success');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!event || !window.confirm(`Excluir "${event.title}"?`)) return;
    setBusy(true);
    try {
      await api(`/agenda/events/${event.id}`, { method: 'DELETE' });
      toast('Compromisso excluído', 'success');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function createTag() {
    const name = (newTag ?? '').trim();
    if (!name) return setNewTag(null);
    try {
      const used = new Set(tags.map((t) => t.color));
      const color =
        TAG_COLORS.find((c) => !used.has(c)) ?? TAG_COLORS[tags.length % TAG_COLORS.length]!;
      const t = await api<AgendaTag>('/agenda/tags', { method: 'POST', json: { name, color } });
      onTagCreated(t);
      set({ tagId: t.id });
      setNewTag(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const status = event?.remindAt
    ? event.remindError
      ? { tone: 'warning' as const, text: `O lembrete não saiu: ${event.remindError}.` }
      : event.remindedAt && new Date(event.remindedAt) >= new Date(event.remindAt)
        ? { tone: 'info' as const, text: 'Lembrete enviado no WhatsApp.' }
        : null
    : null;

  return (
    <Modal
      open
      title={event ? 'Editar compromisso' : 'Novo compromisso'}
      onClose={onClose}
      footer={
        <>
          {event && (
            <Button
              variant="ghost"
              icon={<Trash2 size={16} />}
              onClick={remove}
              disabled={busy}
              className="ag-dlg__del"
            >
              Excluir
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={save} loading={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="cm-form ag-dlg">
        {error && (
          <div className="cm-form__wide">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
        <TextField
          label="Título"
          wrapClass="cm-form__wide"
          value={f.title}
          maxLength={120}
          autoFocus={!event}
          placeholder="Ex.: Receber o fornecedor de carnes"
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <div className="cm-form__wide">
          <CheckField
            label="Dia todo"
            checked={f.allDay}
            onChange={(allDay) =>
              set({
                allDay,
                remind: f.remind && f.remind !== 'custom' ? (allDay ? '-480' : '30') : f.remind,
              })
            }
          />
        </div>
        <div className={`ag-when ${f.allDay ? 'ag-when--day' : ''}`}>
          <TextField
            label={f.allDay ? 'De' : 'Começa'}
            type="date"
            value={f.startDay}
            onChange={(e) => {
              const v = e.target.value;
              // Andou o começo: o fim anda junto se ficaria antes.
              set({ startDay: v, endDay: f.endDay < v ? v : f.endDay });
            }}
          />
          {!f.allDay && (
            <TextField
              label="Hora"
              type="time"
              value={f.startTime}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return set({ startTime: v });
                // Mantém a duração ao trocar a hora do começo.
                const oldS = joinLocal(f.startDay, f.startTime);
                const oldE = joinLocal(f.endDay, f.endTime);
                const dur = Math.max(0, oldE.getTime() - oldS.getTime());
                const ns = joinLocal(f.startDay, v);
                const ne = new Date(ns.getTime() + dur);
                set({ startTime: v, endDay: dayKey(ne), endTime: hhmm(ne) });
              }}
            />
          )}
          <TextField
            label={f.allDay ? 'Até' : 'Termina'}
            type="date"
            value={f.endDay}
            min={f.startDay}
            onChange={(e) => set({ endDay: e.target.value })}
          />
          {!f.allDay && (
            <TextField
              label="Hora do fim"
              type="time"
              value={f.endTime}
              onChange={(e) => set({ endTime: e.target.value })}
            />
          )}
        </div>

        <div className="cm-form__wide cm-field">
          <span className="cm-label">Tag</span>
          <div className="ag-tagpick" role="radiogroup" aria-label="Tag">
            <button
              type="button"
              role="radio"
              aria-checked={!f.tagId}
              className="ag-tagpick__item"
              onClick={() => set({ tagId: '' })}
            >
              Sem tag
            </button>
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={f.tagId === t.id}
                className="ag-tagpick__item"
                style={{ ['--tag' as string]: t.color }}
                onClick={() => set({ tagId: t.id })}
              >
                <span className="ag-dot" aria-hidden />
                {t.name}
                {f.tagId === t.id && <Check size={14} aria-hidden />}
              </button>
            ))}
            {newTag === null ? (
              <button
                type="button"
                className="ag-tagpick__item ag-tagpick__add"
                onClick={() => setNewTag('')}
              >
                <Plus size={14} aria-hidden /> Nova tag
              </button>
            ) : (
              <span className="ag-tagpick__new">
                <input
                  className="cm-input"
                  autoFocus
                  aria-label="Nome da nova tag"
                  placeholder="Nome da tag"
                  maxLength={40}
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void createTag();
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setNewTag(null);
                    }
                  }}
                />
                <Button size="sm" variant="secondary" onClick={createTag}>
                  Criar
                </Button>
              </span>
            )}
          </div>
        </div>

        <div className="cm-field cm-form__wide">
          <label className="cm-label" htmlFor="ag-notes">
            Anotações
          </label>
          <textarea
            id="ag-notes"
            className="cm-input"
            rows={3}
            maxLength={2000}
            placeholder="O que precisa para esse dia: lista, contatos, detalhes…"
            value={f.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>

        <h3 className="cm-form__section">
          <BellRing size={14} aria-hidden /> Lembrete pelo WhatsApp
        </h3>
        {waOn ? (
          <>
            <SelectField
              label="Quando avisar"
              value={f.remind}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'custom' && !f.remindAt) {
                  const { start } = times();
                  const r = addMinutes(start, f.allDay ? 480 : -60);
                  set({ remind: v, remindAt: `${dayKey(r)}T${hhmm(r)}` });
                } else set({ remind: v });
              }}
            >
              <option value="">Sem lembrete</option>
              {presets.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Escolher dia e hora…</option>
            </SelectField>
            {f.remind === 'custom' && (
              <TextField
                label="Avisar em"
                type="datetime-local"
                value={f.remindAt}
                onChange={(e) => set({ remindAt: e.target.value })}
              />
            )}
            <p className="cm-hint cm-form__wide ag-dlg__hint">
              O assistente manda a mensagem para {settings?.phone ? `o seu WhatsApp` : 'você'} no
              horário escolhido.
              {!settings?.whatsappReady && ' O WhatsApp do restaurante precisa estar conectado.'}
            </p>
            {status && (
              <div className="cm-form__wide">
                <Alert tone={status.tone}>{status.text}</Alert>
              </div>
            )}
          </>
        ) : (
          <div className="cm-form__wide ag-dlg__wa">
            <span className="cm-hint">
              Quer que o assistente te lembre pelo WhatsApp na hora que você escolher? Permita uma
              vez e escolha o lembrete em cada compromisso.
            </span>
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>
              Permitir lembretes
            </Button>
          </div>
        )}

        {event && (
          <div className="cm-form__wide">
            <CheckField
              label="Concluído"
              description="Marque quando já resolveu. Lembrete de compromisso concluído não sai."
              checked={f.done}
              onChange={(done) => set({ done })}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
