import { ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { brl } from '../../lib/money';
import { BagArt } from './art';
import { reducedMotion } from './morph';
import './order-sent.css';

/** Tempo da comemoração antes de abrir o acompanhamento sozinho. */
export const ORDER_SENT_MS = 2600;

/**
 * Confirmação do pedido feito: tela inteira na cor de fundo da loja (sem fade, para não piscar),
 * a sacola sobe com o selo e o visto se desenha. Depois de ~2,6 s abre o acompanhamento, que já
 * veio carregado por trás (prefetchOrder); "Acompanhar" abre na hora.
 */
export function OrderSent({
  number,
  total,
  channel,
  table,
  awaiting = false,
  onDone,
}: {
  number: number;
  total: string;
  channel: 'delivery' | 'pickup' | 'table';
  /** Nome da mesa (pedido pelo QR Code). */
  table?: string;
  /** Entrou em análise: o restaurante ainda vai aceitar. */
  awaiting?: boolean;
  onDone(): void;
}) {
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
      <div className="osent__card">
        <BagArt done live className="osent__art" />
        <h2 id="osent-title">Pedido enviado!</h2>
        <p id="osent-text">
          Pedido <strong>#{number}</strong> · {brl(total)}
          <br />
          {channel === 'table'
            ? awaiting
              ? `A loja já recebeu. Assim que confirmar, prepara e leva na Mesa ${table ?? ''}.`
              : `A cozinha já recebeu e a gente leva na Mesa ${table ?? ''}.`
            : channel === 'delivery'
              ? 'A loja já recebeu e vai preparar para entregar.'
              : 'A loja já recebeu. Avisamos quando estiver pronto para retirar.'}
        </p>
        <button ref={btn} type="button" className="cta osent__cta" onClick={() => onDone()}>
          Acompanhar pedido <ChevronRight size={18} aria-hidden />
          <span className="osent__bar" aria-hidden />
        </button>
      </div>
    </div>,
    // Dentro da moldura do cardápio (.sf), que guarda as variáveis de cor e raio da loja.
    document.querySelector('.sf') ?? document.body,
  );
}
