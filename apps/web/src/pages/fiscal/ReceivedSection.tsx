import { Inbox, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useCan } from '../../app/auth';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
  HelpScope,
} from '../../design-system';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import type { FiscalReceived } from '../../lib/types';
import { FiscalHead, fmtDateTime, fmtDoc } from './common';
import { RECEIVED_HELP } from '../../features/help/fiscal-help';

type Manifest = NonNullable<FiscalReceived['manifestation']>;
const MANIFEST: Record<Manifest, [string, 'info' | 'success' | 'danger' | 'warning']> = {
  ciencia: ['Ciência', 'info'],
  confirmacao: ['Confirmada', 'success'],
  desconhecimento: ['Desconhecida', 'danger'],
  nao_realizada: ['Não realizada', 'warning'],
};
const ACTIONS: [Manifest, string, string][] = [
  ['ciencia', 'Dar ciência', 'Avisa que você viu a nota. Libera o XML completo para baixar.'],
  ['confirmacao', 'Confirmar a compra', 'A mercadoria chegou como descrito. Encerra a nota.'],
  ['desconhecimento', 'Não reconheço', 'Você não fez esta compra. Use se a nota não é sua.'],
  [
    'nao_realizada',
    'Compra não realizada',
    'A compra foi combinada, mas não aconteceu (ex.: devolvida na entrega).',
  ],
];

