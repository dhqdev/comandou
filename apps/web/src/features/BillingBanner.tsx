import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useCan } from '../app/auth';
import { api, BILLING_BLOCKED_EVENT } from '../lib/api';
import { contactHref } from '../pages/pricing-data';

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
  /** Teste criado pelo site nos últimos dias (sem cobrança automática). */
  trial?: { endsAt: string | null; daysLeft: number; contact: string } | null;
}

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '';

/** "Seu teste grátis termina hoje / amanhã / em 3 dias, em 20/11." */
function trialEnd(endsAt: string | null): string {
  if (!endsAt) return 'Seu teste grátis está no fim.';
  const end = new Date(endsAt);
  const today = new Date();
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(end) - midnight(today)) / 86_400_000);
  if (days <= 0) return 'Seu teste grátis termina hoje.';
  if (days === 1) return 'Seu teste grátis termina amanhã.';
  return `Seu teste grátis termina em ${days} dias, em ${day(endsAt)}.`;
}

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
  if (n.level === 'info' && n.trial) {
    const t = n.trial;
    const href = contactHref(t.contact);
    return (
      <div className="offline-banner billing-banner" data-level="info" role="status">
        {trialEnd(t.endsAt)} Para continuar de onde parou,{' '}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            fale com a gente
          </a>
        ) : (
          'fale com a gente'
        )}
        .
      </div>
    );
  }
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
