import { CheckCircle2, XCircle } from 'lucide-react';
import { customOdId } from '@comandou/shared';
import { FormEvent, ReactNode, useState } from 'react';
import { Alert, Button, Spinner, TextField, useToast } from '../../design-system';
import { SelectField } from '../../features/forms';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import type { AiOverview } from '../AiPage';
import { useLoad } from '../OverviewPages';
import type { PipelineSettings } from '../TicketsBoard';
import type { BackupSettings, BackupTestResult } from '../types';

/**
 * Formulários de Super Admin › Credenciais. Cada um carrega a configuração da sua tela e salva
 * pelo mesmo endereço dela, mandando os valores atuais de volta junto com a chave nova (os
 * outros ajustes continuam na tela de cada assunto).
 */

const SAVED = '•••••••• (salva)';

function useBusy() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(key: string, fn: () => Promise<T>, ok?: string | ((r: T) => string)) {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (ok) toast(typeof ok === 'string' ? ok : ok(r), 'success');
      return r;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run, setError };
}

function Loading<T>({
  load,
  children,
}: {
  load: { data: T | null; error: string | null };
  children(d: T): ReactNode;
}) {
  if (load.error) return <Alert tone="danger">{load.error}</Alert>;
  if (!load.data) return <Spinner />;
  return <>{children(load.data)}</>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="adm-form-actions adm-cred__actions">{children}</div>;
}

