import { INVOICE_KIND_LABELS } from '@comandou/shared';
import { ArrowLeft, Check, Copy, CreditCard, FileText, Lock, QrCode } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth, useCan } from '../../app/auth';
import { Alert, Button, Skeleton, useToast } from '../../design-system';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import type { BillingView, Invoice, PayMethod } from '../PlanPage';
import { CardForm, type CardSaved } from './CardForm';
import './pay.css';

interface PayInfo {
  paid: boolean;
  amount?: string;
  pix: { image: string; payload: string; expiresAt?: string } | null;
  boleto: { line: string; url: string | null } | null;
  invoiceUrl: string | null;
}

const POLL_MS = 5_000;
/** A cada quantas conferências a tela pergunta ao Asaas (as outras só leem o banco). */
const ASK_EVERY = 6;
/** Para de esperar sozinha depois de 15 minutos (o botão "Já paguei" continua valendo). */
const POLL_MAX = 180;

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—';

/** Dias entre hoje e o vencimento (negativo: venceu). */
function daysTo(iso: string) {
  const due = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / 86_400_000);
}

function dueText(iso: string): { text: string; tone: 'ok' | 'warn' | 'late' } {
  const d = daysTo(iso);
  if (d > 1) return { text: `Vence em ${day(iso)}`, tone: 'ok' };
  if (d === 1) return { text: 'Vence amanhã', tone: 'warn' };
  if (d === 0) return { text: 'Vence hoje', tone: 'warn' };
  return { text: `Venceu em ${day(iso)}`, tone: 'late' };
}

/**
 * Tela de pagamento da assinatura (`/plano/pagar/:id`): resumo da fatura à esquerda e, à direita,
 * Pix (com espera automática), boleto ou cartão. No cartão, pagar já salva o cartão no Asaas e liga
 * a cobrança automática no dia do vencimento.
 */
export function PayPage() {
  const canPlan = useCan('plan:read');
  if (!canPlan)
    return <Alert tone="info">Só o administrador ou o gerente veem a assinatura.</Alert>;
  return <Checkout />;
}

