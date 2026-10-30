import { ArrowRight, X } from 'lucide-react';
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useInRouterContext } from 'react-router';

/**
 * Ajuda de campo: o "?" ao lado do rótulo abre um balão curto dizendo o que é o campo, para que
 * serve e, quando ele depende de outra tela, um link que leva até lá num clique.
 *
 * As explicações ficam em dicionários por tela (HelpScope). TextField, SelectField e CheckField
 * acham a explicação pelo próprio rótulo, então campo novo ganha o "?" só de entrar no dicionário.
 */
export interface HelpEntry {
  /** O que é e para que serve, em uma ou duas frases. */
  text: string;
  /** Exemplo curto (opcional). */
  example?: string;
  /** Tela relacionada. */
  link?: { to: string; label: string };
}

export type HelpDict = Record<string, HelpEntry>;

const HelpCtx = createContext<HelpDict | null>(null);

/** "Código (opcional)" e "código" acham a mesma explicação. */
export function helpKey(label: string) {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\((opcional|nf-e)\)/gi, '')
    .replace(/[^a-z0-9%/ ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Liga um dicionário de ajuda a um pedaço da tela; o de dentro vale mais que o de fora. */
export function HelpScope({ dict, children }: { dict: HelpDict; children: ReactNode }) {
  const parent = useContext(HelpCtx);
  const merged = useMemo(() => {
    const own: HelpDict = {};
    for (const [k, v] of Object.entries(dict)) own[helpKey(k)] = v;
    return { ...(parent ?? {}), ...own };
  }, [parent, dict]);
  return <HelpCtx.Provider value={merged}>{children}</HelpCtx.Provider>;
}

/** Explicação do campo pelo rótulo (null quando a tela não tem dicionário ou o campo não está nele). */
export function useHelp(label: ReactNode): HelpEntry | null {
  const dict = useContext(HelpCtx);
  if (!dict || typeof label !== 'string') return null;
  return dict[helpKey(label)] ?? null;
}

/**
 * Botão "?" com o balão. Passe `entry` direto ou `label` para buscar no dicionário da tela.
 * Sem explicação, não mostra nada.
 */
export function HelpTip({
  label,
  entry,
  className,
}: {
  label: string;
  entry?: HelpEntry | null;
  className?: string;
}) {
  const found = useHelp(label);
  const help = entry ?? found;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  if (!help) return null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className ? `cm-help ${className}` : 'cm-help'}
        aria-label={`O que é ${label}?`}
        aria-expanded={open}
        data-help={label}
        onClick={(e) => {
          // Dentro de <label> o clique não pode marcar a caixa nem focar o campo.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open && <HelpBubble anchor={btn} title={label} help={help} onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpBubble({
  anchor,
  title,
  help,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  title: string;
  help: HelpEntry;
  onClose(): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const inRouter = useInRouterContext();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const b = box.current;
      if (!a || !b) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = b.offsetWidth;
      const h = b.offsetHeight;
      let top = a.bottom + 8;
      if (top + h > vh - 8) top = Math.max(8, a.top - h - 8);
      const left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), vw - w - 8);
      setPos({ top: Math.round(top), left: Math.round(left) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor.current?.focus();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={box}
      className="cm-help-bubble"
      role="dialog"
      aria-labelledby={id}
      data-placed={pos ? true : undefined}
      style={pos ? { top: pos.top, left: pos.left } : undefined}
    >
      <div className="cm-help-bubble__head">
        <strong id={id}>{title.replace(/\s*\(opcional\)\s*$/i, '')}</strong>
        <button type="button" aria-label="Fechar ajuda" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <p>{help.text}</p>
      {help.example && (
        <p className="cm-help-bubble__ex">
          <b>Exemplo:</b> {help.example}
        </p>
      )}
      {help.link &&
        (inRouter ? (
          <Link className="cm-help-bubble__link" to={help.link.to} onClick={onClose}>
            {help.link.label} <ArrowRight size={14} />
          </Link>
        ) : (
          <a className="cm-help-bubble__link" href={help.link.to}>
            {help.link.label} <ArrowRight size={14} />
          </a>
        ))}
    </div>,
    document.body,
  );
}

/** Rótulo de campo com o "?" ao lado (para campos montados à mão). */
export function HelpLabel({
  htmlFor,
  children,
  as = 'label',
}: {
  htmlFor?: string;
  children: string;
  as?: 'label' | 'span';
}) {
  const Tag = as;
  return (
    <span className="cm-label-row">
      <Tag className="cm-label" htmlFor={as === 'label' ? htmlFor : undefined}>
        {children}
      </Tag>
      <HelpTip label={children} />
    </span>
  );
}
