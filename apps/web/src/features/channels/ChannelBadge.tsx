import { channelInfo } from '@comandou/shared';
import type { CSSProperties } from 'react';
import './channel-badge.css';

/**
 * Selo do aplicativo de delivery (cor e nome da marca) em todo lugar onde o pedido aparece.
 * As cores são da marca de cada aplicativo (dado, não tema): iguais no claro e no escuro.
 */
export function ChannelBadge({
  channel,
  code,
  size = 'md',
}: {
  channel: string;
  /** Código curto do pedido no aplicativo (ex.: 4821). */
  code?: string | null;
  size?: 'sm' | 'md';
}) {
  const info = channelInfo(channel);
  return (
    <span
      className={`ch-badge ch-badge--${size}`}
      style={{ '--ch': info.color, '--ch-ink': info.ink } as CSSProperties}
      title={code ? `${info.label} · pedido ${code}` : info.label}
    >
      {info.label}
      {code && <span className="ch-badge__code">{code}</span>}
    </span>
  );
}
