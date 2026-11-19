import { Timer } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Quanto falta para aceitar um pedido de aplicativo (no iFood são 8 minutos; depois ele cancela
 * sozinho) ou para responder a uma negociação do cliente (`kind="answer"`). Fica laranja nos 3
 * últimos minutos e vermelho no último.
 */
export function AcceptDeadline({
  until,
  compact = false,
  kind = 'accept',
}: {
  until: string;
  compact?: boolean;
  kind?: 'accept' | 'answer';
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const ms = Date.parse(until) - now;
  if (!Number.isFinite(ms)) return null;
  const mins = Math.ceil(ms / 60_000);
  const tone = ms <= 60_000 ? 'danger' : ms <= 3 * 60_000 ? 'warning' : 'neutral';
  const answer = kind === 'answer';
  const text =
    ms <= 0
      ? answer
        ? 'Prazo para responder acabou'
        : 'Prazo para aceitar acabou'
      : compact
        ? answer
          ? `Responda ao cliente em ${mins} min`
          : `Aceite em ${mins} min`
        : answer
          ? `Responda em até ${mins} min`
          : `Aceite em até ${mins} min, senão o aplicativo cancela`;
  return (
    <span className="ch-deadline" data-tone={tone} role="timer" title={text}>
      <Timer size={13} aria-hidden /> {text}
    </span>
  );
}
