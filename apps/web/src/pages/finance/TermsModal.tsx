import {
  DEFAULT_PAYMENT_TERMS,
  PAYMENT_METHODS,
  PAYMENT_TERM_MAX_DAYS,
  PAYMENT_TERM_MAX_FEE,
  type PaymentMethod,
  type PaymentTerms,
} from '@comandou/shared';
import { useState } from 'react';
import { Alert, Button, Modal } from '../../design-system';
import { PAYMENT_METHOD_LABELS } from '../../features/format';
import { api } from '../../lib/api';
import type { FinanceSettings } from '../../lib/types';

const METHODS = PAYMENT_METHODS.filter((m) => m !== 'cash');
const HINTS: Partial<Record<PaymentMethod, string>> = {
  debit: 'Costuma cair em 1 dia útil.',
  credit: 'À vista cai em 30 dias; com antecipação, em 1 ou 2 dias (com taxa maior).',
  voucher: 'Regras novas do PAT: taxa de até 3,6% e repasse em até 15 dias.',
  pix: 'Cai na hora. Pela maquininha pode ter taxa.',
};

/**
 * Taxa e prazo de cada forma de pagamento. Ao fechar o caixa, o sistema usa estes números para
 * prever quanto e quando cada venda cai na conta; a conciliação mostra se o banco pagou certo.
 */
export function TermsModal({
  terms,
  onClose,
  onSaved,
}: {
  terms: PaymentTerms;
  onClose(): void;
  onSaved(s: FinanceSettings): void;
}) {
  const [form, setForm] = useState(
    () =>
      Object.fromEntries(
        METHODS.map((m) => [
          m,
          { fee: terms[m].feePercent.replace('.', ','), days: String(terms[m].days) },
        ]),
      ) as Record<PaymentMethod, { fee: string; days: string }>,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = Object.fromEntries(
    METHODS.map((m) => {
      const fee = form[m].fee.trim().replace(',', '.') || '0';
      const days = form[m].days.trim() || '0';
      const okFee = /^\d{1,2}(\.\d{1,2})?$/.test(fee) && Number(fee) <= PAYMENT_TERM_MAX_FEE;
      const okDays = /^\d{1,3}$/.test(days) && Number(days) <= PAYMENT_TERM_MAX_DAYS;
      return [m, okFee && okDays ? { feePercent: fee, days: Number(days) } : null];
    }),
  ) as Record<PaymentMethod, { feePercent: string; days: number } | null>;
  const valid = METHODS.every((m) => parsed[m]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<FinanceSettings>('/finance/settings', {
          method: 'PUT',
          json: {
            paymentTerms: {
              cash: { feePercent: '0', days: 0 },
              ...Object.fromEntries(METHODS.map((m) => [m, parsed[m]])),
            },
          },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const set = (m: PaymentMethod, k: 'fee' | 'days', v: string) =>
    setForm((f) => ({ ...f, [m]: { ...f[m], [k]: v } }));

  return (
    <Modal
      open
      size="lg"
      title="Taxas e prazos das maquininhas"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() =>
              setForm(
                Object.fromEntries(
                  METHODS.map((m) => [
                    m,
                    {
                      fee: DEFAULT_PAYMENT_TERMS[m].feePercent.replace('.', ','),
                      days: String(DEFAULT_PAYMENT_TERMS[m].days),
                    },
                  ]),
                ) as typeof form,
              )
            }
          >
            Usar o padrão
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!valid} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="fin-modal">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="cm-hint" style={{ margin: 0 }}>
          Copie do contrato da sua maquininha. Ao fechar o caixa, o sistema calcula a taxa de cada
          venda e o dia em que o dinheiro cai na conta. Fim de semana passa para a segunda.
        </p>
        <div className="fin-terms">
          <div className="fin-terms__head" aria-hidden>
            <span>Forma</span>
            <span>Taxa (%)</span>
            <span>Cai em (dias)</span>
          </div>
          {METHODS.map((m) => (
            <div className="fin-terms__row" key={m}>
              <div>
                <strong>{PAYMENT_METHOD_LABELS[m]}</strong>
                {HINTS[m] && <div className="cm-hint">{HINTS[m]}</div>}
              </div>
              <input
                className="cm-input"
                inputMode="decimal"
                aria-label={`Taxa de ${PAYMENT_METHOD_LABELS[m]} (%)`}
                aria-invalid={!parsed[m] || undefined}
                value={form[m].fee}
                onChange={(e) => set(m, 'fee', e.target.value)}
              />
              <input
                className="cm-input"
                inputMode="numeric"
                aria-label={`Dias até cair na conta (${PAYMENT_METHOD_LABELS[m]})`}
                aria-invalid={!parsed[m] || undefined}
                value={form[m].days}
                onChange={(e) => set(m, 'days', e.target.value)}
              />
            </div>
          ))}
        </div>
        <p className="cm-hint" style={{ margin: 0 }}>
          Dinheiro não tem taxa: entra como recebido no fechamento. A taxa vale para os caixas que
          fecharem daqui para a frente.
        </p>
      </div>
    </Modal>
  );
}
