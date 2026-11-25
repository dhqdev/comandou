import { Hash, Users } from 'lucide-react';
import type { Kind } from './chat-api';

const PALETTE = [
  ['#fde4d6', '#9a3a12'],
  ['#dff1e4', '#1f6b35'],
  ['#e0ebfb', '#24539e'],
  ['#f3e3f7', '#7a2d8f'],
  ['#fdf0cf', '#7d5a00'],
  ['#dcf2f2', '#1c6464'],
  ['#f8e0e3', '#9c2737'],
  ['#e8e6fb', '#4a3fa3'],
] as const;

export function initials(name: string | null | undefined) {
  const parts = (name ?? '?')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .split(/\s+/);
  return (
    (parts[0]?.[0] ?? '?') +
    (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? ''))
  ).toUpperCase();
}

/** Fundo e letra do avatar: sempre os mesmos para a mesma pessoa. */
export function avatarColors(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Bolinha com as iniciais (cor fixa por pessoa) e, se quiser, o ponto de online. */
export function Avatar({
  name,
  seed,
  size = 40,
  online,
  kind = 'direct',
}: {
  name: string | null | undefined;
  seed?: string;
  size?: number;
  online?: boolean;
  kind?: Kind;
}) {
  const [bg, fg] = avatarColors(seed ?? name ?? '?');
  return (
    <span
      className="tc-avatar"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.38 }}
      aria-hidden
    >
      {kind === 'group' ? (
        <Users size={size * 0.45} />
      ) : kind === 'channel' ? (
        <Hash size={size * 0.45} />
      ) : (
        initials(name)
      )}
      {online !== undefined && <i className={`tc-avatar__dot ${online ? 'is-on' : ''}`} />}
    </span>
  );
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Hora (hoje), "Ontem", dia da semana (esta semana) ou data. */
export function shortWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return hhmm(iso);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Ontem';
  if (now.getTime() - d.getTime() < 6 * 86_400_000)
    return d
      .toLocaleDateString('pt-BR', { weekday: 'short' })
      .replace('.', '')
      .replace(/^\w/, (c) => c.toUpperCase());
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Tempo do recado no Mural: "agora", "há 5 min", "há 2 h"; mais antigo, como `shortWhen`. */
export function timeAgo(iso: string, now = Date.now()) {
  const min = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 12 * 60) return `há ${Math.floor(min / 60)} h`;
  return shortWhen(iso);
}

/** Separador de dia na conversa: HOJE, ONTEM, 1 DE OUTUBRO. */
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return 'Hoje';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export const dayKey = (iso: string) => new Date(iso).toDateString();

export const fmtInt = (n: number) => new Intl.NumberFormat('pt-BR').format(Math.round(n));

/** Emojis do seletor do campo de mensagem. */
export const EMOJIS =
  '😀 😂 😊 😍 🤩 😎 🤔 😅 😴 😢 😡 🙏 👍 👎 👏 🙌 💪 👀 ✅ ❌ ⚠️ 🔥 🎉 ❤️ 🍕 🍔 🍟 🌭 🥗 🍝 🍣 🍰 ☕ 🍺 🥤 🧾 🛵 ⏰ 📦 🧑‍🍳 🍽️ 💰'.split(
    ' ',
  );

/**
 * Botão de enviar: tocar nele não tira o foco do campo. No celular o teclado fica aberto entre
 * uma mensagem e outra (antes fechava e abria de novo, e a conversa pulava para cima e voltava).
 */
export const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();
