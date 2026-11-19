import { fromCents, toCents, type FinanceMonth } from '@comandou/shared';
import { ChevronDown, Landmark, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Segmented,
  Spinner,
  useToast,
} from '../../design-system';
import { useCan } from '../../app/auth';
import { PAYMENT_METHOD_LABELS } from '../../features/format';
import { fmtDate } from '../../features/forms';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useLiveData } from '../../lib/realtime';
import { DayBars, HBars, KpiStrip } from './charts';
import { methodTotals, money, pctText } from './insights';
import type { ClosingDay } from './types';

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const weekday = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' });

/** Valor com sinal e cor: sobra em verde, falta em vermelho. */
export function SignedBrl({ value }: { value: string }) {
  const c = toCents(value);
  if (c === 0) return <span className="cm-hint">{brl('0')}</span>;
  return (
    <span className={c > 0 ? 'fin-pos' : 'fin-neg'}>
      {c > 0 ? '+' : '−'}
      {brl(fromCents(Math.abs(c)))}
    </span>
  );
}

const STATUS: Record<
  ClosingDay['status'],
  { tone: 'success' | 'warning' | 'neutral'; text: string }
> = {
  posted: { tone: 'success', text: 'No financeiro' },
  pending: { tone: 'warning', text: 'Falta lançar' },
  open: { tone: 'neutral', text: 'Caixa aberto' },
};

/**
 * Fechamentos: cada dia de movimento com os caixas que abriram nele. Mostra o que entrou por forma
 * de pagamento, a taxa da maquininha, o líquido e quando cai na conta, a sobra ou falta da gaveta
 * e se o dia já está no financeiro (ao fechar o caixa, vai sozinho).
 */
