import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../../app/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../../design-system';
import { FiscalCompanySetup } from '../../features/FiscalCompanySetup';
import { CheckField } from '../../features/forms';
import { api } from '../../lib/api';
import type { FiscalSettings } from '../../lib/types';
import { FiscalHead } from './common';

/** Configuração da emissão: ambiente, conta na Focus, cadastro da empresa e como as notas saem. */
export function SettingsSection() {
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
  /** Token próprio da Focus (true) ou cadastro guiado pelo Comandou (false, modo revenda). */
  const [ownToken, setOwnToken] = useState(false);

  const apply = (x: FiscalSettings, first = false) => {
    setS(x);
    if (first) setOwnToken(!x.managedAvailable || (x.mode === 'own' && x.hasToken));
    setCnpj(x.cnpj ?? '');
    setCfop(x.defaultCfop);
    setCode(x.defaultCode);
    setNcm(x.defaultNcm ?? '');
    setToken('');
  };
  useEffect(() => {
    api<FiscalSettings>('/fiscal/settings')
      .then((x) => apply(x, true))
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
    const defaults = { defaultCfop: cfop, defaultCode: code, defaultNcm: ncm || null };
    void save(
      ownToken
        ? {
            ...defaults,
            ...(s?.mode !== 'own' ? { mode: 'own' } : {}),
            cnpj: cnpj.replace(/\D/g, '') || null,
            ...(token.trim() ? { token: token.trim() } : {}),
          }
        : { ...defaults, ...(s?.mode !== 'managed' ? { mode: 'managed' } : {}) },
    );
  }

  if (!s) return error ? <Alert tone="danger">{error}</Alert> : <Spinner />;
  const digits = cnpj.replace(/\D/g, '');
  return (
    <div className="fi-page">
      <FiscalHead title="Configuração">
        Ambiente, conta na Focus NFe, cadastro da empresa e como as notas saem.
      </FiscalHead>
      <Card
        searchId="secao-emissao"
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
      <OutputCard s={s} busy={busy} save={save} />
      {!ownToken && <FiscalCompanySetup settings={s} onSaved={(x) => apply(x)} />}
      {s.managedAvailable && (
        <p className="cm-hint" style={{ margin: 0 }}>
          {ownToken ? 'Não tem conta na Focus NFe? ' : 'Já tem conta própria na Focus NFe? '}
          <button type="button" className="cm-linklike" onClick={() => setOwnToken(!ownToken)}>
            {ownToken ? 'Use o cadastro guiado do Comandou' : 'Use o seu próprio token'}
          </button>
          {s.mode !== (ownToken ? 'own' : 'managed') && ' (salve abaixo para trocar)'}
        </p>
      )}
      <Card
        searchId="secao-focus"
        title={ownToken ? 'Dados da Focus NFe e códigos de reserva' : 'Códigos de reserva'}
      >
        <form onSubmit={submit} className="form-grid">
          {ownToken && (
            <>
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
            </>
          )}
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
            <Button
              type="submit"
              loading={busy}
              disabled={ownToken && !!digits && digits.length !== 14}
            >
              Salvar
            </Button>
          </div>
        </form>
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="cm-hint">
          Usados só enquanto não houver nenhum padrão fiscal ativo (Fiscal → Padrões fiscais). O NCM
          padrão vale para os produtos sem NCM. Confirme os códigos com a sua contabilidade e teste
          em homologação antes de ir para produção.
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
          Em produção, cada nota autorizada vale perante a SEFAZ. A NFC-e só pode ser cancelada em
          até 30 minutos e a NF-e em até 24 horas.{' '}
          {s.mode === 'managed'
            ? 'Confira se o CSC de produção foi informado no cadastro da empresa e se as notas de teste saíram corretas.'
            : 'Use o token de produção da Focus NFe e confirme que as notas de teste saíram corretas.'}
        </p>
      </Modal>
    </div>
  );
}

/** Como as notas saem: tipos ligados, natureza da operação, observação, automático e e-mail. */
function OutputCard({
  s,
  busy,
  save,
}: {
  s: FiscalSettings;
  busy: boolean;
  save(json: Record<string, unknown>, ok?: string): Promise<boolean>;
}) {
  const [nfceNature, setNfceNature] = useState(s.nfceNature);
  const [nfeNature, setNfeNature] = useState(s.nfeNature);
  const [info, setInfo] = useState(s.additionalInfo ?? '');
  useEffect(() => {
    setNfceNature(s.nfceNature);
    setNfeNature(s.nfeNature);
    setInfo(s.additionalInfo ?? '');
  }, [s.nfceNature, s.nfeNature, s.additionalInfo]);
  const dirty =
    nfceNature !== s.nfceNature || nfeNature !== s.nfeNature || info !== (s.additionalInfo ?? '');
  return (
    <Card searchId="secao-saida" title="Como as notas saem">
      <div className="fi-checks">
        <CheckField
          label="Emitir a NFC-e sozinho quando o pedido for pago"
          description="Ao quitar o pedido no caixa, a NFC-e vai para a fila sem ninguém clicar. Se o cliente informou CPF no pagamento, ele entra na nota."
          checked={s.autoEmitNfce}
          disabled={busy}
          onChange={(v) =>
            void save(
              { autoEmitNfce: v },
              v ? 'Emissão automática ligada' : 'Emissão automática desligada',
            )
          }
        />
        <CheckField
          label="Emitir NF-e (modelo 55)"
          description="Para vender a empresas ou a quem pede nota com endereço e inscrição estadual. A empresa precisa estar habilitada para NF-e na SEFAZ do estado."
          checked={s.nfeEnabled}
          disabled={busy}
          onChange={(v) => void save({ nfeEnabled: v }, v ? 'NF-e ligada' : 'NF-e desligada')}
        />
        <CheckField
          label="Mandar a nota por e-mail ao cliente"
          description="Quando o destinatário tem e-mail, ele recebe o PDF e o XML assim que a nota é autorizada."
          checked={s.emailCustomer}
          disabled={busy}
          onChange={(v) => void save({ emailCustomer: v })}
        />
      </div>
      <form
        className="form-grid"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save({ nfceNature, nfeNature, additionalInfo: info || null });
        }}
      >
        <TextField
          label="Natureza da operação na NFC-e"
          value={nfceNature}
          maxLength={60}
          onChange={(e) => setNfceNature(e.target.value.toUpperCase())}
        />
        <TextField
          label="Natureza da operação na NF-e"
          value={nfeNature}
          maxLength={60}
          onChange={(e) => setNfeNature(e.target.value.toUpperCase())}
          hint="Pode ser trocada em cada NF-e"
        />
        <label className="cm-field fi-textarea">
          <span className="cm-label">Observação em todas as notas (opcional)</span>
          <textarea
            className="cm-input"
            rows={3}
            maxLength={2000}
            value={info}
            onChange={(e) => setInfo(e.target.value)}
            placeholder="Ex.: Documento emitido por ME ou EPP optante pelo Simples Nacional."
          />
        </label>
        <div style={{ alignSelf: 'end' }}>
          <Button
            type="submit"
            loading={busy}
            disabled={!dirty || !nfceNature.trim() || !nfeNature.trim()}
          >
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
