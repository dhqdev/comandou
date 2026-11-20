import { COURIER_LEVEL_LABELS, COURIER_SCORE_MIN_RIDES, toCents } from '@comandou/shared';
import { Banknote, Bike, Clock, MapPin, Navigation, Package, Route, Star } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, useToast, Skeleton } from '../design-system';
import { brl } from '../lib/money';
import type { AvailableRun, CourierProfile, Delivery } from '../lib/types';
import { CourierEarnings, type CourierEarningsData } from './CourierEarnings';
import { dateTime, minutesSince, PAYMENT_METHOD_LABELS } from './format';
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
export function DriverHomeTab({
  deliveries,
  available,
  profile,
  onGo,
}: {
  deliveries: Delivery[];
  available: AvailableRun[] | null;
  profile: CourierProfile | null;
  onGo(tab: DriverTab): void;
}) {
  const out = deliveries.filter((d) => d.status === 'out');
  const doneToday = deliveries.filter((d) => d.status === 'delivered');
  const earned = doneToday.reduce((n, d) => n + (d.courierPay ? toCents(d.courierPay) : 0), 0);
  const focus = out[0];
  const free = available?.length ?? 0;
  return (
    <>
      {focus ? (
        <button type="button" className="dhome__focus" onClick={() => onGo('runs')}>
          <span className="cm-hint">
            {out.length === 1 ? 'Entrega em andamento' : `${out.length} entregas em andamento`}
          </span>
          <strong>
            #{focus.orderNumber} · {focus.customerName ?? 'Cliente'}
          </strong>
          <span className="dhome__addr">
            <MapPin size={16} aria-hidden /> {focus.deliveryAddress ?? 'Endereço não informado'}
          </span>
        </button>
      ) : (
        <p className="dhome__idle">Você não tem nenhuma entrega em andamento agora.</p>
      )}

      <div className="dhome__go">
        <Button
          size="lg"
          variant={free > 0 && !focus ? 'primary' : 'secondary'}
          icon={<Package size={18} />}
          onClick={() => onGo('available')}
        >
          {free > 0 ? `Ver disponíveis (${free})` : 'Ver disponíveis'}
        </Button>
        <Button
          size="lg"
          variant={focus ? 'primary' : 'secondary'}
          icon={<Bike size={18} />}
          onClick={() => onGo('runs')}
        >
          Ver minhas entregas
        </Button>
      </div>

      <h2 className="driver__title">Hoje</h2>
      <div className="dstats">
        <Stat label="Entregues" value={String(doneToday.length)} />
        <Stat label="Ganhos" value={brl((earned / 100).toFixed(2))} />
        <Stat
          label="Score"
          value={profile?.score != null ? scoreText(profile.score) : 'Novo'}
          onClick={() => onGo('profile')}
        />
      </div>
    </>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const body = (
    <>
      <strong>{value}</strong>
      <span>{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="dstat" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="dstat">{body}</div>
  );
}

// --------------------------------------------------------------------------- Disponíveis
export function AvailableTab({
  list,
  claim,
  onClaimed,
}: {
  /** null: ainda carregando. */
  list: AvailableRun[] | null;
  claim(orderId: string): Promise<unknown>;
  /** Pegou (ou perdeu) a corrida: recarrega as listas; `ok` leva para a aba Entregas. */
  onClaimed(ok: boolean): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!list) return <Skeleton />;
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
      <ul className="dhist">
        {items.map((d) => (
          <li key={d.id}>
            <div>
              <strong>
                #{d.orderNumber} · {d.customerName ?? 'Cliente'}
              </strong>
              <span className="cm-hint">
                {dateTime(d.finishedAt ?? d.dispatchedAt)}
                {d.distanceM ? ` · ${kmLabel(d.distanceM)}` : ''}
              </span>
              {d.deliveryAddress && <span className="dhist__addr">{d.deliveryAddress}</span>}
            </div>
            <div className="dhist__end">
              {d.status === 'delivered' ? (
                <Badge tone="success">Entregue</Badge>
              ) : (
                <Badge tone="danger">Não entregue</Badge>
              )}
              {d.courierPay && toCents(d.courierPay) > 0 && <strong>{brl(d.courierPay)}</strong>}
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
      {next && (
        <Button variant="secondary" block loading={busy} onClick={() => void more(next)}>
          Carregar mais
        </Button>
      )}
    </>
  );
}

// --------------------------------------------------------------------------- Perfil
export function ProfileTab({ profile }: { profile: CourierProfile | null }) {
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
        <div>
          <strong>{p.name}</strong>
          <span className="cm-hint">Entregador desde {since}</span>
        </div>
      </section>

      <section className="dscore" aria-label="Score">
        <div className="dscore__top">
          <Star size={20} aria-hidden />
          {p.score != null ? (
            <>
              <strong>{scoreText(p.score)}</strong>
              <span className="dscore__of">de 5</span>
              <Badge tone={p.level === 'atencao' ? 'warning' : 'success'}>
                {COURIER_LEVEL_LABELS[p.level]}
              </Badge>
            </>
          ) : (
            <>
              <strong>Novo</strong>
              <span className="dscore__of">
                {left === 1 ? 'falta 1 entrega' : `faltam ${left} entregas`} para o score aparecer
              </span>
            </>
          )}
        </div>
        {p.completionPct != null && p.onTimePct != null && (
          <div className="dscore__bars">
            <Bar label="Entregas concluídas" pct={p.completionPct} />
            <Bar label="Entregas no prazo" pct={p.onTimePct} />
          </div>
        )}
        <p className="cm-hint">
          O score é calculado sozinho com as corridas dos últimos {p.recent.days} dias: concluir a
          entrega pesa mais, chegar no prazo completa a nota.
        </p>
      </section>

      <div className="dstats dstats--4">
        <Fact
          icon={<Package size={16} />}
          label="Entregas concluídas"
          value={String(p.delivered)}
        />
        <Fact icon={<Bike size={16} />} label="Entregues hoje" value={String(p.today)} />
        <Fact
          icon={<Clock size={16} />}
          label="Tempo médio"
          value={p.avgMinutes != null ? `${p.avgMinutes} min` : 'sem dados'}
        />
        <Fact
          icon={<Route size={16} />}
          label="Distância rodada"
          value={`${p.km.toLocaleString('pt-BR')} km`}
        />
      </div>
      {p.failed > 0 && (
        <p className="cm-hint">
          {p.failed === 1 ? '1 entrega não concluída' : `${p.failed} entregas não concluídas`} desde
          o começo.
        </p>
      )}
    </>
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

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="dstat dstat--fact">
      <span>
        {icon} {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
