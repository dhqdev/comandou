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
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, useCan } from '../app/auth';
import { Alert, Badge, Button, Modal, Skeleton, useToast } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { TenantSubscription } from '../lib/types';
import { singlePlan, singlePlanList } from './pricing-data';
import { CardForm } from './subscription/CardForm';
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
  const navigate = useNavigate();
  const pay = (i: Invoice) => navigate(`/plano/pagar/${i.id}`);
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
  if (!data && !usage) return <Skeleton variant="page" />;
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
          onPay={pay}
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
        {data.invoices.length > 0 && <Invoices list={data.invoices} onPay={pay} />}
      </div>
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
      <section className="sub-panel sub-included" aria-label="O que está incluso">
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
