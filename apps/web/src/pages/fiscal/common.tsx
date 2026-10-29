import { formatDocument } from '@comandou/shared';
import type { ReactNode } from 'react';
import { Alert, Badge } from '../../design-system';
import type { FiscalDocument, FiscalIssue, FiscalKind, FiscalStatus } from '../../lib/types';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Situação da nota como aparece nas listas (curta, como no caixa). */
export const FISCAL_STATUS: Record<FiscalStatus, [string, Tone]> = {
  draft: ['Rascunho', 'neutral'],
  pending: ['Na fila', 'info'],
  processing: ['Processando', 'info'],
  authorized: ['Emitida', 'success'],
  rejected: ['Recusada', 'danger'],
  error: ['Erro', 'danger'],
  cancelling: ['Cancelando', 'warning'],
  cancelled: ['Cancelada', 'warning'],
  discarded: ['Apagada', 'neutral'],
};

export const KIND_LABEL: Record<FiscalKind, string> = { nfce: 'NFC-e', nfe: 'NF-e' };

export const CHANNEL_LABEL: Record<string, string> = {
  counter: 'Balcão',
  table: 'Mesa',
  delivery: 'Delivery',
  pickup: 'Retirada',
};

export const PAYMENT_LABEL: Record<string, string> = {
  '01': 'Dinheiro',
  '03': 'Cartão de crédito',
  '04': 'Cartão de débito',
  '11': 'Vale-refeição',
  '17': 'Pix',
  '99': 'Outros',
};

export function StatusBadge({ status }: { status: FiscalStatus }) {
  const [label, tone] = FISCAL_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** "7 · série 1" ou o código interno enquanto a nota não tem número. */
export function docTitle(d: Pick<FiscalDocument, 'number' | 'series' | 'id' | 'kind'>) {
  return d.number ? `${d.number} · série ${d.series ?? '1'}` : `${KIND_LABEL[d.kind]} sem número`;
}

export const fmtDoc = (v: string | null | undefined) => (v ? formatDocument(v) : '—');

export const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const FIX_HINT: Record<NonNullable<FiscalIssue['fix']>, string> = {
  recipient: 'Corrija no Destinatário, abaixo, e clique em Reemitir.',
  items: 'Corrija no cadastro do item (Cardápio) e clique em Reemitir.',
  rules: 'Corrija em Fiscal → Padrões fiscais e clique em Reemitir.',
  settings: 'Corrija em Fiscal → Configuração e clique em Reemitir.',
  certificate: 'Envie o certificado em Fiscal → Configuração.',
  payment: 'Confira os pagamentos do pedido no caixa.',
  retry: 'Clique em Reemitir.',
  none: '',
};

/** "Por que foi recusada": cada problema em um bloco, com onde corrigir. */
export function IssueList({
  issues,
  title = 'Por que foi recusada',
}: {
  issues: FiscalIssue[];
  title?: string;
}) {
  if (!issues.length) return null;
  return (
    <section className="fi-issues" aria-label={title}>
      <h2 className="fi-section-title">{title}</h2>
      {issues.map((i, n) => (
        <div key={n} className="fi-issue">
          <strong className="fi-issue__title">
            {i.title}
            {i.code && <span className="fi-issue__code">rejeição {i.code}</span>}
          </strong>
          <p className="fi-issue__detail">{i.detail}</p>
          {i.fix && FIX_HINT[i.fix] && <p className="fi-issue__fix">{FIX_HINT[i.fix]}</p>}
        </div>
      ))}
    </section>
  );
}

export function FiscalHead({
  title,
  children,
  actions,
  error,
  back,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  error?: string | null;
  back?: ReactNode;
}) {
  return (
    <>
      <div className="page-head fi-head">
        <div>
          {back ?? <span className="fi-head__eyebrow">Fiscal</span>}
          <h1 className="page-title">{title}</h1>
          {children && <p className="page-sub">{children}</p>}
        </div>
        {actions && <div className="fi-head__actions">{actions}</div>}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </>
  );
}

/** Linha "rótulo ........ valor" dos blocos de resumo. */
export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fi-kv">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}
