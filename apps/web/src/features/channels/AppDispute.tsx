import {
  DISPUTE_ALTERNATIVE_LABELS,
  DISPUTE_STATUS_LABELS,
  disputeKindLabel,
  disputeTimeoutLabel,
  type ChannelCancelReason,
  type DisputeAlternative,
} from '@comandou/shared';
import { MessageSquareWarning } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, TextField, useToast } from '../../design-system';
import { api } from '../../lib/api';
import { brl, parseBrlInput } from '../../lib/money';
import type { AppDispute } from '../../lib/types';
import { SelectField } from '../forms';
import { AcceptDeadline } from './AcceptDeadline';
import './app-dispute.css';

/** Código do aplicativo (HIGH_STORE_DEMAND) em português simples, para quando não há tradução. */
const CODE_LABELS: Record<string, string> = {
  HIGH_STORE_DEMAND: 'Muitos pedidos na loja',
  DRIVER_DELAY: 'Atraso do entregador',
  WEATHER: 'Chuva ou tempo ruim',
  TRAFFIC: 'Trânsito',
  CUSTOMER_REQUEST: 'O cliente pediu',
  STORE_MISTAKE: 'Erro da loja',
  ORDER_DELAYED: 'Pedido atrasado',
};
export function codeLabel(code: string) {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  const t = code.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

type Step = null | 'accept' | 'reject' | DisputeAlternative;

/**
 * Pedido do cliente pelo aplicativo depois do pedido (cancelar, cancelar parte, reembolso, mais
 * tempo). Quem responde é uma pessoa (o iFood recomenda não automatizar): aceitar, recusar ou
 * propor uma das alternativas que o aplicativo ofereceu, dentro do prazo.
 */
export function AppDisputeCard({
  dispute: d,
  canAnswer,
  onDone,
}: {
  dispute: AppDispute;
  canAnswer: boolean;
  onDone(): void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [minutes, setMinutes] = useState('');
  const [timeReason, setTimeReason] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (d.status !== 'open' || !d.expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [d.status, d.expiresAt]);
  const expired = !!d.expiresAt && Date.parse(d.expiresAt) <= now;
  const open = d.status === 'open' && !expired;

  function pick(s: Step) {
    setStep(s);
    setReason(s === 'accept' ? (d.acceptReasons[0] ?? '') : '');
    setAmount('');
    setMinutes(typeof s === 'object' && s?.minutes?.length ? String(s.minutes[0]) : '');
    setTimeReason(typeof s === 'object' && s?.reasons?.length ? s.reasons[0]! : '');
  }

  async function answer(json: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/channels/disputes/${d.id}/decision`, { method: 'POST', json });
      toast('Resposta enviada ao aplicativo', 'success');
      setStep(null);
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const alt = typeof step === 'object' ? step : null;
  const money = alt && alt.type !== 'ADDITIONAL_TIME';
  const cents = money ? parseBrlInput(amount) : null;
  const overMax = !!(cents && alt?.maxAmount && Number(cents) > Number(alt.maxAmount));
  const ready =
    step === 'accept'
      ? !d.acceptReasons.length || !!reason
      : step === 'reject'
        ? reason.trim().length >= 3
        : alt
          ? money
            ? !!cents && Number(cents) > 0 && !overMax
            : !!minutes && (!alt.reasons?.length || !!timeReason)
          : false;

  function confirm() {
    if (step === 'accept') return answer({ decision: 'accept', ...(reason ? { reason } : {}) });
    if (step === 'reject') return answer({ decision: 'reject', reason: reason.trim() });
    if (!alt) return;
    return answer({
      decision: 'alternative',
      alternativeId: alt.id,
      ...(money
        ? { amount: cents }
        : { minutes: Number(minutes), ...(timeReason ? { timeReason } : {}) }),
    });
  }

  const timeout = open ? disputeTimeoutLabel(d.timeoutAction) : null;
  return (
    <section className="app-dispute" data-open={open || undefined} aria-live="polite">
      <header className="app-dispute__head">
        <MessageSquareWarning size={16} aria-hidden />
        <strong>{disputeKindLabel(d.kind)}</strong>
        {open && d.expiresAt && <AcceptDeadline until={d.expiresAt} kind="answer" />}
      </header>
      {d.message && <p className="app-dispute__msg">“{d.message}”</p>}
      {open ? (
        timeout && <p className="app-dispute__hint">{timeout}</p>
      ) : (
        <p className="app-dispute__hint">
          {d.status === 'open'
            ? 'O prazo acabou: o aplicativo decide sozinho'
            : DISPUTE_STATUS_LABELS[d.status]}
          {d.outcome ? ` · ${codeLabel(d.outcome)}` : ''}
        </p>
      )}

      {open && canAnswer && !step && (
        <div className="app-dispute__actions">
          <Button variant="secondary" size="sm" onClick={() => pick('accept')}>
            Aceitar
          </Button>
          <Button variant="secondary" size="sm" onClick={() => pick('reject')}>
            Recusar
          </Button>
          {d.alternatives.map((a) => (
            <Button key={a.id} variant="ghost" size="sm" onClick={() => pick(a)}>
              {DISPUTE_ALTERNATIVE_LABELS[a.type] ?? 'Fazer uma proposta'}
            </Button>
          ))}
        </div>
      )}
      {open && !canAnswer && (
        <p className="app-dispute__hint">Peça a quem gerencia os pedidos para responder.</p>
      )}

      {open && step && (
        <div className="inline-form">
          {step === 'accept' && d.acceptReasons.length > 0 && (
            <SelectField
              label="Motivo do aceite"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {d.acceptReasons.map((r) => (
                <option key={r} value={r}>
                  {codeLabel(r)}
                </option>
              ))}
            </SelectField>
          )}
          {step === 'accept' && (
            <p className="app-dispute__hint">
              Aceitar faz o aplicativo seguir o que o cliente pediu (o valor volta para ele pelo
              aplicativo).
            </p>
          )}
          {step === 'reject' && (
            <TextField
              label="Por que não dá? (o cliente vê)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={250}
              autoFocus
            />
          )}
          {money && (
            <TextField
              label={alt!.type === 'BENEFIT' ? 'Valor do cupom' : 'Valor a devolver'}
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              hint={alt!.maxAmount ? `Até ${brl(alt!.maxAmount)}` : undefined}
              error={overMax ? `O aplicativo aceita até ${brl(alt!.maxAmount!)}` : undefined}
              autoFocus
            />
          )}
          {alt && !money && (
            <>
              <SelectField
                label="Quanto tempo a mais"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              >
                {(alt.minutes?.length ? alt.minutes : [10, 15, 20, 30]).map((m) => (
                  <option key={m} value={m}>
                    {m} minutos
                  </option>
                ))}
              </SelectField>
              {alt.reasons?.length ? (
                <SelectField
                  label="Motivo do atraso"
                  value={timeReason}
                  onChange={(e) => setTimeReason(e.target.value)}
                >
                  {alt.reasons.map((r) => (
                    <option key={r} value={r}>
                      {codeLabel(r)}
                    </option>
                  ))}
                </SelectField>
              ) : null}
            </>
          )}
          <div className="actions-row">
            <Button variant="secondary" onClick={() => setStep(null)}>
              Voltar
            </Button>
            <Button
              variant={step === 'reject' ? 'danger' : 'primary'}
              loading={busy}
              disabled={!ready}
              onClick={() => void confirm()}
            >
              {step === 'accept'
                ? 'Aceitar o pedido do cliente'
                : step === 'reject'
                  ? 'Recusar'
                  : 'Enviar proposta'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Cancelar ou recusar um pedido de aplicativo: o motivo vai para o aplicativo (o iFood pede um
 * código da lista dele para cada pedido) e o texto fica no Comandou.
 */
export function AppCancelForm({
  orderId,
  confirm,
  note,
  busy,
  onCancel,
  onConfirm,
}: {
  orderId: string;
  confirm: string;
  /** Explicação embaixo (ex.: o que acontece até o aplicativo confirmar). */
  note?: string;
  busy?: boolean;
  onCancel(): void;
  onConfirm(reason: string, code?: string): void;
}) {
  const [reasons, setReasons] = useState<ChannelCancelReason[] | null>(null);
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    let live = true;
    api<{ reasons: ChannelCancelReason[] }>(`/channels/orders/${orderId}/cancel-reasons`)
      .then((r) => live && setReasons(r.reasons))
      .catch(() => live && setReasons([]));
    return () => {
      live = false;
    };
  }, [orderId]);
  const label = reasons?.find((r) => r.code === code)?.label ?? '';
  const ok = reasons?.length ? !!code : text.trim().length >= 3;
  return (
    <div className="inline-form">
      {reasons === null ? (
        <p className="app-dispute__hint">Buscando os motivos que o aplicativo aceita…</p>
      ) : reasons.length > 0 ? (
        <SelectField
          label="Motivo para o aplicativo (o cliente vê)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        >
          <option value="" disabled>
            Escolha o motivo
          </option>
          {reasons.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      <TextField
        label={reasons?.length ? 'Explique (opcional)' : 'Motivo (o cliente vê)'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={250}
      />
      {note && <p className="app-dispute__hint">{note}</p>}
      <div className="actions-row">
        <Button variant="secondary" onClick={onCancel}>
          Voltar
        </Button>
        <Button
          variant="danger"
          loading={busy}
          disabled={!ok || reasons === null}
          onClick={() => onConfirm(text.trim() || label, code || undefined)}
        >
          {confirm}
        </Button>
      </div>
    </div>
  );
}
