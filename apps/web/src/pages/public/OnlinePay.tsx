import { BadgeCheck, Clock3, CreditCard, LockKeyhole, RotateCcw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { brl } from '../../lib/money';
import { PixPay } from './PixPay';
import { Field } from './ui';
import './online-pay.css';

/** O que o cardápio oferece pelo app (PagBank conectado). */
export interface PublicOnlinePay {
  card: boolean;
  pix: boolean;
  publicKey: string | null;
  env: 'SANDBOX' | 'PROD';
}

/** Pagamento do pedido pelo app, como o acompanhamento mostra. */
export interface OnlinePayView {
  method: 'card' | 'pix';
  status: 'waiting' | 'pending' | 'paid' | 'declined' | 'expired' | 'refund_due' | 'refunded';
  amount: string;
  card: { brand: string | null; last4: string | null } | null;
  declineReason: string | null;
  pix: { code: string; expiresAt: string | null } | null;
  cardAttemptsLeft: number;
  canPay: boolean;
  processing: boolean;
  /** O que a loja aceita agora pelo app (null: desligou depois do pedido). */
  offer: PublicOnlinePay | null;
}

export interface CardInput {
  number: string;
  holder: string;
  expiry: string;
  cvv: string;
}
export interface PayerInput {
  cpf: string;
  email: string;
}
export const EMPTY_CARD: CardInput = { number: '', holder: '', expiry: '', cvv: '' };

const SDK = 'https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js';

interface PagSeguroSdk {
  encryptCard(c: {
    publicKey: string;
    holder: string;
    number: string;
    expMonth: string;
    expYear: string;
    securityCode: string;
  }): { encryptedCard?: string; hasErrors: boolean; errors?: { code: string; message: string }[] };
}

let sdk: Promise<PagSeguroSdk> | null = null;
/** SDK do PagBank: só carrega quando o cliente escolhe cartão pelo app. */
export function loadPagBank(): Promise<PagSeguroSdk> {
  const w = window as unknown as { PagSeguro?: PagSeguroSdk };
  if (w.PagSeguro) return Promise.resolve(w.PagSeguro);
  sdk ??= new Promise<PagSeguroSdk>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK;
    s.async = true;
    s.onload = () => (w.PagSeguro ? resolve(w.PagSeguro) : reject(new Error('sdk')));
    s.onerror = () => {
      sdk = null;
      reject(new Error('sdk'));
    };
    document.head.appendChild(s);
  });
  return sdk;
}

const ERRORS: Record<string, string> = {
  INVALID_NUMBER: 'Número do cartão inválido',
  INVALID_SECURITY_CODE: 'Código de segurança inválido',
  INVALID_EXPIRATION_MONTH: 'Validade inválida',
  INVALID_EXPIRATION_YEAR: 'Validade inválida',
  INVALID_HOLDER: 'Nome do titular inválido',
  INVALID_PUBLIC_KEY: 'A loja precisa reconectar o PagBank. Pague de outro jeito.',
};

const digits = (v: string) => v.replace(/\D/g, '');

/** Cifra o cartão no aparelho: só o resultado vai para o servidor. */
export async function encryptCard(publicKey: string, c: CardInput): Promise<string> {
  const [mm, yy] = c.expiry.split('/');
  let ps: PagSeguroSdk;
  try {
    ps = await loadPagBank();
  } catch {
    throw new Error('Não deu para carregar o pagamento com cartão. Confira a internet.');
  }
  const r = ps.encryptCard({
    publicKey,
    holder: c.holder.trim(),
    number: digits(c.number),
    expMonth: (mm ?? '').padStart(2, '0'),
    expYear: (yy ?? '').length === 2 ? `20${yy}` : (yy ?? ''),
    securityCode: digits(c.cvv),
  });
  if (r.hasErrors || !r.encryptedCard)
    throw new Error(ERRORS[r.errors?.[0]?.code ?? ''] ?? 'Confira os dados do cartão');
  return r.encryptedCard;
}

