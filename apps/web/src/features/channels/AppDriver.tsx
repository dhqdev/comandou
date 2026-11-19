import {
  DRIVER_ACTIVE,
  DRIVER_STATUS_LABELS,
  channelInfo,
  type ChannelCancelReason,
  type DriverStatus,
  withArticle,
} from '@comandou/shared';
import { Bike } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, TextField, useToast } from '../../design-system';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useDebounced, useRealtime } from '../../lib/realtime';
import { SelectField } from '../forms';
import './app-driver.css';

/** Entregador do aplicativo para um pedido, como a API manda. */
interface DriverView {
  channel: string;
  deliveredBy: 'merchant' | 'channel';
  status: DriverStatus | null;
  name: string | null;
  vehicle: string | null;
  statusAt: string | null;
  eta: string | null;
  pickupEta: string | null;
  fee: string | null;
  pickupCode: string | null;
  canRequest: boolean;
  canCancel: boolean;
}

interface Quote {
  id: string;
  fee: string;
  minMinutes?: number;
  maxMinutes?: number;
  distanceM?: number;
  expiresAt: string;
}

/** Cor da situação: andando = ok, esperando = atenção, falhou = perigo. */
export const DRIVER_TONE: Record<DriverStatus, 'ok' | 'warn' | 'danger' | 'off'> = {
  requested: 'warn',
  request_failed: 'danger',
  assigned: 'ok',
  to_store: 'ok',
  at_store: 'ok',
  collected: 'ok',
  at_customer: 'ok',
  cancelled: 'off',
};

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const km = (m: number) =>
  m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;

/** "Chega na loja por volta de 14:32" — só previsões que ainda não passaram. */
function etaLine(d: DriverView) {
  const now = Date.now();
  const beforePickup = !d.status || ['requested', 'assigned', 'to_store'].includes(d.status);
  if (beforePickup && d.pickupEta && Date.parse(d.pickupEta) > now)
    return `Chega na loja por volta de ${hhmm(d.pickupEta)}`;
  if (d.eta && Date.parse(d.eta) > now) return `Chega no cliente por volta de ${hhmm(d.eta)}`;
  return null;
}

/**
 * Gaveta do pedido de aplicativo com entrega: quem é o entregador do aplicativo, onde ele está,
 * quando chega e o código de coleta. Na entrega da loja, dá para chamar um entregador do
 * aplicativo (com o valor antes de confirmar) e cancelar o chamado.
 */
