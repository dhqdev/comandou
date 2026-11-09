import { ChevronRight } from 'lucide-react';
import { CSSProperties, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { brl } from '../../lib/money';
import { BagArt, MotoboyArt } from './art';
import { reducedMotion } from './morph';
import './order-sent.css';

/** Tempo da comemoração antes de abrir o acompanhamento sozinho. */
export const ORDER_SENT_MS = 3200;

const CONFETTI_COLORS = [
  'var(--cm-brand-500)',
  'var(--cm-accent-400)',
  '#ffd34d',
  '#ff5a4e',
  '#3ab26a',
  '#7cc4ff',
];

/** Papeizinhos espalhados em volta do centro: posição e giro fixos (sem sorteio a cada render). */
function confetti(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + (i % 3) * 0.35;
    const d = 120 + ((i * 47) % 110);
    return {
      dx: Math.round(Math.cos(a) * d),
      dy: Math.round(Math.sin(a) * d * 0.8 - 40),
      rot: (i * 73) % 360,
      delay: (i % 5) * 40,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
      round: i % 4 === 0,
    };
  });
}

/**
 * Comemoração do pedido feito: a sacola cai com o selo de "ok", papeizinhos estouram e o
 * motoboy passa (entrega). Depois de ~3 s abre o acompanhamento; "Acompanhar" abre na hora.
 */
export function OrderSent({
  number,
  total,
  channel,
  onDone,
}: {
  number: number;
  total: string;
  channel: 'delivery' | 'pickup';
  onDone(): void;
}) {
  const pieces = useMemo(() => confetti(28), []);
  const done = useRef(onDone);
  done.current = onDone;
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    btn.current?.focus({ preventScroll: true });
    try {
      navigator.vibrate?.([24, 60, 40]);
    } catch {
      // Sem vibração no aparelho: segue sem.
    }
    const id = window.setTimeout(() => done.current(), ORDER_SENT_MS);
    return () => window.clearTimeout(id);
  }, []);

  const still = reducedMotion();
  return createPortal(
    <div
      className="osent"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="osent-title"
      aria-describedby="osent-text"
      data-still={still || undefined}
      style={{ ['--osent-ms' as string]: `${ORDER_SENT_MS}ms` }}
    >
      <div className="osent__burst" aria-hidden>
        {pieces.map((p, i) => (
          <i
            key={i}
            data-round={p.round || undefined}
            style={
              {
                '--dx': `${p.dx}px`,
                '--dy': `${p.dy}px`,
                '--rot': `${p.rot}deg`,
                '--delay': `${p.delay}ms`,
                background: p.color,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="osent__card">
        <BagArt done live className="osent__art" />
        <h2 id="osent-title">Pedido enviado!</h2>
        <p id="osent-text">
          Pedido <strong>#{number}</strong> · {brl(total)}
          <br />
          {channel === 'delivery'
            ? 'A loja já recebeu e vai preparar para entregar.'
            : 'A loja já recebeu. Avisamos quando estiver pronto para retirar.'}
        </p>
        <button ref={btn} type="button" className="cta osent__cta" onClick={() => onDone()}>
          Acompanhar pedido <ChevronRight size={18} aria-hidden />
          <span className="osent__bar" aria-hidden />
        </button>
      </div>
      {channel === 'delivery' && !still && <MotoboyArt ride className="osent__moto" />}
    </div>,
    // Dentro da moldura do cardápio (.sf), que guarda as variáveis de cor e raio da loja.
    document.querySelector('.sf') ?? document.body,
  );
}
