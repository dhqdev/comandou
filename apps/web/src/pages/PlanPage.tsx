import {
  FEATURE_LABELS,
  INVOICE_KIND_LABELS,
  INVOICE_LABELS,
  RESOURCE_LABELS,
  SUBSCRIPTION_LABELS,
  type InvoiceKind,
  type InvoiceStatus,
  type PlanFeature,
  type PlanResource,
} from '@comandou/shared';
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useCan } from '../app/auth';
import { Alert, Badge, Button, Card, Modal, Spinner, useToast } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { TenantSubscription } from '../lib/types';
import './subscription.css';

const RESOURCES: PlanResource[] = ['users', 'products', 'orders_month'];
const FEATURES: PlanFeature[] = ['fiscal', 'whatsapp', 'custom_domain'];
const STATUS_TONE = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  cancelled: 'neutral',
} as const;
const INVOICE_TONE: Record<InvoiceStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  paid: 'success',
  overdue: 'danger',
  cancelled: 'neutral',
  refunded: 'neutral',
};

export interface Invoice {
  id: string;
  kind: InvoiceKind;
  description: string;
  amount: string;
  dueDate: string;
  status: InvoiceStatus;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  billingType: string | null;
  paidAt: string | null;
  sent: boolean;
  lastError: string | null;
  createdAt: string;
}

export interface PlanOption {
  id: string;
  name: string;
  priceMonthly: string;
  maxUsers: number | null;
  maxProducts: number | null;
  maxOrdersMonth: number | null;
  featureFiscal: boolean;
  featureWhatsapp: boolean;
  featureCustomDomain: boolean;
}

export interface BillingView {
  billing: { enabled: boolean; auto: boolean; blockAfterDays: number; upgradeDueDays: number };
  subscription: {
    planId: string;
    planName: string;
    priceMonthly: string;
    status: keyof typeof STATUS_TONE;
    billingMode: 'manual' | 'asaas';
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    accessUntil: string | null;
    daysLeft: number | null;
    blockOn: string | null;
    blockedAt: string | null;
    blockReason: 'payment' | 'contract' | null;
    blockLabel: string | null;
  } | null;
  invoices: Invoice[];
  contract: {
    number: string | null;
    validUntil: string | null;
    daysLeft: number | null;
    phase: 'none' | 'valid' | 'renewal' | 'expired' | 'blocked';
    blockOn: string | null;
    renewal: { number: string; status: string; sentTo: string | null } | null;
  };
  plans: PlanOption[];
}

export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Assinatura do restaurante: tempo que falta, pagar, contrato, uso e troca de plano. */
export function PlanPage() {
  const canPlan = useCan('plan:read');
  return (
    <>
      <div>
        <h1 className="page-title">Assinatura</h1>
        <p className="page-sub">Plano, pagamento, contrato e uso do mês.</p>
      </div>
      {canPlan ? (
        <Subscription />
      ) : (
        <Alert tone="info">Só o administrador ou o gerente veem a assinatura.</Alert>
      )}
    </>
  );
}

