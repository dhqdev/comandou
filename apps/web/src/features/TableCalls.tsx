import { fromCents, toCents } from '@comandou/shared';
import { BellRing, CreditCard, Download, ReceiptText } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCan } from '../app/auth';
import { Alert, Button, Modal, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl } from '../lib/money';
import { useRealtime } from '../lib/realtime';
import { playSound } from '../lib/sounds';
import { SelectField } from './forms';
import { useOpenSessions } from './PaymentModal';
import './table-calls.css';

/** Chamado de uma mesa pelo cardápio do QR Code (GET /table-service/calls). */
export interface TableCall {
  id: string;
  tableId: string;
  tableLabel: string;
  tabId: string | null;
  kind: 'waiter' | 'bill';
  createdAt: string;
}

/** Comprovante do Pix da conta inteira da mesa, esperando o caixa (GET /table-service/receipts). */
export interface TabReceipt {
  id: string;
  tabId: string;
  tabNumber: number;
  tableId: string | null;
  tableLabel: string | null;
  amount: string;
  contentType: string;
  createdAt: string;
  /** Saldo da conta agora (pode ter mudado depois do comprovante). */
  due: string;
}

const since = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? 'agora' : `há ${m} min`;
};

/** Lista que se atualiza sozinha e toca o aviso quando chega uma nova. */
function useLiveList<T extends { id: string }>(
  path: string,
  enabled: boolean,
  refresh: (e: { type: string }) => boolean,
) {
  const [items, setItems] = useState<T[]>([]);
  const known = useRef<Set<string> | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const list = await api<T[]>(path);
      // Primeira carga não toca: só o que chega depois de abrir a tela.
      if (known.current && list.some((x) => !known.current!.has(x.id))) playSound('bill');
      known.current = new Set(list.map((x) => x.id));
      setItems(list);
    } catch {
      /* sem rede: tenta de novo no próximo aviso */
    }
  }, [path, enabled]);
  useEffect(() => {
    void load();
    if (!enabled) return;
    // Rede de segurança: se um aviso do tempo real se perder, a lista acerta em 1 minuto.
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
    return () => window.clearInterval(id);
  }, [load, enabled]);
  useRealtime((e) => {
    if (refresh(e)) void load();
  }, load);
  return { items, reload: load, setItems };
}

/** Chamados abertos das mesas (garçom, PDV e Salão). */
export function useTableCalls(enabled = true) {
  return useLiveList<TableCall>('/table-service/calls', enabled, (e) => e.type === 'table.call');
}

/** Comprovantes do Pix da conta da mesa esperando o caixa. */
export function useTabReceipts(enabled = true) {
  return useLiveList<TabReceipt>(
    '/table-service/receipts',
    enabled,
    (e) => e.type === 'tab.changed',
  );
}

/** "Atendi": tira o chamado da lista de todo mundo. */
export async function answerCall(id: string) {
  await api(`/table-service/calls/${id}/answer`, { method: 'POST', json: {} });
}

/**
 * Faixa de avisos das mesas, no topo da tela (sem cobrir botões): "Mesa 4 está chamando" com
 * Atender e, para quem recebe pagamento, "Mesa 4 mandou o comprovante do Pix" com Conferir.
 */
export function TableServiceAlerts({ compact = false }: { compact?: boolean }) {
  const canTables = useCan('tables:operate');
  const canPay = useCan('payments:create');
  const toast = useToast();
  const calls = useTableCalls(canTables);
  const receipts = useTabReceipts(canPay);
  const [review, setReview] = useState<TabReceipt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function answer(c: TableCall) {
    setBusy(c.id);
    try {
      await answerCall(c.id);
      calls.setItems((l) => l.filter((x) => x.id !== c.id));
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  if (!calls.items.length && !receipts.items.length && !review) return null;
  return (
    <>
      <section
        className="tcall"
        data-compact={compact || undefined}
        aria-label="Avisos das mesas"
        aria-live="polite"
      >
        {calls.items.map((c) => (
          <div key={c.id} className="tcall__item" data-kind={c.kind}>
            <span className="tcall__icon" aria-hidden>
              {c.kind === 'bill' ? <CreditCard size={18} /> : <BellRing size={18} />}
            </span>
            <span className="tcall__text">
              <strong>
                Mesa {c.tableLabel}{' '}
                {c.kind === 'bill' ? 'quer pagar com o garçom' : 'está chamando o garçom'}
              </strong>
              <small>{since(c.createdAt)}</small>
            </span>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === c.id}
              onClick={() => void answer(c)}
              aria-label={`Atender a Mesa ${c.tableLabel}`}
            >
              Atender
            </Button>
          </div>
        ))}
        {receipts.items.map((r) => (
          <div key={r.id} className="tcall__item" data-kind="pix">
            <span className="tcall__icon" aria-hidden>
              <ReceiptText size={18} />
            </span>
            <span className="tcall__text">
              <strong>
                {r.tableLabel ? `Mesa ${r.tableLabel}` : `Comanda ${r.tabNumber}`} mandou o Pix da
                conta · {brl(r.amount)}
              </strong>
              <small>{since(r.createdAt)} · confira o comprovante</small>
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setReview(r)}
              aria-label={`Conferir o Pix da Mesa ${r.tableLabel ?? r.tabNumber}`}
            >
              Conferir
            </Button>
          </div>
        ))}
      </section>
      {review && (
        <TabReceiptModal
          receipt={review}
          onClose={() => setReview(null)}
          onDone={() => {
            setReview(null);
            void receipts.reload();
          }}
        />
      )}
    </>
  );
}

