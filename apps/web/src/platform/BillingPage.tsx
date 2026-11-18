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
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { CalendarSection } from './BillingCalendar';
import { useLoad } from './OverviewPages';
import { CredentialsNote } from './credentials/CredentialsNote';
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
  cardEnabled: boolean;
  salesContact: string;
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
      <CalendarSection />
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
  invoiceDaysBefore: string;
  blockAfterDays: string;
  upgradeDueDays: string;
  contractRenewalDays: string;
  contractGraceDays: string;
  cardEnabled: boolean;
  salesContact: string;
};
const toForm = (s: Settings): Form => ({
  enabled: s.enabled,
  invoiceDaysBefore: String(s.invoiceDaysBefore),
  blockAfterDays: String(s.blockAfterDays),
  upgradeDueDays: String(s.upgradeDueDays),
  contractRenewalDays: String(s.contractRenewalDays),
  contractGraceDays: String(s.contractGraceDays),
  cardEnabled: s.cardEnabled,
  salesContact: s.salesContact ?? '',
});

/** Linha do tempo de exemplo com os números do formulário (vencimento no dia 10). */
function example(f: Form) {
  const before = Number(f.invoiceDaysBefore || 0);
  const grace = Number(f.blockAfterDays || 0);
  const sent = 10 - before;
  const sentDay = sent >= 1 ? `dia ${sent}` : `dia ${30 + sent} do mês anterior`;
  return (
    <>
      Exemplo com os números abaixo: se o cliente pagou até o dia 10, a fatura chega no{' '}
      <strong>{sentDay}</strong>, vence no <strong>dia 10</strong> e, sem pagamento,{' '}
      {grace ? (
        <>
          o acesso é bloqueado no <strong>dia {10 + grace}</strong>
        </>
      ) : (
        'o acesso é bloqueado logo depois do dia 10'
      )}
      .
    </>
  );
}

