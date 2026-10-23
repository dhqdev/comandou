import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

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

/** Botão sol/lua que alterna o tema. A troca acontece com um fade curto em toda a tela. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, set] = useTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Usar tema escuro' : 'Usar tema claro';
  return (
    <button
      type="button"
      className={`cm-theme-toggle ${className}`}
      aria-label={label}
      title={label}
      data-theme-now={theme}
      onClick={() => {
        const root = document.documentElement;
        root.classList.add('cm-theme-switching');
        set(next);
        window.setTimeout(() => root.classList.remove('cm-theme-switching'), 320);
      }}
    >
      <Sun size={18} className="cm-theme-toggle__sun" />
      <Moon size={18} className="cm-theme-toggle__moon" />
    </button>
  );
}
