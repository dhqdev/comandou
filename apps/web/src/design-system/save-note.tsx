import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Estado do salvamento automático:
 * - saving: gravando agora;
 * - saved: gravou, com a lista do que mudou;
 * - invalid: tem campo a corrigir, nada é gravado até lá;
 * - error: o servidor recusou ou caiu a internet (com Tentar de novo).
 */
export interface SaveNoteState {
  /** Muda a cada aviso novo: reinicia o tempo para sumir. */
  id: number;
  state: 'saving' | 'saved' | 'invalid' | 'error';
  lines: string[];
}

const SHOW_SAVED_MS = 4500;

/**
 * Cartão pequeno embaixo da tela que diz o que o salvamento automático gravou.
 * "Salvo" some sozinho; erro e campo a corrigir ficam até resolver.
 */
export function SaveNote({ note, onRetry }: { note: SaveNoteState | null; onRetry?(): void }) {
  const [hidden, setHidden] = useState<number | null>(null);
  useEffect(() => {
    if (!note || note.state !== 'saved') return;
    const t = setTimeout(() => setHidden(note.id), SHOW_SAVED_MS);
    return () => clearTimeout(t);
  }, [note]);
  if (!note || hidden === note.id) return null;
  const title =
    note.state === 'saving'
      ? 'Salvando…'
      : note.state === 'saved'
        ? 'Salvo'
        : note.state === 'invalid'
          ? 'Não salvo: corrija para salvar'
          : 'Não foi salvo';
  const icon =
    note.state === 'saving' ? (
      <Loader2 size={15} className="cm-save-note__spin" />
    ) : note.state === 'saved' ? (
      <Check size={15} />
    ) : (
      <AlertCircle size={15} />
    );
  const shown = note.lines.slice(0, 3);
  const more = note.lines.length - shown.length;
  return (
    <div
      className={`cm-save-note cm-save-note--${note.state}`}
      role={note.state === 'error' || note.state === 'invalid' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="cm-save-note__icon" aria-hidden>
        {icon}
      </span>
      <div className="cm-save-note__body">
        <strong>{title}</strong>
        {shown.length > 0 && (
          <ul>
            {shown.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
            {more > 0 && <li>e mais {more}</li>}
          </ul>
        )}
      </div>
      {note.state === 'error' && onRetry && (
        <button type="button" className="cm-save-note__retry" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}