function Result({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <Alert tone={ok ? 'info' : 'danger'}>{children}</Alert>;
}

function NoKey({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Alert tone="danger">
      O servidor está sem a chave mestra (INTEGRATIONS_KEY): não dá para guardar chaves com
      segurança. Veja “Chave mestra” mais abaixo.
    </Alert>
  );
}

// ------------------------------------------------------------------ Focus NFe

export interface FocusState {
  saved: boolean;
  fromServer: boolean;
  last4: string | null;
  updatedAt: string | null;
}

export function FocusEditor({
  focus,
  keyConfigured,
  onSaved,
}: {
  focus: FocusState;
  keyConfigured: boolean;
  onSaved(): void;
}) {
  const [token, setToken] = useState('');
  const [test, setTest] = useState<{ ok: boolean; companies?: number | null; error?: string }>();
  const { busy, error, run } = useBusy();
  const has = focus.saved || focus.fromServer;

  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await run(
      'save',
      () => api('/platform/credentials/focus-master', { method: 'PUT', json: { token } }),
      'Token da Focus salvo',
    );
    if (r) {
      setToken('');
      setTest(undefined);
      onSaved();
    }
  }

  return (
    <form className="adm-cred__form" onSubmit={save}>
      <NoKey show={!keyConfigured} />
      {focus.fromServer && (
        <Alert tone="info">
          Hoje o token vem da variável FOCUS_NFE_MASTER_TOKEN do servidor. Salve aqui para cuidar
          dele por este painel (o salvo aqui vale no lugar da variável).
        </Alert>
      )}
      <div className="adm-backup-grid">
        <TextField
          label={has ? 'Trocar o Token Master' : 'Token Master'}
          type="password"
          autoComplete="new-password"
          value={token}
          placeholder={focus.saved ? `•••••••• termina em ${focus.last4}` : 'Cole o Token Master'}
          onChange={(e) => setToken(e.target.value.trim())}
          hint="Focus NFe › Painel API › Tokens › Token Master."
        />
      </div>
      {test && (
        <Result ok={test.ok}>
          {test.ok
            ? `A Focus aceitou o token${test.companies != null ? ` · ${test.companies} empresa(s) na conta` : ''}.`
            : `Não funcionou: ${test.error}`}
        </Result>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Actions>
        {focus.saved && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={busy === 'remove'}
            disabled={!!busy}
            onClick={async () => {
              if (
                await run(
                  'remove',
                  () => api('/platform/credentials/focus-master/remove', { method: 'POST' }),
                  'Token da Focus apagado',
                )
              )
                onSaved();
            }}
          >
            Apagar
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy === 'test'}
          disabled={!!busy || (!token && !has)}
          onClick={async () => {
            const r = await run('test', () =>
              api<{ ok: boolean; companies?: number | null; error?: string }>(
                '/platform/credentials/focus-master/test',
                { method: 'POST', json: { token: token || undefined } },
              ),
            );
            if (r) setTest(r);
          }}
        >
          Testar
        </Button>
        <Button type="submit" size="sm" loading={busy === 'save'} disabled={!!busy || !token}>
          Salvar
        </Button>
      </Actions>
    </form>
  );
}

// ------------------------------------------------------------------ OpenRouter

interface AiTest {
  ok: boolean;
  error?: string;
  ms: number;
  usage?: { promptTokens: number; completionTokens: number };
  credits?: { totalUsd: number | null; remainingUsd: number | null };
}

const money = (n: number | null | undefined) =>
  n == null
    ? '—'
    : `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const aiBody = (s: AiOverview['settings']) => ({
  enabled: s.enabled,
  model: s.model,
  assistantName: s.assistantName,
  defaultMonthlyTokens: s.defaultMonthlyTokens,
  lowBalanceUsd: s.lowBalanceUsd,
});

/**
 * Uma das chaves do OpenRouter guardadas em Super Admin › Tokens: a dos restaurantes, a sua e a
 * de gerenciamento (só lê o saldo da conta).
 */
export function OpenRouterEditor({
  kind,
  onSaved,
}: {
  kind: 'owner' | 'clients' | 'admin';
  onSaved(): void;
}) {
  const load = useLoad<AiOverview>('/platform/ai');
  return (
    <Loading load={load}>
      {(o) => (
        <OpenRouterForm
          kind={kind}
          o={o}
          onSaved={(n) => {
            load.setData(n);
            onSaved();
          }}
        />
      )}
    </Loading>
  );
}

function OpenRouterForm({
  kind,
  o,
  onSaved,
}: {
  kind: 'owner' | 'clients' | 'admin';
  o: AiOverview;
  onSaved(n: AiOverview): void;
}) {
  const s = o.settings;
  const owner = kind === 'owner';
  const admin = kind === 'admin';
  const has = admin ? s.hasAdminKey : owner ? s.hasOwnerKey : s.hasApiKey;
  const readable = admin ? s.adminKeyReadable : owner ? s.ownerKeyReadable : s.keyReadable;
  const acc = admin ? null : owner ? o.ownerAccount : o.account;
  const accError = admin ? o.balance.error : acc?.error;
  const [value, setValue] = useState('');
  const [test, setTest] = useState<AiTest | null>(null);
  const { busy, error, run } = useBusy();

  async function save(extra: Record<string, unknown>, what: 'save' | 'clear') {
    const n = await run(
      what,
      () =>
        api<AiOverview>('/platform/ai/settings', {
          method: 'PUT',
          json: { ...aiBody(s), ...extra },
        }),
      what === 'clear' ? 'Chave apagada' : 'Chave salva',
    );
    if (n) {
      setValue('');
      setTest(null);
      onSaved(n);
    }
  }

  return (
    <form
      className="adm-cred__form"
      onSubmit={(e) => {
        e.preventDefault();
        if (value)
          void save(
            admin ? { adminApiKey: value } : owner ? { ownerApiKey: value } : { apiKey: value },
            'save',
          );
      }}
    >
      <NoKey show={!s.keyConfigured} />
      {has && !readable && s.keyConfigured && (
        <Alert tone="danger">
          A chave salva não abre com a INTEGRATIONS_KEY atual. Cole a chave de novo.
        </Alert>
      )}
      {accError && has && <Alert tone="warning">{accError}</Alert>}
      {admin && has && o.balance.from === 'conta' && (
        <Result ok>
          Saldo da conta: {money(o.balance.remainingUsd)} de {money(o.balance.totalUsd)} em
          créditos.
        </Result>
      )}
      <div className="adm-backup-grid">
        <TextField
          label={has ? 'Trocar a chave' : 'Colar a chave'}
          type="password"
          autoComplete="new-password"
          value={value}
          placeholder={has ? `•••••••• ${acc?.keyLabel ?? '(salva)'}` : 'sk-or-v1-…'}
          onChange={(e) => setValue(e.target.value.trim())}
        />
      </div>
      {test && (
        <Result ok={test.ok}>
          {!test.ok
            ? `Não funcionou: ${test.error}`
            : test.credits
              ? `Funcionou: saldo de ${money(test.credits.remainingUsd)} de ${money(test.credits.totalUsd)} em créditos`
              : `Funcionou em ${(test.ms / 1000).toFixed(1)} s${test.usage ? ` · ${test.usage.promptTokens + test.usage.completionTokens} tokens` : ''}`}
        </Result>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Actions>
        {(owner || admin) && has && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => save(admin ? { clearAdminKey: true } : { clearOwnerKey: true }, 'clear')}
            loading={busy === 'clear'}
            disabled={!!busy}
          >
            Apagar
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy === 'test'}
          disabled={!!busy || (!value && !readable)}
          onClick={async () => {
            setTest(null);
            const r = await run('test', () =>
              api<AiTest>('/platform/ai/test', {
                method: 'POST',
                json: { apiKey: value || undefined, key: kind, model: s.model },
              }),
            );
            if (r) setTest(r);
          }}
        >
          Testar
        </Button>
        <Button type="submit" size="sm" loading={busy === 'save'} disabled={!!busy || !value}>
          Salvar
        </Button>
      </Actions>
    </form>
  );
}

// ------------------------------------------------------------------ Resend

interface MailOverview {
  settings: {
    enabled: boolean;
    fromAddress: string;
    fromName: string;
    replyTo: string;
    resendKeySet: boolean;
    ready: boolean;
    canStoreSecrets: boolean;
  };
}

export function ResendEditor({ onSaved }: { onSaved(): void }) {
  const load = useLoad<MailOverview>('/platform/mail');
  const [value, setValue] = useState('');
  const [to, setTo] = useState('');
  const { busy, error, run } = useBusy();
  return (
    <Loading load={load}>
      {(o) => {
        const s = o.settings;
        return (
          <>
            <form
              className="adm-cred__form"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await run(
                  'save',
                  () =>
                    api('/platform/mail/settings', {
                      method: 'PUT',
                      json: {
                        // Primeira chave: já liga o envio, se o remetente já existe (sem ele, a
                        // API recusa; o remetente e o liga e desliga ficam em Super Admin › E-mail).
                        enabled: s.enabled || (!s.resendKeySet && !!s.fromAddress),
                        fromAddress: s.fromAddress,
                        fromName: s.fromName,
                        replyTo: s.replyTo,
                        resendKey: value,
                      },
                    }),
                  'Chave do Resend salva',
                );
                if (r !== null) {
                  setValue('');
                  load.reload();
                  onSaved();
                }
              }}
            >
              <NoKey show={!s.canStoreSecrets} />
              <div className="adm-backup-grid">
                <TextField
                  label={s.resendKeySet ? 'Trocar a chave' : 'API Key'}
                  type="password"
                  autoComplete="new-password"
                  value={value}
                  placeholder={s.resendKeySet ? SAVED : 're_…'}
                  onChange={(e) => setValue(e.target.value.trim())}
                  hint={
                    s.fromAddress
                      ? `Remetente: ${s.fromAddress} (troque em Super Admin › E-mail)`
                      : 'Depois escolha o remetente em Super Admin › E-mail.'
                  }
                />
              </div>
              {error && <Alert tone="danger">{error}</Alert>}
              <Actions>
                <Button
                  type="submit"
                  size="sm"
                  loading={busy === 'save'}
                  disabled={!!busy || !value}
                >
                  Salvar
                </Button>
              </Actions>
            </form>
            {s.ready && (
              <form
                className="adm-cred__form adm-cred__inline"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await run(
                    'test',
                    () =>
                      api('/platform/mail/settings/test', {
                        method: 'POST',
                        json: { to: to.trim() },
                      }),
                    `E-mail de teste enviado para ${to.trim()}`,
                  );
                }}
              >
                <TextField
                  label="Mandar um e-mail de teste para"
                  type="email"
                  placeholder="voce@exemplo.com"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  loading={busy === 'test'}
                  disabled={!/^\S+@\S+\.\S+$/.test(to.trim()) || !!busy}
                >
                  Enviar teste
                </Button>
              </form>
            )}
          </>
        );
      }}
    </Loading>
  );
}

// ------------------------------------------------------------------ Asaas

interface BillingOverview {
  settings: {
    enabled: boolean;
    environment: 'sandbox' | 'production';
    hasApiKey: boolean;
    keyReadable: boolean;
    keyConfigured: boolean;
    hasWebhookToken: boolean;
    webhookRegistered: boolean;
    invoiceDaysBefore: number;
    blockAfterDays: number;
    upgradeDueDays: number;
    contractRenewalDays: number;
    contractGraceDays: number;
    cardEnabled: boolean;
    salesContact: string;
    accountName: string | null;
  };
}

export function AsaasEditor({ onSaved }: { onSaved(): void }) {
  const load = useLoad<BillingOverview>('/platform/billing');
  return (
    <Loading load={load}>
      {(o) => (
        <AsaasForm
          o={o}
          onSaved={() => {
            load.reload();
            onSaved();
          }}
        />
      )}
    </Loading>
  );
}

function AsaasForm({ o, onSaved }: { o: BillingOverview; onSaved(): void }) {
  const s = o.settings;
  const [environment, setEnvironment] = useState(s.environment);
  const [apiKey, setApiKey] = useState('');
  const [hook, setHook] = useState<{ url: string; token: string } | null>(null);
  const { busy, error, run } = useBusy();
  const changed = !!apiKey || environment !== s.environment;

  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await run(
      'save',
      () =>
        api('/platform/billing/settings', {
          method: 'PUT',
          json: {
            enabled: s.enabled,
            environment,
            apiKey: apiKey || undefined,
            invoiceDaysBefore: s.invoiceDaysBefore,
            blockAfterDays: s.blockAfterDays,
            upgradeDueDays: s.upgradeDueDays,
            contractRenewalDays: s.contractRenewalDays,
            contractGraceDays: s.contractGraceDays,
            cardEnabled: s.cardEnabled,
            salesContact: s.salesContact ?? '',
          },
        }),
      'Asaas salvo',
    );
    if (r !== null) {
      setApiKey('');
      onSaved();
    }
  }

  return (
    <form className="adm-cred__form" onSubmit={save}>
      <NoKey show={!s.keyConfigured} />
      {s.hasApiKey && !s.keyReadable && s.keyConfigured && (
        <Alert tone="danger">
          A chave salva não abre com a INTEGRATIONS_KEY atual: cole de novo.
        </Alert>
      )}
      <div className="adm-backup-grid">
        <SelectField
          label="Ambiente"
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as typeof environment)}
        >
          <option value="sandbox">Sandbox (testes, sem dinheiro de verdade)</option>
          <option value="production">Produção (cobra os clientes de verdade)</option>
        </SelectField>
        <TextField
          label={s.hasApiKey ? 'Trocar a chave da API' : 'Chave da API'}
          type="password"
          autoComplete="new-password"
          value={apiKey}
          placeholder={s.hasApiKey ? SAVED : '$aact_…'}
          onChange={(e) => setApiKey(e.target.value.trim())}
          hint={s.accountName ? `Conta conectada: ${s.accountName}` : undefined}
        />
      </div>
      {hook && (
        <div className="adm-kv" style={{ marginTop: 4 }}>
          <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
            Para cadastrar à mão no Asaas (Integrações › Webhooks), use:
          </p>
          <code style={{ display: 'block', wordBreak: 'break-all' }}>{hook.url}</code>
          <code style={{ display: 'block', wordBreak: 'break-all', marginTop: 6 }}>
            Token: {hook.token}
          </code>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Actions>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={busy === 'token'}
          disabled={!s.hasWebhookToken || !!busy}
          onClick={async () => {
            const r = await run(
              'token',
              () =>
                api<{ url: string; token: string }>('/platform/billing/webhook/token', {
                  method: 'POST',
                }),
              'Token exibido (fica registrado na auditoria)',
            );
            if (r) setHook(r);
          }}
        >
          Ver dados do webhook
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy === 'hook'}
          disabled={!s.hasApiKey || !!busy}
          onClick={async () => {
            if (
              await run(
                'hook',
                () =>
                  api<{ url: string }>('/platform/billing/webhook/register', { method: 'POST' }),
                (r) => `Webhook cadastrado: ${r.url}`,
              )
            )
              onSaved();
          }}
        >
          {s.webhookRegistered ? 'Cadastrar o webhook de novo' : 'Cadastrar webhook no Asaas'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy === 'test'}
          disabled={!s.hasApiKey || !!busy}
          onClick={() =>
            run(
              'test',
              () =>
                api<{ ok: boolean; accountName?: string; balance?: number; error?: string }>(
                  '/platform/billing/test',
                  { method: 'POST' },
                ),
              (r) =>
                r.ok
                  ? `Conta ${r.accountName ?? ''} conectada${r.balance != null ? ` · saldo ${brl(r.balance.toFixed(2))}` : ''}`
                  : `Falhou: ${r.error}`,
            )
          }
        >
          Testar conexão
        </Button>
        <Button type="submit" size="sm" loading={busy === 'save'} disabled={!!busy || !changed}>
          Salvar
        </Button>
      </Actions>
    </form>
  );
}

// ------------------------------------------------------------------ PagBank

interface PayOverview {
  settings: {
    enabled: boolean;
    environment: 'sandbox' | 'production';
    hasPlatformToken: boolean;
    clientId: string | null;
    hasClientSecret: boolean;
    receiverAccountId: string | null;
    feePercent: string;
    feeFixed: string;
    redirectUri: string;
    keyConfigured: boolean;
  };
}

export function PagBankEditor({ onSaved }: { onSaved(): void }) {
  const load = useLoad<PayOverview>('/platform/online-pay');
  return (
    <Loading load={load}>
      {(o) => (
        <PagBankForm
          key={JSON.stringify(o.settings)}
          o={o}
          onSaved={(n) => {
            load.setData(n);
            onSaved();
          }}
        />
      )}
    </Loading>
  );
}

function PagBankForm({ o, onSaved }: { o: PayOverview; onSaved(n: PayOverview): void }) {
  const s = o.settings;
  const [f, setF] = useState({
    environment: s.environment,
    platformToken: '',
    receiverAccountId: s.receiverAccountId ?? '',
    clientId: s.clientId ?? '',
    clientSecret: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const { busy, error, run } = useBusy();

  async function save(e: FormEvent) {
    e.preventDefault();
    const n = await run(
      'save',
      () =>
        api<PayOverview>('/platform/online-pay/settings', {
          method: 'PUT',
          json: {
            enabled: s.enabled,
            environment: f.environment,
            platformToken: f.platformToken || undefined,
            clientId: f.clientId || undefined,
            clientSecret: f.clientSecret || undefined,
            receiverAccountId: f.receiverAccountId,
            feePercent: s.feePercent,
            feeFixed: s.feeFixed,
          },
        }),
      'PagBank salvo',
    );
    if (n) onSaved(n);
  }

  return (
    <form className="adm-cred__form" onSubmit={save}>
      <NoKey show={!s.keyConfigured} />
      <div className="adm-backup-grid">
        <SelectField
          label="Ambiente"
          value={f.environment}
          onChange={(e) => set('environment', e.target.value as typeof f.environment)}
        >
          <option value="sandbox">Sandbox (testes, sem dinheiro de verdade)</option>
          <option value="production">Produção (cobra de verdade)</option>
        </SelectField>
        <TextField
          label="Token da conta PagBank"
          type="password"
          autoComplete="new-password"
          value={f.platformToken}
          placeholder={s.hasPlatformToken ? SAVED : 'Cole o token'}
          onChange={(e) => set('platformToken', e.target.value.trim())}
        />
        <TextField
          label="Conta que recebe a taxa"
          value={f.receiverAccountId}
          placeholder="ACCO_…"
          onChange={(e) => set('receiverAccountId', e.target.value.trim())}
          hint="O id da sua conta PagBank. Às vezes vem sozinho ao criar a aplicação."
        />
        <TextField
          label="Client id da aplicação"
          value={f.clientId}
          onChange={(e) => set('clientId', e.target.value.trim())}
        />
        <TextField
          label="Client secret da aplicação"
          type="password"
          autoComplete="new-password"
          value={f.clientSecret}
          placeholder={s.hasClientSecret ? SAVED : ''}
          onChange={(e) => set('clientSecret', e.target.value.trim())}
        />
      </div>
      <p className="adm-form-group__note">
        Endereço de retorno da aplicação: <code>{s.redirectUri}</code>
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Actions>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy === 'app'}
          disabled={!s.hasPlatformToken || !!busy}
          onClick={async () => {
            const n = await run(
              'app',
              () => api<PayOverview>('/platform/online-pay/application', { method: 'POST' }),
              'Aplicação criada no PagBank',
            );
            if (n) onSaved(n);
          }}
        >
          {s.clientId ? 'Criar outra aplicação no PagBank' : 'Criar aplicação no PagBank'}
        </Button>
        <Button type="submit" size="sm" loading={busy === 'save'} disabled={!!busy}>
          Salvar
        </Button>
      </Actions>
      {!s.hasPlatformToken && (
        <p className="adm-form-group__note">Salve o token da conta antes de criar a aplicação.</p>
      )}
    </form>
  );
}

// ------------------------------------------------------------------ Backblaze B2

export function BackblazeEditor({ onSaved }: { onSaved(): void }) {
  const load = useLoad<BackupSettings>('/platform/backups/settings');
  return (
    <Loading load={load}>
      {(s) => (
        <BackblazeForm
          key={s.updatedAt ?? ''}
          s={s}
          onSaved={(n) => {
            load.setData(n);
            onSaved();
          }}
        />
      )}
    </Loading>
  );
}

function BackblazeForm({ s, onSaved }: { s: BackupSettings; onSaved(n: BackupSettings): void }) {
  const [f, setF] = useState({
    endpoint: s.endpoint,
    bucket: s.bucket,
    keyId: s.keyId,
    applicationKey: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value.trim() }));
  const [test, setTest] = useState<BackupTestResult | null>(null);
  const { busy, error, run } = useBusy();
  const complete = !!(
    f.endpoint &&
    f.bucket &&
    f.keyId &&
    (f.applicationKey || s.hasApplicationKey)
  );
  const body = () => ({
    enabled: s.enabled,
    endpoint: f.endpoint,
    region: s.region,
    bucket: f.bucket,
    prefix: s.prefix,
    keyId: f.keyId,
    applicationKey: f.applicationKey || undefined,
    runAt: s.runAt,
    retentionDays: s.retentionDays,
    restoreTestWeekday: s.restoreTestWeekday,
  });

  return (
    <form
      className="adm-cred__form"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = await run(
          'save',
          () => api<BackupSettings>('/platform/backups/settings', { method: 'PUT', json: body() }),
          'Bucket do backup salvo',
        );
        if (n) onSaved(n);
      }}
    >
      <NoKey show={!s.keyConfigured} />
      <div className="adm-backup-grid">
        <TextField
          label="Endereço S3 (Endpoint)"
          placeholder="https://s3.us-west-004.backblazeb2.com"
          value={f.endpoint}
          onChange={set('endpoint')}
          hint={
            s.resolvedRegion && f.endpoint === s.endpoint
              ? `Região: ${s.resolvedRegion}`
              : undefined
          }
        />
        <TextField label="Nome do bucket" value={f.bucket} onChange={set('bucket')} />
        <TextField label="keyID" autoComplete="off" value={f.keyId} onChange={set('keyId')} />
        <TextField
          label="applicationKey"
          type="password"
          autoComplete="new-password"
          value={f.applicationKey}
          placeholder={s.hasApplicationKey ? SAVED : ''}
          onChange={set('applicationKey')}
        />
      </div>
      {test && (
        <Alert tone={test.ok ? (test.canDelete ? 'info' : 'warning') : 'danger'}>
          <div>
            <strong>{test.ok ? 'Bucket funcionando' : 'Não funcionou'}</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {test.steps.map((st) => (
                <li key={st.step}>
                  {st.ok ? 'ok' : 'falhou'}: {st.step}
                  {st.detail ? `: ${st.detail}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Actions>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy === 'test'}
          disabled={!complete || !!busy}
          onClick={async () => {
            setTest(null);
            const r = await run('test', () =>
              api<BackupTestResult>('/platform/backups/test', { method: 'POST', json: body() }),
            );
            if (r) setTest(r);
          }}
        >
          Testar conexão
        </Button>
        <Button type="submit" size="sm" loading={busy === 'save'} disabled={!!busy}>
          Salvar
        </Button>
      </Actions>
    </form>
  );
}