/** NF-e de fornecedores emitidas contra o CNPJ do restaurante, com a manifestação do destinatário. */
export function ReceivedSection() {
  const toast = useToast();
  const canManage = useCan('fiscal:manage');
  const [data, setData] = useState<{ rows: FiscalReceived[]; syncedAt: string | null } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<FiscalReceived | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api('/fiscal/received'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setBusy(true);
    try {
      const r = await api<{ fetched: number }>('/fiscal/received/sync', { method: 'POST' });
      toast(r.fetched ? `${r.fetched} notas novas ou atualizadas` : 'Nenhuma nota nova', 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.rows ?? [];
  const pending = rows.filter((r) => !r.manifestation && r.situation === 'autorizada').length;
  return (
    <div className="fi-page">
      <FiscalHead
        title="Notas recebidas"
        error={error}
        actions={
          canManage && (
            <Button
              variant="secondary"
              icon={<RefreshCw size={16} />}
              loading={busy}
              onClick={sync}
            >
              Buscar notas novas
            </Button>
          )
        }
      >
        NF-e que fornecedores emitiram para o seu CNPJ. Dê ciência para baixar o XML e confirme a
        compra quando a mercadoria chegar.
        {data?.syncedAt && <> Última busca: {fmtDateTime(data.syncedAt)}.</>}
      </FiscalHead>
      <Card bodyless>
        {data === null ? (
          <div className="cm-card__body">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Inbox size={20} />}
            title="Nenhuma nota recebida"
            description='Clique em "Buscar notas novas". A SEFAZ libera as notas algumas horas depois da emissão.'
          />
        ) : (
          <>
            {pending > 0 && (
              <p className="cm-hint fi-pad">
                {pending} {pending === 1 ? 'nota sem manifestação' : 'notas sem manifestação'}. O
                prazo para confirmar é de 180 dias.
              </p>
            )}
            <div className="fi-table-wrap">
              <table className="cm-table fi-table">
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th>Emitida</th>
                    <th>Situação</th>
                    <th className="cm-num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="fi-row"
                      tabIndex={0}
                      onClick={() => setOpen(r)}
                      onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}
                    >
                      <td>
                        <strong>{r.issuerName ?? 'Fornecedor'}</strong>
                        <div className="cm-hint">{fmtDoc(r.issuerDocument)}</div>
                      </td>
                      <td>{fmtDateTime(r.issuedAt)}</td>
                      <td>
                        <div className="fi-badges">
                          {r.situation !== 'autorizada' && (
                            <Badge tone="danger">
                              {r.situation === 'cancelada' ? 'Cancelada' : 'Denegada'}
                            </Badge>
                          )}
                          {r.manifestation ? (
                            <Badge tone={MANIFEST[r.manifestation][1]}>
                              {MANIFEST[r.manifestation][0]}
                            </Badge>
                          ) : (
                            r.situation === 'autorizada' && (
                              <Badge tone="warning">Sem manifestação</Badge>
                            )
                          )}
                        </div>
                      </td>
                      <td className="cm-num">{r.total ? brl(r.total) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      {open && (
        <ReceivedModal
          note={open}
          canManage={canManage}
          onClose={() => setOpen(null)}
          onChanged={async () => {
            setOpen(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function ReceivedModal({
  note,
  canManage,
  onClose,
  onChanged,
}: {
  note: FiscalReceived;
  canManage: boolean;
  onClose(): void;
  onChanged(): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<Manifest | null>(null);
  const [asking, setAsking] = useState<Manifest | null>(null);
  const [reason, setReason] = useState('');
  const file = (ext: 'pdf' | 'xml') => `/api/v1/fiscal/received/${note.id}/file?ext=${ext}`;

  async function manifest(tipo: Manifest) {
    setBusy(tipo);
    try {
      await api(`/fiscal/received/${note.id}/manifest`, {
        method: 'POST',
        json: { tipo, reason: tipo === 'nao_realizada' ? reason.trim() : null },
      });
      toast('Manifestação enviada', 'success');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  const final = note.manifestation && note.manifestation !== 'ciencia';
  return (
    <HelpScope dict={RECEIVED_HELP}>
      <Modal open size="lg" title={note.issuerName ?? 'Nota recebida'} onClose={onClose}>
        <div className="fi-form">
          <div className="fi-kv">
            <span>CNPJ</span>
            <strong>{fmtDoc(note.issuerDocument)}</strong>
          </div>
          <div className="fi-kv">
            <span>Emitida em</span>
            <strong>{fmtDateTime(note.issuedAt)}</strong>
          </div>
          <div className="fi-kv">
            <span>Valor</span>
            <strong>{note.total ? brl(note.total) : '—'}</strong>
          </div>
          <div className="fi-kv">
            <span>Chave</span>
            <strong className="mono-break">{note.accessKey}</strong>
          </div>
          {note.manifestation && (
            <div className="fi-kv">
              <span>Manifestação</span>
              <strong>
                {MANIFEST[note.manifestation][0]} · {fmtDateTime(note.manifestedAt)}
              </strong>
            </div>
          )}
          {note.cancelReason && (
            <p className="cm-hint">Cancelada pelo fornecedor: {note.cancelReason}</p>
          )}
          {note.correctionText && (
            <p className="cm-hint">Carta de correção: {note.correctionText}</p>
          )}
          <div className="fi-head__actions">
            <a
              className="cm-btn cm-btn--secondary"
              href={file('pdf')}
              target="_blank"
              rel="noreferrer noopener"
            >
              DANFE (PDF)
            </a>
            <a
              className="cm-btn cm-btn--ghost"
              href={file('xml')}
              target="_blank"
              rel="noreferrer noopener"
            >
              XML
            </a>
          </div>
          {canManage && note.situation === 'autorizada' && !final && (
            <section>
              <h2 className="fi-section-title">Manifestar</h2>
              <div className="fi-manifest">
                {ACTIONS.filter(([t]) => t !== note.manifestation).map(([tipo, label, help]) => (
                  <div key={tipo} className="fi-manifest__item">
                    <div>
                      <strong>{label}</strong>
                      <p className="cm-hint">{help}</p>
                    </div>
                    <Button
                      variant={tipo === 'desconhecimento' ? 'danger' : 'secondary'}
                      size="sm"
                      loading={busy === tipo}
                      disabled={!!busy}
                      onClick={() =>
                        tipo === 'nao_realizada' ? setAsking(tipo) : void manifest(tipo)
                      }
                    >
                      {label}
                    </Button>
                  </div>
                ))}
              </div>
              {asking === 'nao_realizada' && (
                <div className="fi-form">
                  <TextField
                    label="Justificativa"
                    value={reason}
                    maxLength={255}
                    onChange={(e) => setReason(e.target.value)}
                    hint="Mínimo de 15 caracteres"
                  />
                  <Button
                    loading={busy === 'nao_realizada'}
                    disabled={reason.trim().length < 15}
                    onClick={() => void manifest('nao_realizada')}
                  >
                    Enviar
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      </Modal>
    </HelpScope>
  );
}
