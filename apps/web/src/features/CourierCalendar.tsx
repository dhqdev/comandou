import { formatBRL, toCents } from '@comandou/shared';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Alert, Badge, Button, Card, EmptyState, Modal, Skeleton } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useRealtime } from '../lib/realtime';
import { time } from './format';
import './courier-calendar.css';

interface Cell {
  day: string;
  courierId: string;
  delivered: number;
  failed: number;
  distanceM: number;
  rides: string;
  daily: string;
  total: string;
  collected: string;
  first: string;
  last: string;
}
interface CalendarData {
  month: string;
  couriers: { id: string; name: string; active: boolean }[];
  days: Cell[];
}
interface Ride {
  id: string;
  courierId: string;
  orderNumber: number;
  customerName: string | null;
  deliveryAddress: string | null;
  status: 'delivered' | 'failed';
  dispatchedAt: string;
  finishedAt: string;
  failureReason: string | null;
  distanceM: number | null;
  pay: string;
  fee: string | null;
  collectAmount: string | null;
  paid: boolean;
}

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const thisMonth = () => isoOf(new Date()).slice(0, 7);
const shiftMonth = (m: string, n: number) =>
  isoOf(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).slice(0, 7);
const monthLabel = (m: string) =>
  new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
const km = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const firstName = (n: string) => n.split(/\s+/)[0] ?? n;
/** "R$ 1,2 mil" / "R$ 85" para a célula pequena do celular. */
const compact = (cents: number) =>
  cents >= 100_000
    ? `R$ ${(cents / 100_000).toFixed(1).replace('.', ',')} mil`
    : `R$ ${Math.round(cents / 100)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Calendário de ganhos (Entregas › Acerto): cada dia do mês com quanto cada entregador fez
 * (corridas + diária), uma cor por entregador (a mesma do mapa), o total do dia e da semana.
 * Tocar num dia abre o detalhe com as corridas; tocar num nome destaca só ele.
 */
export function CourierCalendar({
  colorOf,
  month,
  onMonth: setMonth,
}: {
  colorOf(id: string): string;
  /** "AAAA-MM"; o mês fica com quem usa o calendário (os pagamentos feitos seguem o mesmo). */
  month: string;
  onMonth(m: string | ((m: string) => string)): void;
}) {
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<CalendarData>(`/courier-pay/calendar?month=${month}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'delivery.changed') void load();
  }, load);

  const view = useMemo(() => (data ? summarize(data, only) : null), [data, only]);
  const today = isoOf(new Date());

  // Semanas do mês (começam no domingo), com as casas fora do mês vazias.
  const weeks = useMemo(() => {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7)) - 1;
    const start = new Date(y, m, 1).getDay();
    const last = new Date(y, m + 1, 0).getDate();
    const cells: (string | null)[] = [
      ...Array<null>(start).fill(null),
      ...Array.from({ length: last }, (_, i) => `${month}-${pad(i + 1)}`),
    ];
    while (cells.length % 7) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  }, [month]);

  return (
    <Card
      title="Calendário de ganhos"
      actions={
        <div className="ccal-month">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Mês anterior"
            icon={<ChevronLeft size={16} />}
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          />
          <strong>{monthLabel(month)}</strong>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Próximo mês"
            icon={<ChevronRight size={16} />}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          />
          {month !== thisMonth() && (
            <Button size="sm" variant="secondary" onClick={() => setMonth(thisMonth())}>
              Hoje
            </Button>
          )}
        </div>
      }
    >
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !data || !view ? (
        <Skeleton variant="board" />
      ) : (
        <div className="ccal">
          <div className="ccal-kpis">
            <Kpi label={only ? `Ganhos de ${firstName(view.name(only))}` : 'Ganhos no mês'}>
              {formatBRL(view.monthTotal)}
            </Kpi>
            <Kpi label="Entregas">{view.delivered}</Kpi>
            <Kpi label="Dias com entrega">{view.activeDays}</Kpi>
            <Kpi label="Melhor dia">
              {view.best ? (
                <>
                  {formatBRL(view.best.cents)} <small>dia {Number(view.best.day.slice(8))}</small>
                </>
              ) : (
                '—'
              )}
            </Kpi>
          </div>

          {view.people.length > 0 && (
            <div className="ccal-legend" role="group" aria-label="Entregadores">
              {view.people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="ccal-chip"
                  aria-pressed={only === p.id}
                  data-dim={(only && only !== p.id) || undefined}
                  style={{ '--rider': colorOf(p.id) } as CSSProperties}
                  onClick={() => setOnly((o) => (o === p.id ? null : p.id))}
                >
                  <span className="ccal-dot" />
                  <span className="ccal-chip__name">{p.name}</span>
                  <span className="ccal-chip__value">{formatBRL(p.cents)}</span>
                  <span
                    className="ccal-chip__bar"
                    style={{ width: `${(p.cents / view.topPerson) * 100}%` }}
                  />
                </button>
              ))}
            </div>
          )}

          {data.days.length === 0 && (
            <EmptyState
              icon={<CalendarDays size={20} />}
              title="Nenhuma corrida neste mês"
              description="Quando um entregador encerrar uma entrega, o ganho dele aparece no dia, na cor dele."
            />
          )}

          <div className="ccal-grid" role="grid" aria-label={`Ganhos de ${monthLabel(month)}`}>
            <div className="ccal-row ccal-row--head" role="row">
              {WEEK.map((w) => (
                <span key={w} role="columnheader">
                  {w}
                </span>
              ))}
              <span role="columnheader" className="ccal-week">
                Semana
              </span>
            </div>
            {weeks.map((week, wi) => {
              const weekCents = week.reduce((a, d) => a + (d ? view.dayTotal(d) : 0), 0);
              return (
                <div key={wi} className="ccal-row" role="row">
                  {week.map((d, i) =>
                    d ? (
                      <DayCell
                        key={d}
                        day={d}
                        today={d === today}
                        future={d > today}
                        lines={view.byDay.get(d) ?? []}
                        max={view.maxDay}
                        colorOf={colorOf}
                        name={view.name}
                        onOpen={() => setOpen(d)}
                      />
                    ) : (
                      <span key={`x${i}`} className="ccal-cell ccal-cell--out" role="gridcell" />
                    ),
                  )}
                  <span className="ccal-week" role="gridcell">
                    {weekCents ? formatBRL(weekCents) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="cm-hint">
            Ganho do dia = corridas encerradas no dia + a diária de quem entregou. Toque num dia
            para ver o que é cada valor e num nome para ver só aquele entregador.
          </p>
        </div>
      )}
      <Modal
        open={!!open}
        size="lg"
        title={open ? cap(dayLabel(open)) : ''}
        onClose={() => setOpen(null)}
      >
        {open && data && (
          <DayDetail
            day={open}
            cells={data.days.filter((c) => c.day === open)}
            name={(id) => data.couriers.find((c) => c.id === id)?.name ?? 'Entregador'}
            colorOf={colorOf}
          />
        )}
      </Modal>
    </Card>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ccal-kpi">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

/** Totais do mês, por pessoa e por dia, já filtrados pelo entregador escolhido. */
function summarize(data: CalendarData, only: string | null) {
  const cells = only ? data.days.filter((c) => c.courierId === only) : data.days;
  const byDay = new Map<string, Cell[]>();
  for (const c of cells) {
    const list = byDay.get(c.day) ?? [];
    list.push(c);
    byDay.set(c.day, list);
  }
  for (const list of byDay.values()) list.sort((a, b) => toCents(b.total) - toCents(a.total));
  const dayTotal = (d: string) => (byDay.get(d) ?? []).reduce((a, c) => a + toCents(c.total), 0);
  let best: { day: string; cents: number } | null = null;
  for (const d of byDay.keys()) {
    const v = dayTotal(d);
    if (v > 0 && (!best || v > best.cents)) best = { day: d, cents: v };
  }
  const perPerson = new Map<string, number>();
  for (const c of data.days)
    perPerson.set(c.courierId, (perPerson.get(c.courierId) ?? 0) + toCents(c.total));
  const people = data.couriers
    .map((c) => ({ id: c.id, name: c.name, cents: perPerson.get(c.id) ?? 0 }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  return {
    byDay,
    dayTotal,
    best,
    people,
    topPerson: Math.max(1, ...people.map((p) => p.cents)),
    maxDay: Math.max(1, ...[...byDay.keys()].map(dayTotal)),
    monthTotal: cells.reduce((a, c) => a + toCents(c.total), 0),
    delivered: cells.reduce((a, c) => a + c.delivered, 0),
    activeDays: [...byDay.values()].filter((l) => l.some((c) => c.delivered > 0)).length,
    name: (id: string) => data.couriers.find((c) => c.id === id)?.name ?? 'Entregador',
  };
}

function DayCell({
  day,
  today,
  future,
  lines,
  max,
  colorOf,
  name,
  onOpen,
}: {
  day: string;
  today: boolean;
  future: boolean;
  lines: Cell[];
  max: number;
  colorOf(id: string): string;
  name(id: string): string;
  onOpen(): void;
}) {
  const total = lines.reduce((a, c) => a + toCents(c.total), 0);
  const n = Number(day.slice(8));
  if (!lines.length)
    return (
      <span
        className="ccal-cell ccal-cell--empty"
        role="gridcell"
        data-today={today || undefined}
        data-future={future || undefined}
      >
        <span className="ccal-cell__n">{n}</span>
      </span>
    );
  const shown = lines.slice(0, 3);
  return (
    <button
      type="button"
      role="gridcell"
      className="ccal-cell"
      data-today={today || undefined}
      aria-label={`Dia ${n}: ${formatBRL(total)}. ${lines.map((c) => `${name(c.courierId)} ${brl(c.total)}`).join(', ')}`}
      onClick={onOpen}
      style={{ '--heat': String(total / max) } as CSSProperties}
    >
      <span className="ccal-cell__top">
        <span className="ccal-cell__n">{n}</span>
        <strong className="ccal-cell__total">
          <span className="ccal-full">{formatBRL(total)}</span>
          <span className="ccal-short">{compact(total)}</span>
        </strong>
      </span>
      <span className="ccal-stack" aria-hidden>
        {lines.map((c) => (
          <span
            key={c.courierId}
            style={{
              flexGrow: Math.max(1, toCents(c.total)),
              background: colorOf(c.courierId),
            }}
          />
        ))}
      </span>
      <span className="ccal-lines" aria-hidden>
        {shown.map((c) => (
          <span
            key={c.courierId}
            className="ccal-line"
            style={{ '--rider': colorOf(c.courierId) } as CSSProperties}
          >
            <span className="ccal-dot" />
            <span className="ccal-line__name">{firstName(name(c.courierId))}</span>
            <span className="ccal-line__value">{brl(c.total)}</span>
          </span>
        ))}
        {lines.length > shown.length && (
          <span className="ccal-more">+{lines.length - shown.length}</span>
        )}
      </span>
      <span className="ccal-dots" aria-hidden>
        {lines.map((c) => (
          <span
            key={c.courierId}
            className="ccal-dot"
            style={{ '--rider': colorOf(c.courierId) } as CSSProperties}
          />
        ))}
      </span>
    </button>
  );
}

/**
 * Detalhe de um dia (abre ao tocar no dia; no celular sobe de baixo). Diz com palavras o que é
 * cada valor: ganho = corridas + diária; "cobrou na porta" é dinheiro do cliente, da loja.
 */
function DayDetail({
  day,
  cells,
  name,
  colorOf,
}: {
  day: string;
  cells: Cell[];
  name(id: string): string;
  colorOf(id: string): string;
}) {
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setRides(null);
    api<Ride[]>(`/courier-pay/calendar/day?day=${day}`)
      .then((r) => live && setRides(r))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [day]);

  const sorted = [...cells].sort((a, b) => toCents(b.total) - toCents(a.total));
  const total = cells.reduce((a, c) => a + toCents(c.total), 0);
  const delivered = cells.reduce((a, c) => a + c.delivered, 0);
  /** O dia de um entregador é pago de uma vez (o pagamento vai até uma data). */
  const paidOf = (id: string) => {
    const mine = rides?.filter((r) => r.courierId === id) ?? [];
    return mine.length > 0 && mine.every((r) => r.paid);
  };
  const paid = rides
    ? cells.reduce((a, c) => a + (paidOf(c.courierId) ? toCents(c.total) : 0), 0)
    : null;

  return (
    <div className="ccal-detail">
      <p className="ccal-detail__lead">
        {cells.length === 1
          ? `1 entregador fez ${plural(delivered, 'entrega', 'entregas')} e ganhou `
          : `${cells.length} entregadores fizeram ${plural(delivered, 'entrega', 'entregas')} e ganharam `}
        <strong>{formatBRL(total)}</strong> neste dia.
      </p>
      <div className="ccal-kpis">
        <Kpi label="Ganhos do dia">{formatBRL(total)}</Kpi>
        <Kpi label="Entregas">{delivered}</Kpi>
        <Kpi label="Já pago">{paid === null ? '…' : formatBRL(paid)}</Kpi>
        <Kpi label="Falta pagar">{paid === null ? '…' : formatBRL(total - paid)}</Kpi>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {sorted.map((c) => {
        const mine = rides?.filter((r) => r.courierId === c.courierId) ?? [];
        const isPaid = paidOf(c.courierId);
        return (
          <section
            key={c.courierId}
            className="ccal-person"
            style={{ '--rider': colorOf(c.courierId) } as CSSProperties}
          >
            <header className="ccal-person__head">
              <span className="ccal-dot ccal-dot--lg" />
              <div>
                <strong>{name(c.courierId)}</strong>
                <span className="cm-hint">
                  {km(c.distanceM)} · das {time(c.first)} às {time(c.last)}
                </span>
              </div>
              {rides &&
                (isPaid ? (
                  <Badge tone="success">Pago</Badge>
                ) : (
                  <Badge tone="warning">A pagar</Badge>
                ))}
            </header>
            <dl className="ccal-bill">
              <div>
                <dt>
                  Corridas
                  <small>
                    {plural(c.delivered, 'entrega', 'entregas')}
                    {c.failed > 0 && ` + ${plural(c.failed, 'não entregue', 'não entregues')}`},
                    pela regra de pagamento
                  </small>
                </dt>
                <dd>{brl(c.rides)}</dd>
              </div>
              {toCents(c.daily) > 0 && (
                <div>
                  <dt>
                    Diária
                    <small>valor fixo por dia trabalhado</small>
                  </dt>
                  <dd>{brl(c.daily)}</dd>
                </div>
              )}
              <div className="ccal-bill__total">
                <dt>Ganhou no dia</dt>
                <dd>{brl(c.total)}</dd>
              </div>
            </dl>
            {toCents(c.collected) > 0 && (
              <p className="ccal-door">
                Recebeu <strong>{brl(c.collected)}</strong> em dinheiro dos clientes na porta. Esse
                valor é da loja (não é ganho dele) e volta para o caixa no acerto.
              </p>
            )}
            {rides && mine.length > 0 && (
              <details className="ccal-rides" open={sorted.length === 1 || undefined}>
                <summary>Ver {plural(mine.length, 'corrida', 'corridas')}</summary>
                <ul className="od-rows">
                  {mine.map((r) => (
                    <li key={r.id}>
                      <div>
                        <strong>
                          Pedido #{r.orderNumber}
                          {r.customerName && ` · ${r.customerName}`}
                        </strong>
                        <div className="od-item__sub">
                          {time(r.dispatchedAt)} → {time(r.finishedAt)}
                          {r.distanceM ? ` · ${km(r.distanceM)}` : ''}
                          {r.collectAmount && toCents(r.collectAmount) > 0
                            ? ` · cobrou ${brl(r.collectAmount)}`
                            : ''}
                        </div>
                      </div>
                      <span className="od-rows__end">
                        {r.status === 'failed' && <Badge tone="danger">Não entregue</Badge>}
                        <strong>{brl(r.pay)}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!rides && !error && <Skeleton rows={2} />}
          </section>
        );
      })}
      <p className="cm-hint">
        <strong>Ganhou no dia</strong> = corridas + diária: é o que a loja deve ao entregador.{' '}
        <strong>Pago</strong> = já entrou num pagamento com recibo (em A pagar agora).{' '}
        <strong>Recebido na porta</strong> é dinheiro do cliente, da loja, e volta no acerto.
      </p>
    </div>
  );
}
