import { PIX_RECEIPT_LABELS, toCents } from '@comandou/shared';
import {
  BadgeCheck,
  Download,
  FileText,
  Hourglass,
  Maximize2,
  ReceiptText,
  Undo2,
  XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useCan } from '../app/auth';
import { Alert, Button, Modal, useToast } from '../design-system';
import { api } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { brl } from '../lib/money';
import type { Order, PixReceipt } from '../lib/types';
import { dateTime, time } from './format';
import { SelectField } from './forms';
import { useOpenSessions } from './PaymentModal';
import './pix.css';

export const pixReceiptUrl = (orderId: string, receiptId: string) =>
  `/api/v1/orders/${orderId}/pix-receipts/${receiptId}/file`;

const isPdf = (r: Pick<PixReceipt, 'contentType'>) => r.contentType === 'application/pdf';

/** Arquivo de comprovante para ver na prévia (sem sair da tela). */
export type ReceiptFile = { url: string; pdf: boolean; title: string };

export const receiptFile = (
  orderId: string,
  r: Pick<PixReceipt, 'id' | 'contentType'>,
  title: string,
): ReceiptFile => ({ url: pixReceiptUrl(orderId, r.id), pdf: isPdf(r), title });

/**
 * Prévia do comprovante na mesma tela (foto ou PDF em tamanho grande), por cima do que estiver
 * aberto. Fecha no X, no Esc ou clicando fora; "Baixar" salva o arquivo.
 */
