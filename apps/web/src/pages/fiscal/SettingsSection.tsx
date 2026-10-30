import { Check, Circle, RefreshCw } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../app/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  HelpLabel,
  HelpTip,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../../design-system';
import { FiscalCompanySetup, fmtCnpj, saveFiscalCompany } from '../../features/FiscalCompanySetup';
import { CheckField, Tabs } from '../../features/forms';
import { api } from '../../lib/api';
import type { FiscalRulesResponse, FiscalSettings } from '../../lib/types';
import { FiscalHead } from './common';

type Tab = 'empresa' | 'nfce' | 'nfe' | 'geral';
type Save = (json: Record<string, unknown>, ok?: string) => Promise<boolean>;

/** "?foco=" da busca global → aba certa. */
function tabFromUrl(): Tab {
  const f = new URLSearchParams(window.location.search).get('foco') ?? '';
  if (f === 'secao-saida') return 'geral';
  return 'empresa';
}

const ENV_LABEL = { homologacao: 'homologação', producao: 'produção' } as const;

/**
 * Configuração da nota fiscal: um resumo do que falta para emitir e quatro abas curtas
 * (empresa e certificado, NFC-e, NF-e e geral).
 */
export function SettingsSection() {
  const toast = useToast();
  const { me } = useAuth();
  const isOwner = me?.user.role === 'owner';
  const [s, setS] = useState<FiscalSettings | null>(null);
  const [hasDefaultRule, setHasDefaultRule] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmProd, setConfirmProd] = useState(false);
  /** Como conectar à Focus: cadastro feito pelo Comandou (managed) ou conta própria (own). */
  const [connect, setConnect] = useState<'managed' | 'own'>('own');

  useEffect(() => {
    api<FiscalSettings>('/fiscal/settings')
      .then((x) => {
        setS(x);
        const ownInUse = x.mode === 'own' && (x.hasHomologToken || x.hasProdToken);
        setConnect(x.managedAvailable && !ownInUse ? 'managed' : 'own');
      })
      .catch((e: Error) => setError(e.message));
    api<FiscalRulesResponse>('/fiscal/rules')
      .then((r) => setHasDefaultRule(r.rules.some((x) => x.isDefault && x.active)))
      .catch(() => setHasDefaultRule(null));
  }, []);

  const save: Save = async (json, ok = 'Configuração salva') => {
    setBusy(true);
    try {
      setS(await api<FiscalSettings>('/fiscal/settings', { method: 'PUT', json }));
      toast(ok, 'success');
      setError(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  async function sync() {
    setSyncing(true);
    try {
      setS(await api<FiscalSettings>('/fiscal/company/sync', { method: 'POST', json: {} }));
      toast('Dados atualizados da Focus NFe', 'success');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  if (!s) return error ? <Alert tone="danger">{error}</Alert> : <Spinner />;
  const managed = connect === 'managed';
  return (
    <div className="fi-page fi-cfg">
      <FiscalHead
        title="Configuração da nota"
        actions={
          s.managedAvailable &&
          s.focusRegistered && (
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} />}
              loading={syncing}
              onClick={sync}
            >
              Sincronizar Focus
            </Button>
          )
        }
      >
        Conexão com a Focus NFe, certificado e como as notas saem.
      </FiscalHead>

      {!s.keyConfigured && (
        <Alert tone="warning">
          O servidor ainda não tem a chave que protege os tokens (INTEGRATIONS_KEY). Peça ao suporte
          antes de salvar.
        </Alert>
      )}

      <StatusCard
        s={s}
        managed={managed}
        hasDefaultRule={hasDefaultRule}
        busy={busy}
        isOwner={isOwner}
        save={save}
        onProd={() => setConfirmProd(true)}
        goTab={setTab}
      />
      {error && <Alert tone="danger">{error}</Alert>}

      <Card bodyless>
        <div className="fi-tabs">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              ['empresa', 'Empresa'],
              ['nfce', 'NFC-e'],
              ['nfe', 'NF-e'],
              ['geral', 'Geral'],
            ]}
          />
        </div>
        <div className="fi-tabbody">
          {tab === 'empresa' && (
            <div data-search-id="secao-focus">
              {s.managedAvailable && <HelpLabel as="span">Como conectar à Focus NFe</HelpLabel>}
              {s.managedAvailable && (
                <div
                  className="fi-connect"
                  role="radiogroup"
                  aria-label="Como conectar à Focus NFe"
                >
                  {(
                    [
                      [
                        'managed',
                        'Cadastro pelo Comandou',
                        'Sem conta na Focus: preencha a empresa e envie o certificado.',
                      ],
                      [
                        'own',
                        'Tenho conta na Focus',
                        'Use os tokens da sua própria conta na Focus NFe.',
                      ],
                    ] as const
                  ).map(([v, label, hint]) => (
                    <label key={v} className="fi-radio" data-on={connect === v || undefined}>
                      <input
                        type="radio"
                        name="fi-connect"
                        checked={connect === v}
                        onChange={() => setConnect(v)}
                      />
                      <span>
                        <strong>{label}</strong>
                        <span className="cm-hint">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {managed ? (
                <FiscalCompanySetup settings={s} onSaved={setS} />
              ) : (
                <OwnTokenForm s={s} busy={busy} save={save} />
              )}
            </div>
          )}
          {tab === 'nfce' && (
            <NfceTab s={s} managed={managed} busy={busy} save={save} onSaved={setS} />
          )}
          {tab === 'nfe' && (
            <NfeTab s={s} managed={managed} busy={busy} save={save} onSaved={setS} />
          )}
          {tab === 'geral' && <GeneralTab s={s} busy={busy} save={save} />}
        </div>
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
          {managed
            ? 'Confira se o CSC de produção foi informado na aba NFC-e e se as notas de teste saíram certas.'
            : 'Confira se o token de produção foi informado e se as notas de teste saíram certas.'}
        </p>
      </Modal>
    </div>
  );
}

/** Topo: ambiente, liga/desliga e o que falta para emitir no ambiente atual. */
function StatusCard({
  s,
  managed,
  hasDefaultRule,
  busy,
  isOwner,
  save,
  onProd,
  goTab,
}: {
  s: FiscalSettings;
  managed: boolean;
  hasDefaultRule: boolean | null;
  busy: boolean;
  isOwner: boolean;
  save: Save;
  onProd(): void;
  goTab(t: Tab): void;
}) {
  const prod = s.environment === 'producao';
  const env = ENV_LABEL[s.environment];
  const steps: { label: string; done: boolean; go?: Tab; to?: string }[] = managed
    ? [
        { label: 'Empresa na Focus', done: s.focusRegistered, go: 'empresa' },
        { label: 'Certificado A1', done: !!s.certificateValidUntil, go: 'empresa' },
        { label: `CSC de ${env}`, done: prod ? s.cscProd : s.cscHomolog, go: 'nfce' },
      ]
    : [
        { label: 'CNPJ', done: !!s.cnpj, go: 'empresa' },
        {
          label: `Token de ${env}`,
          done: prod ? s.hasProdToken : s.hasHomologToken,
          go: 'empresa',
        },
      ];
  // Obrigatórios para ligar; o padrão fiscal é recomendado (sem ele valem os códigos da aba Geral).
  const ready = steps.every((x) => x.done);
  if (hasDefaultRule !== null)
    steps.push({ label: 'Padrão fiscal', done: hasDefaultRule, to: '/fiscal/padroes' });
  steps.push({ label: 'Emissão ligada', done: s.enabled });
  const missing = steps.filter((x) => !x.done).length;

  return (
    <section className="cm-card fi-status" data-search-id="secao-emissao">
      <div className="fi-status__top">
        <div className="fi-status__env">
          <Badge tone={prod ? 'success' : 'warning'}>{prod ? 'Produção' : 'Homologação'}</Badge>
          <span>
            {prod ? 'Notas com valor fiscal.' : 'Notas de teste, sem valor fiscal.'}{' '}
            <strong>
              {missing === 0
                ? 'Tudo pronto para emitir.'
                : `Falta${missing === 1 ? '' : 'm'} ${missing} passo${missing === 1 ? '' : 's'}.`}
            </strong>
          </span>
        </div>
        <div className="fi-status__actions">
          {prod ? (
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              onClick={() => save({ environment: 'homologacao' }, 'Voltou para homologação')}
            >
              Voltar para homologação
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={!isOwner}
              title={isOwner ? undefined : 'Só o dono muda para produção'}
              onClick={onProd}
            >
              Mudar para produção
            </Button>
          )}
          <Button
            size="sm"
            variant={s.enabled ? 'secondary' : 'primary'}
            loading={busy}
            disabled={!s.enabled && !ready}
            title={!s.enabled && !ready ? 'Complete os passos acima' : undefined}
            onClick={() =>
              save({ enabled: !s.enabled }, s.enabled ? 'Emissão desligada' : 'Emissão ligada')
            }
          >
            {s.enabled ? 'Desligar emissão' : 'Ligar emissão'}
          </Button>
        </div>
      </div>
      <ul className="fi-steps" aria-label="O que falta para emitir">
        {steps.map((x) => {
          const body = (
            <>
              {x.done ? <Check size={14} /> : <Circle size={12} />}
              {x.label}
            </>
          );
          return (
            <li key={x.label} data-done={x.done || undefined}>
              {x.done || (!x.go && !x.to) ? (
                <span className="fi-step">{body}</span>
              ) : x.to ? (
                <Link className="fi-step" to={x.to}>
                  {body}
                </Link>
              ) : (
                <button type="button" className="fi-step" onClick={() => goTab(x.go!)}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Conta própria na Focus: CNPJ e um token por ambiente. */
function OwnTokenForm({ s, busy, save }: { s: FiscalSettings; busy: boolean; save: Save }) {
  const [cnpj, setCnpj] = useState(fmtCnpj(s.cnpj ?? ''));
  const [hom, setHom] = useState('');
  const [prod, setProd] = useState('');
  const digits = cnpj.replace(/\D/g, '');
  const saved = (has: boolean) => (has ? 'Salvo. Preencha só para trocar' : undefined);
  return (
    <form
      className="fi-tab"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const ok = await save({
          ...(s.mode !== 'own' ? { mode: 'own' } : {}),
          cnpj: digits || null,
          ...(hom.trim() ? { tokenHomolog: hom.trim() } : {}),
          ...(prod.trim() ? { tokenProd: prod.trim() } : {}),
        });
        if (ok) {
          setHom('');
          setProd('');
        }
      }}
    >
      <div className="fi-fields">
        <TextField
          label="CNPJ do emitente"
          inputMode="numeric"
          value={cnpj}
          onChange={(e) => setCnpj(fmtCnpj(e.target.value))}
          error={digits && digits.length !== 14 ? 'CNPJ com 14 dígitos' : undefined}
          hint="O mesmo cadastrado na Focus"
        />
        <TextField
          label="Token de homologação"
          type="password"
          autoComplete="off"
          value={hom}
          onChange={(e) => setHom(e.target.value)}
          hint={saved(s.hasHomologToken) ?? 'Para notas de teste'}
        />
        <TextField
          label="Token de produção"
          type="password"
          autoComplete="off"
          value={prod}
          onChange={(e) => setProd(e.target.value)}
          hint={saved(s.hasProdToken) ?? 'Para notas que valem'}
        />
      </div>
      <p className="cm-hint fi-note">
        Os tokens ficam no painel da Focus, na sua empresa. O certificado A1, o CSC e a numeração
        você cadastra lá mesmo.
      </p>
      <div className="fi-actions">
        <Button type="submit" loading={busy} disabled={!!digits && digits.length !== 14}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

const onlyDigits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);
const numOrNull = (v: string) => (v ? Number(v) : null);

/** Série e próximo número de produção (para continuar a numeração de outro sistema). */
function useNumbering(s: FiscalSettings, kind: 'nfce' | 'nfe') {
  const n = s.company?.numeracao ?? {};
  const [serie, setSerie] = useState(String(n[`${kind}Serie`] ?? ''));
  const [next, setNext] = useState(String(n[`${kind}Proximo`] ?? ''));
  const dirty =
    serie !== String(n[`${kind}Serie`] ?? '') || next !== String(n[`${kind}Proximo`] ?? '');
  const fields = (
    <>
      <TextField
        label="Série em produção"
        inputMode="numeric"
        value={serie}
        onChange={(e) => setSerie(onlyDigits(e.target.value, 3))}
        hint="Normalmente 1"
      />
      <TextField
        label="Próximo número"
        inputMode="numeric"
        value={next}
        onChange={(e) => setNext(onlyDigits(e.target.value, 9))}
        hint="Só se vier de outro sistema"
      />
    </>
  );
  const numeracao = {
    ...(s.company?.numeracao ?? {}),
    [`${kind}Serie`]: numOrNull(serie),
    [`${kind}Proximo`]: numOrNull(next),
  };
  return { fields, dirty, numeracao };
}

/** Salva natureza (configuração) e, se mudou, CSC/numeração (cadastro na Focus). */
function useTabSave(s: FiscalSettings, save: Save, onSaved: (s: FiscalSettings) => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(
    settings: Record<string, unknown> | null,
    company: Record<string, unknown> | null,
  ) {
    setBusy(true);
    setError(null);
    try {
      if (company) {
        onSaved(await saveFiscalCompany(s, company));
        if (!settings) toast('Salvo na Focus NFe', 'success');
      }
      if (settings) await save(settings);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

function NfceTab({
  s,
  managed,
  busy,
  save,
  onSaved,
}: {
  s: FiscalSettings;
  managed: boolean;
  busy: boolean;
  save: Save;
  onSaved(s: FiscalSettings): void;
}) {
  const [nature, setNature] = useState(s.nfceNature);
  const [homId, setHomId] = useState('');
  const [hom, setHom] = useState('');
  const [prodId, setProdId] = useState('');
  const [prod, setProd] = useState('');
  const num = useNumbering(s, 'nfce');
  const t = useTabSave(s, save, onSaved);
  const pairOk = (id: string, v: string) =>
    (!id && !v) || (/^\d{1,6}$/.test(id) && v.trim().length >= 16);
  const cscOk = pairOk(homId, hom) && pairOk(prodId, prod);
  const cscDirty = !!(homId || hom || prodId || prod);
  const canCompany = managed && s.focusRegistered && !!s.company;
  const dirty = nature !== s.nfceNature || (canCompany && (cscDirty || num.dirty));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const csc: Record<string, unknown> = {};
    if (homId) csc.homologacao = { id: homId, csc: hom.trim() };
    if (prodId) csc.producao = { id: prodId, csc: prod.trim() };
    const company =
      canCompany && (cscDirty || num.dirty)
        ? {
            company: { ...s.company!, numeracao: num.numeracao },
            ...(Object.keys(csc).length ? { csc } : {}),
          }
        : null;
    const ok = await t.run(nature !== s.nfceNature ? { nfceNature: nature } : null, company);
    if (ok) {
      setHomId('');
      setHom('');
      setProdId('');
      setProd('');
    }
  }

  return (
    <form className="fi-tab" onSubmit={submit}>
      <CheckField
        label="Emitir sozinho quando o pedido for pago"
        description="A NFC-e sai ao fechar a conta no caixa, sem clicar. O CPF informado no pagamento entra na nota."
        checked={s.autoEmitNfce}
        disabled={busy}
        onChange={(v) =>
          void save(
            { autoEmitNfce: v },
            v ? 'Emissão automática ligada' : 'Emissão automática desligada',
          )
        }
      />
      <div className="fi-fields">
        <TextField
          label="Natureza da operação"
          wrapClass="fi-w2"
          value={nature}
          maxLength={60}
          onChange={(e) => setNature(e.target.value.toUpperCase())}
          hint="Texto que sai na nota. Ex.: VENDA AO CONSUMIDOR"
        />
      </div>

      {managed ? (
        <>
          <Sub
            title="CSC"
            hint="Código da SEFAZ que gera o QR Code da NFC-e. Cada ambiente tem o seu."
          >
            {!canCompany && (
              <span className="cm-hint">Cadastre a empresa na aba Empresa primeiro.</span>
            )}
          </Sub>
          <div className="fi-fields">
            <TextField
              label="ID do CSC de homologação"
              inputMode="numeric"
              value={homId}
              disabled={!canCompany}
              onChange={(e) => setHomId(onlyDigits(e.target.value, 6))}
              hint={s.cscHomolog ? 'Informado. Preencha só para trocar' : 'Ex.: 1 ou 000001'}
            />
            <TextField
              label="CSC de homologação"
              autoComplete="off"
              value={hom}
              disabled={!canCompany}
              onChange={(e) => setHom(e.target.value)}
              hint="Gerado no site da SEFAZ do estado"
            />
            <TextField
              label="ID do CSC de produção"
              inputMode="numeric"
              value={prodId}
              disabled={!canCompany}
              onChange={(e) => setProdId(onlyDigits(e.target.value, 6))}
              hint={s.cscProd ? 'Informado. Preencha só para trocar' : 'Pode deixar para depois'}
            />
            <TextField
              label="CSC de produção"
              autoComplete="off"
              value={prod}
              disabled={!canCompany}
              onChange={(e) => setProd(e.target.value)}
            />
          </div>
          {!cscOk && (
            <p className="cm-error-text">Preencha o ID e o CSC (16+ caracteres) juntos.</p>
          )}
          <Sub
            title="Numeração"
            hint="A Focus numera sozinha. Mude só para continuar de outro sistema."
          />
          <div className="fi-fields">{canCompany ? num.fields : null}</div>
        </>
      ) : (
        <p className="cm-hint fi-note">
          Com conta própria, o CSC e a numeração ficam no painel da Focus NFe.
        </p>
      )}

      {t.error && <Alert tone="danger">{t.error}</Alert>}
      <div className="fi-actions">
        <Button type="submit" loading={t.busy} disabled={!dirty || !cscOk || !nature.trim()}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

function NfeTab({
  s,
  managed,
  busy,
  save,
  onSaved,
}: {
  s: FiscalSettings;
  managed: boolean;
  busy: boolean;
  save: Save;
  onSaved(s: FiscalSettings): void;
}) {
  const [nature, setNature] = useState(s.nfeNature);
  const num = useNumbering(s, 'nfe');
  const t = useTabSave(s, save, onSaved);
  const canCompany = managed && s.focusRegistered && !!s.company;
  const dirty = nature !== s.nfeNature || (canCompany && num.dirty);
  return (
    <form
      className="fi-tab"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void t.run(
          nature !== s.nfeNature ? { nfeNature: nature } : null,
          canCompany && num.dirty ? { company: { ...s.company!, numeracao: num.numeracao } } : null,
        );
      }}
    >
      <CheckField
        label="Emitir NF-e (modelo 55)"
        description="Nota para empresas ou para quem pede nota com endereço. A empresa precisa estar habilitada na SEFAZ."
        checked={s.nfeEnabled}
        disabled={busy}
        onChange={(v) => void save({ nfeEnabled: v }, v ? 'NF-e ligada' : 'NF-e desligada')}
      />
      <div className="fi-fields">
        <TextField
          label="Natureza da operação"
          wrapClass="fi-w2"
          value={nature}
          maxLength={60}
          onChange={(e) => setNature(e.target.value.toUpperCase())}
          hint="Padrão de cada NF-e. Dá para trocar na hora de emitir"
        />
        {canCompany && num.fields}
      </div>
      <p className="cm-hint fi-note">
        Notas que fornecedores emitem contra o seu CNPJ aparecem em{' '}
        <Link to="/fiscal/recebidas">Notas recebidas</Link>.
      </p>
      {t.error && <Alert tone="danger">{t.error}</Alert>}
      <div className="fi-actions">
        <Button type="submit" loading={t.busy} disabled={!dirty || !nature.trim()}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

/** E-mail, observação e os códigos usados quando não há padrão fiscal. */
function GeneralTab({ s, busy, save }: { s: FiscalSettings; busy: boolean; save: Save }) {
  const [info, setInfo] = useState(s.additionalInfo ?? '');
  const [cfop, setCfop] = useState(s.defaultCfop);
  const [code, setCode] = useState(s.defaultCode);
  const [ncm, setNcm] = useState(s.defaultNcm ?? '');
  const dirty =
    info !== (s.additionalInfo ?? '') ||
    cfop !== s.defaultCfop ||
    code !== s.defaultCode ||
    ncm !== (s.defaultNcm ?? '');
  return (
    <form
      className="fi-tab"
      data-search-id="secao-saida"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void save({
          additionalInfo: info || null,
          defaultCfop: cfop,
          defaultCode: code,
          defaultNcm: ncm || null,
        });
      }}
    >
      <CheckField
        label="Mandar a nota por e-mail ao cliente"
        description="Se o cliente tem e-mail, ele recebe o PDF e o XML quando a nota é autorizada."
        checked={s.emailCustomer}
        disabled={busy}
        onChange={(v) => void save({ emailCustomer: v })}
      />
      <label className="cm-field">
        <HelpLabel as="span">Observação em todas as notas</HelpLabel>
        <textarea
          className="cm-input"
          rows={2}
          maxLength={2000}
          value={info}
          onChange={(e) => setInfo(e.target.value)}
          placeholder="Ex.: Documento emitido por ME ou EPP optante pelo Simples Nacional."
        />
        <span className="cm-hint">Opcional. Sai no rodapé de cada nota</span>
      </label>
      <Sub
        title="Sem padrão fiscal"
        hint="Usados só enquanto não houver nenhum padrão fiscal ativo. Confirme com a contabilidade."
      />
      <div className="fi-fields">
        <TextField
          label="CFOP"
          inputMode="numeric"
          maxLength={4}
          value={cfop}
          onChange={(e) => setCfop(onlyDigits(e.target.value, 4))}
          hint="5102 = venda de mercadoria"
        />
        <TextField
          label="CSOSN / CST"
          inputMode="numeric"
          maxLength={3}
          value={code}
          onChange={(e) => setCode(onlyDigits(e.target.value, 3))}
          hint="102 no Simples Nacional"
        />
        <TextField
          label="NCM padrão"
          inputMode="numeric"
          maxLength={8}
          value={ncm}
          onChange={(e) => setNcm(onlyDigits(e.target.value, 8))}
          hint="Para itens sem NCM"
        />
      </div>
      <div className="fi-actions">
        <Button
          type="submit"
          loading={busy}
          disabled={!dirty || cfop.length !== 4 || code.length < 2 || (!!ncm && ncm.length !== 8)}
        >
          Salvar
        </Button>
      </div>
    </form>
  );
}

/** Subtítulo de seção dentro da aba, com a explicação numa linha. */
function Sub({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="fi-subwrap">
      <h3 className="fi-sub cm-sec-help">
        {title} <HelpTip label={title} />
      </h3>
      {hint && <p className="cm-hint">{hint}</p>}
      {children}
    </div>
  );
}
