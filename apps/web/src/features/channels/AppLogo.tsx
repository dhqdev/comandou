import { channelInfo } from '@comandou/shared';
import type { CSSProperties } from 'react';
import aiqfome from './logos/aiqfome.svg';
import food99 from './logos/99food.svg';
import ifood from './logos/ifood.svg';
import keeta from './logos/keeta.png';
import opendelivery from './logos/opendelivery.png';
import rappi from './logos/rappi.svg';
import './app-logo.css';

/**
 * Logo oficial de cada aplicativo de delivery, no formato do ícone do app (quadrado de cantos
 * redondos). Tirados das fontes oficiais de cada marca: iFood e Rappi (Wikimedia Commons),
 * aiqfome (Simple Icons), 99Food (99app.com), Keeta (keeta-global.com), Open Delivery
 * (opendelivery.com.br). Cor de marca é dado: igual no claro e no escuro.
 */
const LOGOS: Record<string, string> = {
  ifood,
  keeta,
  '99food': food99,
  rappi,
  aiqfome,
  opendelivery,
};

/** Ícone do aplicativo; sem logo conhecido (Open Delivery cadastrado), a inicial na cor dele. */
export function AppLogo({
  channel,
  label,
  size = 44,
}: {
  channel: string;
  label?: string;
  size?: number;
}) {
  const info = channelInfo(channel, label);
  const src = LOGOS[channel];
  const style = {
    '--app-logo': `${size}px`,
    '--ch': info.color,
    '--ch-ink': info.ink,
  } as CSSProperties;
  if (!src)
    return (
      <span className="app-logo app-logo--initial" style={style} aria-hidden>
        {info.label.slice(0, 1).toUpperCase()}
      </span>
    );
  return (
    <img
      className="app-logo"
      style={style}
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
    />
  );
}
