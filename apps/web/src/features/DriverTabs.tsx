import { COURIER_LEVEL_LABELS, COURIER_SCORE_MIN_RIDES, toCents } from '@comandou/shared';
import {
  Banknote,
  ChevronRight,
  Clock,
  LogOut,
  MapPin,
  Moon,
  Navigation,
  Package,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, Skeleton, switchTheme, useTheme, useToast } from '../design-system';
import { useDriverShell } from '../driver/DriverShell';
import { brl } from '../lib/money';
import type { AvailableRun, CourierProfile, Delivery } from '../lib/types';
import { CourierEarnings, type CourierEarningsData } from './CourierEarnings';
import { dateTime, minutesSince, PAYMENT_METHOD_LABELS, time } from './format';
import { kmLabel } from './live-geo';
import { SlideTabs } from './SlideTabs';

/**
 * Abas do app do entregador além das corridas na rua: Início (resumo e atalhos), Disponíveis
 * (pedidos prontos que ele pode pegar sozinho), Histórico (corridas encerradas e ganhos) e Perfil
 * (score e números). Valem para o app com login e para o link do entregador.
 */

export type DriverTab = 'home' | 'available' | 'runs' | 'history' | 'profile';

export interface HistoryPage {
  items: Delivery[];
  /** Data para pedir a página seguinte; null no fim. */
  next: string | null;
}

/** O que o app pede ao servidor além das corridas (login e link têm endereços diferentes). */
export interface DriverData {
  available(): Promise<AvailableRun[]>;
  claim(orderId: string): Promise<unknown>;
  history(before?: string): Promise<HistoryPage>;
  profile(): Promise<CourierProfile>;
}

const scoreText = (n: number) => n.toFixed(1).replace('.', ',');

// --------------------------------------------------------------------------- Início
const WEEKDAY = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const weekday = (day: string) => WEEKDAY[new Date(`${day}T12:00:00`).getDay()];
const cents = (v: string | null | undefined) => (v ? toCents(v) : 0);
const money = (c: number) => brl((c / 100).toFixed(2));

/**
 * Início em forma de painel: o ganho do dia com os últimos 7 dias, a entrega em andamento (ou os
 * pedidos prontos para pegar), os números do dia e as últimas corridas de hoje.
 */
