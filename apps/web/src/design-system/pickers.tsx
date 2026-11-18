import { Check } from 'lucide-react';
import { forwardRef, SelectHTMLAttributes, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './app-frame';
import { commit, fieldName, setRef, useCoarse } from './picker-utils';

/**
 * Seletores do Comandou. No computador usam o controle nativo; no toque (celular, PWA),
 * tocar no campo abre uma folha que sobe de baixo, grande e no visual do sistema, em vez
 * da roleta do iPhone/Android. O elemento nativo continua na página (formulários, leitores
 * de tela e testes funcionam igual), e a escolha na folha dispara o mesmo `onChange`.
 */

interface Opt {
  value: string;
  label: string;
  disabled: boolean;
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Título da folha no celular (padrão: o rótulo do campo). */
  sheetTitle?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = '', sheetTitle, children, ...rest },
  ref,
) {
  const el = useRef<HTMLSelectElement | null>(null);
  const coarse = useCoarse();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Opt[]>([]);
  const [title, setTitle] = useState('');
  const [current, setCurrent] = useState('');

  const show = () => {
    const s = el.current;
    if (!s || s.disabled) return;
    setOpts([...s.options].map((o) => ({ value: o.value, label: o.text, disabled: o.disabled })));
    setTitle(sheetTitle ?? fieldName(s, 'Escolha uma opção'));
    setCurrent(s.value);
    setOpen(true);
  };

  return (
    <span className={`cm-picker ${coarse ? 'is-touch' : ''}`}>
      <select
        ref={(n) => {
          el.current = n;
          setRef(ref, n);
        }}
        className={`cm-input ${className}`}
        {...rest}
        onFocus={(e) => {
          // No toque, o foco (ex.: tocar no rótulo) abriria a roleta nativa.
          if (coarse) {
            e.currentTarget.blur();
            show();
          }
          rest.onFocus?.(e);
        }}
      >
        {children}
      </select>
      {coarse && (
        <button
          type="button"
          className="cm-picker__tap"
          tabIndex={-1}
          aria-hidden
          disabled={rest.disabled}
          onClick={show}
        />
      )}
      {coarse &&
        createPortal(
          <Sheet open={open} title={title} onClose={() => setOpen(false)}>
            <div className="cm-options" role="listbox" aria-label={title}>
              {opts.map((o) => {
                const on = o.value === current;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={o.disabled}
                    className={`cm-option ${on ? 'is-on' : ''}`}
                    onClick={() => {
                      setOpen(false);
                      if (el.current && el.current.value !== o.value)
                        commit(el.current, o.value, 'change');
                    }}
                  >
                    <span>{o.label}</span>
                    {on && <Check size={20} aria-hidden />}
                  </button>
                );
              })}
            </div>
          </Sheet>,
          document.body,
        )}
    </span>
  );
});
