import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, EmptyState, Spinner, DateInput } from '../design-system';
import { CHANNEL_LABELS, PAYMENT_METHOD_LABELS, qty } from '../features/format';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { OrderChannel, PaymentMethod } from '@comandou/shared';

interface Sales {
  totals: {
    orders: number;
    cancelled: number;
    revenue: string;
    discounts: string;
    surcharges: string;
    deliveryFees: string;
    receivable: string;
    averageTicket: string;
  };
  byChannel: { channel: OrderChannel; orders: number; revenue: string }[];
  received: { method: PaymentMethod; received: string; refunded: string; net: string }[];
  topProducts: { productId: string; name: string; quantity: string; revenue: string }[];
}

export function ReportsPage() {
  const [day, setDay] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [data, setData] = useState<Sales | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const from = new Date(`${day}T00:00:00`);
    const to = new Date(from.getTime() + 86_400_000);
    try {
      setData(
        await api<Sales>(
          `/reports/sales?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        ),
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [day]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="page-sub">Faturamento (pedidos do dia) separado de recebimentos (caixa).</p>
        </div>
        <label className="cm-field">
          <span className="cm-label">Dia</span>
          <DateInput value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Faturamento" value={brl(data.totals.revenue)} />
            <Stat
              label="Pedidos"
              value={String(data.totals.orders)}
              hint={`${data.totals.cancelled} cancelados`}
            />
            <Stat label="Ticket médio" value={brl(data.totals.averageTicket)} />
            <Stat label="Descontos" value={brl(data.totals.discounts)} />
            <Stat label="A receber" value={brl(data.totals.receivable)} />
          </div>
          <div className="two-cols">
            <Card searchId="secao-recebimentos" title="Recebimentos por forma" bodyless>
              {data.received.length === 0 ? (
                <EmptyState title="Nenhum recebimento" />
              ) : (
                <table className="cm-table">
                  <thead>
                    <tr>
                      <th>Forma</th>
                      <th className="cm-num">Recebido</th>
                      <th className="cm-num">Estornos</th>
                      <th className="cm-num">Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.received.map((r) => (
                      <tr key={r.method}>
                        <td>{PAYMENT_METHOD_LABELS[r.method]}</td>
                        <td className="cm-num">{brl(r.received)}</td>
                        <td className="cm-num">{brl(r.refunded)}</td>
                        <td className="cm-num">
                          <strong>{brl(r.net)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card searchId="secao-canais" title="Por canal" bodyless>
              {data.byChannel.length === 0 ? (
                <EmptyState title="Sem vendas" />
              ) : (
                <table className="cm-table">
                  <tbody>
                    {data.byChannel.map((c) => (
                      <tr key={c.channel}>
                        <td>{CHANNEL_LABELS[c.channel]}</td>
                        <td className="cm-num">{c.orders} pedidos</td>
                        <td className="cm-num">
                          <strong>{brl(c.revenue)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
          <Card searchId="secao-mais-vendidos" title="Mais vendidos" bodyless>
            {data.topProducts.length === 0 ? (
              <EmptyState title="Sem vendas" />
            ) : (
              <table className="cm-table">
                <tbody>
                  {data.topProducts.map((p) => (
                    <tr key={p.productId + p.name}>
                      <td>{p.name}</td>
                      <td className="cm-num">{qty(p.quantity)}</td>
                      <td className="cm-num">{brl(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="cm-card stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {hint && <div className="cm-hint">{hint}</div>}
    </div>
  );
}