function Checkout() {
  const { invoiceId = '' } = useParams();
  const { me } = useAuth();
  const owner = me?.user.role === 'owner';
  const toast = useToast();
  const [view, setView] = useState<BillingView | null>(null);
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [method, setMethod] = useState<PayMethod>('pix');
  const [checking, setChecking] = useState(false);

  const loadView = useCallback(
    () =>
      api<BillingView | null>('/subscription/billing').then((v) => {
        setView(v);
        return v;
      }),
    [],
  );

  useEffect(() => {
    let alive = true;
    loadView()
      .then(async (v) => {
        const inv = v?.invoices.find((i) => i.id === invoiceId);
        if (!alive || !v || !inv) return;
        const card = v.billing.cardAvailable ? v.payment?.card : null;
        const pref = v.payment?.method;
        setMethod(pref === 'card' && card ? 'card' : pref === 'boleto' ? 'boleto' : 'pix');
        if (inv.status === 'paid') return setPaid(true);
        if (inv.status !== 'pending' && inv.status !== 'overdue') return;
        const r = await api<PayInfo>(`/subscription/invoices/${inv.id}/pay`);
        if (!alive) return;
        if (r.paid) setPaid(true);
        else setInfo(r);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [invoiceId, loadView]);

  const confirmed = useCallback(() => {
    setPaid(true);
    void loadView().catch(() => undefined);
  }, [loadView]);

  const check = useCallback(
    async (ask: boolean) => {
      const r = await api<{ paid: boolean }>(
        `/subscription/invoices/${invoiceId}/status${ask ? '?asaas=1' : ''}`,
      );
      if (r.paid) confirmed();
      return r.paid;
    },
    [invoiceId, confirmed],
  );

  // Esperando o Pix: confere sozinho e troca a tela quando o pagamento cair.
  const waiting = method === 'pix' && !!info?.pix && !paid;
  const ticks = useRef(0);
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => {
      if (document.hidden || ticks.current >= POLL_MAX) return;
      ticks.current += 1;
      void check(ticks.current % ASK_EVERY === 0).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [waiting, check]);

  if (error)
    return (
      <div className="pay">
        <BackLink />
        <Alert tone="danger">{error}</Alert>
      </div>
    );
  if (!view) return <Skeleton variant="detail" />;
  const invoice = view.invoices.find((i) => i.id === invoiceId);
  if (!invoice || !view.subscription)
    return (
      <div className="pay">
        <BackLink />
        <Alert tone="warning">Fatura não encontrada. Ela pode ter sido cancelada.</Alert>
      </div>
    );
  const open = invoice.status === 'pending' || invoice.status === 'overdue';
  const cardOn = !!view.billing.cardAvailable;
  const savedCard = cardOn ? (view.payment?.card ?? null) : null;

  return (
    <div className="pay">
      <Summary view={view} invoice={invoice} paid={paid} />
      <section className="pay-main" aria-label="Pagamento">
        {paid ? (
          <Done view={view} />
        ) : !open ? (
          <Alert tone="info">Esta fatura não tem pagamento em aberto.</Alert>
        ) : (
          <>
            <h1 className="pay-h">Como você quer pagar</h1>
            <Methods value={method} onChange={setMethod} cardOn={cardOn} card={savedCard} />
            {!info ? (
              <div className="pay-panel pay-panel--wait">
                <Skeleton variant="form" rows={3} />
              </div>
            ) : (
              <div className="pay-panel" key={method}>
                {method === 'pix' && <PixPanel info={info} amount={invoice.amount} />}
                {method === 'boleto' && <BoletoPanel info={info} />}
                {method === 'card' && (
                  <CardPanel
                    invoice={invoice}
                    info={info}
                    owner={owner}
                    cardOn={cardOn}
                    card={savedCard}
                    onPaid={confirmed}
                  />
                )}
              </div>
            )}
            {method !== 'card' && info && (
              <div className="pay-foot">
                <span className="sub-muted">
                  {method === 'pix'
                    ? 'Pix cai em segundos e o acesso é liberado na hora.'
                    : 'O boleto é confirmado pelo banco em até 3 dias úteis.'}
                </span>
                <Button
                  variant="secondary"
                  loading={checking}
                  onClick={async () => {
                    setChecking(true);
                    try {
                      if (!(await check(true)))
                        toast(
                          method === 'pix'
                            ? 'Ainda não recebemos. O Pix pode levar alguns segundos.'
                            : 'Ainda não recebemos. O boleto leva até 3 dias úteis.',
                          'neutral',
                        );
                    } catch (e) {
                      toast((e as Error).message, 'danger');
                    } finally {
                      setChecking(false);
                    }
                  }}
                >
                  Já paguei
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link className="pay-back" to="/plano">
      <ArrowLeft size={16} aria-hidden />
      Assinatura
    </Link>
  );
}

// ---------------------------------------------------------------- resumo
function Summary({ view, invoice, paid }: { view: BillingView; invoice: Invoice; paid: boolean }) {
  const s = view.subscription!;
  const due = dueText(invoice.dueDate);
  const isPaid = paid || invoice.status === 'paid';
  const auto =
    view.billing.cardAvailable && view.payment?.method === 'card' ? view.payment.card : null;
  return (
    <aside className="pay-sum" aria-label="Resumo">
      <BackLink />
      <div className="pay-sum__body">
        <span className="pay-sum__kind">
          {INVOICE_KIND_LABELS[invoice.kind]} · Plano {s.planName}
        </span>
        <div className="pay-sum__amount" data-testid="pay-amount">
          {brl(invoice.amount)}
        </div>
        {invoice.description && <p className="pay-sum__desc">{invoice.description}</p>}
        <p className="pay-sum__due">
          <span className="pay-dot" data-tone={isPaid ? 'paid' : due.tone} aria-hidden />
          {isPaid ? 'Pago' : due.text}
        </p>
      </div>
      <dl className="pay-sum__kv">
        {s.accessUntil && (
          <div>
            <dt>{isPaid ? 'Liberado até' : 'Acesso atual até'}</dt>
            <dd>{day(s.accessUntil)}</dd>
          </div>
        )}
        <div>
          <dt>Cobrança automática</dt>
          <dd>{auto ? `Cartão •••• ${auto.last4}` : 'Desligada'}</dd>
        </div>
      </dl>
      <p className="pay-safe">
        <Lock size={14} aria-hidden />
        Pagamento processado pelo Asaas. Os dados do cartão não passam pelo Comandou.
      </p>
    </aside>
  );
}

// ---------------------------------------------------------------- formas
function Methods({
  value,
  onChange,
  cardOn,
  card,
}: {
  value: PayMethod;
  onChange(m: PayMethod): void;
  cardOn: boolean;
  card: { brand: string; last4: string } | null;
}) {
  const items: { k: PayMethod; icon: ReactNode; title: string; sub: string }[] = [
    { k: 'pix', icon: <QrCode size={20} aria-hidden />, title: 'Pix', sub: 'Na hora' },
    {
      k: 'boleto',
      icon: <FileText size={20} aria-hidden />,
      title: 'Boleto',
      sub: '1 a 3 dias úteis',
    },
    {
      k: 'card',
      icon: <CreditCard size={20} aria-hidden />,
      title: 'Cartão',
      sub: card ? `•••• ${card.last4}` : cardOn ? 'Automático' : 'Na hora',
    },
  ];
  return (
    <div className="pay-methods" role="radiogroup" aria-label="Forma de pagamento">
      {items.map((m) => (
        <button
          key={m.k}
          type="button"
          role="radio"
          aria-checked={value === m.k}
          className="pay-method"
          onClick={() => onChange(m.k)}
        >
          <span className="pay-method__icon">{m.icon}</span>
          <span className="pay-method__title">{m.title}</span>
          <span className="pay-method__sub">{m.sub}</span>
        </button>
      ))}
    </div>
  );
}

function useCopy() {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 2000);
    } catch {
      toast('Não deu para copiar: selecione o texto', 'danger');
    }
  }
  return { done, copy };
}

function PixPanel({ info, amount }: { info: PayInfo; amount: string }) {
  const { done, copy } = useCopy();
  if (!info.pix)
    return <p className="sub-muted">Pix indisponível para esta fatura. Use boleto ou cartão.</p>;
  return (
    <div className="pay-pix">
      <div className="pay-qr">
        <img
          src={`data:image/png;base64,${info.pix.image}`}
          alt="QR Code do Pix"
          width={208}
          height={208}
        />
      </div>
      <div className="pay-pix__side">
        <ol className="pay-steps">
          <li>Abra o app do seu banco e escolha Pix.</li>
          <li>Leia o QR Code ou use o Pix Copia e Cola.</li>
          <li>Confira o valor de {brl(amount)} e confirme.</li>
        </ol>
        <div className="pay-code">
          <code>{info.pix.payload}</code>
        </div>
        <Button
          block
          size="lg"
          icon={done ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
          onClick={() => copy(info.pix!.payload)}
        >
          {done ? 'Código copiado' : 'Copiar código Pix'}
        </Button>
        <p className="pay-waiting" role="status">
          <span className="pay-pulse" aria-hidden />
          Esperando o pagamento. A tela muda sozinha quando cair.
        </p>
      </div>
    </div>
  );
}

function BoletoPanel({ info }: { info: PayInfo }) {
  const { done, copy } = useCopy();
  if (!info.boleto) return <p className="sub-muted">Boleto indisponível para esta fatura.</p>;
  return (
    <div className="pay-boleto">
      <span className="pay-label">Linha digitável</span>
      <div className="pay-code pay-code--line">
        <code>{info.boleto.line}</code>
      </div>
      <div className="pay-actions">
        <Button
          size="lg"
          icon={done ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
          onClick={() => copy(info.boleto!.line.replace(/\D/g, ''))}
        >
          {done ? 'Linha copiada' : 'Copiar linha digitável'}
        </Button>
        {info.boleto.url && (
          <a
            href={info.boleto.url}
            target="_blank"
            rel="noreferrer"
            className="cm-btn cm-btn--secondary cm-btn--lg"
          >
            <FileText size={18} aria-hidden />
            Abrir o boleto em PDF
          </a>
        )}
      </div>
    </div>
  );
}

function CardPanel({
  invoice,
  info,
  owner,
  cardOn,
  card,
  onPaid,
}: {
  invoice: Invoice;
  info: PayInfo;
  owner: boolean;
  cardOn: boolean;
  card: { brand: string; last4: string; holderName: string } | null;
  onPaid(): void;
}) {
  const [other, setOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(invoice.data?.cardError ?? null);

  async function charge() {
    setBusy(true);
    setFail(null);
    try {
      const r = await api<{ ok: boolean; error?: string }>(
        `/subscription/invoices/${invoice.id}/card`,
        { method: 'POST' },
      );
      if (r.ok) onPaid();
      else setFail(r.error ?? 'Cartão recusado');
    } catch (e) {
      setFail((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saved(r: CardSaved) {
    // Salvar o cartão já paga a fatura vencida; esta pode ainda não ter vencido.
    const bad = r.charged.find((c) => !c.ok);
    if (bad) return setFail(bad.error ?? 'Cartão recusado');
    const st = await api<{ paid: boolean }>(`/subscription/invoices/${invoice.id}/status`).catch(
      () => ({ paid: false }),
    );
    if (st.paid) onPaid();
    else await charge();
  }

  const asaasLink = info.invoiceUrl && (
    <a
      href={info.invoiceUrl}
      target="_blank"
      rel="noreferrer"
      className={cardOn && owner ? 'sub-link pay-once' : 'cm-btn cm-btn--lg cm-btn--primary'}
    >
      {cardOn && owner ? 'Pagar só esta vez, sem salvar o cartão' : 'Pagar com cartão'}
    </a>
  );

  if (!cardOn || !owner)
    return (
      <div className="pay-card">
        <p className="pay-text">
          {!owner
            ? 'Só o administrador do restaurante salva o cartão para a cobrança automática. Para pagar só esta fatura, use a página segura do Asaas.'
            : 'Você paga esta fatura com cartão na página segura do Asaas.'}
        </p>
        {asaasLink ?? <p className="sub-muted">Página de pagamento indisponível.</p>}
      </div>
    );

  return (
    <div className="pay-card">
      {fail && (
        <Alert tone="danger">Cartão recusado: {fail}. Tente outro cartão, Pix ou boleto.</Alert>
      )}
      {card && !other ? (
        <>
          <div className="pay-saved">
            <CreditCard size={20} aria-hidden />
            <span className="pay-saved__text">
              <strong>
                {card.brand} •••• {card.last4}
              </strong>
              <span className="sub-muted">{card.holderName}</span>
            </span>
            <button type="button" className="sub-link sub-link--btn" onClick={() => setOther(true)}>
              Usar outro
            </button>
          </div>
          <Button block size="lg" loading={busy} onClick={charge}>
            Pagar {brl(invoice.amount)}
          </Button>
          <p className="pay-auto">
            <span className="pay-dot" data-tone="paid" aria-hidden />
            Cobrança automática ligada: as próximas mensalidades saem sozinhas neste cartão no dia
            do vencimento.
          </p>
        </>
      ) : (
        <>
          <p className="pay-text">
            Pague agora e deixe o cartão salvo: nas próximas vezes, a mensalidade sai sozinha no dia
            do vencimento. Dá para trocar ou tirar o cartão quando quiser em Assinatura.
          </p>
          <CardForm
            quiet
            submitLabel={`Pagar ${brl(invoice.amount)} e ligar automático`}
            onCancel={card ? () => setOther(false) : undefined}
            onSaved={saved}
          />
          {asaasLink}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pago
function Done({ view }: { view: BillingView }) {
  const navigate = useNavigate();
  const s = view.subscription!;
  const cardAuto =
    !!view.billing.cardAvailable && view.payment?.method === 'card' && !!view.payment.card;
  return (
    <div className="pay-done" role="status">
      <span className="pay-done__mark" aria-hidden>
        <Check size={30} strokeWidth={2.5} />
      </span>
      <h1 className="pay-done__title">Pagamento confirmado</h1>
      <p className="pay-text">
        Obrigado!
        {s.accessUntil ? ` O Comandou está liberado até ${day(s.accessUntil)}.` : ''}
      </p>
      {cardAuto && (
        <p className="sub-muted">
          As próximas mensalidades saem sozinhas no cartão {view.payment!.card!.brand} ••••{' '}
          {view.payment!.card!.last4}, no dia do vencimento.
        </p>
      )}
      <Button size="lg" onClick={() => navigate('/plano')}>
        Voltar para a assinatura
      </Button>
    </div>
  );
}
