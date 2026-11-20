import { channelInfo, fromCents, toCents, type FinanceMonth, withArticle } from '@comandou/shared';
import { RefreshCw, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, EmptyState, useToast, Skeleton } from '../../design-system';
import { useCan } from '../../app/auth';
import { fmtDate } from '../../features/forms';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useRealtime } from '../../lib/realtime';
import { KpiStrip } from './charts';
import { pctText } from './insights';

interface Payout {
  id: string;
  channel: string;
  storeName: string | null;
  kind: string;
  periodStart: string | null;
  periodEnd: string | null;
  expectedDate: string;
  amount: string;
  originalAmount: string | null;
  originalDate: string | null;
  anticipationFee: string | null;
  status: 'scheduled' | 'paid' | 'failed';
  entryId: string | null;
  entryStatus: 'open' | 'paid' | 'cancelled' | null;
  reconciled: boolean;
}
interface SalesRow {
  channel: string;
  orders: number;
  closed: number;
  customerTotal: string;
  gross: string;
  fees: string;
  net: string;
}
interface StoreRow {
  id: string;
  channel: string;
  name: string;
  financeAt: string | null;
  financeError: string | null;
}
interface Data {
  payouts: Payout[];
  sales: SalesRow[];
  stores: StoreRow[];
}

const sumOf = <T,>(rows: T[], f: (r: T) => string) =>
  fromCents(rows.reduce((a, r) => a + toCents(f(r)), 0));
const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Situação do repasse para a pessoa: conferido no extrato, pago, a cair ou com problema. */
function payoutBadge(p: Payout, label: string) {
  if (p.status === 'failed') return <Badge tone="danger">Não foi feito</Badge>;
  if (toCents(p.amount) <= 0)
    return <Badge tone="warning">Débito {withArticle(label, 'do')}</Badge>;
  if (p.reconciled) return <Badge tone="success">Conferido no extrato</Badge>;
  if (p.status === 'paid') return <Badge tone="info">Pago {withArticle(label, 'pelo')}</Badge>;
  return <Badge>A cair</Badge>;
}

/**
 * Aplicativos: o que os pedidos do iFood (e dos outros aplicativos) renderam, quanto o aplicativo
 * descontou e os repasses do mês (quando caem, se já caíram e se o extrato conferiu). Cada repasse
 * vira uma conta a receber "Repasse de vendas" (fora do DRE), que a Conciliação confere sozinha.
 */