/** O que falta no cartão e no CPF/e-mail (null = pronto). */
export function cardMissing(c: CardInput): string | null {
  const n = digits(c.number);
  if (n.length < 13 || n.length > 19) return 'o número do cartão';
  if (!/^[A-Za-zÀ-ÿ' ]+ [A-Za-zÀ-ÿ' ]+$/.test(c.holder.trim())) return 'o nome como está no cartão';
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(c.expiry)) return 'a validade (MM/AA)';
  if (!/^\d{3,4}$/.test(c.cvv)) return 'o código de segurança';
  return null;
}
export function payerMissing(p: PayerInput): string | null {
  if (digits(p.cpf).length !== 11) return 'o CPF de quem paga';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) return 'o e-mail para o recibo';
  return null;
}

const maskCard = (v: string) =>
  digits(v)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
const maskExpiry = (v: string) => {
  const d = digits(v).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};
const maskCpf = (v: string) => {
  const d = digits(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
};

/** Número, nome, validade e código do cartão. Nada disso é guardado. */
export function CardFields({
  value,
  onChange,
  disabled,
}: {
  value: CardInput;
  onChange(v: CardInput): void;
  disabled?: boolean;
}) {
  const set = (k: keyof CardInput, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="opay__fields">
      <Field label="Número do cartão" wide>
        <input
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="0000 0000 0000 0000"
          value={value.number}
          disabled={disabled}
          onChange={(e) => set('number', maskCard(e.target.value))}
        />
      </Field>
      <Field label="Nome no cartão" wide>
        <input
          autoComplete="cc-name"
          value={value.holder}
          disabled={disabled}
          onChange={(e) => set('holder', e.target.value.slice(0, 120))}
        />
      </Field>
      <Field label="Validade">
        <input
          inputMode="numeric"
          autoComplete="cc-exp"
          placeholder="MM/AA"
          value={value.expiry}
          disabled={disabled}
          onChange={(e) => set('expiry', maskExpiry(e.target.value))}
        />
      </Field>
      <Field label="Código de segurança">
        <input
          inputMode="numeric"
          autoComplete="cc-csc"
          placeholder="CVV"
          value={value.cvv}
          disabled={disabled}
          onChange={(e) => set('cvv', digits(e.target.value).slice(0, 4))}
        />
      </Field>
    </div>
  );
}

/** CPF e e-mail de quem paga (o PagBank pede; não ficam guardados no Comandou). */
export function PayerFields({
  value,
  onChange,
  disabled,
}: {
  value: PayerInput;
  onChange(v: PayerInput): void;
  disabled?: boolean;
}) {
  return (
    <div className="opay__fields">
      <Field label="CPF de quem paga">
        <input
          inputMode="numeric"
          placeholder="000.000.000-00"
          value={value.cpf}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, cpf: maskCpf(e.target.value) })}
        />
      </Field>
      <Field label="E-mail para o recibo">
        <input
          type="email"
          autoComplete="email"
          value={value.email}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, email: e.target.value.trim() })}
        />
      </Field>
    </div>
  );
}

/** Aviso de segurança curto embaixo do cartão. */
export function SecureNote() {
  return (
    <p className="opay__secure">
      <LockKeyhole size={14} aria-hidden /> Pagamento pelo PagBank. Os dados do cartão são
      protegidos no seu celular e não ficam com a loja.
    </p>
  );
}

/** Paga o pedido pelo app (cartão já cifrado ou Pix). `base`: link do pedido ou da conta. */
export function payOnline(
  base: string,
  b:
    | { method: 'card'; encryptedCard: string; holderName: string; cpf: string; email: string }
    | { method: 'pix'; cpf: string; email: string },
) {
  const { method, ...json } = b;
  return api<OnlinePayView>(`${base}/pay/${method}`, {
    method: 'POST',
    json,
  });
}

/**
 * Pagamento pelo app no acompanhamento: Pix com o QR Code (confirma sozinho), cartão aprovado,
 * recusado (tenta outro, até o limite) ou devolvido.
 */
