import { useCallback, useEffect, useState } from 'react';
import { useCan } from '../app/auth';
import { Alert, Badge, Button, TextField, useToast } from '../design-system';
import { FISCAL_STATUS } from '../pages/FiscalPage';
import { api } from '../lib/api';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { FiscalDocument } from '../lib/types';

const LIVE = ['pending', 'processing', 'authorized', 'cancelling'];

/**
 * NFC-e do pedido no detalhe do pedido. O status mostrado é sempre o que o servidor confirmou:
 * o evento em tempo real só dispara uma nova consulta.
 */
export function FiscalSection({
  orderId,
  paid,
  cancelled,
}: {
  orderId: string;
  paid: boolean;
  cancelled: boolean;
}) {
  const toast = useToast();
  const canEmit = useCan('fiscal:emit');
  const canSee = useCan('fiscal:manage') || canEmit;
  const [docs, setDocs] = useState<FiscalDocument[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

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
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'fiscal.changed' && e.orderId === orderId) reload();
  }, load);

  if (!canSee || docs === null) return null;
  const doc = docs.find((d) => LIVE.includes(d.status)) ?? docs[0];

  async function call(url: string, json: object | undefined, ok: string) {
    setBusy(true);
    try {
      await api(url, { method: 'POST', json });
      toast(ok, 'success');
      setCancelling(false);
      setReason('');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
      await load();
    }
  }

  const canRequest = canEmit && paid && !cancelled && (!doc || !LIVE.includes(doc.status));
  return (
    <div>
      <h3 className="section-title">Nota fiscal (NFC-e)</h3>
      {doc ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone={FISCAL_STATUS[doc.status][1]}>{FISCAL_STATUS[doc.status][0]}</Badge>
            {doc.environment === 'homologacao' && <Badge tone="warning">homologação</Badge>}
            {doc.number && (
              <span>
                Nº {doc.number} · série {doc.series}
              </span>
            )}
            {doc.danfeUrl && doc.status === 'authorized' && (
              <a href={doc.danfeUrl} target="_blank" rel="noreferrer noopener">
                Abrir DANFE
              </a>
            )}
          </div>
          {doc.accessKey && <span className="mono-break">{doc.accessKey}</span>}
          {(doc.lastError || (doc.status !== 'authorized' && doc.sefazMessage)) && (
            <Alert tone={doc.status === 'authorized' ? 'warning' : 'danger'}>
              {doc.lastError ?? doc.sefazMessage}
            </Alert>
          )}
          {canEmit && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['pending', 'processing', 'cancelling'].includes(doc.status) && (
                <Button
                  variant="ghost"
                  loading={busy}
                  onClick={() =>
                    call(`/fiscal/documents/${doc.id}/sync`, undefined, 'Consultando a nota')
                  }
                >
                  Atualizar
                </Button>
              )}
              {doc.status === 'authorized' && !cancelling && (
                <Button variant="ghost" onClick={() => setCancelling(true)}>
                  Cancelar nota
                </Button>
              )}
            </div>
          )}
          {cancelling && (
            <div style={{ display: 'grid', gap: 8 }}>
              <TextField
                label="Justificativa do cancelamento"
                value={reason}
                maxLength={255}
                onChange={(e) => setReason(e.target.value)}
                hint="Mínimo de 15 caracteres. A SEFAZ aceita cancelar até 30 minutos após a autorização."
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="ghost" onClick={() => setCancelling(false)}>
                  Voltar
                </Button>
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={reason.trim().length < 15}
                  onClick={() =>
                    call(
                      `/fiscal/documents/${doc.id}/cancel`,
                      { reason: reason.trim() },
                      'Nota cancelada',
                    )
                  }
                >
                  Cancelar NFC-e
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="pm-hint" style={{ margin: 0 }}>
          {paid
            ? 'Nenhuma nota emitida.'
            : 'A nota é emitida depois que o pedido estiver totalmente pago.'}
        </p>
      )}
      {canRequest && (
        <Button
          variant="secondary"
          loading={busy}
          style={{ marginTop: 8 }}
          onClick={() => call(`/orders/${orderId}/nfce`, undefined, 'NFC-e enviada para emissão')}
        >
          {doc ? 'Emitir nova NFC-e' : 'Emitir NFC-e'}
        </Button>
      )}
    </div>
  );
}
