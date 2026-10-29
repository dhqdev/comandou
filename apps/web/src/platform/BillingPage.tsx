import {
  BLOCK_LABELS,
  INVOICE_KIND_LABELS,
  INVOICE_LABELS,
  SUBSCRIPTION_LABELS,
  type InvoiceKind,
  type InvoiceStatus,
} from '@comandou/shared';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, Spinner, TextField, useToast } from '../design-system';
import { SelectField } from '../features/forms';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useLoad } from './OverviewPages';
import { ago, Dot, Level, Section, Tag, Tile } from './ui';

interface Settings {
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
  accountName: string | null;
  lastCycleAt: string | null;
  lastCycleError: string | null;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  planName: string;
  priceMonthly: string;
  status: keyof typeof SUBSCRIPTION_LABELS;
  billingMode: 'manual' | 'asaas';
  accessUntil: string | null;
  daysLeft: number | null;
  blockedAt: string | null;
  blockReason: 'payment' | 'contract' | null;
  contractValidUntil: string | null;
  contractPhase: 'none' | 'valid' | 'renewal' | 'expired' | 'blocked';
}

export interface AdminInvoice {
  id: string;
  kind: InvoiceKind;
  description: string;
  amount: string;
  dueDate: string;
  status: InvoiceStatus;
  invoiceUrl: string | null;
  billingType: string | null;
  paidAt: string | null;
  sent: boolean;
  lastError: string | null;
  environment: string | null;
  createdAt: string;
  tenantId?: string;
  tenantName?: string;
}

interface Overview {
  settings: Settings;
  webhookPath: string;
  totals: {
    open: string;
    overdue: string;
    paidMonth: string;
    openCount: number;
    overdueCount: number;
  };
  tenants: TenantRow[];
  invoices: AdminInvoice[];
  events: {
    id: string;
    event: string;
    paymentId: string | null;
    receivedAt: string;
    processedAt: string | null;
    error: string | null;
  }[];
}

export const INVOICE_LEVEL: Record<InvoiceStatus, Level> = {
  pending: 'warn',
  paid: 'ok',
  overdue: 'bad',
  cancelled: 'off',
  refunded: 'off',
};
export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—';

function tenantLevel(t: TenantRow): Level {
  if (t.blockReason) return 'bad';
  if (t.status === 'past_due' || t.contractPhase === 'expired') return 'warn';
  if (t.billingMode === 'manual') return 'off';
  return 'ok';
}

/**
 * Cobrança: conta do Asaas, regras (7 dias de teste, +30 dias por pagamento, bloqueio
 * automático), situação de cada cliente e as faturas recentes.
 */
export function BillingPage() {
  const data = useLoad<Overview>('/platform/billing');
  const o = data.data;
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (!o) return <Spinner />;
  return (
    <>
      <StatusSection o={o} onRan={data.reload} />
      <TenantsSection o={o} />
      <InvoicesSection o={o} />
      <SettingsSection o={o} onSaved={(n) => data.setData(n)} />
    </>
  );
}

