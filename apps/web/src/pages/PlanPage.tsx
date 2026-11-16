import {
  INVOICE_KIND_LABELS,
  INVOICE_LABELS,
  RESOURCE_LABELS,
  SUBSCRIPTION_LABELS,
  type InvoiceKind,
  type InvoiceStatus,
  type PlanResource,
} from '@comandou/shared';
import { Check, CreditCard, FileText, QrCode } from 'lucide-react';
import { FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useAuth, useCan } from '../app/auth';
import { Alert, Badge, Button, Modal, Spinner, TextField, useToast } from '../design-system';
import { useCepLookup } from '../lib/cep';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { TenantSubscription } from '../lib/types';
import { singlePlan, singlePlanList } from './pricing-data';
import './subscription.css';

const RESOURCES: PlanResource[] = ['users', 'products', 'orders_month'];
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

export type PayMethod = 'pix' | 'boleto' | 'card';

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
  data?: { cardError?: string | null; cardTriedOn?: string; card?: string } | null;
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
  tagline?: string;
  highlights?: string[];
  featured?: boolean;
}

export interface BillingView {
  billing: {
    enabled: boolean;
    auto: boolean;
    blockAfterDays: number;
    upgradeDueDays: number;
    invoiceDaysBefore?: number;
    cardAvailable?: boolean;
  };
  payment?: {
    method: PayMethod | null;
    card: { brand: string; last4: string; holderName: string; savedAt: string } | null;
  };
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
    scheduledPlan?: {
      id: string;
      name: string;
      priceMonthly: string;
      startsAt: string | null;
    } | null;
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
const isOpen = (i: Invoice) => i.status === 'pending' || i.status === 'overdue';
const METHOD_LABEL: Record<PayMethod, string> = {
  card: 'Cartão de crédito',
  pix: 'Pix',
  boleto: 'Boleto',
};

/** Assinatura do restaurante: valor único, quanto falta, pagar e forma de pagamento. */
export function PlanPage() {
  const canPlan = useCan('plan:read');
  return (
    <>
      <div>
        <h1 className="page-title">Assinatura</h1>
        <p className="page-sub">Sua mensalidade, o pagamento e o que está incluso.</p>
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
  const { me } = useAuth();
  const owner = me?.user.role === 'owner';
  const [data, setData] = useState<BillingView | null>(null);
  const [usage, setUsage] = useState<TenantSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
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
  const open = (data?.invoices ?? [])
    .filter(isOpen)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  if (!data || !s)
    return (
      <div className="sub-panel">
        <p className="sub-muted">
          Este restaurante não tem assinatura ativa. Fale com o suporte para contratar o Comandou.
        </p>
      </div>
    );

  return (
    <div className="sub2">
      <div className="sub2-side">
        <StatusPanel
          view={data}
          open={open}
          owner={owner}
          onPay={setPaying}
          onMethod={() => setMethodOpen(true)}
        />
        {usage?.current && hasLimits(usage) && <UsagePanel data={usage} />}
        <ContractPanel c={data.contract} />
      </div>
      <div className="sub2-main">
        <SinglePrice view={data} />
        {data.billing.auto && (
          <MethodPanel view={data} owner={owner} onEdit={() => setMethodOpen(true)} />
        )}
        {data.invoices.length > 0 && <Invoices list={data.invoices} onPay={setPaying} />}
      </div>
      <PayModal
        invoice={paying}
        view={data}
        owner={owner}
        onClose={() => setPaying(null)}
        onPaid={() => {
          setPaying(null);
          load();
        }}
      />
      <MethodModal
        open={methodOpen}
        view={data}
        onClose={() => setMethodOpen(false)}
        onDone={() => {
          setMethodOpen(false);
          load();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- coluna da esquerda
function StatusPanel({
  view,
  open,
  owner,
  onPay,
  onMethod,
}: {
  view: BillingView;
  open: Invoice[];
  owner: boolean;
  onPay(i: Invoice): void;
  onMethod(): void;
}) {
  const s = view.subscription!;
  const auto = view.billing.auto;
  const trial = s.status === 'trialing';
  const next = open[0];
  const method = view.payment?.method ?? null;
  const card = view.payment?.card ?? null;
  const cardAuto = method === 'card' && !!card && !!view.billing.cardAvailable;
  const left = s.daysLeft ?? 0;
  const pct = s.accessUntil ? Math.max(0, Math.min(100, (left / 30) * 100)) : 100;
  return (
    <section className="sub-panel sub-status" aria-label="Seu plano">
      <div className="sub-status__head">
        <span className="sub-muted">Plano {s.planName}</span>
        <Badge tone={STATUS_TONE[s.status]}>{SUBSCRIPTION_LABELS[s.status]}</Badge>
      </div>
      {s.daysLeft !== null && s.accessUntil ? (
        <>
          <div className="sub-status__big" data-testid="days-left">
            {s.daysLeft > 0 ? (
              <>
                {s.daysLeft}
                <small>{s.daysLeft === 1 ? 'dia' : 'dias'}</small>
              </>
            ) : (
              'Vencido'
            )}
          </div>
          <div className="sub-meter" aria-hidden>
            <span style={{ width: `${pct}%` }} data-low={left <= 3 || undefined} />
          </div>
          <p className="sub-muted">
            {trial ? 'de teste grátis, até ' : s.daysLeft > 0 ? 'liberado até ' : 'desde '}
            {day(s.accessUntil)}
          </p>
        </>
      ) : (
        <div className="sub-status__big">Ativa</div>
      )}

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
      {!s.blockReason &&
        auto &&
        s.blockOn &&
        open.length > 0 &&
        !cardAuto &&
        (left <= 5 || open.some((i) => i.status === 'overdue')) && (
          <Alert tone={open.some((i) => i.status === 'overdue') ? 'danger' : 'warning'}>
            Pague até {day(next?.dueDate ?? s.accessUntil)} para continuar usando. Sem pagamento, o
            sistema é bloqueado automaticamente em {day(s.blockOn)}. Nenhum dado é apagado.
          </Alert>
        )}
      {next?.data?.cardError && (
        <Alert tone="warning">
          O cartão foi recusado ({next.data.cardError}). Tentamos de novo amanhã; se preferir, pague
          agora por Pix ou boleto.
        </Alert>
      )}

      {next && (
        <Button block size="lg" onClick={() => onPay(next)}>
          {next.kind === 'upgrade' ? 'Pagar a troca de plano' : 'Pagar a mensalidade'} ·{' '}
          {brl(next.amount)}
        </Button>
      )}

      <dl className="sub-kv">
        <div>
          <dt>Mensalidade</dt>
          <dd>{brl(s.priceMonthly)} a cada 30 dias</dd>
        </div>
        {auto && (
          <>
            <div>
              <dt>Pagamento</dt>
              <dd>
                {cardAuto
                  ? `${card!.brand} •••• ${card!.last4}`
                  : method
                    ? METHOD_LABEL[method]
                    : 'Pix, boleto ou cartão'}
              </dd>
            </div>
            <div>
              <dt>Cobrança automática</dt>
              <dd>{cardAuto ? 'Ligada' : 'Desligada'}</dd>
            </div>
            {!trial && s.accessUntil && (
              <div>
                <dt>Próxima cobrança</dt>
                <dd>
                  {day(next?.dueDate ?? s.accessUntil)} ·{' '}
                  {brl(next?.amount ?? s.scheduledPlan?.priceMonthly ?? s.priceMonthly)}
                </dd>
              </div>
            )}
          </>
        )}
      </dl>

      {auto && (
        <p className="sub-muted">
          {cardAuto
            ? 'A mensalidade sai sozinha no cartão no dia do vencimento.'
            : `A fatura com o Pix chega no seu e-mail ${view.billing.invoiceDaysBefore ?? 5} dias antes de vencer. Ligue o cartão automático para não precisar lembrar.`}
        </p>
      )}

      {s.scheduledPlan && (
        <div className="sub-note">
          <span>
            A partir de {day(s.scheduledPlan.startsAt)}, sua mensalidade passa a ser o valor único
            de <strong>{brl(s.scheduledPlan.priceMonthly)}</strong>, com tudo incluso e sem limites.
            Até lá, o {s.planName} continua como está.
          </span>
        </div>
      )}

      {!auto && (
        <p className="sub-muted">
          A cobrança deste restaurante é combinada com o suporte do Comandou.
        </p>
      )}
      {auto && (
        <div className="sub-status__links">
          <button type="button" className="sub-pill" onClick={onMethod} disabled={!owner}>
            {cardAuto ? 'Trocar cartão ou forma' : 'Ligar cobrança automática'}
          </button>
          <a className="sub-pill" href="#faturas">
            Ver faturas
          </a>
        </div>
      )}
      {auto && !owner && (
        <p className="sub-muted">Só o administrador do restaurante muda o pagamento e o plano.</p>
      )}
    </section>
  );
}

/** Só planos antigos têm limite: no valor único não há nada para medir. */
const hasLimits = (u: TenantSubscription) =>
  !!u.current && RESOURCES.some((r) => u.current!.plan.limits[r] !== null);

function UsagePanel({ data }: { data: TenantSubscription }) {
  const cur = data.current!;
  return (
    <section className="sub-panel" aria-label="Uso do mês">
      <h2 className="sub-h2">Uso do mês</h2>
      <div className="sub-usage">
        {RESOURCES.map((r) => {
          const limit = cur.plan.limits[r];
          const used = data.usage[r];
          const full = limit !== null && used >= limit;
          return (
            <div key={r} className="sub-usage__row" data-testid={`usage-${r}`}>
              <div className="sub-usage__top">
                <span>{RESOURCE_LABELS[r]}</span>
                <span className="sub-usage__num">
                  {used.toLocaleString('pt-BR')}
                  <span className="sub-muted">
                    {' '}
                    / {limit?.toLocaleString('pt-BR') ?? 'sem limite'}
                  </span>
                </span>
              </div>
              {limit !== null && (
                <div
                  className="sub-meter sub-meter--thin"
                  role="progressbar"
                  aria-label={RESOURCE_LABELS[r]}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={Math.min(used, limit)}
                >
                  <span
                    style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
                    data-low={full || undefined}
                  />
                </div>
              )}
              {full && (
                <span className="sub-warn">
                  Limite do plano antigo: some quando a mensalidade passar para o valor único
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ContractPanel({ c }: { c: BillingView['contract'] }) {
  if (c.phase === 'none' && !c.renewal) return null;
  return (
    <section className="sub-panel" aria-label="Contrato">
      <h2 className="sub-h2">Contrato</h2>
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
    </section>
  );
}

// ---------------------------------------------------------------- coluna principal
/** Valor único: o mesmo preço para qualquer restaurante, com tudo do sistema e sem limites. */
function SinglePrice({ view }: { view: BillingView }) {
  const plan = singlePlan(view.plans);
  if (!plan) return null;
  return (
    <>
      <section className="sub-hero2" aria-label="Preço do Comandou">
        <span className="sub-chip">{plan.name}</span>
        <h2 className="sub-single__price">
          {brl(plan.priceMonthly)} <small>por mês</small>
        </h2>
        <p>
          Valor único: o mesmo preço para qualquer número de pessoas, produtos e pedidos. Tudo do
          sistema incluso, sem plano maior e sem cobrança por usuário.
        </p>
      </section>
      <section className="sub-panel" aria-label="O que está incluso">
        <h2 className="sub-h2">O que está incluso</h2>
        <ul className="sub-single__list">
          {singlePlanList(plan).map((b) => (
            <li key={b}>
              <Check size={15} aria-hidden />
              {b}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function MethodPanel({
  view,
  owner,
  onEdit,
}: {
  view: BillingView;
  owner: boolean;
  onEdit(): void;
}) {
  const method = view.payment?.method ?? null;
  const card = view.payment?.card ?? null;
  const cardOn = !!view.billing.cardAvailable;
  const items: { k: PayMethod; icon: ReactNode; title: string; sub: string }[] = [
    {
      k: 'card',
      icon: <CreditCard size={18} aria-hidden />,
      title: 'Cartão de crédito',
      sub: !cardOn
        ? 'Em breve'
        : card
          ? `${card.brand} •••• ${card.last4} · cobrança automática`
          : 'Automático: cobra sozinho no vencimento',
    },
    {
      k: 'pix',
      icon: <QrCode size={18} aria-hidden />,
      title: 'Pix',
      sub: `Gerado sozinho ${view.billing.invoiceDaysBefore ?? 5} dias antes, chega no e-mail`,
    },
    {
      k: 'boleto',
      icon: <FileText size={18} aria-hidden />,
      title: 'Boleto',
      sub: 'Compensa em até 3 dias úteis',
    },
  ];
  const active: PayMethod = method === 'card' && !card ? 'pix' : (method ?? 'pix');
  return (
    <section aria-label="Forma de pagamento">
      <div className="sub-sec-head">
        <h2 className="sub-h2">Forma de pagamento</h2>
        {owner && (
          <button type="button" className="sub-link sub-link--btn" onClick={onEdit}>
            Alterar
          </button>
        )}
      </div>
      <div className="sub-methods">
        {items.map((m) => (
          <div
            key={m.k}
            className="sub-method"
            data-on={active === m.k || undefined}
            data-off={(m.k === 'card' && !cardOn) || undefined}
          >
            <span className="sub-method__icon">{m.icon}</span>
            <span className="sub-method__text">
              <strong>{m.title}</strong>
              <span className="sub-muted">{m.sub}</span>
            </span>
            {active === m.k && <span className="sub-tag">Em uso</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Invoices({ list, onPay }: { list: Invoice[]; onPay(i: Invoice): void }) {
  return (
    <section aria-label="Faturas" id="faturas">
      <div className="sub-sec-head">
        <h2 className="sub-h2">Faturas</h2>
      </div>
      <div className="sub-panel sub-panel--flush">
        <ul className="sub-list">
          {list.map((i) => (
            <li key={i.id} className="sub-row">
              <div className="sub-row__main">
                <span className="sub-row__title">{INVOICE_KIND_LABELS[i.kind]}</span>
                <span className="sub-muted">
                  {i.status === 'paid' && i.paidAt
                    ? `paga em ${day(i.paidAt)}`
                    : `vence em ${day(i.dueDate)}`}
                  {i.billingType && i.billingType !== 'MANUAL' && i.billingType !== 'UNDEFINED'
                    ? ` · ${i.billingType === 'BOLETO' ? 'boleto' : i.billingType === 'PIX' ? 'Pix' : 'cartão'}`
                    : ''}
                </span>
              </div>
              <span className="sub-row__amount">{brl(i.amount)}</span>
              <Badge tone={INVOICE_TONE[i.status]}>{INVOICE_LABELS[i.status]}</Badge>
              <span className="sub-row__action">
                {isOpen(i) && (
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
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- janelas
function MethodModal({
  open,
  view,
  onClose,
  onDone,
}: {
  open: boolean;
  view: BillingView;
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const card = view.payment?.card ?? null;
  const cardOn = !!view.billing.cardAvailable;
  const [pick, setPick] = useState<PayMethod>('pix');
  const [newCard, setNewCard] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const m = view.payment?.method ?? 'pix';
    setPick(m === 'card' && !card ? 'pix' : m);
    setNewCard(false);
  }, [open, view, card]);
  async function save() {
    setBusy(true);
    try {
      await api('/subscription/pay-method', { method: 'PUT', json: { method: pick } });
      toast(
        pick === 'card'
          ? 'Cobrança automática no cartão ligada'
          : `Pagamento por ${METHOD_LABEL[pick]}`,
        'success',
      );
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api('/subscription/card', { method: 'DELETE' });
      toast('Cartão removido. As próximas faturas vêm por Pix.', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  const needCard = pick === 'card' && (!card || newCard);
  return (
    <Modal
      open={open}
      title="Forma de pagamento"
      onClose={onClose}
      footer={
        needCard ? undefined : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Voltar
            </Button>
            <Button onClick={save} loading={busy}>
              Salvar
            </Button>
          </>
        )
      }
    >
      <div className="sub-choice" role="radiogroup" aria-label="Como você quer pagar">
        {(
          [
            [
              'card',
              'Cartão de crédito (automático)',
              'Cobramos sozinhos no dia do vencimento. Você não precisa lembrar.',
            ],
            [
              'pix',
              'Pix',
              `A fatura com o Pix sai ${view.billing.invoiceDaysBefore ?? 5} dias antes e chega no seu e-mail. Você paga no app do banco.`,
            ],
            [
              'boleto',
              'Boleto',
              'Mesma fatura, para pagar no boleto. Compensa em até 3 dias úteis.',
            ],
          ] as const
        ).map(([k, title, sub]) => (
          <label
            key={k}
            className="sub-choice__opt"
            data-on={pick === k || undefined}
            data-off={(k === 'card' && !cardOn) || undefined}
          >
            <input
              type="radio"
              name="pay-method"
              value={k}
              checked={pick === k}
              disabled={k === 'card' && !cardOn}
              onChange={() => setPick(k)}
            />
            <span>
              <strong>{title}</strong>
              <span className="sub-muted">{k === 'card' && !cardOn ? 'Em breve.' : sub}</span>
            </span>
          </label>
        ))}
      </div>
      {pick === 'card' && card && !newCard && (
        <div className="sub-card-saved">
          <CreditCard size={18} aria-hidden />
          <span>
            <strong>
              {card.brand} •••• {card.last4}
            </strong>
            <span className="sub-muted">{card.holderName}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setNewCard(true)}>
            Trocar
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} loading={busy}>
            Remover
          </Button>
        </div>
      )}
      {needCard && (
        <CardForm onCancel={card ? () => setNewCard(false) : onClose} onSaved={onDone} />
      )}
    </Modal>
  );
}

const onlyDigits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);
const fmtCardNumber = (v: string) => onlyDigits(v, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
const fmtExpiry = (v: string) => {
  const d = onlyDigits(v, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

function CardForm({ onCancel, onSaved }: { onCancel(): void; onSaved(): void }) {
  const toast = useToast();
  const [f, setF] = useState({
    holderName: '',
    number: '',
    expiry: '',
    ccv: '',
    document: '',
    email: '',
    phone: '',
    postalCode: '',
    addressNumber: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holderCep = useCepLookup(f.postalCode);
  const set =
    (k: keyof typeof f, fmt?: (v: string) => string) => (e: { target: { value: string } }) =>
      setF((x) => ({ ...x, [k]: fmt ? fmt(e.target.value) : e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{
        brand: string;
        last4: string;
        charged: { ok: boolean; error?: string }[];
      }>('/subscription/card', { method: 'POST', json: f });
      toast(`Cartão ${r.brand} •••• ${r.last4} salvo. Cobrança automática ligada.`, 'success');
      if (r.charged.some((c) => c.ok)) toast('Fatura em aberto paga no cartão', 'success');
      const fail = r.charged.find((c) => !c.ok);
      if (fail) toast(`A fatura em aberto não passou no cartão: ${fail.error ?? ''}`, 'danger');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="sub-cardform" onSubmit={submit}>
      <TextField
        label="Número do cartão"
        inputMode="numeric"
        autoComplete="cc-number"
        value={f.number}
        onChange={set('number', fmtCardNumber)}
        wrapClass="sub-cardform__full"
      />
      <TextField
        label="Nome impresso no cartão"
        autoComplete="cc-name"
        value={f.holderName}
        onChange={set('holderName')}
        wrapClass="sub-cardform__full"
      />
      <TextField
        label="Validade (MM/AA)"
        inputMode="numeric"
        autoComplete="cc-exp"
        placeholder="08/29"
        value={f.expiry}
        onChange={set('expiry', fmtExpiry)}
      />
      <TextField
        label="Código de segurança"
        inputMode="numeric"
        autoComplete="cc-csc"
        value={f.ccv}
        onChange={set('ccv', (v) => onlyDigits(v, 4))}
      />
      <TextField
        label="CPF ou CNPJ do titular"
        inputMode="numeric"
        value={f.document}
        onChange={set('document', (v) => onlyDigits(v, 14))}
      />
      <TextField
        label="Celular do titular"
        inputMode="tel"
        autoComplete="tel"
        value={f.phone}
        onChange={set('phone', (v) => onlyDigits(v, 11))}
      />
      <TextField
        label="E-mail do titular"
        type="email"
        autoComplete="email"
        value={f.email}
        onChange={set('email')}
        wrapClass="sub-cardform__full"
      />
      <TextField
        label="CEP"
        inputMode="numeric"
        autoComplete="postal-code"
        value={f.postalCode}
        onChange={set('postalCode', (v) => onlyDigits(v, 8))}
        hint={
          holderCep.state === 'busy'
            ? 'Buscando o endereço…'
            : holderCep.address
              ? [
                  holderCep.address.street,
                  holderCep.address.district,
                  `${holderCep.address.city}/${holderCep.address.state}`,
                ]
                  .filter(Boolean)
                  .join(', ')
              : holderCep.state === 'missing'
                ? 'CEP não encontrado. Confira.'
                : undefined
        }
      />
      <TextField
        label="Número do endereço"
        value={f.addressNumber}
        onChange={set('addressNumber', (v) => v.slice(0, 10))}
      />
      <p className="sub-muted sub-cardform__full">
        Os dados do cartão vão direto para o Asaas, nosso banco de cobrança. O Comandou guarda só a
        bandeira e os 4 últimos números. Cobramos apenas a mensalidade, no dia do vencimento.
      </p>
      {error && (
        <div className="sub-cardform__full">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="sub-cardform__actions sub-cardform__full">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Voltar
        </Button>
        <Button type="submit" loading={busy}>
          Salvar cartão e ligar automático
        </Button>
      </div>
    </form>
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
  view,
  owner,
  onClose,
  onPaid,
}: {
  invoice: Invoice | null;
  view: BillingView;
  owner: boolean;
  onClose(): void;
  onPaid(): void;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pix' | 'boleto' | 'card'>('pix');
  const [checking, setChecking] = useState(false);
  const [charging, setCharging] = useState(false);
  const card = view.billing.cardAvailable ? (view.payment?.card ?? null) : null;
  const preferred = view.payment?.method ?? 'pix';
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
    setTab(preferred);
    void fetchInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchInfo]);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copiado', 'success');
    } catch {
      toast('Não deu para copiar: selecione o texto', 'danger');
    }
  }
  async function payWithCard() {
    if (!invoice) return;
    setCharging(true);
    try {
      const r = await api<{ ok: boolean; error?: string }>(
        `/subscription/invoices/${invoice.id}/card`,
        { method: 'POST' },
      );
      if (r.ok) {
        toast('Pago no cartão. Obrigado!', 'success');
        onPaid();
      } else toast(`Cartão recusado: ${r.error ?? ''}`, 'danger');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setCharging(false);
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
              {card && owner && (
                <>
                  <p>
                    Pagar com o cartão salvo{' '}
                    <strong>
                      {card.brand} •••• {card.last4}
                    </strong>
                  </p>
                  <Button onClick={payWithCard} loading={charging}>
                    Pagar {invoice ? brl(invoice.amount) : ''} no cartão
                  </Button>
                  <p className="sub-muted">Ou use outro cartão na página segura do Asaas:</p>
                </>
              )}
              {!card && (
                <p className="sub-muted">
                  O pagamento com cartão é feito na página segura do Asaas. Os dados do cartão não
                  passam pelo Comandou.
                </p>
              )}
              {info.invoiceUrl ? (
                <a
                  href={info.invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`cm-btn ${card && owner ? 'cm-btn--secondary' : 'cm-btn--primary'}`}
                >
                  {card && owner ? 'Usar outro cartão' : 'Pagar com cartão'}
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