function SettingsSection({ o, onSaved }: { o: Overview; onSaved(n: Overview): void }) {
  const toast = useToast();
  const s = o.settings;
  const [f, setF] = useState<Form>(() => toForm(s));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          // Ambiente e chave do Asaas ficam em Super Admin › Credenciais.
          environment: s.environment,
          invoiceDaysBefore: Number(f.invoiceDaysBefore || 0),
          blockAfterDays: Number(f.blockAfterDays || 0),
          upgradeDueDays: Number(f.upgradeDueDays || 0),
          contractRenewalDays: Number(f.contractRenewalDays || 0),
          contractGraceDays: Number(f.contractGraceDays || 0),
          cardEnabled: f.cardEnabled,
          salesContact: f.salesContact.trim(),
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
  return (
    <Section title="Configurações" sub="prazos e regras (só o super admin vê)">
      <Card>
        <form onSubmit={save}>
          <div className="adm-form-group">
            <h3 className="adm-form-group__title">1. Cobrança automática</h3>
            <p className="adm-form-group__lead">
              O Asaas emite as faturas (Pix, boleto e cartão), manda por e-mail para o restaurante e
              avisa o Comandou quando o pagamento cai.
            </p>
            <CredentialsNote
              id="asaas"
              level={!s.hasApiKey ? 'bad' : !s.webhookRegistered ? 'warn' : 'ok'}
            >
              {!s.hasApiKey
                ? 'Falta a chave da API do Asaas.'
                : `Asaas ${s.environment === 'production' ? 'em produção' : 'no sandbox'}${s.accountName ? ` · ${s.accountName}` : ''}${s.webhookRegistered ? '' : ' · falta cadastrar o webhook'}.`}{' '}
              Chave, ambiente, teste e webhook ficam em Credenciais.
            </CredentialsNote>
            <label className="adm-check" style={{ marginTop: 14 }}>
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => set('enabled')(e.target.checked)}
              />
              Cobrança automática ligada
            </label>
            <p className="adm-form-group__note">
              <strong>Ligada:</strong> o Comandou gera as faturas sozinho, manda pelo Asaas, dá
              baixa quando o cliente paga e bloqueia quem não paga. <strong>Desligada:</strong>{' '}
              ninguém é cobrado nem bloqueado automaticamente; você dá baixa à mão na ficha de cada
              restaurante.
            </p>
          </div>

          <div className="adm-form-group">
            <h3 className="adm-form-group__title">
              2. Mensalidade: quando cobrar e quando bloquear
            </h3>
            <p className="adm-form-group__lead">
              Cada pagamento libera 30 dias de uso. A mensalidade vence no último dia liberado.{' '}
              {example(f)}
            </p>
            <div className="adm-backup-grid">
              <TextField
                label="Mandar a fatura quantos dias antes do vencimento"
                inputMode="numeric"
                value={f.invoiceDaysBefore}
                onChange={num('invoiceDaysBefore')}
                hint="De 1 a 20. Ex.: 5 = o cliente recebe a fatura 5 dias antes do último dia pago, com tempo para pagar."
              />
              <TextField
                label="Dias de tolerância depois do vencimento"
                inputMode="numeric"
                value={f.blockAfterDays}
                onChange={num('blockAfterDays')}
                hint="De 0 a 15. Quantos dias o restaurante continua usando sem ter pago. 0 = bloqueia assim que o período acaba."
              />
              <TextField
                label="Prazo para pagar a troca de plano (dias)"
                inputMode="numeric"
                value={f.upgradeDueDays}
                onChange={num('upgradeDueDays')}
                hint="De 1 a 10. Quem sobe de plano paga só a diferença dos dias que faltam; essa fatura vence em tantos dias. O plano novo vale na hora."
              />
            </div>
          </div>

          <div className="adm-form-group">
            <h3 className="adm-form-group__title">3. Contrato anual</h3>
            <p className="adm-form-group__lead">
              O contrato vale 12 meses. Perto do fim, o restaurante vê um aviso para assinar o novo.
            </p>
            <div className="adm-backup-grid">
              <TextField
                label="Avisar a renovação quantos dias antes"
                inputMode="numeric"
                value={f.contractRenewalDays}
                onChange={num('contractRenewalDays')}
                hint="De 7 a 90. Ex.: 30 = o aviso de renovação aparece no sistema do restaurante 30 dias antes do contrato vencer."
              />
              <TextField
                label="Bloquear quantos dias depois do contrato vencer"
                inputMode="numeric"
                value={f.contractGraceDays}
                onChange={num('contractGraceDays')}
                hint="De 0 a 60. Se o contrato novo não for assinado, o acesso é bloqueado depois desses dias. 0 = bloqueia no dia seguinte ao vencimento."
              />
            </div>
          </div>

          <div className="adm-form-group">
            <h3 className="adm-form-group__title">4. Cartão de crédito automático</h3>
            <p className="adm-form-group__lead">
              Com isto ligado, o administrador do restaurante cadastra um cartão na tela Assinatura
              e a mensalidade é cobrada sozinha no dia do vencimento (a diferença de troca de plano,
              na hora). Se o banco recusar, tentamos de novo por até 3 dias e a fatura continua com
              Pix e boleto. O Comandou guarda só o token do Asaas (cifrado), a bandeira e os 4
              últimos números.
            </p>
            <p className="adm-form-group__note">
              <strong>Antes de ligar:</strong> peça ao Asaas para liberar a{' '}
              <em>tokenização de cartão</em> na sua conta (Asaas › Minha conta › Integrações, ou
              pelo gerente de conta). Sem isso, o cadastro do cartão é recusado. Teste primeiro no
              ambiente Sandbox com o cartão 5162 3060 0482 9590.
            </p>
            <label className="adm-check">
              <input
                type="checkbox"
                checked={f.cardEnabled}
                onChange={(e) => set('cardEnabled')(e.target.checked)}
              />
              Liberar cartão automático para os restaurantes
            </label>
            <p className="adm-form-group__note">
              Pix e boleto não precisam de nada: a fatura sai sozinha {f.invoiceDaysBefore || 5}{' '}
              dia(s) antes do vencimento, o Asaas manda por e-mail e o Pix aparece na tela
              Assinatura do restaurante.
            </p>
          </div>

          <div className="adm-form-group">
            <h3 className="adm-form-group__title">5. Página de preços</h3>
            <TextField
              label="Contato de vendas da página de preços"
              value={f.salesContact}
              onChange={(e) => set('salesContact')(e.target.value)}
              placeholder="11 99999-9999, vendas@seudominio.com ou https://…"
              hint="É o botão “Falar com a gente” da página /precos. Número de telefone vira link do WhatsApp, e-mail abre o e-mail e link abre como está."
            />
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="adm-form-actions" style={{ flexWrap: 'wrap' }}>
            <Button type="submit" loading={busy === 'save'}>
              Salvar
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}
