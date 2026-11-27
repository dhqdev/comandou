import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pencil,
  UserRound,
  Users,
} from 'lucide-react';
import { CSSProperties, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { StoreMark, useToast } from '../../design-system';
import { api, ApiError } from '../../lib/api';
import { ReserveArt } from './art';
import { useStore } from './context';
import { maskPhone, newOrderToken } from './store';
import { Field, ScreenHeader, Stepper } from './ui';
import './reservations.css';

export interface ReservationConfig {
  enabled: boolean;
  maxParty?: number;
  maxDaysAhead?: number;
  weekdays?: number[];
  opensAt?: string;
  closesAt?: string;
  note?: string | null;
  autoConfirm?: boolean;
  /** Hoje no fuso do restaurante (AAAA-MM-DD). */
  today?: string;
  timeZone?: string;
}
interface Slot {
  time: string;
  startsAt: string;
  remaining: number | null;
  available: boolean;
}
interface Availability {
  date: string;
  slots: Slot[];
  closedReason: string | null;
}
export interface PublicReservation {
  /** Só nas reservas da conta (o link usa o token). */
  id?: string;
  code: string;
  name: string;
  partySize: number;
  startsAt: string;
  occasion: string | null;
  notes: string | null;
  status: 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
  tableLabel: string | null;
  cancelReason: string | null;
  note?: string | null;
  canCancel: boolean;
  timeZone: string;
}

/** Reserva na conta do cliente (feita no cardápio ou lançada pela equipe no cadastro dele). */
export type AccountReservation = PublicReservation & { id: string };

/** Ainda vai acontecer (ou começou há pouco): o que a tela trata como "próxima". */
const upcoming = (r: Pick<PublicReservation, 'startsAt' | 'status'>) =>
  Date.parse(r.startsAt) > Date.now() - 2 * 3_600_000 &&
  r.status !== 'cancelled' &&
  r.status !== 'no_show' &&
  r.status !== 'completed';

/** Reservas da conta aberta neste aparelho (null enquanto carrega ou sem conta). */
export function useAccountReservations(on: boolean) {
  const [list, setList] = useState<AccountReservation[] | null>(null);
  useEffect(() => {
    setList(null);
    if (!on) return;
    let alive = true;
    api<AccountReservation[]>('/store/account/reservations')
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [on]);
  return list;
}

/** Próxima reserva da conta (a mais cedo que ainda vai acontecer). */
export const nextAccountReservation = (list: AccountReservation[] | null) =>
  (list ?? [])
    .filter(upcoming)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;

const STATUS: Record<PublicReservation['status'], { label: string; hint: string }> = {
  pending: {
    label: 'Aguardando confirmação',
    hint: 'O restaurante vai confirmar em instantes. Você pode acompanhar por aqui.',
  },
  confirmed: { label: 'Reserva confirmada', hint: 'Está tudo certo. Te esperamos!' },
  seated: { label: 'Você chegou', hint: 'Bom apetite!' },
  completed: { label: 'Concluída', hint: 'Obrigado pela visita. Volte sempre!' },
  cancelled: { label: 'Cancelada', hint: 'Esta reserva foi cancelada.' },
  no_show: { label: 'Não comparecimento', hint: 'A reserva expirou sem chegada.' },
};

const OCCASIONS = ['Aniversário', 'Encontro', 'Negócios', 'Família', 'Comemoração'];
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Reservas guardadas neste aparelho (o link de cada uma é o token). */
const KEY = 'cm-reservations';
interface StoredReservation {
  token: string;
  code: string;
  startsAt: string;
}
function storedReservations(): StoredReservation[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as StoredReservation[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function remember(r: StoredReservation) {
  try {
    const list = [r, ...storedReservations().filter((x) => x.token !== r.token)]
      // Só as que ainda não passaram (com folga de 1 dia).
      .filter((x) => Date.parse(x.startsAt) > Date.now() - 86_400_000)
      .slice(0, 10);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sem armazenamento: o link segue valendo nesta tela */
  }
}
/** Próxima reserva deste aparelho, para o atalho na tela inicial. */
export function upcomingReservation() {
  return storedReservations()
    .filter((r) => Date.parse(r.startsAt) > Date.now() - 2 * 3_600_000)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
}

let configCache: Promise<ReservationConfig> | null = null;
/** Configuração pública das reservas (uma busca por carregamento do cardápio). */
export function useReservationConfig() {
  const [cfg, setCfg] = useState<ReservationConfig | null>(null);
  useEffect(() => {
    configCache ??= api<ReservationConfig>('/store/reservations/config').catch(() => {
      configCache = null;
      return { enabled: false };
    });
    let alive = true;
    void configCache.then((c) => alive && setCfg(c));
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}

const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', opts);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const when = (startsAt: string, timeZone?: string) =>
  new Date(startsAt).toLocaleString('pt-BR', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Atalho "Reservar mesa" na tela inicial do cardápio (só se o restaurante aceita reservas). */
export function ReserveCard() {
  const cfg = useReservationConfig();
  const { account } = useStore();
  const mine = useAccountReservations(!!account?.customer);
  const own = nextAccountReservation(mine);
  const device = useMemo(upcomingReservation, []);
  // Reserva da conta (inclusive a que a equipe lançou no cadastro) vale antes da do aparelho.
  const next = own
    ? { to: `/pedir/reservas/${own.id}`, startsAt: own.startsAt }
    : device
      ? { to: `/pedir/reserva/${device.token}`, startsAt: device.startsAt }
      : null;
  if (!cfg?.enabled && !own) return null;
  const opts = { timeZone: cfg?.timeZone ?? own?.timeZone } as const;
  return (
    <Link className="sf-tile rsv-tile" to={next ? next.to : '/pedir/reservar'}>
      <ReserveArt live className="sf-tile__art" />
      <span className="sf-tile__text">
        <strong>{next ? 'Sua reserva' : 'Reservar mesa'}</strong>
        <small>
          {next
            ? `${new Date(next.startsAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', ...opts })} às ${new Date(next.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', ...opts })}`
            : 'Em poucos toques'}
        </small>
      </span>
    </Link>
  );
}

/**
 * Faixa dos dias: rola de lado com o dedo, com as setas (computador) e com a rodinha do mouse.
 * As setas somem na ponta; o dia escolhido sempre fica à vista.
 */
function DayStrip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setEdge({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    // Rodinha do mouse (vertical) vira rolagem de lado, sem rolar a página junto.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const max = el.scrollWidth - el.clientWidth;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    el.querySelector('[aria-selected="true"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
    return () => {
      el.removeEventListener('wheel', onWheel);
      ro?.disconnect();
    };
  }, []);
  const go = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.8), behavior: 'smooth' });
  };
  return (
    <div
      className="rsv-strip"
      data-start={edge.start || undefined}
      data-end={edge.end || undefined}
    >
      <button
        type="button"
        className="rsv-strip__arrow rsv-strip__arrow--prev"
        aria-label="Dias anteriores"
        tabIndex={-1}
        onClick={() => go(-1)}
        hidden={edge.start}
      >
        <ChevronLeft size={20} aria-hidden />
      </button>
      <div className="rsv-days" role="listbox" aria-label="Dia" ref={ref} onScroll={measure}>
        {children}
      </div>
      <button
        type="button"
        className="rsv-strip__arrow rsv-strip__arrow--next"
        aria-label="Próximos dias"
        tabIndex={-1}
        onClick={() => go(1)}
        hidden={edge.end}
      >
        <ChevronRight size={20} aria-hidden />
      </button>
    </div>
  );
}

/** Reserva de mesa: pessoas → dia → horário → seus dados. */
export function ReserveScreen() {
  const { menu, account, customer } = useStore();
  const cfg = useReservationConfig();
  const navigate = useNavigate();
  const toast = useToast();
  const [party, setParty] = useState(2);
  const [date, setDate] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({
    name: account?.customer?.name ?? customer.customerName,
    phone: account?.customer ? maskPhone(account.customer.phone) : customer.customerPhone,
    email: account?.customer?.email ?? '',
    occasion: '',
    notes: '',
  });
  // Cliente com conta: nome e celular já vêm dela (mostra um resumo; Alterar abre os campos).
  const [editData, setEditData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token] = useState(newOrderToken);

  // Dias abertos para reserva a partir de hoje (no relógio do restaurante).
  const days = useMemo(() => {
    if (!cfg?.enabled || !cfg.today) return [];
    const out: string[] = [];
    for (let i = 0; i <= Math.min(cfg.maxDaysAhead ?? 30, 60); i++) {
      const d = addDays(cfg.today, i);
      if (cfg.weekdays?.includes(new Date(`${d}T12:00:00Z`).getUTCDay())) out.push(d);
    }
    return out;
  }, [cfg]);

  useEffect(() => {
    if (!date && days[0]) setDate(days[0]);
  }, [days, date]);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setLoadingSlots(true);
    setSlot(null);
    api<Availability>(`/store/reservations/availability?date=${date}`)
      .then((a) => alive && setAvail(a))
      .catch(
        () => alive && setAvail({ date, slots: [], closedReason: 'Não foi possível carregar' }),
      )
      .finally(() => alive && setLoadingSlots(false));
    return () => {
      alive = false;
    };
  }, [date]);

  const fits = (s: Slot) => s.available && (s.remaining === null || s.remaining >= party);
  useEffect(() => {
    if (slot && !fits(slot)) setSlot(null);
  }, [party]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<PublicReservation>('/store/reservations', {
        method: 'POST',
        json: {
          token,
          name: form.name.trim(),
          phone: form.phone,
          email: form.email.trim() || null,
          partySize: party,
          startsAt: slot.startsAt,
          occasion: form.occasion || null,
          notes: form.notes.trim() || null,
        },
      });
      remember({ token, code: r.code, startsAt: r.startsAt });
      toast(r.status === 'confirmed' ? 'Reserva confirmada!' : 'Reserva enviada!', 'success');
      navigate(`/pedir/reserva/${token}`, { replace: true });
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.status === 0 ? 'Sem conexão. Tente de novo.' : e2.message);
      // Horário pode ter lotado: recarrega a grade.
      if (e2.status === 409 && date) {
        api<Availability>(`/store/reservations/availability?date=${date}`)
          .then(setAvail)
          .catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return <div className="sf-wrap sf-page" aria-busy="true" />;
  if (!cfg.enabled)
    return (
      <div className="sf-wrap sf-page">
        <ScreenHeader title="Reservar mesa" />
        <div className="empty-state">
          <StoreMark size={64} src={menu.restaurant.logoUrl} mood="sleep" />
          <strong>Reservas indisponíveis</strong>
          <p>{menu.restaurant.name} não está aceitando reservas pelo cardápio no momento.</p>
          <Link className="cta cta--inline" to="/pedir">
            Voltar ao cardápio
          </Link>
        </div>
      </div>
    );

  // Reserva só com cadastro: quem não entrou vê o convite (e volta para cá depois de entrar).
  if (!account) return <div className="sf-wrap sf-page" aria-busy="true" />;
  if (!account.customer)
    return (
      <div className="sf-wrap sf-page">
        <ScreenHeader title="Reservar mesa" />
        <div className="empty-state">
          <ReserveArt live className="empty-state__art" />
          <strong>Entre para reservar</strong>
          <p>Com a sua conta, a reserva sai com o seu nome e celular e você acompanha por aqui.</p>
          <div className="rsv-auth">
            <Link
              className="cta cta--inline"
              to="/pedir/conta"
              state={{ back: 'reserve', mode: 'login' }}
            >
              Já sou cliente
            </Link>
            <Link
              className="cta cta--inline cta--ghost"
              to="/pedir/conta"
              state={{ back: 'reserve', mode: 'signup' }}
            >
              Criar conta
            </Link>
          </div>
        </div>
      </div>
    );

  const step2 = !!slot;
  return (
    <div className="sf-wrap sf-page sf-page--bar rsv">
      <ScreenHeader title="Reservar mesa" />
      <div className="rsv-hero">
        <ReserveArt live className="rsv-hero__art" />
        <p className="rsv-lead">
          <strong>{menu.restaurant.name}</strong>
          Das {cfg.opensAt} às {cfg.closesAt}
        </p>
      </div>

      <section className="rsv-sec">
        <h2>
          <Users size={18} aria-hidden /> Quantas pessoas?
        </h2>
        <div className="rsv-party">
          <Stepper
            value={party}
            onChange={(n) => setParty(Math.min(cfg.maxParty ?? 10, Math.max(1, n)))}
          />
          <span>
            {party} {party === 1 ? 'pessoa' : 'pessoas'}
          </span>
        </div>
        {party >= (cfg.maxParty ?? 10) && (
          <small className="rsv-hint">
            Para grupos maiores que {cfg.maxParty}, fale direto com o restaurante.
          </small>
        )}
      </section>

      <section className="rsv-sec">
        <h2>
          <CalendarDays size={18} aria-hidden /> Qual dia?
        </h2>
        {days.length === 0 ? (
          <p className="rsv-hint">Nenhum dia aberto para reserva no momento.</p>
        ) : (
          <DayStrip>
            {days.map((d, i) => (
              <button
                key={d}
                type="button"
                role="option"
                aria-selected={d === date}
                className="rsv-day"
                style={{ '--i': Math.min(i, 10) } as CSSProperties}
                onClick={() => setDate(d)}
              >
                <span>
                  {i === 0 && d === cfg.today ? 'Hoje' : WD[new Date(`${d}T12:00:00Z`).getUTCDay()]}
                </span>
                <strong>{Number(d.slice(8))}</strong>
                <span>{dayLabel(d, { month: 'short' }).replace('.', '')}</span>
              </button>
            ))}
          </DayStrip>
        )}
      </section>

      <section className="rsv-sec">
        <h2>
          <Clock size={18} aria-hidden /> Qual horário?
        </h2>
        {loadingSlots && !avail ? (
          <div className="rsv-slots">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="sk rsv-slot--sk" />
            ))}
          </div>
        ) : avail?.closedReason ? (
          <p className="rsv-hint">{avail.closedReason}</p>
        ) : avail && avail.slots.length ? (
          <div className="rsv-slots" data-loading={loadingSlots || undefined}>
            {avail.slots.map((s) => {
              const ok = fits(s);
              return (
                <button
                  key={s.startsAt}
                  type="button"
                  className="rsv-slot"
                  aria-pressed={slot?.startsAt === s.startsAt}
                  disabled={!ok}
                  onClick={() => setSlot(s)}
                  title={
                    ok ? undefined : s.available ? `Cabem só mais ${s.remaining}` : 'Indisponível'
                  }
                >
                  {s.time}
                  {ok && s.remaining !== null && s.remaining <= 6 && (
                    <small>{s.remaining} lugares</small>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="rsv-hint">Sem horários neste dia.</p>
        )}
        {avail && avail.slots.length > 0 && !avail.slots.some(fits) && (
          <p className="rsv-hint">Todos os horários deste dia estão ocupados. Tente outro dia.</p>
        )}
      </section>

      {step2 && (
        <form className="rsv-sec rsv-form" onSubmit={submit} id="rsv-form">
          <h2>
            <UserRound size={18} aria-hidden /> Seus dados
          </h2>
          {!editData && form.name.trim() && form.phone ? (
            <div className="rsv-me">
              <span className="rsv-me__avatar" aria-hidden>
                {form.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="rsv-me__who">
                <strong>{form.name}</strong>
                <small>
                  {form.phone}
                  {form.email ? ` · ${form.email}` : ''}
                </small>
              </span>
              <button type="button" className="rsv-me__edit" onClick={() => setEditData(true)}>
                <Pencil size={15} aria-hidden /> Alterar
              </button>
            </div>
          ) : (
            <>
              <Field label="Seu nome">
                <input
                  required
                  maxLength={80}
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </Field>
              <Field label="Celular (WhatsApp)">
                <input
                  required
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(11) 98888-7777"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: maskPhone(e.target.value) }))}
                />
              </Field>
              <Field label="E-mail (opcional)">
                <input
                  type="email"
                  maxLength={254}
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </Field>
            </>
          )}
          <div className="f">
            <span>É uma ocasião especial?</span>
            <div className="rsv-chips">
              {OCCASIONS.map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={form.occasion === o}
                  onClick={() => setForm((f) => ({ ...f, occasion: f.occasion === o ? '' : o }))}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          <Field label="Algum pedido? (opcional)">
            <textarea
              rows={2}
              maxLength={300}
              placeholder="Cadeira de bebê, mesa perto da janela…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          {cfg.note && <p className="rsv-note">{cfg.note}</p>}
          {error && (
            <p className="rsv-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      <div className="checkout-bar rsv-bar">
        <div className="checkout-bar__inner">
          {slot && date ? (
            <button type="submit" form="rsv-form" className="cta" disabled={busy}>
              {busy
                ? 'Enviando…'
                : `Reservar ${dayLabel(date, { day: '2-digit', month: '2-digit' })} às ${slot.time} · ${party}p`}
            </button>
          ) : (
            <button type="button" className="cta" disabled>
              Escolha um horário
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Acompanhamento da reserva: pelo link (`/pedir/reserva/:token`) ou pela conta
 * (`/pedir/reservas/:id`, inclusive a que a equipe lançou no cadastro do cliente). Atualiza
 * sozinho enquanto aguarda a confirmação.
 */
export function ReservationStatusScreen() {
  const { token = '', id = '' } = useParams();
  const { menu } = useStore();
  const toast = useToast();
  const [r, setR] = useState<PublicReservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const base = id
    ? `/store/account/reservations/${encodeURIComponent(id)}`
    : `/store/reservations/${encodeURIComponent(token)}`;

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<PublicReservation>(base)
        .then((x) => {
          if (!alive) return;
          setR(x);
          setError(null);
          if (token) remember({ token, code: x.code, startsAt: x.startsAt });
        })
        .catch(
          (e: ApiError) =>
            alive &&
            setError(
              e.status === 404
                ? 'Reserva não encontrada.'
                : e.status === 401
                  ? 'Entre na sua conta para ver esta reserva.'
                  : e.message,
            ),
        );
    void load();
    // Enquanto o restaurante não confirma, confere de tempos em tempos.
    const t = window.setInterval(
      () => document.visibilityState === 'visible' && void load(),
      20_000,
    );
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [base, token]);

  async function cancel() {
    setBusy(true);
    try {
      setR(await api<PublicReservation>(`${base}/cancel`, { method: 'POST' }));
      setAsking(false);
      toast('Reserva cancelada', 'success');
    } catch (e) {
      toast((e as ApiError).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return (
      <div className="sf-wrap sf-page">
        <ScreenHeader title="Reserva" />
        <div className="empty-state">
          <StoreMark size={64} src={menu.restaurant.logoUrl} mood="sleep" />
          <strong>{error}</strong>
        </div>
      </div>
    );
  if (!r) return <div className="sf-wrap sf-page" aria-busy="true" />;
  const st = STATUS[r.status];
  return (
    <div className="sf-wrap sf-page rsv">
      <ScreenHeader title="Sua reserva" />
      <div className="rsv-ticket" data-status={r.status}>
        <div className="rsv-ticket__top">
          <StoreMark
            size={56}
            mood={r.status === 'cancelled' || r.status === 'no_show' ? 'sleep' : 'happy'}
          />
          <div>
            <span className="rsv-status">{st.label}</span>
            <p>{st.hint}</p>
          </div>
        </div>
        <dl className="rsv-ticket__info">
          <div>
            <dt>Restaurante</dt>
            <dd>{menu.restaurant.name}</dd>
          </div>
          <div>
            <dt>Quando</dt>
            <dd className="rsv-cap">{when(r.startsAt, r.timeZone)}</dd>
          </div>
          <div>
            <dt>Pessoas</dt>
            <dd>{r.partySize}</dd>
          </div>
          <div>
            <dt>Código</dt>
            <dd className="rsv-code">{r.code}</dd>
          </div>
          {r.tableLabel && (
            <div>
              <dt>Mesa</dt>
              <dd>{r.tableLabel}</dd>
            </div>
          )}
          {r.occasion && (
            <div>
              <dt>Ocasião</dt>
              <dd>{r.occasion}</dd>
            </div>
          )}
        </dl>
        {r.note && <p className="rsv-note">{r.note}</p>}
        {menu.restaurant.address && <p className="rsv-hint">{menu.restaurant.address}</p>}
      </div>
      {asking ? (
        // Confirmação dentro da própria tela (o confirm() do navegador some no app instalado).
        <div className="rsv-confirm" role="alertdialog" aria-label="Cancelar a reserva?">
          <strong>Cancelar esta reserva?</strong>
          <p>O restaurante recebe o aviso na hora e libera a mesa.</p>
          <div className="rsv-actions">
            <button type="button" className="cta cta--danger" disabled={busy} onClick={cancel}>
              {busy ? 'Cancelando…' : 'Sim, cancelar'}
            </button>
            <button
              type="button"
              className="cta cta--ghost"
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              Manter a reserva
            </button>
          </div>
        </div>
      ) : (
        <div className="rsv-actions">
          <Link className="cta" to="/pedir">
            Ver o cardápio
          </Link>
          {r.canCancel && (
            <button type="button" className="cta cta--ghost" onClick={() => setAsking(true)}>
              Cancelar reserva
            </button>
          )}
        </div>
      )}
      <p className="cm-hint sf-note">
        {id
          ? 'Esta reserva fica na sua conta: acompanhe por Conta › Reservas.'
          : 'Guarde este link: é por ele que você acompanha a reserva.'}
      </p>
    </div>
  );
}

/** Linha de uma reserva na lista (dia, hora, pessoas e situação). */
function ReservationRow({ r, to }: { r: PublicReservation; to: string }) {
  const st = STATUS[r.status];
  const d = new Date(r.startsAt);
  const opts = { timeZone: r.timeZone } as const;
  return (
    <li>
      <Link className="rsv-row" to={to} data-status={r.status}>
        <span className="rsv-row__day">
          <small>
            {d.toLocaleDateString('pt-BR', { weekday: 'short', ...opts }).replace('.', '')}
          </small>
          <strong>{d.toLocaleDateString('pt-BR', { day: '2-digit', ...opts })}</strong>
          <small>
            {d.toLocaleDateString('pt-BR', { month: 'short', ...opts }).replace('.', '')}
          </small>
        </span>
        <span className="rsv-row__text">
          <strong>
            {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', ...opts })} ·{' '}
            {r.partySize} {r.partySize === 1 ? 'pessoa' : 'pessoas'}
            {r.tableLabel ? ` · Mesa ${r.tableLabel}` : ''}
          </strong>
          <small className="rsv-row__status">{st.label}</small>
        </span>
        <ChevronRight size={18} aria-hidden />
      </Link>
    </li>
  );
}

/**
 * Conta › Reservas (/pedir/reservas): as reservas da conta (as do cardápio e as que a equipe
 * lançou no cadastro do cliente), próximas primeiro. Sem conta, as guardadas neste aparelho.
 */
export function MyReservationsScreen() {
  const { account } = useStore();
  const cfg = useReservationConfig();
  const me = account?.customer ?? null;
  const mine = useAccountReservations(!!me);
  const device = useMemo(
    () =>
      storedReservations()
        .slice()
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    [],
  );
  const next = (mine ?? []).filter(upcoming);
  const past = (mine ?? []).filter((r) => !upcoming(r));
  const reserve = cfg?.enabled ? (
    <Link className="cta cta--inline" to="/pedir/reservar">
      Reservar mesa
    </Link>
  ) : null;
  return (
    <div className="sf-wrap sf-page rsv">
      <ScreenHeader title="Reservas" />
      {me && mine === null ? (
        <div aria-busy="true" className="rsv-list-sk">
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="sk rsv-row--sk" />
          ))}
        </div>
      ) : me ? (
        next.length || past.length ? (
          <>
            {next.length > 0 && (
              <section className="rsv-sec">
                <h2>
                  <CalendarDays size={18} aria-hidden /> Próximas
                </h2>
                <ul className="rsv-list">
                  {next.map((r) => (
                    <ReservationRow key={r.id} r={r} to={`/pedir/reservas/${r.id}`} />
                  ))}
                </ul>
              </section>
            )}
            {past.length > 0 && (
              <section className="rsv-sec">
                <h2>
                  <Clock size={18} aria-hidden /> Últimas
                </h2>
                <ul className="rsv-list">
                  {past.map((r) => (
                    <ReservationRow key={r.id} r={r} to={`/pedir/reservas/${r.id}`} />
                  ))}
                </ul>
              </section>
            )}
            {reserve && <div className="rsv-actions">{reserve}</div>}
          </>
        ) : (
          <div className="empty-state">
            <ReserveArt live className="empty-state__art" />
            <strong>Nenhuma reserva por aqui</strong>
            <p>
              As reservas que você fizer (ou que o restaurante anotar no seu cadastro) aparecem
              aqui.
            </p>
            {reserve}
          </div>
        )
      ) : (
        <>
          {device.length > 0 && (
            <ul className="rsv-list">
              {device.map((d) => (
                <li key={d.token}>
                  <Link className="rsv-row" to={`/pedir/reserva/${d.token}`}>
                    <span className="rsv-row__text">
                      <strong>Reserva {d.code}</strong>
                      <small>
                        {new Date(d.startsAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: cfg?.timeZone,
                        })}
                      </small>
                    </span>
                    <ChevronRight size={18} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="empty-state">
            <ReserveArt live className="empty-state__art" />
            <strong>Entre para ver suas reservas</strong>
            <p>Com a conta aberta, todas as suas reservas ficam aqui, até as anotadas na loja.</p>
            <Link className="cta cta--inline" to="/pedir/conta">
              Entrar ou criar conta
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