function StatusSection({ o, onRan }: { o: Overview; onRan(): void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const s = o.settings;
  const blocked = o.tenants.filter((t) => t.blockReason);
  const renew = o.tenants.filter(
    (t) => t.contractPhase === 'renewal' || t.contractPhase === 'expired',
  );
  async function run() {
    setBusy(true);
    try {
      const r = await api<{
        created?: number;
        blocked?: number;
        unblocked?: number;
        busy?: boolean;
      }>('/platform/billing/run', { method: 'POST' });
      toast(
        r.busy
          ? 'O ciclo já está rodando em outra réplica'
          : `Ciclo feito: ${r.created ?? 0} fatura(s), ${r.blocked ?? 0} bloqueio(s), ${r.unblocked ?? 0} liberação(ões)`,
        'success',
      );
      onRan();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      title="Cobrança"
      sub={
        s.enabled
          ? `Asaas ${s.environment === 'production' ? 'produção' : 'sandbox'}${s.accountName ? ` · ${s.accountName}` : ''}`
          : 'desligada'
      }
      actions={
        <Button variant="ghost" size="sm" onClick={run} loading={busy} disabled={!s.enabled}>
          Rodar ciclo agora
        </Button>
      }
    >
      {!s.keyConfigured && (
        <Alert tone="danger">
          A API está sem INTEGRATIONS_KEY: não dá para guardar a chave do Asaas com segurança.
        </Alert>
      )}
      {!s.enabled && (
        <Alert tone="info">
          Cobrança automática desligada. Coloque a chave do Asaas abaixo e ligue: restaurantes novos
          já nascem em cobrança automática; os antigos você liga um a um na aba Assinatura.
        </Alert>
      )}
      {s.enabled && !s.webhookRegistered && (
        <Alert tone="warning">
          Webhook do Asaas não cadastrado: sem ele, o pagamento só é visto no ciclo ou no botão
          Conferir. Use "Cadastrar webhook no Asaas" abaixo.
        </Alert>
      )}
      {s.lastCycleError && <Alert tone="warning">Último ciclo: {s.lastCycleError}</Alert>}
      <div className="adm-grid">
        <Tile label="Recebido no mês" value={brl(o.totals.paidMonth)} level="ok" />
        <Tile
          label="A receber"
          value={brl(o.totals.open)}
          sub={`${o.totals.openCount} fatura(s) em aberto`}
        />
        <Tile
          label="Vencido"
          value={brl(o.totals.overdue)}
          sub={`${o.totals.overdueCount} fatura(s)`}
          level={o.totals.overdueCount ? 'bad' : 'off'}
        />
        <Tile
          label="Bloqueados"
          value={blocked.length}
          sub={renew.length ? `${renew.length} contrato(s) para renovar` : 'contratos em dia'}
          level={blocked.length ? 'bad' : 'ok'}
        />
      </div>
      <p className="adm-sub" style={{ whiteSpace: 'normal', marginTop: 12 }}>
        Regra: teste grátis (dias do plano), cada pagamento libera mais 30 dias, a fatura sai{' '}
        {s.invoiceDaysBefore} dias antes do fim e, sem pagamento,{' '}
        {s.blockAfterDays
          ? `o sistema bloqueia ${s.blockAfterDays} dia(s) depois do fim`
          : 'o sistema bloqueia no fim do período'}
        . Contrato vale 12 meses; sem o novo assinado, bloqueia {s.contractGraceDays} dias depois.
        Último ciclo: {s.lastCycleAt ? ago(s.lastCycleAt) : 'nunca'}.
      </p>
    </Section>
  );
}

function TenantsSection({ o }: { o: Overview }) {
  return (
    <Section title="Clientes" sub={`${o.tenants.length} com assinatura`}>
      <div className="adm-panel">
        <div className="adm-rows">
          {o.tenants.map((t) => (
            <Link key={t.id} to={`/restaurantes/${t.id}`} className="adm-row">
              <Dot level={tenantLevel(t)} />
              <span className="adm-row__main">
                <span className="adm-row__title">
                  {t.name}
                  {t.blockReason && (
                    <>
                      {' '}
                      <Tag level="bad">bloqueado: {BLOCK_LABELS[t.blockReason]}</Tag>
                    </>
                  )}
                </span>
                <span className="adm-row__meta">
                  {t.planName} · {brl(t.priceMonthly)} · {SUBSCRIPTION_LABELS[t.status]} ·{' '}
                  {t.billingMode === 'asaas' ? 'automática' : 'manual'}
                  {t.contractValidUntil ? ` · contrato até ${day(t.contractValidUntil)}` : ''}
                </span>
              </span>
              <span className="adm-row__side">
                {t.accessUntil ? (t.daysLeft ? `${t.daysLeft} dia(s)` : 'vencido') : 'sem prazo'}
                <br />
                <small>{t.accessUntil ? `até ${day(t.accessUntil)}` : ''}</small>
              </span>
            </Link>
          ))}
          {o.tenants.length === 0 && <div className="adm-empty">Nenhuma assinatura.</div>}
        </div>
      </div>
    </Section>
  );
}

function InvoicesSection({ o }: { o: Overview }) {
  return (
    <Section title="Faturas recentes">
      <div className="adm-panel">
        <div className="adm-rows">
          {o.invoices.map((i) => (
            <Link key={i.id} to={`/restaurantes/${i.tenantId}`} className="adm-row">
              <Dot level={INVOICE_LEVEL[i.status]} />
              <span className="adm-row__main">
                <span className="adm-row__title">
                  {i.tenantName} · {INVOICE_KIND_LABELS[i.kind]}
                </span>
                <span className="adm-row__meta">
                  {INVOICE_LABELS[i.status]} · vence {day(i.dueDate)}
                  {i.paidAt ? ` · paga ${day(i.paidAt)}` : ''}
                  {i.lastError ? ` · erro: ${i.lastError}` : ''}
                </span>
              </span>
              <span className="adm-row__side">{brl(i.amount)}</span>
            </Link>
          ))}
          {o.invoices.length === 0 && <div className="adm-empty">Nenhuma fatura ainda.</div>}
        </div>
      </div>
      {o.events.length > 0 && (
        <p className="adm-sub" style={{ whiteSpace: 'normal', marginTop: 8 }}>
          Último aviso do Asaas: {o.events[0]!.event} {ago(o.events[0]!.receivedAt)}
          {o.events[0]!.error ? ` (${o.events[0]!.error})` : ''}.
        </p>
      )}
    </Section>
  );
}

type Form = {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  apiKey: string;
  invoiceDaysBefore: string;
  blockAfterDays: string;
  upgradeDueDays: string;
  contractRenewalDays: string;
  contractGraceDays: string;
};
const toForm = (s: Settings): Form => ({
  enabled: s.enabled,
  environment: s.environment,
  apiKey: '',
  invoiceDaysBefore: String(s.invoiceDaysBefore),
  blockAfterDays: String(s.blockAfterDays),
  upgradeDueDays: String(s.upgradeDueDays),
  contractRenewalDays: String(s.contractRenewalDays),
  contractGraceDays: String(s.contractGraceDays),
});

function SettingsSection({ o, onSaved }: { o: Overview; onSaved(n: Overview): void }) {
  const toast = useToast();
  const s = o.settings;
  const [f, setF] = useState<Form>(() => toForm(s));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hook, setHook] = useState<{ url: string; token: string } | null>(null);
  const set = (k: keyof Form) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const num = (k: keyof Form) => (e: { target: { value: string } }) =>
    set(k)(e.target.value.replace(/\D/g, ''));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      const n = await api<Overview>('/platform/billing/settings', {
        method: 'PUT',
        json: {
          enabled: f.enabled,
          environment: f.environment,
          apiKey: f.apiKey.trim() || undefined,
          invoiceDaysBefore: Number(f.invoiceDaysBefore || 0),
          blockAfterDays: Number(f.blockAfterDays || 0),
          upgradeDueDays: Number(f.upgradeDueDays || 0),
          contractRenewalDays: Number(f.contractRenewalDays || 0),
          contractGraceDays: Number(f.contractGraceDays || 0),
        },
      });
      onSaved(n);
      setF(toForm(n.settings));
      toast('Cobrança salva', 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function call<T>(key: string, path: string, ok: (r: T) => string) {
    setBusy(key);
    setError(null);
    try {
      const r = await api<T>(path, { method: 'POST' });
      toast(ok(r), 'success');
      return r;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }
  return (
    <Section title="Asaas" sub="chave, webhook e regras (só o super admin vê)">
      <Card>
        <form onSubmit={save}>
          <div className="adm-backup-grid">
            <SelectField
              label="Ambiente"
              value={f.environment}
              onChange={(e) => set('environment')(e.target.value)}
            >
              <option value="sandbox">Sandbox (testes)</option>
              <option value="production">Produção (cobrança de verdade)</option>
            </SelectField>
            <TextField
              label="Chave da API do Asaas"
              type="password"
              autoComplete="new-password"
              value={f.apiKey}
              placeholder={s.hasApiKey ? '•••••••• (salva)' : '$aact_…'}
              onChange={(e) => set('apiKey')(e.target.value.trim())}
              hint={
                s.hasApiKey
                  ? 'Deixe em branco para manter a salva. Fica cifrada; nunca é mostrada.'
                  : 'No Asaas: Integrações › Chaves de API. Use a do mesmo ambiente.'
              }
            />
            <TextField
              label="Fatura sai quantos dias antes"
              inputMode="numeric"
              value={f.invoiceDaysBefore}
              onChange={num('invoiceDaysBefore')}
              hint="1 a 20 dias antes do fim do período"
            />
            <TextField
              label="Tolerância até bloquear (dias)"
              inputMode="numeric"
              value={f.blockAfterDays}
              onChange={num('blockAfterDays')}
              hint="0 = bloqueia logo que o período acaba sem pagamento"
            />
            <TextField
              label="Prazo da troca de plano (dias)"
              inputMode="numeric"
              value={f.upgradeDueDays}
              onChange={num('upgradeDueDays')}
              hint="Vencimento da diferença proporcional"
            />
            <TextField
              label="Avisar renovação do contrato (dias antes)"
              inputMode="numeric"
              value={f.contractRenewalDays}
              onChange={num('contractRenewalDays')}
            />
            <TextField
              label="Contrato vencido: bloquear depois de (dias)"
              inputMode="numeric"
              value={f.contractGraceDays}
              onChange={num('contractGraceDays')}
            />
          </div>
          <label className="adm-check" style={{ margin: '16px 0' }}>
            <input
              type="checkbox"
              checked={f.enabled}
              onChange={(e) => set('enabled')(e.target.checked)}
            />
            Cobrança automática ligada (gera faturas e bloqueia quem não paga)
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="adm-form-actions" style={{ flexWrap: 'wrap' }}>
            <Button type="submit" loading={busy === 'save'}>
              Salvar
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={busy === 'test'}
              disabled={!s.hasApiKey}
              onClick={() =>
                call<{ ok: boolean; accountName?: string; balance?: number; error?: string }>(
                  'test',
                  '/platform/billing/test',
                  (r) =>
                    r.ok
                      ? `Conta ${r.accountName ?? ''} conectada${r.balance != null ? ` · saldo ${brl(r.balance.toFixed(2))}` : ''}`
                      : `Falhou: ${r.error}`,
                )
              }
            >
              Testar conexão
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={busy === 'hook'}
              disabled={!s.hasApiKey}
              onClick={() =>
                call<{ url: string }>('hook', '/platform/billing/webhook/register', (r) => {
                  onSaved({ ...o, settings: { ...s, webhookRegistered: true } });
                  return `Webhook cadastrado: ${r.url}`;
                })
              }
            >
              Cadastrar webhook no Asaas
            </Button>
            <Button
              type="button"
              variant="ghost"
              loading={busy === 'token'}
              disabled={!s.hasWebhookToken}
              onClick={async () => {
                const r = await call<{ url: string; token: string }>(
                  'token',
                  '/platform/billing/webhook/token',
                  () => 'Token exibido (fica registrado na auditoria)',
                );
                if (r) setHook(r);
              }}
            >
              Ver dados do webhook
            </Button>
          </div>
          {hook && (
            <div className="adm-kv" style={{ marginTop: 12 }}>
              <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
                Para cadastrar à mão no Asaas (Integrações › Webhooks), use:
              </p>
              <code style={{ display: 'block', wordBreak: 'break-all' }}>{hook.url}</code>
              <code style={{ display: 'block', wordBreak: 'break-all', marginTop: 6 }}>
                Token: {hook.token}
              </code>
            </div>
          )}
        </form>
      </Card>
    </Section>
  );
}