/**
 * Conferir o Pix da conta da mesa: o comprovante grande, o valor que ele cobre e o saldo de agora,
 * o caixa onde o Pix entra e Aprovar (o valor entra nos pedidos da comanda) ou Recusar com motivo.
 */
export function TabReceiptModal({
  receipt,
  onClose,
  onDone,
}: {
  receipt: TabReceipt;
  onClose(): void;
  onDone(): void;
}) {
  const toast = useToast();
  const { sessions, sessionId, choose } = useOpenSessions(true);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idem = useRef(newIdempotencyKey());
  const url = `/api/v1/table-service/receipts/${receipt.id}/file`;
  const pdf = receipt.contentType === 'application/pdf';
  const who = receipt.tableLabel ? `Mesa ${receipt.tableLabel}` : `Comanda ${receipt.tabNumber}`;
  const diff = toCents(receipt.due) - toCents(receipt.amount);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ applied: string; short: string; tabClosed: boolean }>(
        `/table-service/receipts/${receipt.id}/approve`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idem.current },
          json: { cashSessionId: sessionId },
        },
      );
      toast(
        toCents(r.short) > 0
          ? `Pix de ${brl(r.applied)} lançado. Ainda faltam ${brl(r.short)} na ${who}.`
          : r.tabClosed
            ? `Pix aprovado. A ${who} está paga e livre.`
            : `Pix aprovado. A conta da ${who} está paga.`,
        'success',
      );
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError(null);
    try {
      await api(`/table-service/receipts/${receipt.id}/reject`, {
        method: 'POST',
        json: { reason: reason.trim() },
      });
      toast('Comprovante recusado. O cliente vê o motivo na mesa.', 'success');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={`Pix da conta · ${who}`}
      onClose={onClose}
      footer={
        rejecting ? (
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Voltar
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => void reject()}
            >
              Recusar comprovante
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setRejecting(true)}>
              Recusar
            </Button>
            <Button loading={busy} disabled={!sessionId} onClick={() => void approve()}>
              Aprovar {brl(fromCents(Math.min(toCents(receipt.amount), toCents(receipt.due))))}
            </Button>
          </>
        )
      }
    >
      <div className="tcall-review">
        <div className="tcall-review__file">
          {pdf ? (
            <iframe src={url} title="Comprovante do Pix (PDF)" />
          ) : (
            <img src={url} alt="Comprovante do Pix" />
          )}
          <a className="cm-btn cm-btn--ghost cm-btn--sm" href={url} download>
            <Download size={15} aria-hidden /> Baixar
          </a>
        </div>
        <div className="tcall-review__side">
          {error && <Alert tone="danger">{error}</Alert>}
          <dl className="tcall-review__nums">
            <div>
              <dt>O comprovante cobre</dt>
              <dd>{brl(receipt.amount)}</dd>
            </div>
            <div>
              <dt>Saldo da conta agora</dt>
              <dd>{brl(receipt.due)}</dd>
            </div>
          </dl>
          {diff > 0 && (
            <Alert tone="warning">
              A conta aumentou {brl(fromCents(diff))} depois do Pix (pedido novo). Aprovando, entra{' '}
              {brl(receipt.amount)} e o resto fica em aberto.
            </Alert>
          )}
          {diff < 0 && (
            <Alert tone="warning">
              Parte da conta já foi paga de outro jeito. Aprovando, entra só {brl(receipt.due)}:
              devolva a diferença ao cliente.
            </Alert>
          )}
          <p className="cm-hint">
            Confira no app do banco se o Pix de {brl(receipt.amount)} caiu na conta da loja antes de
            aprovar.
          </p>
          {rejecting ? (
            <TextField
              label="Motivo (o cliente vê na mesa)"
              maxLength={200}
              value={reason}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
            />
          ) : sessions !== null && sessions.length === 0 ? (
            <Alert tone="warning">
              Abra um caixa para aprovar: o Pix entra como pagamento nele.
            </Alert>
          ) : (
            (sessions?.length ?? 0) > 1 && (
              <SelectField label="Caixa" value={sessionId} onChange={(e) => choose(e.target.value)}>
                {(sessions ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.registerName} · sessão {s.number}
                  </option>
                ))}
              </SelectField>
            )
          )}
        </div>
      </div>
    </Modal>
  );
}