export function ReceiptFileModal({ file, onClose }: { file: ReceiptFile | null; onClose(): void }) {
  return (
    <Modal
      open={!!file}
      onClose={onClose}
      size="xl"
      title={
        <span className="pix-review__title">
          <ReceiptText size={18} aria-hidden /> {file?.title ?? 'Comprovante'}
        </span>
      }
      footer={
        file ? (
          <a className="cm-btn cm-btn--ghost" href={file.url} download>
            <Download size={16} aria-hidden /> Baixar
          </a>
        ) : undefined
      }
    >
      {file && (
        <div className="pix-lightbox">
          {file.pdf ? (
            <iframe src={file.url} title={file.title} />
          ) : (
            <img src={file.url} alt={file.title} />
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Selo do Pix no cartão do PDV. Com comprovante para conferir, é um botão (com a miniatura) que
 * abre a prévia na hora, sem abrir o pedido.
 */
export function PixReceiptChip({ order, onOpen }: { order: Order; onOpen?: () => void }) {
  const st = order.pixStatus;
  if (!st) return null;
  const r = order.pixReceipt;
  if (st === 'submitted' && r && onOpen)
    return (
      <button
        type="button"
        className="pix-chip"
        data-st={st}
        onClick={onOpen}
        title="Ver o comprovante do Pix"
        aria-label={`Ver o comprovante do Pix do pedido ${order.number}`}
      >
        {r.hasFile && !isPdf(r) ? (
          <img src={pixReceiptUrl(order.id, r.id)} alt="" className="pix-chip__thumb" />
        ) : (
          <FileText size={14} aria-hidden />
        )}
        Comprovante
      </button>
    );
  const Icon =
    st === 'approved' || st === 'refunded'
      ? BadgeCheck
      : st === 'rejected'
        ? XCircle
        : st === 'refund_due'
          ? Undo2
          : Hourglass;
  return (
    <span className="pix-chip" data-st={st}>
      <Icon size={13} aria-hidden />
      {st === 'waiting'
        ? 'Pix sem comprovante'
        : st === 'submitted'
          ? 'Comprovante para conferir'
          : PIX_RECEIPT_LABELS[st]}
    </span>
  );
}

/**
 * Conferir o comprovante: a foto (ou o PDF) grande, o valor que o QR Code pedia e os botões de
 * aprovar (o Pix entra no caixa e o pedido fica pago) e recusar (com motivo, o cliente vê).
 * Pedido cancelado com o comprovante sem conferir (Pix a devolver): no lugar de aprovar, a equipe
 * marca que devolveu o Pix ou que ele não chegou.
 */
export function PixReceiptReview({
  order,
  receipt,
  onDone,
}: {
  order: Pick<Order, 'id' | 'number' | 'status' | 'total' | 'balance'>;
  receipt: PixReceipt;
  /** Depois de aprovar, recusar ou marcar a devolução (com o pedido atualizado). */
  onDone(updated: Order, how: 'approved' | 'rejected' | 'refunded'): void;
}) {
  const toast = useToast();
  const canPay = useCan('payments:create');
  const canManage = useCan('orders:manage');
  const canRefund = useCan('payments:refund');
  const pending = receipt.status === 'submitted';
  /** Pedido cancelado com o comprovante sem conferir: o cliente pode já ter pago. */
  const refundDue = pending && order.status === 'cancelled';
  const { sessions, sessionId, choose } = useOpenSessions(pending && !refundDue && canPay);
  const [busy, setBusy] = useState<'approve' | 'accept' | 'reject' | 'refund' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  // Mesma chave em cada nova tentativa: um clique duplo não lança o Pix duas vezes.
  const key = useRef(newIdempotencyKey());
  const url = pixReceiptUrl(order.id, receipt.id);
  const due = toCents(order.balance);
  const needsCash = due > 0;
  const mismatch = !refundDue && toCents(receipt.amount) !== due && due > 0;

  async function approve(accept: boolean) {
    setBusy(accept ? 'accept' : 'approve');
    setError(null);
    try {
      let o = await api<Order>(`/orders/${order.id}/pix-receipts/${receipt.id}/approve`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        json: needsCash ? { cashSessionId: sessionId } : {},
      });
      if (accept && o.status === 'awaiting')
        o = await api<Order>(`/orders/${order.id}/status`, {
          method: 'POST',
          json: { to: 'new', expectedVersion: o.version },
        });
      toast(
        accept
          ? `Pix aprovado e pedido #${order.number} aceito`
          : `Pix do pedido #${order.number} aprovado`,
        'success',
      );
      onDone(o, 'approved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy('reject');
    setError(null);
    try {
      const o = await api<Order>(`/orders/${order.id}/pix-receipts/${receipt.id}/reject`, {
        method: 'POST',
        json: { reason: reason.trim() },
      });
      toast(
        refundDue
          ? `Pix do pedido #${order.number} marcado como não recebido. O cliente vê o motivo.`
          : 'Comprovante recusado. O cliente vê o motivo e pode mandar outro.',
        'neutral',
      );
      onDone(o, 'rejected');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function refunded() {
    setBusy('refund');
    setError(null);
    try {
      const o = await api<Order>(`/orders/${order.id}/pix-receipts/${receipt.id}/refunded`, {
        method: 'POST',
      });
      toast(`Pix do pedido #${order.number} marcado como devolvido`, 'success');
      onDone(o, 'refunded');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const rejectForm = (
    <form
      className="pix-review__reject"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length >= 3) void reject();
      }}
    >
      <label className="cm-label" htmlFor={`pix-reason-${receipt.id}`}>
        {refundDue ? 'O que você viu no banco? (o cliente vê)' : 'Por que recusar? (o cliente vê)'}
      </label>
      <input
        id={`pix-reason-${receipt.id}`}
        className="cm-input"
        maxLength={200}
        autoFocus
        placeholder={refundDue ? 'Ex.: Pix não caiu na conta' : 'Ex.: valor diferente do pedido'}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="pix-review__row">
        {(refundDue
          ? ['Pix não caiu na conta', 'Comprovante de outro pagamento', 'Comprovante ilegível']
          : ['Valor diferente do pedido', 'Comprovante ilegível', 'Pix não caiu na conta']
        ).map((r) => (
          <button
            key={r}
            type="button"
            className="chip"
            aria-pressed={reason === r}
            onClick={() => setReason(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="pix-review__row">
        <Button variant="ghost" onClick={() => setRejecting(false)}>
          Voltar
        </Button>
        <Button
          type="submit"
          variant="secondary"
          loading={busy === 'reject'}
          disabled={reason.trim().length < 3}
        >
          {refundDue ? 'Marcar como não recebido' : 'Recusar comprovante'}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="pix-review">
      <div className="pix-review__file">
        {!receipt.hasFile ? (
          <p className="cm-hint">O arquivo foi apagado (comprovantes ficam 5 anos).</p>
        ) : isPdf(receipt) ? (
          <iframe src={url} title={`Comprovante do pedido ${order.number}`} />
        ) : (
          <button type="button" onClick={() => setZoom(true)} title="Ver em tamanho grande">
            <img src={url} alt={`Comprovante do Pix do pedido ${order.number}`} />
          </button>
        )}
      </div>
      <div className="pix-review__side">
        <dl className="pix-review__facts">
          <dt>Valor do Pix</dt>
          <dd>
            <strong>{brl(receipt.amount)}</strong>
          </dd>
          <dt>Recebido</dt>
          <dd>{dateTime(receipt.createdAt)}</dd>
          {receipt.reviewedAt && (
            <>
              <dt>
                {receipt.status === 'approved'
                  ? 'Aprovado'
                  : receipt.status === 'refunded'
                    ? 'Devolvido'
                    : 'Recusado'}
              </dt>
              <dd>
                {time(receipt.reviewedAt)}
                {receipt.reviewedByName ? ` · ${receipt.reviewedByName}` : ''}
              </dd>
            </>
          )}
          {receipt.rejectReason && (
            <>
              <dt>Motivo</dt>
              <dd>{receipt.rejectReason}</dd>
            </>
          )}
        </dl>
        {pending && (
          <p className="cm-hint pix-review__tip">
            Confira no comprovante o <strong>valor</strong>, a <strong>data</strong> e o{' '}
            <strong>seu nome</strong> como recebedor. Se puder, veja no app do banco se o Pix caiu.
          </p>
        )}
        {mismatch && (
          <Alert tone="warning">
            O pedido mudou depois do Pix: agora falta {brl(order.balance)}.
          </Alert>
        )}
        {receipt.hasFile && (
          <button type="button" className="pix-review__open" onClick={() => setZoom(true)}>
            <Maximize2 size={14} aria-hidden /> Ver em tamanho grande
          </button>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        {refundDue && (
          <div className="pix-review__actions">
            <Alert tone="warning">
              <span>
                Pedido cancelado com o comprovante enviado. Veja no app do banco se o Pix de{' '}
                <strong>{brl(receipt.amount)}</strong> caiu: se caiu, devolva ao cliente e marque
                aqui.
              </span>
            </Alert>
            {rejecting ? (
              rejectForm
            ) : refunding ? (
              <div className="pix-review__reject">
                <p className="cm-label">
                  Confirma que devolveu {brl(receipt.amount)} ao cliente pelo banco?
                </p>
                <div className="pix-review__row">
                  <Button variant="ghost" disabled={!!busy} onClick={() => setRefunding(false)}>
                    Voltar
                  </Button>
                  <Button loading={busy === 'refund'} onClick={() => void refunded()}>
                    Sim, devolvi o Pix
                  </Button>
                </div>
              </div>
            ) : (
              <div className="pix-review__row">
                {canManage && (
                  <Button
                    variant="secondary"
                    disabled={!!busy}
                    onClick={() => {
                      setReason('Pix não caiu na conta');
                      setRejecting(true);
                    }}
                  >
                    Não recebi este Pix
                  </Button>
                )}
                {canRefund && (
                  <Button disabled={!!busy} onClick={() => setRefunding(true)}>
                    Já devolvi o Pix
                  </Button>
                )}
              </div>
            )}
            {!canRefund && (
              <p className="cm-hint">
                Quem estorna pagamentos (gerente ou dono) marca a devolução do Pix.
              </p>
            )}
          </div>
        )}
        {pending && !refundDue && (
          <div className="pix-review__actions">
            {canPay && needsCash && sessions && sessions.length > 1 && (
              <SelectField
                label="Caixa que recebe o Pix"
                value={sessionId}
                onChange={(e) => choose(e.target.value)}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.registerName ?? 'Caixa'} · nº {s.number}
                  </option>
                ))}
              </SelectField>
            )}
            {canPay && needsCash && sessions?.length === 0 && (
              <Alert tone="info">
                Nenhum caixa aberto: o Pix entra como pagamento no caixa.{' '}
                <Link to="/caixa">Abrir o caixa</Link>
              </Alert>
            )}
            {!canPay && (
              <p className="cm-hint">Quem recebe pagamentos (caixa ou gerente) aprova o Pix.</p>
            )}
            {rejecting ? (
              rejectForm
            ) : (
              <div className="pix-review__row">
                {canManage && (
                  <Button variant="secondary" disabled={!!busy} onClick={() => setRejecting(true)}>
                    Recusar
                  </Button>
                )}
                {canPay && (
                  <Button
                    variant={order.status === 'awaiting' ? 'secondary' : 'primary'}
                    loading={busy === 'approve'}
                    disabled={!!busy || (needsCash && !sessionId)}
                    onClick={() => void approve(false)}
                  >
                    Aprovar Pix
                  </Button>
                )}
                {canPay && order.status === 'awaiting' && (
                  <Button
                    variant="primary"
                    loading={busy === 'accept'}
                    disabled={!!busy || (needsCash && !sessionId)}
                    onClick={() => void approve(true)}
                  >
                    Aprovar e aceitar
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Prévia rápida do comprovante, aberta pelo selo do cartão no PDV. */
export function PixReceiptModal({
  order,
  onClose,
  onOpenOrder,
}: {
  order: Order | null;
  onClose(): void;
  /** "Ver pedido": abre o detalhe completo. */
  onOpenOrder(o: Order): void;
}) {
  const r = order?.pixReceipt;
  return (
    <Modal
      open={!!order && !!r}
      onClose={onClose}
      size="lg"
      title={
        order ? (
          <span className="pix-review__title">
            <ReceiptText size={18} aria-hidden /> Comprovante do Pix · Pedido #{order.number}
          </span>
        ) : (
          'Comprovante do Pix'
        )
      }
      footer={
        order ? (
          <Button variant="ghost" onClick={() => onOpenOrder(order)}>
            Ver pedido completo
          </Button>
        ) : undefined
      }
    >
      {order && r && (
        <PixReceiptReview key={r.id} order={order} receipt={r} onDone={() => onClose()} />
      )}
    </Modal>
  );
}