export function AppDriverCard({ orderId, canManage }: { orderId: string; canManage: boolean }) {
  const toast = useToast();
  const [d, setD] = useState<DriverView | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [cancel, setCancel] = useState<ChannelCancelReason[] | null>(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<DriverView>(`/channels/orders/${orderId}/driver`)
      .then(setD)
      .catch(() => undefined);
  }, [orderId]);
  useEffect(() => load(), [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'order.changed' && e.orderId === orderId) reload();
  }, load);
  // Previsões: o servidor lê o aplicativo no máximo a cada 30 s; aqui, a cada minuto.
  const active = !!d?.status && DRIVER_ACTIVE.includes(d.status);
  useEffect(() => {
    if (!active && d?.deliveredBy !== 'channel') return;
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
  }, [active, d?.deliveredBy, load]);

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      toast((e as Error).message, 'danger');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const askQuote = () =>
    run(async () =>
      setQuote(
        await api<Quote>(`/channels/orders/${orderId}/driver/quote`, { method: 'POST', json: {} }),
      ),
    );
  const confirm = () =>
    run(async () => {
      await api(`/channels/orders/${orderId}/driver`, {
        method: 'POST',
        json: { quoteId: quote!.id },
      });
      setQuote(null);
      toast('Entregador chamado no aplicativo', 'success');
      load();
    });
  const openCancel = () =>
    run(async () => {
      const r = await api<{ reasons: ChannelCancelReason[] }>(
        `/channels/orders/${orderId}/driver/cancel-reasons`,
      );
      setCode('');
      setReason('');
      setCancel(r.reasons);
    });
  const sendCancel = () =>
    run(async () => {
      await api(`/channels/orders/${orderId}/driver/cancel`, {
        method: 'POST',
        json: { reason: reason.trim(), ...(code ? { code } : {}) },
      });
      setCancel(null);
      toast('Entregador do aplicativo cancelado', 'success');
      load();
    });

  if (!d) return null;
  // Entrega da loja sem nada do aplicativo e sem como chamar: não há o que mostrar.
  if (d.deliveredBy === 'merchant' && !d.status && !d.canRequest) return null;
  const label = channelInfo(d.channel).label;
  const status = d.status;
  const eta = etaLine(d);
  const who = [d.name, d.vehicle].filter(Boolean).join(' · ');
  const expired = !!quote && Date.parse(quote.expiresAt) <= Date.now();

  return (
    <div className="app-driver" data-tone={status ? DRIVER_TONE[status] : 'off'}>
      <div className="app-driver__head">
        <Bike size={15} aria-hidden />
        <strong>
          {status
            ? DRIVER_STATUS_LABELS[status]
            : d.deliveredBy === 'channel'
              ? `Entregador ${withArticle(label, 'do')} ainda não foi escolhido`
              : 'Entrega da loja'}
        </strong>
        {who && <span className="app-driver__who">{who}</span>}
      </div>
      {d.deliveredBy === 'channel' && (
        <span className="app-driver__sub">
          Quem entrega é o entregador {withArticle(label, 'do')}.
        </span>
      )}
      {eta && <span className="app-driver__sub">{eta}</span>}
      {d.pickupCode && d.deliveredBy === 'channel' && (
        <span className="app-driver__code">
          Código de coleta <b>{d.pickupCode}</b>
          <span>Peça ao entregador antes de entregar o pedido.</span>
        </span>
      )}
      {d.fee && status && status !== 'cancelled' && (
        <span className="app-driver__sub">Taxa do entregador: {brl(d.fee)}</span>
      )}
      {status === 'request_failed' && (
        <span className="app-driver__sub">
          {withArticle(label, 'O')} não achou entregador. Chame de novo ou entregue com o seu.
        </span>
      )}

      {canManage && quote && (
        <div className="app-driver__quote">
          <span>
            Entregador {withArticle(label, 'do')}: <b>{brl(quote.fee)}</b>
            {quote.minMinutes && quote.maxMinutes
              ? ` · ${quote.minMinutes}–${quote.maxMinutes} min`
              : ''}
            {quote.distanceM != null ? ` · ${km(quote.distanceM)}` : ''}
          </span>
          <span className="app-driver__sub">
            {expired
              ? 'O valor venceu. Peça de novo.'
              : `Valor vale até ${hhmm(quote.expiresAt)}. A taxa é cobrada no repasse ${withArticle(label, 'do')}.`}
          </span>
          <div className="app-driver__actions">
            <Button variant="secondary" size="sm" onClick={() => setQuote(null)}>
              Voltar
            </Button>
            {expired ? (
              <Button variant="primary" size="sm" loading={busy} onClick={() => void askQuote()}>
                Ver o valor de novo
              </Button>
            ) : (
              <Button variant="primary" size="sm" loading={busy} onClick={() => void confirm()}>
                Chamar por {brl(quote.fee)}
              </Button>
            )}
          </div>
        </div>
      )}

      {canManage && cancel && (
        <div className="inline-form app-driver__cancel">
          {cancel.length > 0 && (
            <SelectField
              label="Motivo"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                const r = cancel.find((x) => x.code === e.target.value);
                if (r && !reason.trim()) setReason(r.label);
              }}
            >
              <option value="">Escolha o motivo</option>
              {cancel.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </SelectField>
          )}
          <TextField
            label="Explique em poucas palavras"
            placeholder="Ex.: meu entregador vai levar"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={250}
          />
          <div className="app-driver__actions">
            <Button variant="secondary" size="sm" onClick={() => setCancel(null)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              disabled={!reason.trim()}
              onClick={() => void sendCancel()}
            >
              Cancelar entregador
            </Button>
          </div>
        </div>
      )}

      {canManage && !quote && !cancel && (d.canRequest || d.canCancel) && (
        <div className="app-driver__actions">
          {d.canRequest && (
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void askQuote()}>
              Chamar entregador {withArticle(label, 'do')}
            </Button>
          )}
          {d.canCancel && (
            <Button variant="ghost" size="sm" loading={busy} onClick={() => void openCancel()}>
              Cancelar entregador
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Pedido que o entregador do aplicativo leva (ou com um chamado): o motoboy da loja não sai. */
export function appDriverTakes(o: {
  deliveredBy?: 'merchant' | 'channel' | null;
  appDriverStatus?: DriverStatus | null;
}) {
  return (
    o.deliveredBy === 'channel' ||
    (!!o.appDriverStatus && DRIVER_ACTIVE.includes(o.appDriverStatus))
  );
}

/** Pílula curta para PDV e Entregas: "Entregador do iFood · chegou na loja". */
export function AppDriverTag({
  channel,
  status,
}: {
  channel: string;
  status: DriverStatus | null | undefined;
}) {
  const label = channelInfo(channel).label;
  const tone = status ? DRIVER_TONE[status] : 'off';
  const text = status ? DRIVER_STATUS_LABELS[status] : `Entregador ${withArticle(label, 'do')}`;
  return (
    <span
      className="app-driver-tag"
      data-tone={tone}
      title={`Entregador ${withArticle(label, 'do')}: ${text}`}
    >
      {text}
    </span>
  );
}
