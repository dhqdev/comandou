import { channelInfo } from '@comandou/shared';
import { Landmark } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';

interface OrderFinance {
  channel: string;
  gross: string | null;
  net: string | null;
  fees: string | null;
  entries: { label: string; amount: string }[] | null;
  updatedAt: string | null;
}

/** "−R$ 3,00" com o sinal de menos de verdade. */
const signed = (v: string) => (Number(v) < 0 ? `−${brl(String(-Number(v)))}` : brl(v));

/**
 * Gaveta do pedido de aplicativo (só para quem vê o Financeiro): o que a venda rende no repasse,
 * as taxas e os descontos do aplicativo, como o financeiro dele informa.
 */
export function AppOrderFinance({ orderId }: { orderId: string }) {
  const [f, setF] = useState<OrderFinance | null>(null);
  useEffect(() => {
    let alive = true;
    api<OrderFinance>(`/channels/orders/${orderId}/finance`)
      .then((r) => alive && setF(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [orderId]);
  if (!f) return null;
  const label = channelInfo(f.channel).label;
  return (
    <div className="od-note" data-hue={f.net !== null ? 'green' : undefined}>
      <Landmark size={15} aria-hidden />
      <div>
        <span>Repasse do {label}</span>
        {f.net === null ? (
          <strong>
            {f.updatedAt
              ? `O ${label} ainda não fechou a conta desta venda.`
              : `Ainda não lido do financeiro do ${label}.`}
          </strong>
        ) : (
          <>
            <strong>
              Fica com a loja {brl(f.net)} · vendido {brl(f.gross ?? '0')} · descontado{' '}
              {brl(f.fees ?? '0')}
            </strong>
            {!!f.entries?.length && (
              <span>{f.entries.map((e) => `${e.label} ${signed(e.amount)}`).join(' · ')}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
