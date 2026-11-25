import { PIN_LENGTH } from '@comandou/shared';
import { Check, Delete } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from '../design-system';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ok', '0', 'del'] as const;
/** PIN antigo (antes da 0.250): 4 números, enviado pelo botão de confirmar. */
const OLD_LENGTH = 4;

/**
 * Teclado de PIN (6 números) para o garçom e o entregador: bolinhas no topo e teclas grandes de
 * 64px. Envia sozinho no 6º número; o PIN antigo, de 4, vai pelo botão de confirmar (ou Enter).
 * No computador, as teclas numéricas e o Backspace também funcionam. Erro: as bolinhas balançam
 * e o PIN apaga para tentar de novo.
 */
export function PinPad({
  onSubmit,
  disabled,
  error,
}: {
  onSubmit(pin: string): Promise<boolean>;
  disabled?: boolean;
  error?: string | null;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const busyRef = useRef(false);

  const submit = useCallback(
    async (value: string) => {
      busyRef.current = true;
      setBusy(true);
      const ok = await onSubmit(value).catch(() => false);
      busyRef.current = false;
      setBusy(false);
      if (!ok) {
        setShake((n) => n + 1);
        setPin('');
        navigator.vibrate?.(120);
      }
    },
    [onSubmit],
  );

  const press = useCallback(
    (k: string) => {
      if (busyRef.current || disabled) return;
      if (k === 'del') return setPin((p) => p.slice(0, -1));
      if (k === 'ok')
        return setPin((p) => {
          if (p.length === OLD_LENGTH) void submit(p);
          return p;
        });
      setPin((p) => {
        if (p.length >= PIN_LENGTH) return p;
        const next = p + k;
        if (next.length === PIN_LENGTH) void submit(next);
        return next;
      });
    },
    [disabled, submit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <div className="pinpad">
      <div
        key={shake}
        className={`pinpad__dots${shake ? ' is-wrong' : ''}`}
        role="status"
        aria-label={`PIN: ${pin.length} de ${PIN_LENGTH} números`}
        data-testid="pin-dots"
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={`pinpad__dot${i < pin.length ? ' is-on' : ''}`} />
        ))}
        {busy && (
          <span className="pinpad__busy">
            <Spinner inline label="Entrando" />
          </span>
        )}
      </div>
      <p className="pinpad__error" role="alert">
        {error ?? ''}
      </p>
      <div className="pinpad__keys">
        {KEYS.map((k, i) =>
          k === 'ok' ? (
            <button
              key={i}
              type="button"
              className="pinpad__key pinpad__key--ok"
              onClick={() => press('ok')}
              disabled={disabled || busy || pin.length !== OLD_LENGTH}
              aria-label="Entrar com o PIN de 4 números"
              title="PIN antigo, de 4 números"
            >
              <Check size={22} />
            </button>
          ) : (
            <button
              key={i}
              type="button"
              className={`pinpad__key${k === 'del' ? ' pinpad__key--del' : ''}`}
              onClick={() => press(k)}
              disabled={disabled || busy || (k === 'del' && !pin)}
              aria-label={k === 'del' ? 'Apagar' : k}
            >
              {k === 'del' ? <Delete size={22} /> : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
