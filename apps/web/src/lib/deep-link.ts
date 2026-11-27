import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import './spotlight.css';

/** Tira um parâmetro da URL atual sem criar entrada no histórico. */
function useDropParam() {
  const navigate = useNavigate();
  return (name: string) => {
    const p = new URLSearchParams(window.location.search);
    if (!p.has(name)) return;
    p.delete(name);
    const s = p.toString();
    navigate({ search: s ? `?${s}` : '', hash: window.location.hash }, { replace: true });
  };
}

/**
 * Link direto vindo da busca global: "/pedidos?abrir=<id>" abre o pedido.
 * Chama `onValue` uma vez (quando `ready`) e limpa o parâmetro da URL, para que voltar ou
 * recarregar a tela não abra de novo.
 */
export function useLinkParam(name: string, onValue: (value: string) => void, ready = true) {
  const [params] = useSearchParams();
  const value = params.get(name);
  const cb = useRef(onValue);
  cb.current = onValue;
  const drop = useDropParam();
  useEffect(() => {
    if (!value || !ready) return;
    cb.current(value);
    drop(name);
  }, [value, ready, name]);
}

/**
 * Destaca o item pedido em "?foco=": espera ele aparecer (a tela pode estar carregando), rola até
 * ele e faz ele piscar (três toques de contorno, ~2 s). Campo de formulário pisca com o rótulo
 * junto (o bloco `.cm-field`); dentro de um `<details>` fechado, abre antes. Fica no AppShell,
 * vale para todas as telas: a busca do topo e os links do assistente de IA usam o mesmo caminho.
 */
export function useSearchSpotlight() {
  const location = useLocation();
  const drop = useDropParam();
  const target = new URLSearchParams(location.search).get('foco');
  useEffect(() => {
    if (!target) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const found = document.querySelector<HTMLElement>(`[data-search-id="${CSS.escape(target)}"]`);
      if (!found && tries < 60) return;
      clearInterval(timer);
      drop('foco');
      if (!found) return;
      spotlight(found);
    }, 100);
    return () => clearInterval(timer);
  }, [target]);
}

/** Rola até o elemento e faz ele piscar. */
export function spotlight(found: HTMLElement) {
  const el =
    found.matches('input, select, textarea') && found.closest('.cm-field')
      ? (found.closest('.cm-field') as HTMLElement)
      : found;
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null)
    d.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('cm-spotlight');
  void el.offsetWidth; // reinicia a animação
  el.classList.add('cm-spotlight');
  el.addEventListener('animationend', () => el.classList.remove('cm-spotlight'), {
    once: true,
  });
}
