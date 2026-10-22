import { FileText } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth, useCan } from '../app/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { dateTime } from '../features/format';
import { SelectField, Tabs } from '../features/forms';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { FiscalDocument, FiscalSettings, FiscalStatus } from '../lib/types';

export const FISCAL_STATUS: Record<
  FiscalStatus,
  [string, 'neutral' | 'info' | 'success' | 'warning' | 'danger']
> = {
  pending: ['Na fila', 'neutral'],
  processing: ['Processando na SEFAZ', 'info'],
  authorized: ['Autorizada', 'success'],
  rejected: ['Rejeitada', 'danger'],
  error: ['Erro', 'danger'],
  cancelling: ['Cancelando', 'warning'],
  cancelled: ['Cancelada', 'neutral'],
};

/** Nota fiscal ao consumidor (NFC-e) pela Focus NFe: notas emitidas e configuração. */
export function FiscalPage() {
  const canManage = useCan('fiscal:manage');
  const [tab, setTab] = useState<'docs' | 'settings'>('docs');
  return (
    <>
      <div>
        <h1 className="page-title">Nota fiscal</h1>
        <p className="page-sub">NFC-e emitida pela Focus NFe a partir dos pedidos pagos.</p>
      </div>
      {canManage && (
        <Tabs<typeof tab>
          value={tab}
          onChange={setTab}
          items={[
            ['docs', 'Notas emitidas'],
            ['settings', 'Configuração'],
          ]}
        />
      )}
      {tab === 'docs' || !canManage ? <DocumentsTab /> : <SettingsTab />}
    </>
  );
}