export function DriverHomeTab({
  deliveries,
  available,
  profile,
  earnings,
  onGo,
}: {
  deliveries: Delivery[];
  available: AvailableRun[] | null;
  profile: CourierProfile | null;
  /** Central de ganhos (só no app com login); sem ela, o dia sai das corridas de hoje. */
  earnings?: CourierEarningsData | null;
  onGo(tab: DriverTab): void;
}) {
  const out = deliveries.filter((d) => d.status === 'out');
  const closed = deliveries.filter((d) => d.status !== 'out');
  const doneToday = closed.filter((d) => d.status === 'delivered');
  const earnedToday = earnings
    ? cents(earnings.today.total)
    : doneToday.reduce((n, d) => n + cents(d.courierPay), 0);
  const kmToday = earnings
    ? earnings.today.distanceM
    : closed.reduce((n, d) => n + (d.distanceM ?? 0), 0);
  const free = available ?? [];
  const days = earnings?.last7 ?? [];
  const top = Math.max(1, ...days.map((d) => cents(d.total)));
  const focus = out[0];

  return (
    <>
      <section className="dhome__hero" aria-label="Seu dia">
        <div className="dhome__hero-top">
          <span className="dhome__eyebrow">Ganhos de hoje</span>
          <span className="dhome__state" data-on={focus ? 'out' : 'free'}>
            <i aria-hidden />
            {focus ? (out.length > 1 ? `${out.length} na rua` : 'Na rua') : 'Livre'}
          </span>
        </div>
        <strong className="dhome__money">{money(earnedToday)}</strong>
        <span className="dhome__meta">
          {doneToday.length} {doneToday.length === 1 ? 'entrega' : 'entregas'}
          {kmToday > 0 && ` · ${kmLabel(kmToday)} rodados`}
        </span>
        {days.length > 0 && (
          <div className="dhome__chart" role="img" aria-label="Ganhos dos últimos 7 dias">
            {days.map((d, i) => {
              const v = cents(d.total);
              return (
                <div
                  key={d.day}
                  className="dhome__col"
                  data-today={i === days.length - 1 || undefined}
                >
                  <span className="dhome__bar" title={`${money(v)} · ${d.delivered} entregas`}>
                    <i style={{ height: `${v > 0 ? Math.max(6, (v / top) * 100) : 0}%` }} />
                  </span>
                  <small>{weekday(d.day)}</small>
                </div>
              );
            })}
          </div>
        )}
        {earnings && (
          <dl className="dhome__split">
            <div>
              <dt>Semana</dt>
              <dd>{brl(earnings.week.total)}</dd>
            </div>
            <div>
              <dt>Mês</dt>
              <dd>{brl(earnings.month.total)}</dd>
            </div>
            <div>
              <dt>A receber</dt>
              <dd>{brl(earnings.pending.net)}</dd>
            </div>
          </dl>
        )}
      </section>

      {focus ? (
        <button type="button" className="dhome__focus" onClick={() => onGo('runs')}>
          <span className="dhome__focus-head">
            <span className="dhome__live" aria-hidden />
            {out.length === 1 ? 'Entrega em andamento' : `${out.length} entregas em andamento`}
            <span className="dhome__since">
              <Clock size={14} aria-hidden /> {minutesSince(focus.dispatchedAt)} min
            </span>
          </span>
          <strong>
            #{focus.orderNumber} · {focus.customerName ?? 'Cliente'}
          </strong>
          <span className="dhome__addr">
            <MapPin size={16} aria-hidden /> {focus.deliveryAddress ?? 'Endereço não informado'}
          </span>
          <span className="dhome__open">
            Abrir a entrega <ChevronRight size={16} aria-hidden />
          </span>
        </button>
      ) : (
        <section className="dhome__ready" aria-label="Pedidos prontos">
          <header>
            <h2 className="driver__title">Prontos para pegar</h2>
            {free.length > 0 && <span className="dhome__count">{free.length}</span>}
          </header>
          {available === null ? (
            <Skeleton variant="list" />
          ) : free.length === 0 ? (
            <p className="dhome__none">
              Nenhum pedido pronto agora. Quando chegar um, o celular toca o aviso.
            </p>
          ) : (
            <ul className="dhome__list">
              {free.slice(0, 3).map((r) => (
                <li key={r.orderId}>
                  <button type="button" onClick={() => onGo('available')}>
                    <span className="dhome__list-main">
                      <strong>#{r.orderNumber}</strong>
                      <span>{r.deliveryAddress ?? 'Endereço não informado'}</span>
                    </span>
                    <span className="dhome__list-end">
                      {toCents(r.payEstimate) > 0 && <strong>{brl(r.payEstimate)}</strong>}
                      {r.distanceM != null && <small>{kmLabel(r.distanceM)}</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            size="lg"
            block
            variant={free.length > 0 ? 'primary' : 'secondary'}
            icon={<Package size={18} />}
            onClick={() => onGo('available')}
          >
            {free.length > 0 ? `Ver os ${free.length} disponíveis` : 'Ver disponíveis'}
          </Button>
        </section>
      )}

      <div className="dkpis" role="list" aria-label="Seus números">
        <Kpi label="Entregues hoje" value={String(doneToday.length)} />
        <Kpi
          label="Score"
          value={profile?.score != null ? scoreText(profile.score) : 'Novo'}
          onClick={() => onGo('profile')}
        />
        <Kpi
          label="Tempo médio"
          value={profile?.avgMinutes != null ? `${profile.avgMinutes} min` : '—'}
        />
        <Kpi label="No prazo" value={profile?.onTimePct != null ? `${profile.onTimePct}%` : '—'} />
      </div>

      {closed.length > 0 && (
        <section className="dhome__last">
          <header>
            <h2 className="driver__title">Hoje</h2>
            <button type="button" className="dhome__link" onClick={() => onGo('history')}>
              Ver histórico <ChevronRight size={16} aria-hidden />
            </button>
          </header>
          <ul className="dlist">
            {closed.slice(0, 3).map((d) => (
              <RideRow key={d.id} d={d} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Kpi({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const body = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );
  return onClick ? (
    <button type="button" role="listitem" className="dkpi" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div role="listitem" className="dkpi">
      {body}
    </div>
  );
}

/** Uma corrida encerrada numa linha: bolinha da situação, pedido, cliente, hora e o ganho. */
export function RideRow({ d, withDate }: { d: Delivery; withDate?: boolean }) {
  const ok = d.status === 'delivered';
  const when = d.finishedAt ?? d.dispatchedAt;
  return (
    <li className="dride" data-ok={ok || undefined}>
      <i className="dride__dot" aria-hidden />
      <div className="dride__main">
        <strong>
          #{d.orderNumber} <span>{d.customerName ?? 'Cliente'}</span>
        </strong>
        <small>
          {withDate ? dateTime(when) : time(when)}
          {d.distanceM ? ` · ${kmLabel(d.distanceM)}` : ''}
          {!ok && ' · não entregue'}
        </small>
      </div>
      <strong className="dride__pay">
        {d.courierPay && toCents(d.courierPay) > 0 ? brl(d.courierPay) : '—'}
      </strong>
    </li>
  );
}

// --------------------------------------------------------------------------- Disponíveis
export function AvailableTab({
  list,
  error,
  claim,
  onClaimed,
}: {
  /** null: ainda carregando. */
  list: AvailableRun[] | null;
  /** A última consulta falhou: mostra o motivo no lugar da lista vazia. */
  error?: string | null;
  claim(orderId: string): Promise<unknown>;
  /** Pegou (ou perdeu) a corrida: recarrega as listas; `ok` leva para a aba Entregas. */
  onClaimed(ok: boolean): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!list) return <Skeleton />;
  if (!list.length && error)
    return <EmptyState mascot title="Não deu para ver os pedidos prontos" description={error} />;
  if (!list.length)
    return (
      <EmptyState
        mascot
        title="Nenhum pedido para pegar agora"
        description="Quando um pedido de entrega ficar pronto e ainda não tiver entregador, ele aparece aqui."
      />
    );

  async function take(r: AvailableRun) {
    setBusy(r.orderId);
    try {
      await claim(r.orderId);
      toast(`Pedido #${r.orderNumber} é seu. Boa entrega!`, 'success');
      onClaimed(true);
    } catch (e) {
      toast((e as Error).message, 'danger');
      onClaimed(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="driver__runs">
      {list.map((r) => {
        const due = toCents(r.balance) > 0;
        return (
          <article key={r.orderId} className="run">
            <header className="run__top">
              <strong className="run__num">#{r.orderNumber}</strong>
              <span className="cm-hint">
                {r.readyAt ? `pronto há ${minutesSince(r.readyAt)} min` : 'pronto'}
                {` · ${r.items} ${r.items === 1 ? 'item' : 'itens'}`}
              </span>
            </header>
            <div className="run__addr">
              <MapPin size={18} />
              <span>{r.deliveryAddress ?? 'Endereço não informado'}</span>
            </div>
            <div className="davail__facts">
              {r.distanceM != null && (
                <span>
                  <Navigation size={15} aria-hidden /> {kmLabel(r.distanceM)} da loja
                </span>
              )}
              <span>
                <Banknote size={15} aria-hidden />{' '}
                {due
                  ? `Cobrar ${brl(r.balance)}${
                      r.paymentHint
                        ? ` · ${PAYMENT_METHOD_LABELS[r.paymentHint as keyof typeof PAYMENT_METHOD_LABELS] ?? r.paymentHint}`
                        : ''
                    }`
                  : 'Já está pago'}
              </span>
            </div>
            {toCents(r.payEstimate) > 0 && (
              <div className="run__earn">
                <span>Você ganha nesta entrega</span>
                <strong>{brl(r.payEstimate)}</strong>
              </div>
            )}
            <Button
              size="lg"
              block
              loading={busy === r.orderId}
              disabled={busy !== null}
              onClick={() => void take(r)}
            >
              Pegar corrida
            </Button>
          </article>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------------- Histórico
export function HistoryTab({
  load,
  earnings,
}: {
  load(before?: string): Promise<HistoryPage>;
  earnings?: () => Promise<CourierEarningsData>;
}) {
  const [view, setView] = useState<'rides' | 'earnings'>('rides');
  return (
    <>
      {earnings && (
        <SlideTabs<'rides' | 'earnings'>
          label="Histórico"
          value={view}
          onChange={setView}
          tabs={[
            { value: 'rides', label: 'Entregas' },
            { value: 'earnings', label: 'Meus ganhos' },
          ]}
        />
      )}
      {view === 'earnings' && earnings ? (
        <CourierEarnings load={earnings} />
      ) : (
        <Rides load={load} />
      )}
    </>
  );
}

function Rides({ load }: { load(before?: string): Promise<HistoryPage> }) {
  const [items, setItems] = useState<Delivery[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const more = useCallback(
    async (before?: string) => {
      setBusy(true);
      try {
        const page = await load(before);
        setItems((cur) => (before && cur ? [...cur, ...page.items] : page.items));
        setNext(page.next);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );
  useEffect(() => void more(), [more]);

  if (error && !items) return <p className="form-error">{error}</p>;
  if (!items) return <Skeleton />;
  if (!items.length)
    return (
      <EmptyState
        mascot
        title="Nenhuma entrega encerrada ainda"
        description="As corridas que você concluir ficam guardadas aqui, com o valor de cada uma."
      />
    );
  return (
    <>
      {groupByDay(items).map((g) => (
        <section key={g.key} className="dday">
          <header className="dday__head">
            <strong>{g.label}</strong>
            <span>
              {g.items.length} {g.items.length === 1 ? 'corrida' : 'corridas'} ·{' '}
              <b>{money(g.total)}</b>
            </span>
          </header>
          <ul className="dlist">
            {g.items.map((d) => (
              <RideRow key={d.id} d={d} />
            ))}
          </ul>
        </section>
      ))}
      {error && <p className="form-error">{error}</p>}
      {next && (
        <Button variant="secondary" block loading={busy} onClick={() => void more(next)}>
          Carregar mais
        </Button>
      )}
    </>
  );
}

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Corridas por dia (Hoje, Ontem, "sex., 14 de nov."), com o total ganho no dia. */
function groupByDay(items: Delivery[]) {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const groups: { key: string; label: string; total: number; items: Delivery[] }[] = [];
  for (const d of items) {
    const when = d.finishedAt ?? d.dispatchedAt;
    const key = dayKey(when);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const label =
        key === today
          ? 'Hoje'
          : key === yesterday
            ? 'Ontem'
            : new Date(when).toLocaleDateString('pt-BR', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              });
      g = { key, label: label.charAt(0).toUpperCase() + label.slice(1), total: 0, items: [] };
      groups.push(g);
    }
    g.items.push(d);
    g.total += cents(d.courierPay);
  }
  return groups;
}

// --------------------------------------------------------------------------- Perfil
const LEVEL_TONE: Record<CourierProfile['level'], string> = {
  novo: 'neutral',
  excelente: 'success',
  'muito-bom': 'success',
  bom: 'info',
  atencao: 'warning',
};

export function ProfileTab({ profile }: { profile: CourierProfile | null }) {
  const shell = useDriverShell();
  if (!profile) return <Skeleton variant="form" />;
  const p = profile;
  const since = new Date(p.since).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const left = Math.max(0, COURIER_SCORE_MIN_RIDES - (p.recent.delivered + p.recent.failed));
  return (
    <>
      <section className="dprof">
        <span className="dprof__avatar" aria-hidden>
          {p.name.trim().charAt(0).toUpperCase()}
        </span>
        <strong>{p.name}</strong>
        <span className="cm-hint">
          Entregador desde {since}
          {p.phone && ` · ${p.phone}`}
        </span>
      </section>

      <section className="dscore" aria-label="Score">
        <div className="dscore__top">
          <ScoreRing score={p.score} />
          <div className="dscore__text">
            {p.score != null ? (
              <>
                <span className="dscore__level" data-tone={LEVEL_TONE[p.level]}>
                  <i aria-hidden /> {COURIER_LEVEL_LABELS[p.level]}
                </span>
                <span className="cm-hint">
                  Nota dos últimos {p.recent.days} dias: concluir pesa mais, chegar no prazo
                  completa.
                </span>
              </>
            ) : (
              <>
                <strong>Score novo</strong>
                <span className="cm-hint">
                  {left === 1 ? 'Falta 1 entrega' : `Faltam ${left} entregas`} para o score
                  aparecer.
                </span>
              </>
            )}
          </div>
        </div>
        {p.completionPct != null && p.onTimePct != null && (
          <div className="dscore__bars">
            <Bar label="Entregas concluídas" pct={p.completionPct} />
            <Bar label="Entregas no prazo" pct={p.onTimePct} />
          </div>
        )}
      </section>

      <div className="dkpis" role="list" aria-label="Seus números">
        <Kpi label="Entregas concluídas" value={p.delivered.toLocaleString('pt-BR')} />
        <Kpi label="Entregues hoje" value={String(p.today)} />
        <Kpi label="Tempo médio" value={p.avgMinutes != null ? `${p.avgMinutes} min` : '—'} />
        <Kpi label="Distância rodada" value={`${p.km.toLocaleString('pt-BR')} km`} />
      </div>
      {p.failed > 0 && (
        <p className="cm-hint dprof__note">
          {p.failed === 1 ? '1 entrega não concluída' : `${p.failed} entregas não concluídas`} desde
          o começo.
        </p>
      )}

      <h2 className="driver__title">Este aparelho</h2>
      <div className="dsettings">
        <ThemeRow />
        {shell.onLogout && (
          <button type="button" className="dsettings__row dsettings__out" onClick={shell.onLogout}>
            <LogOut size={18} aria-hidden />
            <span>Sair da conta</span>
          </button>
        )}
      </div>
    </>
  );
}

/** Anel do score (0 a 5) com a nota no meio. */
function ScoreRing({ score }: { score: number | null }) {
  const r = 30;
  const len = 2 * Math.PI * r;
  const pct = score != null ? Math.min(1, Math.max(0, score / 5)) : 0;
  return (
    <span className="dring">
      <svg viewBox="0 0 72 72" width={72} height={72} aria-hidden>
        <circle className="dring__track" cx="36" cy="36" r={r} />
        <circle
          className="dring__fill"
          cx="36"
          cy="36"
          r={r}
          strokeDasharray={len}
          strokeDashoffset={len * (1 - pct)}
        />
      </svg>
      <span className="dring__value">
        <strong>{score != null ? scoreText(score) : '—'}</strong>
        <small>de 5</small>
      </span>
    </span>
  );
}

function ThemeRow() {
  const [theme] = useTheme();
  const dark = theme === 'dark';
  return (
    <label className="dsettings__row">
      <Moon size={18} aria-hidden />
      <span>Tema escuro</span>
      <span className="switch">
        <input
          type="checkbox"
          checked={dark}
          onChange={(e) => {
            const el = e.currentTarget;
            const box = el.getBoundingClientRect();
            switchTheme(dark ? 'light' : 'dark', { x: box.x + box.width / 2, y: box.y });
          }}
        />
        <span className="switch__track" />
      </span>
    </label>
  );
}

function Bar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="dbar">
      <span>
        {label} <strong>{pct}%</strong>
      </span>
      <div className="dbar__track" role="presentation">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
