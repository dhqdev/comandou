import { FileText, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button, Card, EmptyState, Skeleton } from '../../design-system';
import {
  fold,
  ListTable,
  ListToolbar,
  useListView,
  type ListField,
  type ListSort,
  type ListTab,
} from '../../features/list-view';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useDebounced, useRealtime } from '../../lib/realtime';
import type { FiscalDocument, FiscalKind } from '../../lib/types';
import {
  CHANNEL_LABEL,
  docTitle,
  FiscalHead,
  FISCAL_STATUS,
  fmtDateTime,
  StatusBadge,
} from './common';

const SORTS: ListSort<FiscalDocument>[] = [
  { key: 'when', label: 'Quando', get: (d) => d.authorizedAt ?? d.createdAt },
  { key: 'number', label: 'Número', get: (d) => Number(d.number ?? 0) },
  { key: 'total', label: 'Valor', get: (d) => Number(d.total) },
];

/** Lista de NFC-e ou de NF-e, no estilo do caixa: filtro por situação, período e busca. */
export function DocumentsList({ kind }: { kind: FiscalKind }) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<FiscalDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setDocs(await api<FiscalDocument[]>(`/fiscal/documents?kind=${kind}&limit=1000`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [kind]);
  useEffect(() => {
    setDocs(null);
    void load();
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'fiscal.changed') reload();
  }, load);

  const fields = useMemo<ListField<FiscalDocument>[]>(
    () => [
      {
        key: 'status',
        label: 'Situação',
        value: (d) => d.status,
        options: Object.entries(FISCAL_STATUS)
          .filter(([k]) => k !== 'discarded' && (kind === 'nfe' || k !== 'draft'))
          .map(([value, [label]]) => ({ value, label })),
        pinned: true,
      },
      {
        key: 'when',
        label: 'Período',
        kind: 'date',
        // A mesma data da coluna "Quando" (emissão; sem emissão, criação).
        date: (d) => d.authorizedAt ?? d.createdAt,
        dateNote: 'A data é a da emissão (ou da criação, se a nota não saiu).',
        pinned: true,
      },
      {
        key: 'channel',
        label: 'Venda',
        value: (d) => d.orderChannel,
        options: Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label })),
      },
      {
        key: 'env',
        label: 'Ambiente',
        value: (d) => d.environment,
        options: [
          { value: 'producao', label: 'Produção' },
          { value: 'homologacao', label: 'Homologação (teste)' },
        ],
      },
    ],
    [kind],
  );
  const tabs = useMemo<ListTab[]>(
    () => [
      { id: 'all', label: 'Todas', filters: {} as Record<string, string[]> },
      { id: 'ok', label: 'Emitidas', filters: { status: ['authorized'] } },
      { id: 'err', label: 'Com erro', filters: { status: ['error', 'rejected'] } },
      ...(kind === 'nfe'
        ? [{ id: 'draft', label: 'Rascunhos', filters: { status: ['draft'] } }]
        : []),
      { id: 'cancel', label: 'Canceladas', filters: { status: ['cancelled', 'cancelling'] } },
    ],
    [kind],
  );
  const lv = useListView({
    id: `fiscal-${kind}`,
    rows: docs,
    fields,
    tabs,
    search: (d) =>
      fold(
        `${d.number ?? ''} ${d.accessKey ?? ''} ${d.orderNumber} ${d.recipientName ?? ''} ${d.recipient?.cpf ?? ''} ${d.recipient?.cnpj ?? ''}`,
      ),
    sorts: SORTS,
  });
  const shown = lv.visible ?? [];
  const label = kind === 'nfe' ? 'NF-e' : 'NFC-e';

  return (
    <div className="fi-page">
      <FiscalHead
        title={label}
        error={error}
        actions={
          <Button variant="ghost" icon={<RefreshCw size={16} />} onClick={() => void load()}>
            Atualizar
          </Button>
        }
      >
        {kind === 'nfe'
          ? 'Nota fiscal de produto (modelo 55), com o cliente identificado: CNPJ, endereço e inscrição estadual. Abra pelo detalhe de um pedido pago (botão "NF-e"), confira o rascunho e emita.'
          : 'Cupom fiscal do consumidor (modelo 65), emitido a partir dos pedidos pagos. Recusou? Abra a nota, veja o motivo em palavras simples, corrija e reemita.'}
      </FiscalHead>
      <Card bodyless>
        <ListToolbar
          lv={lv}
          searchLabel={`Buscar ${label}`}
          searchHint="número, chave, pedido ou cliente"
          summary={`${shown.length} ${shown.length === 1 ? 'nota' : 'notas'}`}
        />
        {docs === null ? (
          <div className="cm-card__body">
            <Skeleton variant="table" />
          </div>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={<FileText size={20} />}
            title={`Nenhuma ${label} ainda`}
            description={
              kind === 'nfe'
                ? 'No detalhe de um pedido pago, use "Emitir NF-e" para abrir o rascunho.'
                : 'No detalhe de um pedido pago, use "Emitir NFC-e". Ou ligue a emissão automática em Configuração.'
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Search size={20} />}
            title="Nada por aqui"
            description="Nenhuma nota com esses filtros."
          />
        ) : (
          <ListTable>
            <table className="cm-table lv-table fi-table">
              <thead>
                <tr>
                  <th>Nota</th>
                  <th>Situação</th>
                  <th>Quando</th>
                  <th>Venda</th>
                  <th>Cliente</th>
                  <th className="cm-num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr
                    key={d.id}
                    className="fi-row"
                    tabIndex={0}
                    onClick={() => navigate(`/fiscal/nota/${d.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/fiscal/nota/${d.id}`);
                    }}
                  >
                    <td>
                      <strong>{docTitle(d)}</strong>
                      {d.environment === 'homologacao' && (
                        <div>
                          <Badge tone="warning">homologação</Badge>
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={d.status} />
                      {d.status === 'authorized' && d.contingency && !d.contingencySettledAt && (
                        <div>
                          <Badge tone="warning">contingência pendente</Badge>
                        </div>
                      )}
                      {d.issues[0] && d.status !== 'authorized' && (
                        <div className="cm-hint fi-row__why">{d.issues[0].title}</div>
                      )}
                    </td>
                    <td>{fmtDateTime(d.authorizedAt ?? d.createdAt)}</td>
                    <td>
                      {CHANNEL_LABEL[d.orderChannel] ?? d.orderChannel}
                      <span className="cm-hint"> · #{d.orderNumber}</span>
                    </td>
                    <td>{d.recipientName ?? <span className="cm-hint">Consumidor</span>}</td>
                    <td className="cm-num">{brl(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListTable>
        )}
      </Card>
    </div>
  );
}
