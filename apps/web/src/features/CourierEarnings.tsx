import {
  COURIER_TAX_REGIME_LABELS,
  formatBRL,
  toCents,
  type CourierTaxRegime,
} from '@comandou/shared';
import { Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Segmented, Skeleton } from '../design-system';
import { brl } from '../lib/money';
import { dateTime } from './format';
import { kmLabel } from './live-geo';

interface PeriodTotals {
  delivered: number;
  failed: number;
  distanceM: number;
  rides: string;
  daily: string;
  total: string;
}

export interface CourierEarningsData {
  rule: string;
  dailyRate: string;
  taxRegime: CourierTaxRegime;
  today: PeriodTotals;
  week: PeriodTotals;
  month: PeriodTotals;
  pending: { rides: number; gross: string; withheld: string; net: string };
  recent: {
    id: string;
    orderNumber: number;
    status: 'delivered' | 'failed';
    finishedAt: string;
    distanceM: number | null;
    pay: string | null;
    paid: boolean;
  }[];
  payouts: {
    id: string;
    periodFrom: string | null;
    periodTo: string;
    deliveries: number;
    gross: string;
    withheld: string;
    net: string;
    method: string;
    paidAt: string;
  }[];
  /** Últimos 7 dias (hoje no fim): dia AAAA-MM-DD, entregas e ganho com a diária. */
  last7?: { day: string; delivered: number; total: string }[];
}

type Period = 'today' | 'week' | 'month';
const PERIOD_LABEL: Record<Period, string> = {
  today: 'hoje',
  week: 'nesta semana',
  month: 'neste mês',
};
const METHOD_LABEL: Record<string, string> = {
  cash: 'dinheiro',
  pix: 'Pix',
  transfer: 'transferência',
  other: 'outro',
};
const day = (d: string) => d.split('-').reverse().slice(0, 2).join('/');

/**
 * Central do entregador: quanto ganhou hoje, na semana e no mês, quanto falta receber (já com
 * as retenções, quando é autônomo), como o ganho é calculado, as últimas corridas e os repasses.
 */
export function CourierEarnings({ load }: { load(): Promise<CourierEarningsData> }) {
  const [data, setData] = useState<CourierEarningsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('today');
  useEffect(() => {
    let stop = false;
    load()
      .then((d) => !stop && (setData(d), setError(null)))
      .catch((e) => !stop && setError((e as Error).message));
    return () => {
      stop = true;
    };
  }, [load]);

  if (error) return <Alert tone="warning">{error}</Alert>;
  if (!data) return <Skeleton variant="cards" />;
  const p = data[period];
  const hasDaily = data.dailyRate !== '0.00';
  return (
    <div className="earn">
      <Segmented
        label="Período"
        block
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'today', label: 'Hoje' },
          { value: 'week', label: 'Semana' },
          { value: 'month', label: 'Mês' },
        ]}
      />
      <section className="earn__hero" aria-live="polite">
        <span className="cm-hint">Você ganhou {PERIOD_LABEL[period]}</span>
        <strong className="earn__total">{brl(p.total)}</strong>
        <span className="earn__meta">
          {p.delivered} {p.delivered === 1 ? 'entrega' : 'entregas'}
          {p.failed > 0 && ` · ${p.failed} não entregue${p.failed > 1 ? 's' : ''}`}
          {p.distanceM > 0 && ` · ${kmLabel(p.distanceM)} rodados`}
        </span>
        <dl className="earn__split">
          <div>
            <dt>Corridas</dt>
            <dd>{brl(p.rides)}</dd>
          </div>
          {hasDaily && (
            <div>
              <dt>Diárias</dt>
              <dd>{brl(p.daily)}</dd>
            </div>
          )}
          <div>
            <dt>Média por entrega</dt>
            <dd>{p.delivered ? formatBRL(Math.round(toCents(p.rides) / p.delivered)) : '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="earn__pending">
        <Wallet size={20} />
        <div>
          <strong>A receber: {brl(data.pending.net)}</strong>
          <span className="cm-hint">
            {data.pending.rides === 0
              ? 'Tudo acertado. As próximas corridas entram aqui.'
              : data.pending.withheld !== '0.00'
                ? `${data.pending.rides} corridas · bruto ${brl(data.pending.gross)} − ${brl(data.pending.withheld)} de impostos retidos (INSS/IR)`
                : `${data.pending.rides} corridas ainda não pagas pelo restaurante`}
          </span>
        </div>
      </section>

      <p className="earn__rule">
        <strong>Como você ganha:</strong> {data.rule}.{' '}
        <span className="cm-hint">{COURIER_TAX_REGIME_LABELS[data.taxRegime]}.</span>
      </p>

      {data.recent.length > 0 && (
        <>
          <h2 className="driver__title">Últimas corridas</h2>
          <ul className="dlist">
            {data.recent.map((r) => (
              <li key={r.id} className="dride" data-ok={r.status === 'delivered' || undefined}>
                <i className="dride__dot" aria-hidden />
                <div className="dride__main">
                  <strong>#{r.orderNumber}</strong>
                  <small>
                    {dateTime(r.finishedAt)}
                    {r.distanceM != null && ` · ${kmLabel(r.distanceM)}`}
                    {r.status === 'failed' && ' · não entregue'}
                  </small>
                </div>
                {!r.paid && <span className="earn__due">a receber</span>}
                <strong className="dride__pay">{r.pay ? brl(r.pay) : '—'}</strong>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.payouts.length > 0 && (
        <>
          <h2 className="driver__title">Pagamentos recebidos</h2>
          <ul className="dlist">
            {data.payouts.map((x) => (
              <li key={x.id} className="dride" data-ok>
                <i className="dride__dot" aria-hidden />
                <div className="dride__main">
                  <strong>
                    {x.periodFrom
                      ? `${day(x.periodFrom)} a ${day(x.periodTo)}`
                      : `até ${day(x.periodTo)}`}
                  </strong>
                  <small>
                    {x.deliveries} entregas · {METHOD_LABEL[x.method] ?? x.method}
                    {x.withheld !== '0.00' && ` · retido ${brl(x.withheld)}`}
                  </small>
                </div>
                <strong className="dride__pay">{brl(x.net)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