export function OnlineTrack({
  online,
  base,
  defaultEmail,
  onChange,
}: {
  online: OnlinePayView;
  /** /store/orders/:token ou /store/account/orders/:id */
  base: string;
  defaultEmail?: string | null;
  onChange(): Promise<void>;
}) {
  const [card, setCard] = useState<CardInput>(EMPTY_CARD);
  const [payer, setPayer] = useState<PayerInput>({ cpf: '', email: defaultEmail ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const isCard = online.method === 'card';
  const offer = online.offer;
  const publicKey = offer?.publicKey ?? null;
  const canCard = isCard && !!offer?.card && online.cardAttemptsLeft > 0;
  const canPix = !!offer?.pix;

  async function payNow(method: 'card' | 'pix') {
    setError(null);
    const miss = payerMissing(payer) ?? (method === 'card' ? cardMissing(card) : null);
    if (miss) return setError(`Falta ${miss}.`);
    setBusy(true);
    try {
      if (method === 'card') {
        if (!publicKey) throw new Error('Cartão pelo app indisponível agora. Fale com a loja.');
        const encryptedCard = await encryptCard(publicKey, card);
        await payOnline(base, {
          method: 'card',
          encryptedCard,
          holderName: card.holder.trim(),
          ...payer,
        });
        setCard(EMPTY_CARD);
      } else await payOnline(base, { method: 'pix', ...payer });
      setRetry(false);
      await onChange();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Não deu certo');
    } finally {
      setBusy(false);
    }
  }

  const paid = online.status === 'paid';
  return (
    <section className="track__card track__pix opay">
      <h2>{isCard ? 'Pagamento com cartão' : 'Pagamento por Pix'}</h2>
      {paid ? (
        <p className="pixpay__state" data-tone="ok">
          <BadgeCheck size={18} aria-hidden />
          <span>
            <strong>Pagamento aprovado</strong>
            <small>
              {brl(online.amount)}
              {online.card?.last4 ? ` no cartão final ${online.card.last4}` : ' pelo Pix'}. Bom
              apetite!
            </small>
          </span>
        </p>
      ) : online.status === 'refund_due' || online.status === 'refunded' ? (
        <p className="pixpay__state">
          <RotateCcw size={18} aria-hidden />
          <span>
            <strong>
              {online.status === 'refunded' ? 'Valor devolvido' : 'Devolução a caminho'}
            </strong>
            <small>
              {brl(online.amount)}{' '}
              {online.method === 'card' ? 'voltam no seu cartão' : 'voltam pelo Pix'}.
            </small>
          </span>
        </p>
      ) : online.processing ? (
        <p className="pixpay__state">
          <Clock3 size={18} aria-hidden />
          <span>
            <strong>Confirmando o pagamento</strong>
            <small>Esta página avisa assim que o banco responder.</small>
          </span>
        </p>
      ) : online.status === 'declined' ? (
        <p className="pixpay__state" data-tone="bad">
          <XCircle size={18} aria-hidden />
          <span>
            <strong>{online.declineReason ?? 'Cartão recusado'}</strong>
            <small>
              {online.cardAttemptsLeft > 0
                ? 'Tente outro cartão ou pague com Pix.'
                : 'Muitas tentativas com cartão. Pague com Pix ou fale com a loja.'}
            </small>
          </span>
        </p>
      ) : null}

      {online.pix && <PixPay code={online.pix.code} amount={online.amount} payee={null} auto />}

      {online.canPay && !online.pix && (canCard || canPix) && (
        <div className="opay__again">
          {online.status !== 'pending' || retry ? (
            <>
              <PayerFields value={payer} onChange={setPayer} disabled={busy} />
              {canCard && (
                <>
                  <CardFields value={card} onChange={setCard} disabled={busy} />
                  <SecureNote />
                </>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="opay__actions">
                {canCard && (
                  <button
                    type="button"
                    className="cta"
                    disabled={busy}
                    onClick={() => void payNow('card')}
                  >
                    <CreditCard size={16} aria-hidden />{' '}
                    {busy ? 'Pagando…' : `Pagar ${brl(online.amount)}`}
                  </button>
                )}
                {canPix && (
                  <button
                    type="button"
                    className={canCard ? 'btn-line' : 'cta'}
                    disabled={busy}
                    onClick={() => void payNow('pix')}
                  >
                    {busy && !canCard ? 'Gerando o Pix…' : 'Pagar com Pix'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <button type="button" className="link" onClick={() => setRetry(true)}>
              Pagar de novo
            </button>
          )}
        </div>
      )}
    </section>
  );
}
