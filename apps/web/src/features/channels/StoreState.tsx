import {
  CHANNEL_PAUSE_OPTIONS,
  CHANNEL_STORE_STATE_LABELS,
  channelInfo,
  shiftsLabel,
  type ChannelShift,
  type ChannelStoreState,
  withArticle,
} from '@comandou/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, TextField, useToast } from '../../design-system';
import { api } from '../../lib/api';
import { useDebounced, useRealtime } from '../../lib/realtime';
import { SelectField } from '../forms';
import './store-state.css';

/** Situação de uma loja no aplicativo, como a API manda (Aplicativos de delivery e PDV). */
export interface ChannelStoreStateView {
  id: string;
  channel: string;
  name: string;
  status: 'connected' | 'revoked';
  channelState: ChannelStoreState | null;
  stateTitle: string | null;
  stateDetail: string | null;
  stateAt: string | null;
  stateError: string | null;
  pausedHere: boolean;
  pauseUntil: string | null;
  pauseReason: string | null;
  pauseByStore: boolean;
  followStoreOpen: boolean;
  openingHours: ChannelShift[] | null;
}

export const STATE_TONE: Record<ChannelStoreState, 'ok' | 'warn' | 'danger' | 'off'> = {
  open: 'ok',
  warning: 'warn',
  paused: 'warn',
  closed: 'danger',
  error: 'danger',
  unknown: 'off',
};

const time = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString('pt-BR', {
    ...(sameDay ? {} : { day: '2-digit', month: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** "Pausada até 14:30 · Falta de gás" ou "Aberta · Raio reduzido". */
export function storeStateText(s: ChannelStoreStateView, short = false) {
  const state = s.channelState ?? 'unknown';
  const label = CHANNEL_STORE_STATE_LABELS[state];
  if (state === 'paused' && s.pauseUntil) {
    const until = `${label} até ${time(s.pauseUntil)}`;
    return short || !s.pauseReason ? until : `${until} · ${s.pauseReason}`;
  }
  return short || !s.stateTitle || s.stateTitle === label ? label : `${label} · ${s.stateTitle}`;
}

/** Bolinha, situação, frase do aplicativo e horários. */
export function StoreStateLine({ store: s }: { store: ChannelStoreStateView }) {
  const state = s.channelState ?? 'unknown';
  return (
    <div className="ch-store-state">
      <span className="ch-store-state__main" data-tone={STATE_TONE[state]}>
        {storeStateText(s)}
      </span>
      {s.stateDetail && <span className="ch-store-state__sub">{s.stateDetail}</span>}
      {s.pauseByStore && s.pausedHere && (
        <span className="ch-store-state__sub">Pausada porque a loja está fechada no Comandou</span>
      )}
      {s.openingHours && s.openingHours.length > 0 && (
        <span className="ch-store-state__sub">
          Horário no {channelInfo(s.channel).label}: {shiftsLabel(s.openingHours)}
        </span>
      )}
      {s.stateError && <span className="ch-store-state__error">{s.stateError}</span>}
    </div>
  );
}

/** Pausar só no aplicativo (o Comandou segue aberto) ou tirar a pausa que o Comandou fez. */
export function StorePauseControls({
  store: s,
  onChanged,
}: {
  store: ChannelStoreStateView;
  onChanged(): void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState('30');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const label = channelInfo(s.channel).label;
  async function post(url: string, json?: object) {
    setBusy(true);
    try {
      await api(url, { method: 'POST', json: json ?? {} });
      setOpen(false);
      setReason('');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  if (s.status !== 'connected') return null;
  if (s.pausedHere)
    return (
      <div className="ch-store-pause">
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() => void post(`/channels/stores/${s.id}/resume`)}
        >
          Reabrir {withArticle(label, 'no')}
        </Button>
      </div>
    );
  if (!open)
    return (
      <div className="ch-store-pause">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Pausar {withArticle(label, 'no')}
        </Button>
      </div>
    );
  return (
    <div className="inline-form ch-store-pause__form">
      <SelectField
        label="Por quanto tempo"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
      >
        {CHANNEL_PAUSE_OPTIONS.map((o) => (
          <option key={o.label} value={o.minutes ?? ''}>
            {o.label}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Motivo"
        placeholder="Ex.: muitos pedidos na cozinha"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
      />
      <p className="ch-store-state__sub">
        Só {withArticle(label, 'o')} para de receber pedidos; o cardápio online e o salão continuam.{' '}
        {minutes === '' &&
          `"Até eu reabrir" vale por no máximo 7 dias ${withArticle(label, 'no')}.`}
      </p>
      <div className="actions-row">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Voltar
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={reason.trim().length < 3}
          onClick={() =>
            void post(`/channels/stores/${s.id}/pause`, {
              minutes: minutes === '' ? null : Number(minutes),
              reason: reason.trim(),
            })
          }
        >
          Pausar
        </Button>
      </div>
    </div>
  );
}

/**
 * PDV: uma pílula por loja de aplicativo que recebe pedidos (iFood: Aberta, Pausada até 14:30...),
 * ao lado do "Loja aberta". Toque leva a Aplicativos de delivery.
 */
export function AppStoreChips() {
  const [stores, setStores] = useState<ChannelStoreStateView[]>([]);
  const load = useCallback(() => {
    api<ChannelStoreStateView[]>('/channels/stores/state')
      .then(setStores)
      .catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'channels.changed' || e.type === 'store.changed') reload();
  }, load);
  if (!stores.length) return null;
  return (
    <div className="ch-store-chips" role="group" aria-label="Lojas nos aplicativos">
      {stores.map((s) => {
        const state = s.status === 'revoked' ? 'error' : (s.channelState ?? 'unknown');
        const label = channelInfo(s.channel).label;
        const text =
          s.status === 'revoked' ? 'sem autorização' : storeStateText(s, true).toLowerCase();
        return (
          <Link
            key={s.id}
            className="ch-store-chip"
            data-tone={STATE_TONE[state]}
            to="/integracoes"
            title={`${s.name}: ${storeStateText(s)}${s.stateError ? ` · ${s.stateError}` : ''}`}
          >
            {stores.filter((x) => x.channel === s.channel).length > 1 ? s.name : label}: {text}
          </Link>
        );
      })}
    </div>
  );
}
