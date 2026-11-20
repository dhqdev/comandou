import { useState } from 'react';
import { Alert, Button, Card, EmptyState, useToast, Skeleton } from '../../design-system';
import { api } from '../../lib/api';
import { useLoad } from '../OverviewPages';
import { ago, Section, Tag, Tile, type Level } from '../ui';
import { KIND_LABEL, OutboxRow } from './types';

const STATUS: Record<OutboxRow['status'], [string, Level]> = {
  queued: ['Na fila', 'warn'],
  sending: ['Enviando', 'info'],
  sent: ['Enviado', 'ok'],
  failed: ['Falhou', 'bad'],
  cancelled: ['Cancelado', 'off'],
};

const FILTERS: [string, string][] = [
  ['', 'Todos'],
  ['failed', 'Falharam'],
  ['queued', 'Na fila'],
  ['sent', 'Enviados'],
];

/** Tudo o que o sistema mandou (ou tentou), sem o conteúdo, com reenviar e cancelar. */
export function OutboxTab() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const data = useLoad<{ rows: OutboxRow[]; queued: number; failed: number; sentDay: number }>(
    `/platform/mail/outbox${status ? `?status=${status}` : ''}`,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, what: 'retry' | 'cancel') => {
    setBusy(id);
    try {
      const r = await api<{ sent?: boolean; error?: string | null }>(
        `/platform/mail/outbox/${id}/${what}`,
        {
          method: 'POST',
        },
      );
      if (what === 'retry')
        toast(r.sent ? 'Enviado' : `Ainda não saiu: ${r.error}`, r.sent ? 'success' : 'danger');
      else toast('Cancelado', 'success');
      data.reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {data.data && (
        <div className="adm-tiles">
          <Tile label="Enviados em 24 h" value={data.data.sentDay} />
          <Tile label="Na fila" value={data.data.queued} level={data.data.queued ? 'warn' : 'ok'} />
          <Tile
            label="Falharam (7 dias)"
            value={data.data.failed}
            level={data.data.failed ? 'bad' : 'ok'}
          />
        </div>
      )}
      <Section
        title="Envios"
        sub="Boas-vindas, códigos de senha e contratos"
        actions={
          <div className="mail__filters" role="group" aria-label="Filtrar">
            {FILTERS.map(([v, l]) => (
              <Button
                key={v}
                size="sm"
                variant={status === v ? 'secondary' : 'ghost'}
                onClick={() => setStatus(v)}
              >
                {l}
              </Button>
            ))}
          </div>
        }
      >
        {data.error && <Alert tone="danger">{data.error}</Alert>}
        {!data.data ? (
          <Card>
            <Skeleton variant="table" />
          </Card>
        ) : !data.data.rows.length ? (
          <Card>
            <EmptyState
              title="Nenhum envio"
              description="Quando o sistema mandar um e-mail, ele aparece aqui."
            />
          </Card>
        ) : (
          <Card bodyless>
            <div style={{ overflowX: 'auto' }}>
              <table className="cm-table">
                <thead>
                  <tr>
                    <th>O que</th>
                    <th>Para</th>
                    <th>Situação</th>
                    <th>Quando</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.data.rows.map((r) => {
                    const [label, level] = STATUS[r.status];
                    return (
                      <tr key={r.id}>
                        <td>
                          <strong>{KIND_LABEL[r.kind] ?? r.kind}</strong>
                          <div className="cm-hint">{r.subject}</div>
                          {r.tenant && <div className="cm-hint">{r.tenant}</div>}
                        </td>
                        <td>{r.to.map((a) => a.email).join(', ')}</td>
                        <td>
                          <span title={r.lastError ?? undefined}>
                            <Tag level={level}>{label}</Tag>
                          </span>
                          {r.lastError && r.status !== 'sent' && (
                            <div className="cm-hint mail__err">{r.lastError}</div>
                          )}
                          {r.attempts > 1 && <div className="cm-hint">{r.attempts} tentativas</div>}
                        </td>
                        <td>{ago(r.sentAt ?? r.createdAt)}</td>
                        <td>
                          {r.status === 'failed' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy === r.id}
                              onClick={() => act(r.id, 'retry')}
                            >
                              Reenviar
                            </Button>
                          )}
                          {r.status === 'queued' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={busy === r.id}
                              onClick={() => act(r.id, 'cancel')}
                            >
                              Cancelar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>
    </>
  );
}