export function ClosingsTab({
  period,
  onDailyCheck,
}: {
  period: FinanceMonth | null;
  onDailyCheck(day: string): void;
}) {
  const canWrite = useCan('finance:write');
  const toast = useToast();
  const [days, setDays] = useState<ClosingDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [posting, setPosting] = useState<string | null>(null);
  const [metric, setMetric] = useState<'gross' | 'net'>('gross');

  const load = useCallback(async () => {
    if (!period) return;
    try {
      const r = await api<{ days: ClosingDay[] }>(
        `/finance/closings?from=${period.from}&to=${period.to}`,
      );
      setDays(r.days);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [period]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveData(
    ['finance'],
    () => void load(),
    ['cash.changed', 'channels.finance', 'order.changed'],
    1500,
  );

  async function post(sessionId: string) {
    setPosting(sessionId);
    try {
      await api(`/finance/closings/${sessionId}/post`, { method: 'POST' });
      toast('Caixa lançado no financeiro', 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setPosting(null);
    }
  }

  const sum = (k: 'gross' | 'fee' | 'net' | 'cashDifference') =>
    fromCents((days ?? []).reduce((a, d) => a + toCents(d.totals[k]), 0));
  const pending = (days ?? []).filter((d) => d.status === 'pending').length;
  const grossC = toCents(sum('gross'));
  const feeC = toCents(sum('fee'));
  const orders = (days ?? []).reduce((a, d) => a + d.totals.orders, 0);
  const methods = methodTotals(days ?? []);
  // O gráfico vai do dia mais antigo ao mais novo (a lista mostra o mais novo em cima).
  const byDay = new Map((days ?? []).map((d) => [d.day, d]));
  const last = (days ?? []).reduce((m, d) => (d.day > m ? d.day : m), '');
  // Todos os dias do período até o último caixa, com zero onde não abriu caixa (eixo contínuo).
  const span: string[] = [];
  if (period && last)
    for (let d = period.from; d <= last && d <= period.to; d = nextDay(d)) span.push(d);
  const bars = span
    .map((day) => byDay.get(day) ?? { day, totals: null })
    .map((d) => ({
      day: d.day,
      value: d.totals ? toCents(metric === 'gross' ? d.totals.gross : d.totals.net) : 0,
      details: d.totals
        ? [
            { label: 'Líquido', value: brl(d.totals.net) },
            { label: 'Taxas', value: brl(d.totals.fee) },
            { label: 'Pedidos', value: String(d.totals.orders) },
          ]
        : [{ label: 'Sem caixa neste dia', value: '' }],
    }));

  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      {days && days.length > 0 && (
        <>
          <KpiStrip
            items={[
              {
                key: 'gross',
                label: 'Vendas nos caixas',
                value: brl(sum('gross')),
                sub: orders
                  ? `${orders} pedidos · ticket médio ${money(Math.round(grossC / orders))}`
                  : `${days.length} ${days.length === 1 ? 'dia' : 'dias'}`,
              },
              {
                key: 'fee',
                label: 'Taxas das maquininhas',
                value: brl(sum('fee')),
                sub: grossC > 0 ? `${pctText((feeC / grossC) * 100, 2)} das vendas` : undefined,
              },
              {
                key: 'net',
                label: 'Líquido',
                value: brl(sum('net')),
                sub: 'o que fica depois das taxas',
              },
              {
                key: 'diff',
                label: 'Sobras e faltas de caixa',
                value: <SignedBrl value={sum('cashDifference')} />,
                sub: 'dinheiro contado × esperado',
              },
            ]}
          />
          <div className="fin-split">
            <Card
              title={metric === 'gross' ? 'Vendas por dia' : 'Líquido por dia'}
              actions={
                <Segmented
                  label="Valor do gráfico"
                  value={metric}
                  onChange={setMetric}
                  options={[
                    { value: 'gross', label: 'Vendas' },
                    { value: 'net', label: 'Líquido' },
                  ]}
                />
              }
            >
              <DayBars
                items={bars}
                label={metric === 'gross' ? 'Vendas por dia' : 'Líquido por dia'}
              />
            </Card>
            <Card title="Por forma de pagamento">
              <HBars
                label="Vendas por forma de pagamento"
                rows={methods.map((m, i) => ({
                  key: m.method,
                  strong: i === 0,
                  label: m.name,
                  value: m.gross,
                  sub: `${pctText((m.gross / (grossC || 1)) * 100)} das vendas${m.fee > 0 ? ` · taxa ${pctText(m.feePct, 2)}` : ' · sem taxa'}`,
                }))}
              />
            </Card>
          </div>
        </>
      )}
      {pending > 0 && (
        <Alert tone="warning">
          {pending === 1 ? 'Um dia tem' : `${pending} dias têm`} caixa fechado fora do financeiro
          (de antes desta versão). Abra o dia e toque em <strong>Lançar no financeiro</strong>.
        </Alert>
      )}
      <Card title="Fechamentos de caixa" bodyless>
        {days === null ? (
          <div className="cm-card__body">
            <Spinner />
          </div>
        ) : days.length === 0 ? (
          <EmptyState
            icon={<Landmark size={20} />}
            title="Nenhum caixa neste mês"
            description="Ao fechar o caixa, o dia aparece aqui e vai sozinho para o financeiro."
          />
        ) : (
          <ul className="fin-days">
            {days.map((d) => {
              const expanded = open === d.day;
              const st = STATUS[d.status];
              return (
                <li key={d.day} className="fin-day" data-open={expanded || undefined}>
                  <button
                    type="button"
                    className="fin-day__head"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : d.day)}
                  >
                    <span className="fin-day__date">
                      <strong>{fmtDate(d.day)}</strong>
                      <span className="cm-hint">
                        {weekday(d.day)} · {d.sessions.length}{' '}
                        {d.sessions.length === 1 ? 'caixa' : 'caixas'}
                      </span>
                    </span>
                    <Badge tone={st.tone}>{st.text}</Badge>
                    <span className="fin-day__num fin-day__num--main">
                      <span className="cm-hint">Vendas</span>
                      {brl(d.totals.gross)}
                    </span>
                    <span className="fin-day__num">
                      <span className="cm-hint">Taxas</span>
                      {brl(d.totals.fee)}
                    </span>
                    <span className="fin-day__num">
                      <span className="cm-hint">Gaveta</span>
                      <SignedBrl value={d.totals.cashDifference} />
                    </span>
                    <ChevronDown size={16} className="fin-day__chev" aria-hidden />
                  </button>
                  {expanded && (
                    <div className="fin-day__body">
                      <div className="fin-kpis">
                        <span>
                          <span className="cm-hint">Pedidos</span>
                          {d.totals.orders}
                        </span>
                        <span>
                          <span className="cm-hint">Ticket médio</span>
                          {brl(d.totals.ticket)}
                        </span>
                        <span>
                          <span className="cm-hint">Descontos</span>
                          {brl(d.totals.discounts)}
                        </span>
                        <span>
                          <span className="cm-hint">Taxas de entrega</span>
                          {brl(d.totals.deliveryFees)}
                        </span>
                        <span>
                          <span className="cm-hint">Fundo de troco</span>
                          {brl(d.totals.opening)}
                        </span>
                        <span>
                          <span className="cm-hint">Suprimentos / sangrias</span>
                          {brl(d.totals.supplies)} / {brl(d.totals.withdrawals)}
                        </span>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="cm-table">
                          <thead>
                            <tr>
                              <th>Forma</th>
                              <th className="cm-num">Vendido</th>
                              <th className="cm-num">Taxa</th>
                              <th className="cm-num">Líquido</th>
                              <th>Na conta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.methods.map((m) => (
                              <tr key={m.method}>
                                <td>{PAYMENT_METHOD_LABELS[m.method]}</td>
                                <td className="cm-num">{brl(m.gross)}</td>
                                <td className="cm-num">{brl(m.fee)}</td>
                                <td className="cm-num">
                                  <strong>{brl(m.net)}</strong>
                                </td>
                                <td>
                                  {m.method === 'cash' ? (
                                    <span className="cm-hint">Na gaveta</span>
                                  ) : m.received ? (
                                    <Badge tone="success">Recebido</Badge>
                                  ) : (
                                    <span>
                                      {fmtDate(m.expectedDate)}
                                      {m.estimated && <span className="cm-hint"> · previsão</span>}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                            <tr>
                              <td>
                                <strong>Total</strong>
                              </td>
                              <td className="cm-num">{brl(d.totals.gross)}</td>
                              <td className="cm-num">{brl(d.totals.fee)}</td>
                              <td className="cm-num">
                                <strong>{brl(d.totals.net)}</strong>
                              </td>
                              <td />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <ul className="fin-sessions">
                        {d.sessions.map((s) => (
                          <li key={s.id}>
                            <div>
                              <strong>
                                {s.registerName} · sessão {s.number}
                              </strong>
                              <div className="cm-hint">
                                Aberto às {time(s.openedAt)}
                                {s.openedByName && ` por ${s.openedByName}`}
                                {s.closedAt
                                  ? ` · fechado às ${time(s.closedAt)}${s.closedByName ? ` por ${s.closedByName}` : ''}`
                                  : ' · ainda aberto'}
                              </div>
                              {s.closingNote && <div className="cm-hint">“{s.closingNote}”</div>}
                            </div>
                            <div className="actions-row">
                              {s.cashDifference !== null && toCents(s.cashDifference) !== 0 && (
                                <span>
                                  Gaveta <SignedBrl value={s.cashDifference} />
                                </span>
                              )}
                              {s.status === 'closed' && !s.posted && canWrite && (
                                <Button
                                  size="sm"
                                  icon={<Send size={14} />}
                                  loading={posting === s.id}
                                  onClick={() => post(s.id)}
                                >
                                  Lançar no financeiro
                                </Button>
                              )}
                              <Link className="cm-link" to={`/caixa?sessao=${s.id}`}>
                                Ver no caixa
                              </Link>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="actions-row">
                        <Button variant="secondary" size="sm" onClick={() => onDailyCheck(d.day)}>
                          Conferir com o extrato da maquininha
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
