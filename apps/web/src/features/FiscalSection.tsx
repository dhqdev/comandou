import { formatDocument, isValidCnpj, isValidCpf } from '@comandou/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCan } from '../app/auth';
import { Alert, Badge, Button, TextField, useToast, HelpScope } from '../design-system';
import { api } from '../lib/api';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { FiscalDocument } from '../lib/types';
import { docTitle, KIND_LABEL, StatusBadge } from '../pages/fiscal/common';
import { PAYMENT_FISCAL_HELP } from './help/fiscal-help';

const LIVE = ['draft', 'pending', 'processing', 'authorized', 'cancelling'];
const WORKING = ['pending', 'processing', 'cancelling'];

function docError(digits: string) {
  if (!digits) return undefined;
  if (digits.length === 11) return isValidCpf(digits) ? undefined : 'CPF inválido';
  if (digits.length === 14) return isValidCnpj(digits) ? undefined : 'CNPJ inválido';
  return 'CPF tem 11 dígitos e CNPJ tem 14';
}

/**
 * Nota fiscal do pedido no detalhe do pedido. O status mostrado é sempre o que o servidor confirmou:
 * o evento em tempo real só dispara uma nova consulta. Detalhes, cancelamento e CC-e ficam na tela da nota.
 */
export function FiscalSection({
  orderId,
  paid,
  cancelled,
  taxDocument,
}: {
  orderId: string;
  paid: boolean;
  cancelled: boolean;
  taxDocument?: string | null;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const canEmit = useCan('fiscal:emit');
  const canSee = useCan('fiscal:manage') || canEmit;
  const [docs, setDocs] = useState<FiscalDocument[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [taxDoc, setTaxDoc] = useState(taxDocument ? formatDocument(taxDocument) : '');

  const load = useCallback(async () => {
    if (!canSee) return;
    try {
      setDocs(await api<FiscalDocument[]>(`/fiscal/documents?orderId=${orderId}&limit=10`));
    } catch {
      setDocs([]);
    }
  }, [orderId, canSee]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setTaxDoc(taxDocument ? formatDocument(taxDocument) : '');
  }, [taxDocument]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'fiscal.changed' && e.orderId === orderId) reload();
  }, load);

  if (!canSee || docs === null) return null;
  const doc = docs.find((d) => LIVE.includes(d.status)) ?? docs[0];
  const digits = taxDoc.replace(/\D/g, '');
  const taxError = docError(digits);

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
      await load();
    }
  }

  const emitNfce = () =>
    run(
      'nfce',
      () =>
        api(`/orders/${orderId}/nfce`, {
          method: 'POST',
          json: digits.length === 14 ? { cnpj: digits } : digits ? { cpf: digits } : {},
        }),
      'NFC-e enviada para emissão',
    );
  const openNfe = () =>
    run('nfe', async () => {
      const d = await api<FiscalDocument>(`/orders/${orderId}/nfe`, { method: 'POST', json: {} });
      navigate(`/fiscal/nota/${d.id}`);
    });

  const canRequest = canEmit && paid && !cancelled && (!doc || !LIVE.includes(doc.status));
  const issue = doc && doc.status !== 'authorized' ? doc.issues?.[0] : undefined;
  return (
    <HelpScope dict={PAYMENT_FISCAL_HELP}>
      <div className="fi-order">
        <h3 className="section-title">Nota fiscal</h3>
        {doc ? (
          <div className="fi-order__doc">
            <div className="fi-order__line">
              <StatusBadge status={doc.status} />
              <strong>
                {KIND_LABEL[doc.kind]} {doc.number ? docTitle(doc) : ''}
              </strong>
              {doc.environment === 'homologacao' && <Badge tone="warning">homologação</Badge>}
            </div>
            {(doc.recipient?.cpf || doc.recipient?.cnpj) && (
              <span className="cm-hint">
                {doc.recipient.cpf ? 'CPF' : 'CNPJ'} na nota:{' '}
                {formatDocument(doc.recipient.cpf ?? doc.recipient.cnpj ?? '')}
              </span>
            )}
            {issue ? (
              <Alert tone="danger">
                <strong>{issue.title}.</strong> {issue.detail}
              </Alert>
            ) : (
              doc.status === 'authorized' &&
              doc.sefazMessage && <Alert tone="warning">{doc.sefazMessage}</Alert>
            )}
            <div className="fi-order__actions">
              <Link className="cm-btn cm-btn--secondary" to={`/fiscal/nota/${doc.id}`}>
                {doc.status === 'draft'
                  ? 'Abrir rascunho'
                  : ['rejected', 'error'].includes(doc.status)
                    ? 'Corrigir e reemitir'
                    : 'Abrir nota'}
              </Link>
              {doc.danfeUrl && doc.status === 'authorized' && (
                <a
                  className="cm-btn cm-btn--ghost"
                  href={doc.danfeUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {doc.kind === 'nfe' ? 'DANFE' : 'Cupom'}
                </a>
              )}
              {canEmit && doc.kind === 'nfce' && doc.status === 'authorized' && (
                <Button
                  variant="ghost"
                  loading={busy === 'print'}
                  onClick={() =>
                    run(
                      'print',
                      () => api(`/fiscal/documents/${doc.id}/print`, { method: 'POST' }),
                      'Cupom enviado para a impressora do caixa',
                    )
                  }
                >
                  Imprimir cupom
                </Button>
              )}
              {canEmit && WORKING.includes(doc.status) && (
                <Button
                  variant="ghost"
                  loading={busy === 'sync'}
                  onClick={() =>
                    run(
                      'sync',
                      () => api(`/fiscal/documents/${doc.id}/sync`, { method: 'POST' }),
                      'Consultando a nota',
                    )
                  }
                >
                  Atualizar
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="cm-hint" style={{ margin: 0 }}>
            {paid
              ? 'Nenhuma nota emitida.'
              : 'A nota é emitida depois que o pedido estiver totalmente pago.'}
          </p>
        )}
        {canRequest && (
          <div className="fi-order__emit">
            <TextField
              label="CPF/CNPJ na nota (opcional)"
              inputMode="numeric"
              placeholder="Só se o cliente pedir"
              value={taxDoc}
              maxLength={18}
              onChange={(e) => setTaxDoc(e.target.value)}
              onBlur={() => digits && !taxError && setTaxDoc(formatDocument(digits))}
              error={taxError}
            />
            <div className="fi-order__actions">
              <Button
                variant="secondary"
                loading={busy === 'nfce'}
                disabled={!!taxError || !!busy}
                onClick={emitNfce}
              >
                {doc?.kind === 'nfce' ? 'Emitir NFC-e de novo' : 'Emitir NFC-e'}
              </Button>
              <Button variant="ghost" loading={busy === 'nfe'} disabled={!!busy} onClick={openNfe}>
                Emitir NF-e
              </Button>
            </div>
            <p className="cm-hint" style={{ margin: 0 }}>
              NFC-e é o cupom do consumidor. NF-e é para empresa ou cliente que pede nota com
              endereço e inscrição estadual: abre um rascunho para conferir antes.
            </p>
          </div>
        )}
      </div>
    </HelpScope>
  );
}
