import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useCan } from '../app/auth';
import { api, BILLING_BLOCKED_EVENT } from '../lib/api';

interface Notice {
  level: 'none' | 'info' | 'warning' | 'blocked';
  blockReason?: 'payment' | 'contract' | null;
  daysLeft?: number | null;
  status?: string;
  openInvoices?: number;
  blockOn?: string | null;
  contractPhase?: string;
  contractDaysLeft?: number | null;
  contractBlockOn?: string | null;
}

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '';

/**
 * Aviso da cobrança no topo de todas as telas: pagamento perto de vencer, sistema bloqueado
 * (só lê e paga) ou contrato para renovar. Recarrega a cada 10 minutos e quando a API recusa uma
 * gravação por bloqueio.
 */
export function BillingBanner() {
  const canPay = useCan('plan:read');
  const [n, setN] = useState<Notice | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Notice>('/subscription/notice')
        .then((r) => alive && setN(r))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 10 * 60_000);
    window.addEventListener(BILLING_BLOCKED_EVENT, load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener(BILLING_BLOCKED_EVENT, load);
    };
  }, []);
  if (!n || n.level === 'none') return null;
  const go = canPay ? (
    <Link to="/plano">
      {n.level === 'blocked' && n.blockReason === 'payment' ? 'Pagar agora' : 'Ver assinatura'}
    </Link>
  ) : (
    <span> Avise o administrador do restaurante.</span>
  );
  let text: string;
  if (n.level === 'blocked')
    text =
      n.blockReason === 'contract'
        ? 'Sistema bloqueado: o contrato venceu sem renovação. Dá para consultar, mas não para registrar.'
        : 'Sistema bloqueado: pagamento não confirmado. Dá para consultar, mas pedidos e vendas estão parados.';
  else if (n.level === 'warning')
    text =
      n.daysLeft !== null && n.daysLeft !== undefined && n.daysLeft > 0
        ? `Faltam ${n.daysLeft} ${n.daysLeft === 1 ? 'dia' : 'dias'} para o fim ${n.status === 'trialing' ? 'do teste grátis' : 'do período pago'}. Sem pagamento, o sistema bloqueia em ${day(n.blockOn)}.`
        : 'Há fatura vencida. Pague para evitar o bloqueio do sistema.';
  else
    text =
      n.contractPhase === 'expired'
        ? `O contrato venceu. Assine o novo até ${day(n.contractBlockOn)} para não bloquear.`
        : `O contrato vence em ${n.contractDaysLeft ?? ''} dias. A renovação é anual.`;
  return (
    <div className="offline-banner billing-banner" data-level={n.level} role="status">
      {text} {go}
    </div>
  );
}
