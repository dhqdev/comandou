import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Tema claro/escuro. Fica salvo neste navegador; sem escolha, segue o sistema
 * (vale também para o painel admin). Todas as telas usam os mesmos tokens --cm-*, então
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
  paintBar(theme);
}

/**
 * Cor da barra do navegador (theme-color) e da área do relógio/Dynamic Island no iPhone. Nas telas
 * da equipe acompanha o fundo da moldura; no cardápio ('page') é o próprio fundo da página, para o
 * topo do celular ter uma cor só, sem faixa de outra cor. Não depende do CSS já ter carregado:
 * cada caso tem um valor fixo de reserva.
 */
let barMode: 'frame' | 'page' = 'frame';
export function setBarColor(mode: 'frame' | 'page') {
  barMode = mode;
  paintBar();
}
function paintBar(theme: Theme = currentTheme()) {
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  const page = barMode === 'page';
  const color =
    getComputedStyle(document.documentElement)
      .getPropertyValue(page ? '--cm-bg' : '--cm-frame')
      .trim() ||
    (page ? (theme === 'dark' ? '#141416' : '#f6f6f7') : theme === 'dark' ? '#0e0e10' : '#ffffff');
  if (meta.content !== color) meta.content = color;
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

/**
 * Troca o tema com um círculo que nasce do ponto do clique e se abre até cobrir a tela
 * (View Transitions + clip-path circle, ver tokens.css). Sem ponto (teclado), nasce do meio da
 * tela. Sem suporte do navegador: fade curto de cores. "Reduzir movimento": troca na hora.
 */
let switchTimer: number | undefined;
type Vt = { ready: Promise<void> };
export function switchTheme(next: Theme, from?: { x: number; y: number }) {
  const root = document.documentElement;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return setTheme(next);
  const doc = document as Document & { startViewTransition?: (cb: () => void) => Vt };
  if (typeof doc.startViewTransition === 'function') {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = from?.x ?? w / 2;
    const y = from?.y ?? h / 2;
    // Raio até o canto mais distante: o círculo termina cobrindo a tela inteira.
    const r = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
    const t = doc.startViewTransition(() => setTheme(next));
    t.ready
      .then(() =>
        root
          .animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
            {
              duration: 560,
              easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
              pseudoElement: '::view-transition-new(root)',
            },
          )
          .finished.catch(() => undefined),
      )
      .catch(() => undefined);
    return;
  }
  root.classList.add('cm-theme-switching');
  // Dois quadros: a classe precisa estar valendo antes de as cores mudarem.
  requestAnimationFrame(() => requestAnimationFrame(() => setTheme(next)));
  window.clearTimeout(switchTimer);
  switchTimer = window.setTimeout(() => root.classList.remove('cm-theme-switching'), 450);
}

/** Ponto do clique (ou o centro do botão, quando veio do teclado). */
export function clickPoint(e: { clientX: number; clientY: number; detail: number }, el: Element) {
  return e.detail > 0 ? { x: e.clientX, y: e.clientY } : centerOf(el);
}

/** Centro de um elemento clicado. */
export function centerOf(el: Element) {
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
}

/** Botão sol/lua que alterna o tema, com o círculo que se abre a partir do clique. */
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
      onClick={(e) => switchTheme(next, clickPoint(e, e.currentTarget))}
    >
      <Sun size={18} className="cm-theme-toggle__sun" />
      <Moon size={18} className="cm-theme-toggle__moon" />
    </button>
  );
}
