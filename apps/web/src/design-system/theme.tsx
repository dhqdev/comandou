import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * Tema claro/escuro. Fica salvo neste navegador; sem escolha, segue o sistema
 * (o painel admin começa no escuro). Todas as telas usam os mesmos tokens --cm-*, então
 * trocar o tema aqui muda tudo junto.
 */
export type Theme = 'light' | 'dark';
const KEY = 'cm-theme';
const EVENT = 'cm-theme';

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  if (document.documentElement.dataset.app === 'admin') return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme(): Theme {
  return stored() ?? systemTheme();
}

/** Aplica o tema antes do primeiro desenho (chamar no main.tsx). */
export function applyTheme(theme: Theme = currentTheme()) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  // Barra do navegador/app instalado acompanha o fundo da moldura.
  const meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    const frame = getComputedStyle(root).getPropertyValue('--cm-frame').trim();
    if (frame) meta.content = frame;
  }
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* sem armazenamento: vale só nesta aba */
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, set] = useState<Theme>(currentTheme);
  useEffect(() => {
    const sync = () => set(currentTheme());
    window.addEventListener(EVENT, sync);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystem = () => {
      if (!stored()) {
        applyTheme();
        sync();
      }
    };
    mq?.addEventListener?.('change', onSystem);
    return () => {
      window.removeEventListener(EVENT, sync);
      mq?.removeEventListener?.('change', onSystem);
    };
  }, []);
  return [theme, setTheme];
}

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void> };
};

/**
 * Troca o tema com uma onda que atravessa a tela a partir de onde a pessoa clicou (View
 * Transitions). Navegador sem suporte ou com "reduzir movimento": fade curto de cores.
 */
export function switchTheme(next: Theme, from?: { x: number; y: number }) {
  const doc = document as ViewTransitionDoc;
  const root = document.documentElement;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduce) {
    root.classList.add('cm-theme-switching');
    setTheme(next);
    window.setTimeout(() => root.classList.remove('cm-theme-switching'), 320);
    return;
  }
  const x = from?.x ?? window.innerWidth - 40;
  const y = from?.y ?? 40;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.classList.add('cm-theme-sweep');
  const vt = doc.startViewTransition(() => flushSync(() => setTheme(next)));
  vt.ready
    .then(() => {
      const anim = root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        {
          duration: 650,
          easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
      return anim.finished;
    })
    .catch(() => undefined)
    .finally(() => root.classList.remove('cm-theme-sweep'));
}

/** Centro de um elemento clicado (origem da onda da troca de tema). */
export function centerOf(el: Element) {
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
}

/** Botão sol/lua que alterna o tema, com a onda que passa pela tela. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme] = useTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Usar tema escuro' : 'Usar tema claro';
  return (
    <button
      type="button"
      className={`cm-theme-toggle ${className}`}
      aria-label={label}
      title={label}
      data-theme-now={theme}
      onClick={(e) => switchTheme(next, centerOf(e.currentTarget))}
    >
      <Sun size={18} className="cm-theme-toggle__sun" />
      <Moon size={18} className="cm-theme-toggle__moon" />
    </button>
  );
}