function DocumentsTab() {
  const [status, setStatus] = useState<FiscalStatus | ''>('');
  const [docs, setDocs] = useState<FiscalDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setDocs(
        await api<FiscalDocument[]>(
          `/fiscal/documents?limit=100${status ? `&status=${status}` : ''}`,
        ),
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'fiscal.changed') reload();
  }, load);

  return (
    <Card
      title="Notas"
      actions={
        <SelectField
          label="Situação"
          value={status}
          onChange={(e) => setStatus(e.target.value as FiscalStatus | '')}
        >
          <option value="">Todas</option>
          {Object.entries(FISCAL_STATUS).map(([k, [l]]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </SelectField>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {docs === null ? (
        <Spinner />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<FileText size={20} />}
          title="Nenhuma nota"
          description="Emita a NFC-e pelo detalhe de um pedido pago."
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="cm-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Nota</th>
                <th>Situação</th>
                <th>Quando</th>
                <th className="cm-num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>#{d.orderNumber}</td>
                  <td>
                    {d.number ? `${d.number} / série ${d.series}` : '—'}
                    {d.environment === 'homologacao' && (
                      <div>
                        <Badge tone="warning">homologação</Badge>
                      </div>
                    )}
                  </td>
                  <td>
                    <Badge tone={FISCAL_STATUS[d.status][1]}>{FISCAL_STATUS[d.status][0]}</Badge>
                    {(d.sefazMessage || d.lastError) && d.status !== 'authorized' && (
                      <div className="cm-hint">{d.lastError ?? d.sefazMessage}</div>
                    )}
                  </td>
                  <td>{dateTime(d.authorizedAt ?? d.createdAt)}</td>
                  <td className="cm-num">{brl(d.total)}</td>
                  <td className="cm-num">
                    {d.danfeUrl && d.status === 'authorized' && (
                      <a href={d.danfeUrl} target="_blank" rel="noreferrer noopener">
                        DANFE
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SettingsTab() {
  const toast = useToast();
  const { me } = useAuth();
  const isOwner = me?.user.role === 'owner';
  const [s, setS] = useState<FiscalSettings | null>(null);
  const [cnpj, setCnpj] = useState('');
  const [token, setToken] = useState('');
  const [cfop, setCfop] = useState('5102');
  const [code, setCode] = useState('102');
  const [ncm, setNcm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmProd, setConfirmProd] = useState(false);

  const apply = (x: FiscalSettings) => {
    setS(x);
    setCnpj(x.cnpj ?? '');
    setCfop(x.defaultCfop);
    setCode(x.defaultCode);
    setNcm(x.defaultNcm ?? '');
    setToken('');
  };
  useEffect(() => {
    api<FiscalSettings>('/fiscal/settings')
      .then(apply)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function save(json: Record<string, unknown>, ok = 'Configuração salva') {
    setBusy(true);
    try {
      apply(await api<FiscalSettings>('/fiscal/settings', { method: 'PUT', json }));
      toast(ok, 'success');
      setError(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void save({
      cnpj: cnpj.replace(/\D/g, '') || null,
      defaultCfop: cfop,
      defaultCode: code,
      defaultNcm: ncm || null,
      ...(token.trim() ? { token: token.trim() } : {}),
    });
  }

  if (!s) return error ? <Alert tone="danger">{error}</Alert> : <Spinner />;
  const digits = cnpj.replace(/\D/g, '');
  return (
    <>
      <Card
        title="Emissão"
        actions={
          <Badge tone={s.enabled ? 'success' : 'neutral'}>
            {s.enabled ? 'ativa' : 'desativada'}
          </Badge>
        }
      >
        <p style={{ marginTop: 0 }}>
          Ambiente:{' '}
          <strong>
            {s.environment === 'producao' ? 'Produção (com valor fiscal)' : 'Homologação (teste)'}
          </strong>
        </p>
        {!s.keyConfigured && (
          <Alert tone="warning">
            O servidor ainda não tem a chave que protege tokens (INTEGRATIONS_KEY). Peça ao suporte
            para configurá-la antes de salvar o token.
          </Alert>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant={s.enabled ? 'secondary' : 'primary'}
            loading={busy}
            onClick={() =>
              save({ enabled: !s.enabled }, s.enabled ? 'Emissão desativada' : 'Emissão ativada')
            }
          >
            {s.enabled ? 'Desativar emissão' : 'Ativar emissão'}
          </Button>
          {s.environment === 'homologacao' ? (
            <Button variant="ghost" disabled={!isOwner} onClick={() => setConfirmProd(true)}>
              Mudar para produção
            </Button>
          ) : (
            <Button
              variant="ghost"
              loading={busy}
              onClick={() => save({ environment: 'homologacao' })}
            >
              Voltar para homologação
            </Button>
          )}
        </div>
        {!isOwner && s.environment === 'homologacao' && (
          <p className="cm-hint">Só o dono do restaurante muda para produção.</p>
        )}
      </Card>
      <Card title="Dados da Focus NFe e padrões dos produtos">
        <form onSubmit={submit} className="form-grid">
          <TextField
            label="CNPJ do emitente"
            inputMode="numeric"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            error={digits && digits.length !== 14 ? 'CNPJ com 14 dígitos' : undefined}
          />
          <TextField
            label="Token da Focus NFe"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            hint={
              s.hasToken
                ? `Token salvo (final ${s.tokenLast4}). Preencha só para trocar.`
                : 'Token do ambiente escolhido'
            }
          />
          <TextField
            label="CFOP padrão"
            inputMode="numeric"
            maxLength={4}
            value={cfop}
            onChange={(e) => setCfop(e.target.value.replace(/\D/g, ''))}
          />
          <TextField
            label="CSOSN / CST padrão"
            inputMode="numeric"
            maxLength={3}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            hint="Ex.: 102 no Simples Nacional"
          />
          <TextField
            label="NCM padrão"
            inputMode="numeric"
            maxLength={8}
            value={ncm}
            onChange={(e) => setNcm(e.target.value.replace(/\D/g, ''))}
            hint="Usado nos produtos sem NCM"
          />
          <div style={{ alignSelf: 'end' }}>
            <Button type="submit" loading={busy} disabled={!!digits && digits.length !== 14}>
              Salvar
            </Button>
          </div>
        </form>
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="cm-hint">
          Os códigos fiscais dependem do regime do restaurante. Confirme CFOP, CSOSN/CST e NCM com a
          sua contabilidade e teste em homologação antes de ir para produção.
        </p>
      </Card>
      <Modal
        open={confirmProd}
        title="Emitir notas com valor fiscal?"
        onClose={() => setConfirmProd(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmProd(false)}>
              Continuar em homologação
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                if (
                  await save(
                    { environment: 'producao', confirmProduction: true },
                    'Produção ativada',
                  )
                )
                  setConfirmProd(false);
              }}
            >
              Mudar para produção
            </Button>
          </>
        }
      >
        <p>
          Em produção, cada NFC-e autorizada vale perante a SEFAZ e só pode ser cancelada em até 30
          minutos. Use o token de produção da Focus NFe e confirme que as notas de teste saíram
          corretas.
        </p>
      </Modal>
    </>
  );
}
