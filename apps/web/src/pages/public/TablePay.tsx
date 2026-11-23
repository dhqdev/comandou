import { CreditCard, QrCode } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { brl } from '../../lib/money';
import { useStore } from './context';
import {
  CardFields,
  cardMissing,
  EMPTY_CARD,
  encryptCard,
  PayerFields,
  payerMissing,
  SecureNote,
  type CardInput,
  type PayerInput,
} from './OnlinePay';
import { PixPay } from './PixPay';
import { Field } from './ui';
import './online-pay.css';

/** Pagamento da conta da mesa pelo app (PagBank), como a conta da mesa manda. */
export interface TabOnline {
  status: 'none' | 'pending' | 'paid' | 'declined' | 'expired' | 'refund_due' | 'refunded';
  method: 'card' | 'pix' | null;
  amount: string | null;
  pix: { code: string; expiresAt: string | null } | null;
  /** Cartão enviado e o banco ainda não respondeu. */
  processing: boolean;
  declineReason: string | null;
  cardAttemptsLeft: number;
  /** Pago pelo app e ainda fora do caixa da loja (para o cliente, já pago). */
  paidOutside: string;
}

export interface TablePagBank {
  publicKey: string | null;
  env: 'SANDBOX' | 'PROD';
}

/** Erro da API com o código (ex.: `bill_changed`, `table_location`). */
const codeOf = (e: unknown) =>
  e instanceof ApiError ? (e.body as { code?: string } | undefined)?.code : undefined;

/**
 * Pagar a conta inteira da mesa pelo PagBank: Pix que confirma sozinho (nome, CPF e e-mail de
 * quem paga) ou cartão de crédito (cifrado no celular). O valor que o cliente vê vai junto: se a
 * conta mudou, nada é cobrado e a tela mostra o valor novo.
 */
export function TableAppPay<B>({
  tableId,
  due,
  way,
  pagbank,
  cardAttemptsLeft,
  onBill,
  onStale,
}: {
  tableId: string;
  due: string;
  way: 'pix' | 'card';
  pagbank: TablePagBank | null;
  cardAttemptsLeft: number;
  /** A API devolve a conta da mesa atualizada. */
  onBill(b: B): void;
  /** A conta mudou (ou a localização venceu): recarrega. */
  onStale(): Promise<void>;
}) {
  const { customer, table, here, setHere } = useStore();
  const [payer, setPayer] = useState<PayerInput>({ cpf: customer.customerCpf ?? '', email: '' });
  const [name, setName] = useState(customer.customerName ?? '');
  const [card, setCard] = useState<CardInput>(EMPTY_CARD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCard = way === 'card';
  const cardOut = isCard && cardAttemptsLeft <= 0;

  async function pay() {
    setError(null);
    const miss =
      (!isCard && name.trim().length < 3 ? 'o seu nome' : null) ??
      payerMissing(payer) ??
      (isCard ? cardMissing(card) : null);
    if (miss) return setError(`Falta ${miss}.`);
    // Mesa que confere a localização e o cliente ainda não confirmou: a confirmação aparece.
    if (table?.confirmLocation && !here) return setHere(null);
    setBusy(true);
    try {
      const presence = table?.confirmLocation && here ? here : undefined;
      const base = { cpf: payer.cpf, email: payer.email, amount: due, presence };
      if (isCard) {
        if (!pagbank?.publicKey) throw new Error('Cartão pelo app indisponível agora.');
        const encryptedCard = await encryptCard(pagbank.publicKey, card);
        onBill(
          await api<B>(`/store/table/${tableId}/pay/card`, {
            method: 'POST',
            json: { ...base, encryptedCard, holderName: card.holder.trim() },
          }),
        );
        setCard(EMPTY_CARD);
      } else {
        onBill(
          await api<B>(`/store/table/${tableId}/pay/pix`, {
            method: 'POST',
            json: { ...base, name: name.trim() },
          }),
        );
      }
    } catch (e) {
      const code = codeOf(e);
      if (code === 'table_location') setHere(null);
      if (code === 'bill_changed') void onStale();
      setError(e instanceof Error ? e.message : 'Não deu certo. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="opay tsv-app">
      {!isCard && (
        <div className="opay__fields">
          <Field label="Seu nome" wide>
            <input
              autoComplete="name"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value.slice(0, 120))}
            />
          </Field>
        </div>
      )}
      <PayerFields value={payer} onChange={setPayer} disabled={busy} />
      {isCard && (
        <>
          <CardFields value={card} onChange={setCard} disabled={busy || cardOut} />
          <SecureNote />
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {cardOut ? (
        <p className="form-hint">
          Muitas tentativas com cartão nesta mesa. Pague com Pix ou chame o garçom.
        </p>
      ) : (
        <div className="opay__actions">
          <button type="button" className="cta" disabled={busy} onClick={() => void pay()}>
            {isCard ? <CreditCard size={16} aria-hidden /> : <QrCode size={16} aria-hidden />}{' '}
            {busy
              ? isCard
                ? 'Pagando…'
                : 'Gerando o Pix…'
              : isCard
                ? `Pagar ${brl(due)} no cartão`
                : `Gerar o Pix de ${brl(due)}`}
          </button>
        </div>
      )}
      <p className="opay__hint">
        {isCard
          ? 'Pagamento pelo PagBank. A conta fecha sozinha quando o banco aprovar.'
          : 'O Pix é do PagBank da loja e a confirmação é automática: não precisa mandar comprovante.'}{' '}
        O CPF e o e-mail vão só para o PagBank.
      </p>
    </div>
  );
}

/** Pix da conta gerado: QR Code, copia e cola, e "pagar de outro jeito". */
export function TablePixWaiting({
  online,
  onCancel,
  busy,
}: {
  online: TabOnline & { pix: NonNullable<TabOnline['pix']> };
  onCancel(): void;
  busy: boolean;
}) {
  return (
    <section className="tsv-pay" aria-label="Pagar com Pix">
      <h2>Pague o Pix da conta</h2>
      <PixPay code={online.pix.code} amount={online.amount ?? '0'} payee={null} auto />
      <button type="button" className="link tsv-pay__other" disabled={busy} onClick={onCancel}>
        {busy ? 'Cancelando…' : 'Pagar de outro jeito'}
      </button>
    </section>
  );
}