// ------------------------------------------------------------------ GitHub (esteira)

export function GithubEditor({ onSaved }: { onSaved(): void }) {
  const load = useLoad<PipelineSettings>('/platform/tickets/settings');
  const [token, setToken] = useState('');
  const [checks, setChecks] = useState<{
    ok: boolean;
    checks: { label: string; ok: boolean; detail?: string }[];
  } | null>(null);
  const { busy, error, run } = useBusy();
  return (
    <Loading load={load}>
      {(s) => {
        const save = async (
          extra: { githubToken?: string; removeToken?: boolean },
          what: string,
        ) => {
          const r = await run(
            what,
            () =>
              api('/platform/tickets/settings', {
                method: 'PUT',
                json: {
                  enabled: s.enabled,
                  model: s.model,
                  githubRepo: s.githubRepo,
                  githubBase: s.githubBase,
                  branchPrefix: s.branchPrefix,
                  allowCodeChanges: s.allowCodeChanges,
                  autoAdvance: s.autoAdvance,
                  ...extra,
                },
              }),
            what === 'remove' ? 'Token do GitHub apagado' : 'Token do GitHub salvo',
          );
          if (r !== null) {
            setToken('');
            load.reload();
            onSaved();
          }
        };
        return (
          <form
            className="adm-cred__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (token) void save({ githubToken: token }, 'save');
            }}
          >
            <NoKey show={!s.keyConfigured} />
            {s.hasGithubToken && !s.tokenReadable && (
              <Alert tone="danger">
                O token salvo não abre com a INTEGRATIONS_KEY atual: cole de novo.
              </Alert>
            )}
            <div className="adm-backup-grid">
              <TextField
                label={s.hasGithubToken ? 'Trocar o token' : 'Token do GitHub'}
                type="password"
                autoComplete="off"
                value={token}
                placeholder={s.hasGithubToken ? SAVED : 'github_pat_…'}
                onChange={(e) => setToken(e.target.value.trim())}
                hint={`Repositório: ${s.githubRepo} (troque em Chamados › Configurar)`}
              />
            </div>
            {checks && (
              <ul className="adm-cred__checks">
                {checks.checks.map((c) => (
                  <li key={c.label}>
                    {c.ok ? (
                      <CheckCircle2 size={15} color="var(--cm-success)" />
                    ) : (
                      <XCircle size={15} color="var(--cm-danger)" />
                    )}
                    <span>
                      {c.label} {c.detail && <small>· {c.detail}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
            <Actions>
              {s.hasGithubToken && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={busy === 'remove'}
                  disabled={!!busy}
                  onClick={() => void save({ removeToken: true }, 'remove')}
                >
                  Apagar
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busy === 'test'}
                disabled={!!busy || (!token && !s.hasGithubToken)}
                onClick={async () => {
                  const r = await run('test', () =>
                    api<NonNullable<typeof checks>>('/platform/tickets/settings/test', {
                      method: 'POST',
                      json: { githubRepo: s.githubRepo, githubToken: token || undefined },
                    }),
                  );
                  if (r) setChecks(r);
                }}
              >
                Testar GitHub
              </Button>
              <Button type="submit" size="sm" loading={busy === 'save'} disabled={!!busy || !token}>
                Salvar
              </Button>
            </Actions>
          </form>
        );
      }}
    </Loading>
  );
}

export interface ChannelCredState {
  configured: boolean;
  source?: 'panel' | 'env';
  last4?: string;
  mode?: string;
  /** Open Delivery: servidor da API cadastrada. */
  host?: string;
}

/** Client ID e secret do aplicativo do Comandou num aplicativo de delivery (cifrados). */
export function ChannelEditor({
  channel,
  state,
  keyConfigured,
  onSaved,
}: {
  channel: string;
  state: ChannelCredState | undefined;
  keyConfigured: boolean;
  onSaved(): void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [mode, setMode] = useState(state?.mode ?? 'centralized');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const { busy, error, run } = useBusy();
  const needsBase = channel === 'opendelivery';
  // Rappi: endereço só para o ambiente de teste (sem ele vale o domínio do Brasil).
  const optionalBase = channel === 'rappi';
  // Keeta, 99Food, aiqfome e Open Delivery buscam por polling: não há segredo de webhook.
  const polling = channel === 'keeta' || channel === '99food' || channel === 'aiqfome' || needsBase;
  const saved = state?.source === 'panel';

  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await run(
      'save',
      () =>
        api(`/platform/credentials/channels/${channel}`, {
          method: 'PUT',
          json: {
            clientId,
            clientSecret,
            ...(channel === 'ifood' ? { mode } : {}),
            ...(webhookSecret && !polling ? { webhookSecret } : {}),
            ...(needsBase || (optionalBase && baseUrl) ? { baseUrl } : {}),
          },
        }),
      'Credencial salva',
    );
    if (r) {
      setClientId('');
      setClientSecret('');
      setWebhookSecret('');
      setBaseUrl('');
      onSaved();
    }
  }

  return (
    <form className="adm-cred__form" onSubmit={save}>
      <NoKey show={!keyConfigured} />
      {state?.source === 'env' && (
        <Alert tone="info">
          Hoje a credencial vem das variáveis do servidor. Salve aqui para cuidar dela por este
          painel (o salvo aqui vale no lugar delas).
        </Alert>
      )}
      <div className="adm-backup-grid">
        {(needsBase || optionalBase) && (
          <TextField
            label={optionalBase ? 'Endereço da API (só no teste)' : 'Endereço da API'}
            inputMode="url"
            autoComplete="off"
            value={baseUrl}
            placeholder={
              state?.host
                ? `Em uso: ${state.host}`
                : optionalBase
                  ? 'https://api.dev.rappi.com'
                  : 'https://api.aplicativo.com.br'
            }
            onChange={(e) => setBaseUrl(e.target.value.trim())}
          />
        )}
        <TextField
          label="Client ID"
          value={clientId}
          autoComplete="off"
          onChange={(e) => setClientId(e.target.value.trim())}
        />
        <TextField
          label={saved ? 'Trocar o Client Secret' : 'Client Secret'}
          type="password"
          autoComplete="new-password"
          value={clientSecret}
          placeholder={saved ? `•••••••• termina em ${state?.last4}` : undefined}
          onChange={(e) => setClientSecret(e.target.value.trim())}
        />
        {channel === 'ifood' ? (
          <SelectField label="Modo" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="centralized">
              Centralizado (a loja autoriza no Portal do Parceiro)
            </option>
            <option value="distributed">Distribuído (a loja autoriza com um código)</option>
          </SelectField>
        ) : polling ? null : (
          <TextField
            label={channel === 'rappi' ? 'Segredo do webhook' : 'Segredo do webhook (opcional)'}
            type="password"
            autoComplete="new-password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value.trim())}
          />
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Actions>
        {saved && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={busy === 'remove'}
            disabled={!!busy}
            onClick={async () => {
              if (
                await run(
                  'remove',
                  () => api(`/platform/credentials/channels/${channel}/remove`, { method: 'POST' }),
                  'Credencial apagada',
                )
              )
                onSaved();
            }}
          >
            Apagar
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={busy === 'save'}
          disabled={
            !!busy ||
            clientId.length < 4 ||
            clientSecret.length < 8 ||
            !keyConfigured ||
            (needsBase && !/^https:\/\/[^\s/]+\.[^\s/]+/.test(baseUrl))
          }
        >
          Salvar
        </Button>
      </Actions>
    </form>
  );
}

/** Aplicativo Open Delivery cadastrado no painel (`od-<nome>`), como GET /platform/credentials. */
export interface CustomOdApp {
  channel: string;
  name: string;
  host?: string;
  last4: string;
}

/**
 * Outros aplicativos Open Delivery: a lista dos cadastrados (nome, servidor e final do segredo,
 * com Apagar) e o formulário de um novo. Cada um vira um canal `od-<nome>` nos restaurantes.
 */
export function CustomOdEditor({
  apps,
  keyConfigured,
  onSaved,
}: {
  apps: CustomOdApp[];
  keyConfigured: boolean;
  onSaved(): void;
}) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const { busy, error, run } = useBusy();
  const channel = customOdId(name);
  const taken = !!channel && apps.some((a) => a.channel === channel);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!channel) return;
    const r = await run(
      'save',
      () =>
        api(`/platform/credentials/channels/${channel}`, {
          method: 'PUT',
          json: { name: name.trim(), baseUrl, clientId, clientSecret },
        }),
      'Aplicativo cadastrado',
    );
    if (r) {
      setName('');
      setBaseUrl('');
      setClientId('');
      setClientSecret('');
      onSaved();
    }
  }

  return (
    <div className="adm-cred__form">
      <NoKey show={!keyConfigured} />
      {apps.length > 0 && (
        <ul className="adm-cred__apps">
          {apps.map((a) => (
            <li key={a.channel} className="adm-cred__app">
              <div>
                <strong>{a.name}</strong>
                <span className="adm-cred__app-meta">
                  {a.host} · termina em {a.last4}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={busy === a.channel}
                disabled={!!busy}
                onClick={async () => {
                  if (
                    await run(
                      a.channel,
                      () =>
                        api(`/platform/credentials/channels/${a.channel}/remove`, {
                          method: 'POST',
                        }),
                      `${a.name} apagado`,
                    )
                  )
                    onSaved();
                }}
              >
                Apagar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={save}>
        <div className="adm-backup-grid">
          <TextField
            label="Nome"
            value={name}
            maxLength={40}
            autoComplete="off"
            placeholder="Ex.: Anota AI"
            hint={
              taken
                ? 'Já existe um aplicativo com esse nome: salvar troca as chaves dele.'
                : undefined
            }
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Endereço da API"
            inputMode="url"
            autoComplete="off"
            value={baseUrl}
            placeholder="https://api.aplicativo.com.br"
            onChange={(e) => setBaseUrl(e.target.value.trim())}
          />
          <TextField
            label="Client ID"
            value={clientId}
            autoComplete="off"
            onChange={(e) => setClientId(e.target.value.trim())}
          />
          <TextField
            label="Client Secret"
            type="password"
            autoComplete="new-password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value.trim())}
          />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Actions>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={busy === 'save'}
            disabled={
              !!busy ||
              !channel ||
              clientId.length < 4 ||
              clientSecret.length < 8 ||
              !keyConfigured ||
              !/^https:\/\/[^\s/]+\.[^\s/]+/.test(baseUrl)
            }
          >
            {taken ? 'Trocar as chaves' : 'Cadastrar aplicativo'}
          </Button>
        </Actions>
      </form>
    </div>
  );
}
