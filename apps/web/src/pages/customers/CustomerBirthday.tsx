import { addLocalDays, BIRTHDAY_MONTHS, birthdayLabel } from '@comandou/shared';
import { Cake, Gift } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, TextField } from '../../design-system';
import { dateTime } from '../../features/format';
import { SelectField } from '../../features/forms';
import { api } from '../../lib/api';
import {
  birthdayForm,
  daysToBirthday,
  deviceToday,
  inDaysLabel,
  readBirthday,
  sameBirthday,
} from '../../lib/birthday';
import type { BirthdayGreeting, CustomerDetail } from '../../lib/types';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const short = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** O parabéns deste ano, em uma linha. */
function greetingLine(g: BirthdayGreeting) {
  const gift =
    g.giftKind === 'points' && g.giftPoints
      ? ` com +${g.giftPoints} de presente`
      : g.giftKind === 'text' && g.giftText
        ? ` com ${g.giftText}${g.giftUntil ? ` (vale até ${short(g.giftUntil)})` : ''}`
        : '';
  if (g.status === 'sent')
    return `Parabéns de ${g.year} enviado${g.sentAt ? ` em ${dateTime(g.sentAt)}` : ''}${gift}`;
  if (g.status === 'failed')
    return `Parabéns de ${g.year} não saiu${g.lastError ? `: ${g.lastError}` : ''}`;
  return `Parabéns de ${g.year} na fila${gift}`;
}

/**
 * Ficha do cliente › Aniversário: dia e mês (ano opcional) e se ele recebe o parabéns pelo
 * WhatsApp. O resultado aparece aqui mesmo (a ficha continua aberta, sem aviso flutuante).
 */
export function CustomerBirthday({
  c,
  canManage,
  onSaved,
}: {
  c: CustomerDetail;
  canManage: boolean;
  onSaved(c: CustomerDetail): void;
}) {
  const [f, setF] = useState(() => birthdayForm(c));
  const [optOut, setOptOut] = useState(!!c.birthdayOptOut);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setF(birthdayForm(c));
    setOptOut(!!c.birthdayOptOut);
  }, [c.id, c.birthDay, c.birthMonth, c.birthYear, c.birthdayOptOut]);
  useEffect(() => setNote(null), [c.id]);

  const { value, error } = readBirthday(f);
  const dirty = !sameBirthday(value, c) || optOut !== !!c.birthdayOptOut;
  const today = deviceToday();
  const days = daysToBirthday(c, today);
  const age = days !== null && c.birthYear ? addLocalDays(today, days).year - c.birthYear : null;
  const greeting = c.greetings?.find((g) => g.year === today.year) ?? null;
  const edit = (p: Partial<typeof f>) => {
    setF({ ...f, ...p });
    setNote(null);
  };

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const next = await api<CustomerDetail>(`/customers/${c.id}`, {
        method: 'PATCH',
        json: { birthday: value, birthdayOptOut: optOut },
      });
      onSaved(next);
      setNote({ ok: true, text: 'Aniversário salvo' });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cl-block cl-bday">
      <header className="cl-block__head">
        <h3>Aniversário</h3>
      </header>
      {days !== null && c.birthDay && c.birthMonth && (
        <p className="cl-bday__line">
          <Cake size={16} aria-hidden />
          <span>
            {days === 0 ? (
              <strong>Faz aniversário hoje{age ? ` (${age} anos)` : ''}</strong>
            ) : (
              <>
                {birthdayLabel({ day: c.birthDay, month: c.birthMonth, year: c.birthYear }, true)}
                {' · '}
                {age ? `faz ${age} anos ${inDaysLabel(days)}` : inDaysLabel(days)}
              </>
            )}
          </span>
        </p>
      )}
      {greeting && (
        <p className="cl-bday__line">
          <Gift size={16} aria-hidden />
          <span>{greetingLine(greeting)}</span>
        </p>
      )}
      {canManage ? (
        <>
          <div className="cl-bday__fields">
            <SelectField label="Dia" value={f.day} onChange={(e) => edit({ day: e.target.value })}>
              <option value="">—</option>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Mês"
              value={f.month}
              onChange={(e) => edit({ month: e.target.value })}
            >
              <option value="">—</option>
              {BIRTHDAY_MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Ano"
              placeholder="Opcional"
              inputMode="numeric"
              maxLength={4}
              value={f.year}
              onChange={(e) => edit({ year: e.target.value.replace(/\D/g, '') })}
            />
          </div>
          {error && <p className="cl-bday__error">{error}</p>}
          <label className="os-toggle">
            <span>
              <strong>Mandar parabéns pelo WhatsApp</strong>
              <small>O cliente também escolhe isso na conta do cardápio.</small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={!optOut}
                onChange={(e) => {
                  setOptOut(!e.target.checked);
                  setNote(null);
                }}
              />
              <span className="switch__track" aria-hidden />
            </span>
          </label>
          <div className="cl-bday__foot">
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              disabled={!dirty || !!error}
              onClick={() => void save()}
            >
              Salvar aniversário
            </Button>
            {note && (
              <span className="cl-bday__note" role="status" data-tone={note.ok ? undefined : 'bad'}>
                {note.text}
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="cm-hint">
          {!c.birthDay
            ? 'Sem data de aniversário.'
            : c.birthdayOptOut
              ? 'Pediu para não receber o parabéns.'
              : 'Recebe o parabéns pelo WhatsApp.'}
        </p>
      )}
    </section>
  );
}
