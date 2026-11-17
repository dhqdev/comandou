import { CalendarCheck, ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spinner, TextField } from '../design-system';
import './booking.css';

interface PageInfo {
  slug: string;
  title: string;
  description: string;
  location: string;
  durationMin: number;
  timeZone: string;
  daysAhead: number;
  weekdays: number[];
}

const CSRF = { 'X-Comandou-Request': '1' };
const pad = (n: number) => String(n).padStart(2, '0');
const monthLabel = (d: Date) => {
  const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/v1/public/booking/${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json', ...CSRF } : {}),
    },
  });
  const body = (await r.json().catch(() => ({}))) as { message?: string | string[] };
  if (!r.ok) {
    const m = Array.isArray(body.message) ? body.message[0] : body.message;
    throw new Error(m || 'Não deu certo. Tente de novo.');
  }
  return body as T;
}

/**
 * Página pública para marcar horário (https://<site>/agendar/<endereço>), criada em
 * Super Admin › E-mail › Agendamento. Escolhe o dia, o horário livre e deixa nome e e-mail.
 */
export function BookingPublicPage({ slug }: { slug: string }) {
  const [page, setPage] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', email: '', phone: '', notes: '', company: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);

  useEffect(() => {
    call<PageInfo>(slug)
      .then((p) => {
        setPage(p);
        document.title = p.title;
      })
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  useEffect(() => {
    if (!day) return;
    setSlots(null);
    setPick(null);
    call<{ slots: string[] }>(`${slug}/slots?date=${day}`)
      .then((r) => setSlots(r.slots))
      .catch((e: Error) => setError(e.message));
  }, [slug, day]);

  const today = isoDay(new Date());
  const lastDay = page ? isoDay(new Date(Date.now() + page.daysAhead * 86_400_000)) : today;
  const days = useMemo(() => {
    const first = new Date(month);
    first.setDate(1 - month.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(first);
      d.setDate(first.getDate() + i);
      return d;
    });
  }, [month]);
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: page?.timeZone,
    });

  const book = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ emailed?: boolean }>(slug, {
        method: 'POST',
        body: JSON.stringify({ start: pick, ...f }),
      });
      setEmailed(!!r.emailed);
      setDone(
        new Date(pick).toLocaleString('pt-BR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: page?.timeZone,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      // Horário tomado: atualiza a lista.
      if (day)
        call<{ slots: string[] }>(`${slug}/slots?date=${day}`).then(
          (r) => setSlots(r.slots),
          () => undefined,
        );
    } finally {
      setBusy(false);
    }
  };

  if (!page)
    return <main className="bk">{error ? <Alert tone="danger">{error}</Alert> : <Spinner />}</main>;

  return (
    <main className="bk">
      <section className="bk__card">
        <header className="bk__head">
          <h1>{page.title}</h1>
          <p className="bk__meta">
            <span>
              <Clock size={15} aria-hidden /> {page.durationMin} min
            </span>
            {page.location && (
              <span>
                <MapPin size={15} aria-hidden /> {page.location}
              </span>
            )}
          </p>
          {page.description && <p className="bk__desc">{page.description}</p>}
        </header>

        {done ? (
          <div className="bk__done" role="status">
            <CalendarCheck size={36} aria-hidden />
            <h2>Horário marcado</h2>
            <p>
              {done}.{' '}
              {emailed ? (
                <>
                  O convite foi para <strong>{f.email}</strong>.
                </>
              ) : (
                'Guarde esta data: a gente te espera.'
              )}
            </p>
          </div>
        ) : (
          <div className="bk__body">
            <div className="bk__cal">
              <div className="bk__month">
                <button
                  type="button"
                  aria-label="Mês anterior"
                  disabled={isoDay(month) <= today.slice(0, 8) + '01'}
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                >
                  <ChevronLeft size={18} />
                </button>
                <strong>{monthLabel(month)}</strong>
                <button
                  type="button"
                  aria-label="Próximo mês"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <div className="bk__grid">
                {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((w, i) => (
                  <span key={i} className="bk__dow" aria-hidden>
                    {w}
                  </span>
                ))}
                {days.map((d) => {
                  const k = isoDay(d);
                  const ok =
                    d.getMonth() === month.getMonth() &&
                    k >= today &&
                    k <= lastDay &&
                    page.weekdays.includes(d.getDay());
                  return (
                    <button
                      key={k}
                      type="button"
                      className="bk__day"
                      disabled={!ok}
                      aria-pressed={day === k}
                      aria-label={d.toLocaleDateString('pt-BR', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                      onClick={() => setDay(k)}
                    >
                      {d.getMonth() === month.getMonth() ? d.getDate() : ''}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="bk__slots">
              {!day ? (
                <p className="bk__hint">Escolha um dia</p>
              ) : !slots ? (
                <Spinner />
              ) : !slots.length ? (
                <p className="bk__hint">Sem horários livres neste dia</p>
              ) : (
                slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="bk__slot"
                    aria-pressed={pick === s}
                    onClick={() => setPick(s)}
                  >
                    {fmtTime(s)}
                  </button>
                ))
              )}
            </div>
            {pick && (
              <form className="bk__form" onSubmit={book}>
                <TextField
                  label="Seu nome"
                  autoComplete="name"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                  required
                />
                <TextField
                  label="E-mail"
                  type="email"
                  autoComplete="email"
                  value={f.email}
                  onChange={(e) => setF({ ...f, email: e.target.value })}
                  required
                />
                <TextField
                  label="WhatsApp (opcional)"
                  type="tel"
                  autoComplete="tel"
                  value={f.phone}
                  onChange={(e) => setF({ ...f, phone: e.target.value })}
                />
                <label className="cm-field">
                  <span className="cm-label">Quer contar algo antes? (opcional)</span>
                  <textarea
                    className="cm-input"
                    rows={3}
                    maxLength={1000}
                    value={f.notes}
                    onChange={(e) => setF({ ...f, notes: e.target.value })}
                  />
                </label>
                {/* Campo escondido: gente não vê, robô preenche. */}
                <input
                  className="bk__trap"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                  value={f.company}
                  onChange={(e) => setF({ ...f, company: e.target.value })}
                />
                {error && <Alert tone="danger">{error}</Alert>}
                <Button type="submit" size="lg" block loading={busy}>
                  Marcar {fmtTime(pick)}
                </Button>
              </form>
            )}
            {error && !pick && <Alert tone="danger">{error}</Alert>}
          </div>
        )}
      </section>
      <p className="bk__foot">Agendamento pelo Comandou</p>
    </main>
  );
}