function Subscription() {
  const [data, setData] = useState<BillingView | null>(null);
  const [usage, setUsage] = useState<TenantSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const load = useCallback(() => {
    api<BillingView | null>('/subscription/billing')
      .then(setData)
      .catch((e: Error) => setError(e.message));
    api<TenantSubscription>('/subscription')
      .then(setUsage)
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data && !usage) return <Spinner />;
  const s = data?.subscription ?? null;
  const open = (data?.invoices ?? []).filter(
    (i) => i.status === 'pending' || i.status === 'overdue',
  );
  return (
    <div className="sub-page">
      {s ? (
        <StatusCard view={data!} open={open} onPay={setPaying} />
      ) : (
        <Card title="Plano">
          <p className="sub-muted">
            Este restaurante não tem assinatura ativa: nenhum limite de plano se aplica. Fale com o
            suporte para contratar um plano.
          </p>
        </Card>
      )}
      {data && data.invoices.length > 0 && <Invoices list={data.invoices} onPay={setPaying} />}
      {data && <ContractCard c={data.contract} />}
      {usage?.current && <UsageCard data={usage} />}
      {data && s && <PlansCard view={data} onChanged={load} />}
      <PayModal
        invoice={paying}
        onClose={() => setPaying(null)}
        onPaid={() => {
          setPaying(null);
          load();
        }}
      />
    </div>
  );
}

function StatusCard({
  view,
  open,
  onPay,
}: {
  view: BillingView;
  open: Invoice[];
  onPay(i: Invoice): void;
}) {
  const s = view.subscription!;
  const auto = view.billing.auto;
  const trial = s.status === 'trialing';
  const next = [...open].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
  return (
    <Card
      title={`Plano ${s.planName}`}
      actions={<Badge tone={STATUS_TONE[s.status]}>{SUBSCRIPTION_LABELS[s.status]}</Badge>}
    >
      <div className="sub-hero">
        <div className="sub-hero__left">
          {s.daysLeft !== null && s.accessUntil ? (
            <>
              <span className="sub-hero__big" data-testid="days-left">
                {s.daysLeft > 0 ? plural(s.daysLeft, 'dia', 'dias') : 'Vencido'}
              </span>
              <span className="sub-muted">
                {trial ? 'de teste grátis, até ' : s.daysLeft > 0 ? 'liberado até ' : 'desde '}
                {day(s.accessUntil)}
              </span>
            </>
          ) : (
            <span className="sub-hero__big">Ativa</span>
          )}
        </div>
        <div className="sub-hero__right">
          <span className="sub-price">{brl(s.priceMonthly)}</span>
          <span className="sub-muted">a cada 30 dias</span>
        </div>
      </div>
      {s.blockReason === 'payment' && (
        <Alert tone="danger">
          Sistema bloqueado: o pagamento não foi confirmado. Dá para consultar tudo, mas pedidos,
          vendas e cadastros ficam parados. Pague abaixo e o acesso volta na hora (Pix e cartão em
          minutos, boleto em até 3 dias úteis).
        </Alert>
      )}
      {s.blockReason === 'contract' && (
        <Alert tone="danger">
          Sistema bloqueado: o contrato venceu e o novo ainda não foi assinado. Assine pelo link que
          enviamos por e-mail ou fale com o suporte.
        </Alert>
      )}
      {!s.blockReason && auto && s.blockOn && open.length > 0 && (
        <Alert tone={open.some((i) => i.status === 'overdue') ? 'danger' : 'warning'}>
          Pague até {day(next?.dueDate ?? s.accessUntil)} para continuar usando. Sem pagamento, o
          sistema é bloqueado automaticamente em {day(s.blockOn)}. Nenhum dado é apagado.
        </Alert>
      )}
      {!auto && (
        <p className="sub-muted">
          A cobrança deste restaurante é combinada com o suporte do Comandou.
        </p>
      )}
      {next && (
        <div className="sub-pay">
          <div>
            <strong>{brl(next.amount)}</strong>
            <span className="sub-muted"> · vence em {day(next.dueDate)}</span>
          </div>
          <Button onClick={() => onPay(next)}>Pagar</Button>
        </div>
      )}
      {auto && !next && !trial && (
        <p className="sub-muted">
          Tudo em dia. A próxima cobrança chega alguns dias antes do fim do período.
        </p>
      )}
    </Card>
  );
}

function Invoices({ list, onPay }: { list: Invoice[]; onPay(i: Invoice): void }) {
  return (
    <Card title="Faturas">
      <ul className="sub-list">
        {list.map((i) => (
          <li key={i.id} className="sub-row">
            <div className="sub-row__main">
              <span className="sub-row__title">{INVOICE_KIND_LABELS[i.kind]}</span>
              <span className="sub-muted">
                {i.status === 'paid' && i.paidAt
                  ? `paga em ${day(i.paidAt)}`
                  : `vence em ${day(i.dueDate)}`}
                {i.billingType && i.billingType !== 'MANUAL'
                  ? ` · ${i.billingType === 'BOLETO' ? 'boleto' : i.billingType === 'PIX' ? 'Pix' : 'cartão'}`
                  : ''}
              </span>
            </div>
            <span className="sub-row__amount">{brl(i.amount)}</span>
            <Badge tone={INVOICE_TONE[i.status]}>{INVOICE_LABELS[i.status]}</Badge>
            <span className="sub-row__action">
              {(i.status === 'pending' || i.status === 'overdue') && (
                <Button size="sm" variant="secondary" onClick={() => onPay(i)}>
                  Pagar
                </Button>
              )}
              {i.status === 'paid' && i.invoiceUrl && (
                <a href={i.invoiceUrl} target="_blank" rel="noreferrer" className="sub-link">
                  Comprovante
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ContractCard({ c }: { c: BillingView['contract'] }) {
  if (c.phase === 'none' && !c.renewal) return null;
  return (
    <Card title="Contrato">
      {c.validUntil ? (
        <p className="sub-line">
          <span>
            {c.number} · válido até <strong>{day(c.validUntil)}</strong>
          </span>
          {c.daysLeft !== null && c.daysLeft > 0 && (
            <span className="sub-muted">faltam {plural(c.daysLeft, 'dia', 'dias')}</span>
          )}
        </p>
      ) : (
        <p className="sub-muted">Contrato ainda não assinado.</p>
      )}
      <p className="sub-muted">O contrato é renovado todo ano, com uma nova assinatura.</p>
      {c.phase === 'renewal' && (
        <Alert tone="info">
          O contrato vence em breve.{' '}
          {c.renewal ? 'O novo já foi enviado.' : 'Enviaremos o novo para assinatura.'}
        </Alert>
      )}
      {c.phase === 'expired' && (
        <Alert tone="warning">
          O contrato venceu. Assine o novo até {day(c.blockOn)} para o sistema não ser bloqueado.
        </Alert>
      )}
      {c.renewal && (
        <p className="sub-muted">
          Contrato {c.renewal.number} enviado
          {c.renewal.sentTo ? ` para ${c.renewal.sentTo}` : ''}: assine pelo link do e-mail.
        </p>
      )}
    </Card>
  );
}

function UsageCard({ data }: { data: TenantSubscription }) {
  const cur = data.current!;
  return (
    <Card title="Uso do mês">
      <div className="stat-grid">
        {RESOURCES.map((r) => {
          const limit = cur.plan.limits[r];
          const used = data.usage[r];
          const full = limit !== null && used >= limit;
          return (
            <div key={r} className="cm-card stat" data-testid={`usage-${r}`}>
              <div className="stat__label">{RESOURCE_LABELS[r]}</div>
              <div className="stat__value">
                {used}
                <span className="cm-hint"> / {limit ?? 'sem limite'}</span>
              </div>
              {limit !== null && (
                <div
                  className="usage-bar"
                  role="progressbar"
                  aria-label={RESOURCE_LABELS[r]}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={Math.min(used, limit)}
                  data-full={full || undefined}
                >
                  <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
                </div>
              )}
              {full && <div className="cm-hint">Limite atingido</div>}
            </div>
          );
        })}
      </div>
      <ul className="sub-features">
        {FEATURES.map((f) => (
          <li key={f} data-on={cur.plan.features[f] || undefined}>
            <span className="sub-check" aria-hidden />
            {FEATURE_LABELS[f]}
            <span className="sub-muted">{cur.plan.features[f] ? 'incluído' : 'não incluído'}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const limitText = (n: number | null, unit: string) =>
  n === null ? `${unit} sem limite` : `até ${n.toLocaleString('pt-BR')} ${unit}`;

function PlansCard({ view, onChanged }: { view: BillingView; onChanged(): void }) {
  const { me } = useAuth();
  const owner = me?.user.role === 'owner';
  const s = view.subscription!;
  const [choice, setChoice] = useState<PlanOption | null>(null);
  if (view.plans.length < 2) return null;
  const cur = Number(s.priceMonthly);
  return (
    <Card title="Planos">
      <div className="sub-plans">
        {view.plans.map((p) => {
          const current = p.id === s.planId;
          const up = Number(p.priceMonthly) > cur;
          return (
            <div key={p.id} className="sub-plan" data-current={current || undefined}>
              <div className="sub-plan__head">
                <strong>{p.name}</strong>
                {current && <Badge tone="brand">Seu plano</Badge>}
              </div>
              <span className="sub-price">{brl(p.priceMonthly)}</span>
              <ul className="sub-plan__list">
                <li>{limitText(p.maxUsers, 'pessoas')}</li>
                <li>{limitText(p.maxProducts, 'produtos')}</li>
                <li>{limitText(p.maxOrdersMonth, 'pedidos por mês')}</li>
                {p.featureFiscal && <li>Nota fiscal (NFC-e)</li>}
                {p.featureWhatsapp && <li>Avisos no WhatsApp</li>}
                {p.featureCustomDomain && <li>Domínio próprio</li>}
              </ul>
              {!current &&
                (up && view.billing.auto && owner ? (
                  <Button variant="secondary" onClick={() => setChoice(p)}>
                    Subir para este plano
                  </Button>
                ) : (
                  <span className="sub-muted">
                    {up && view.billing.auto
                      ? 'Só o administrador troca o plano'
                      : 'Fale com o suporte para trocar'}
                  </span>
                ))}
            </div>
          );
        })}
      </div>
      <UpgradeModal
        plan={choice}
        trial={s.status === 'trialing'}
        onClose={() => setChoice(null)}
        onDone={() => {
          setChoice(null);
          onChanged();
        }}
      />
    </Card>
  );
}

function UpgradeModal({
  plan,
  trial,
  onClose,
  onDone,
}: {
  plan: PlanOption | null;
  trial: boolean;
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const [quote, setQuote] = useState<{ amount: string; days: number; cents: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setQuote(null);
    if (plan)
      api<{ amount: string; days: number; cents: number }>(`/subscription/plans/${plan.id}/quote`)
        .then(setQuote)
        .catch((e: Error) => toast(e.message, 'danger'));
  }, [plan, toast]);
  async function confirm() {
    if (!plan) return;
    setBusy(true);
    try {
      await api('/subscription/upgrade', { method: 'POST', json: { planId: plan.id } });
      toast(`Plano ${plan.name} ativado`, 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={!!plan}
      title={plan ? `Subir para o ${plan.name}` : ''}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={confirm} loading={busy} disabled={!quote}>
            Confirmar troca
          </Button>
        </>
      }
    >
      {!quote ? (
        <Spinner />
      ) : (
        <div className="sub-quote">
          <p>Os limites e recursos do novo plano valem na hora.</p>
          {trial ? (
            <p>Você está no teste grátis: a troca não gera cobrança agora.</p>
          ) : quote.cents > 0 ? (
            <p>
              Diferença proporcional dos {quote.days} dias que faltam:{' '}
              <strong>{brl(quote.amount)}</strong>, numa fatura à parte.
            </p>
          ) : (
            <p>Sem cobrança agora: faltam poucos dias para o fim do período.</p>
          )}
          {plan && (
            <p className="sub-muted">
              A partir da próxima mensalidade: {brl(plan.priceMonthly)} a cada 30 dias.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

interface PayInfo {
  paid: boolean;
  amount?: string;
  pix: { image: string; payload: string } | null;
  boleto: { line: string; url: string | null } | null;
  invoiceUrl: string | null;
}

function PayModal({
  invoice,
  onClose,
  onPaid,
}: {
  invoice: Invoice | null;
  onClose(): void;
  onPaid(): void;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pix' | 'boleto' | 'card'>('pix');
  const [checking, setChecking] = useState(false);
  const fetchInfo = useCallback(
    async (quiet = false) => {
      if (!invoice) return;
      try {
        const r = await api<PayInfo>(`/subscription/invoices/${invoice.id}/pay`);
        if (r.paid) {
          toast('Pagamento confirmado. Obrigado!', 'success');
          onPaid();
          return;
        }
        setInfo(r);
        if (quiet) toast('Ainda não recebemos a confirmação. Pix leva alguns segundos.', 'neutral');
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [invoice, onPaid, toast],
  );
  useEffect(() => {
    setInfo(null);
    setError(null);
    setTab('pix');
    void fetchInfo();
  }, [fetchInfo]);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copiado', 'success');
    } catch {
      toast('Não deu para copiar: selecione o texto', 'danger');
    }
  }
  return (
    <Modal
      open={!!invoice}
      title={invoice ? `Pagar ${brl(invoice.amount)}` : ''}
      onClose={onClose}
      footer={
        <Button
          variant="secondary"
          loading={checking}
          onClick={async () => {
            setChecking(true);
            await fetchInfo(true);
            setChecking(false);
          }}
        >
          Já paguei
        </Button>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!info && !error && <Spinner />}
      {info && (
        <div className="sub-paybox">
          <div className="sub-tabs" role="tablist">
            {(
              [
                ['pix', 'Pix'],
                ['boleto', 'Boleto'],
                ['card', 'Cartão'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className="sub-tab"
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'pix' &&
            (info.pix ? (
              <div className="sub-pix">
                <img
                  src={`data:image/png;base64,${info.pix.image}`}
                  alt="QR Code do Pix"
                  width={200}
                  height={200}
                />
                <p className="sub-muted">Aponte a câmera do app do banco ou copie o código.</p>
                <code className="sub-code">{info.pix.payload}</code>
                <Button variant="secondary" onClick={() => copy(info.pix!.payload)}>
                  Copiar código Pix
                </Button>
              </div>
            ) : (
              <p className="sub-muted">Pix indisponível para esta fatura. Use boleto ou cartão.</p>
            ))}
          {tab === 'boleto' &&
            (info.boleto ? (
              <div className="sub-pix">
                <code className="sub-code">{info.boleto.line}</code>
                <Button
                  variant="secondary"
                  onClick={() => copy(info.boleto!.line.replace(/\D/g, ''))}
                >
                  Copiar linha digitável
                </Button>
                {info.boleto.url && (
                  <a href={info.boleto.url} target="_blank" rel="noreferrer" className="sub-link">
                    Abrir boleto em PDF
                  </a>
                )}
                <p className="sub-muted">O boleto leva até 3 dias úteis para ser confirmado.</p>
              </div>
            ) : (
              <p className="sub-muted">Boleto indisponível para esta fatura.</p>
            ))}
          {tab === 'card' && (
            <div className="sub-pix">
              <p className="sub-muted">
                O pagamento com cartão é feito na página segura do Asaas. Os dados do cartão não
                passam pelo Comandou.
              </p>
              {info.invoiceUrl ? (
                <a
                  href={info.invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="cm-btn cm-btn--primary"
                >
                  Pagar com cartão
                </a>
              ) : (
                <p className="sub-muted">Página de pagamento indisponível.</p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