export function AppsTab({ period }: { period: FinanceMonth | null }) {
  const canWrite = useCan('finance:write');
  const toast = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!period) return;
    try {
      setD(await api<Data>(`/channels/finance?from=${period.from}&to=${period.to}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [period]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'channels.finance') void load();
  }, load);

  async function refresh() {
    setBusy(true);
    try {
      const r = await api<{ read: number }>('/channels/finance/refresh', {
        method: 'POST',
        json: {},
      });
      toast(
        r.read
          ? 'Financeiro dos aplicativos lido de novo'
          : 'Já foi lido há pouco. Tente de novo em alguns minutos.',
        r.read ? 'success' : 'neutral',
      );
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!d) return <Skeleton variant="page" />;
  if (!d.stores.length && !d.payouts.length && !d.sales.length)
    return (
      <EmptyState
        icon={<Smartphone size={20} />}
        title="Nenhum aplicativo com repasse"
        description="Ligue a loja do iFood em Integrações para ver aqui o que cada pedido rende e quando o repasse cai na conta."
      />
    );

  const orders = d.sales.reduce((a, s) => a + s.orders, 0);
  const closed = d.sales.reduce((a, s) => a + s.closed, 0);
  const grossC = toCents(sumOf(d.sales, (s) => s.gross));
  const feesC = toCents(sumOf(d.sales, (s) => s.fees));
  const valid = d.payouts.filter((p) => p.status !== 'failed');
  const paid = sumOf(
    valid.filter((p) => p.status === 'paid' || p.reconciled),
    (p) => p.amount,
  );
  const due = sumOf(
    valid.filter((p) => p.status === 'scheduled' && !p.reconciled),
    (p) => p.amount,
  );

  return (
    <>
      <KpiStrip
        items={[
          {
            key: 'sold',
            label: 'Vendido nos aplicativos',
            value: brl(sumOf(d.sales, (s) => s.customerTotal)),
            sub: `${orders} ${orders === 1 ? 'pedido' : 'pedidos'} no mês`,
          },
          {
            key: 'fees',
            label: 'Descontado pelos aplicativos',
            value: brl(fromCents(feesC)),
            sub:
              grossC > 0
                ? `${pctText((feesC / grossC) * 100, 1)} das vendas já fechadas`
                : 'comissão, taxas e promoções',
          },
          {
            key: 'net',
            label: 'Fica com a loja',
            value: brl(sumOf(d.sales, (s) => s.net)),
            sub:
              closed < orders
                ? `${closed} de ${orders} pedidos já fechados pelo aplicativo`
                : 'depois dos descontos',
          },
          {
            key: 'payouts',
            label: 'Repasses do mês',
            value: brl(sumOf(valid, (p) => p.amount)),
            sub: `${brl(paid)} já pago · ${brl(due)} a cair`,
          },
        ]}
      />

      <Card
        title="Repasses"
        actions={
          canWrite ? (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              icon={<RefreshCw size={14} />}
              onClick={() => void refresh()}
            >
              Atualizar agora
            </Button>
          ) : undefined
        }
      >
        <p className="cm-hint fin-apps__hint">
          Cada repasse vira uma conta a receber "Repasse de vendas" no Financeiro. Ela fica fora do
          DRE (a venda já entrou pelo pedido) e a Conciliação confere com o extrato pelo valor e
          pela data.
        </p>
        {d.stores.map((s) => (
          <p key={s.id} className="fin-apps__store">
            <span className="fin-dot" data-status={s.financeError ? 'warn' : 'good'} />
            {channelInfo(s.channel).label} · {s.name}:{' '}
            {s.financeError ??
              (s.financeAt ? `lido às ${when(s.financeAt)}` : 'ainda não lido (até 6 horas)')}
          </p>
        ))}
        {d.payouts.length === 0 ? (
          <p className="cm-hint">Nenhum repasse com data neste mês.</p>
        ) : (
          <div className="fin-apps__scroll">
            <table className="cm-table fin-apps">
              <thead>
                <tr>
                  <th>Cai em</th>
                  <th>Aplicativo</th>
                  <th>Vendas de</th>
                  <th className="cm-num">Valor</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {d.payouts.map((p) => {
                  const label = channelInfo(p.channel).label;
                  const anticipated =
                    !!p.originalDate && p.originalDate !== p.expectedDate && !!p.anticipationFee;
                  return (
                    <tr key={p.id}>
                      <td>{fmtDate(p.expectedDate)}</td>
                      <td>
                        {label}
                        {p.storeName && <span className="cm-hint"> · {p.storeName}</span>}
                      </td>
                      <td>
                        {p.periodStart && p.periodEnd
                          ? p.periodStart === p.periodEnd
                            ? ddmm(p.periodStart)
                            : `${ddmm(p.periodStart)} a ${ddmm(p.periodEnd)}`
                          : '—'}
                        {anticipated && (
                          <span className="cm-hint">
                            {' '}
                            · antecipado de {ddmm(p.originalDate!)} (taxa {brl(p.anticipationFee!)})
                          </span>
                        )}
                      </td>
                      <td className="cm-num">
                        <strong>{brl(p.amount)}</strong>
                      </td>
                      <td>{payoutBadge(p, label)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {d.sales.length > 0 && (
        <Card title="Pedidos dos aplicativos no mês">
          <div className="fin-apps__scroll">
            <table className="cm-table fin-apps">
              <thead>
                <tr>
                  <th>Aplicativo</th>
                  <th className="cm-num">Pedidos</th>
                  <th className="cm-num">Vendido</th>
                  <th className="cm-num">Descontado</th>
                  <th className="cm-num">Fica com a loja</th>
                </tr>
              </thead>
              <tbody>
                {d.sales.map((s) => (
                  <tr key={s.channel}>
                    <td>{channelInfo(s.channel).label}</td>
                    <td className="cm-num">
                      {s.orders}
                      {s.closed < s.orders && (
                        <span className="cm-hint"> ({s.orders - s.closed} sem fechar)</span>
                      )}
                    </td>
                    <td className="cm-num">{brl(s.customerTotal)}</td>
                    <td className="cm-num">{brl(s.fees)}</td>
                    <td className="cm-num">
                      <strong>{brl(s.net)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cm-hint fin-apps__hint">
            O aplicativo fecha a conta de cada venda alguns dias depois da entrega; até lá, o pedido
            aparece como "sem fechar". O desconto de cada pedido aparece também na gaveta do pedido.
          </p>
        </Card>
      )}
    </>
  );
}
