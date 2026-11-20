import { FormEvent, useState } from 'react';
import { Alert, Button, TextField, useToast } from '../../design-system';
import { useCepLookup } from '../../lib/cep';
import { api } from '../../lib/api';
import '../subscription.css';

const onlyDigits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);
const fmtCardNumber = (v: string) => onlyDigits(v, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
const fmtExpiry = (v: string) => {
  const d = onlyDigits(v, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

export interface CardSaved {
  brand: string;
  last4: string;
  charged: { ok: boolean; error?: string }[];
}

/**
 * Cadastro do cartão para a cobrança automática. Os dados vão direto ao Asaas (o servidor só
 * repassa e guarda o token cifrado); salvar já paga a fatura vencida que estiver em aberto.
 */
export function CardForm({
  onCancel,
  onSaved,
  submitLabel = 'Salvar cartão e ligar automático',
  quiet,
}: {
  onCancel?(): void;
  onSaved(r: CardSaved): void;
  submitLabel?: string;
  /** A tela de pagamento dá o próprio retorno: sem os avisos de cartão salvo. */
  quiet?: boolean;
}) {
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
      const r = await api<CardSaved>('/subscription/card', { method: 'POST', json: f });
      if (!quiet) {
        toast(`Cartão ${r.brand} •••• ${r.last4} salvo. Cobrança automática ligada.`, 'success');
        if (r.charged.some((c) => c.ok)) toast('Fatura em aberto paga no cartão', 'success');
        const fail = r.charged.find((c) => !c.ok);
        if (fail) toast(`A fatura em aberto não passou no cartão: ${fail.error ?? ''}`, 'danger');
      }
      onSaved(r);
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
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Voltar
          </Button>
        )}
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
