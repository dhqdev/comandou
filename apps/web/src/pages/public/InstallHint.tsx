import { Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canPromptInstall, isStandalone, promptInstall, wasInstalled } from '../../platform/pwa';
import './install-hint.css';

/**
 * Como este aparelho instala o cardápio:
 * - `phone` / `desktop`: o navegador oferece a instalação (Chrome, Edge, Android), um toque basta;
 * - `ios`: iPhone e iPad, pelo Compartilhar → Adicionar à Tela de Início;
 * - `android`: Android sem o pedido do navegador, pelo menu ⋮;
 * - `mac`: Safari do Mac, pelo Arquivo → Adicionar ao Dock.
 * null quando não dá (Firefox no computador, navegador dentro do Instagram/WhatsApp) ou já está
 * instalado.
 */
export type InstallKind = 'phone' | 'desktop' | 'ios' | 'android' | 'mac';

export function installKind(env: {
  ua: string;
  touchPoints: number;
  standalone: boolean;
  canPrompt: boolean;
}): InstallKind | null {
  const { ua, touchPoints, standalone, canPrompt } = env;
  if (standalone) return null;
  // Navegador dentro de outro app (Instagram, Facebook, WhatsApp, WebView): não instala.
  if (/FBAN|FBAV|Instagram|Line\/|WhatsApp|; wv\)/i.test(ua)) return null;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  if (ios) return 'ios';
  const mobile = /Android|Mobi/i.test(ua);
  if (canPrompt) return mobile ? 'phone' : 'desktop';
  if (/Android/i.test(ua)) return 'android';
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
  const version = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
  if (/Macintosh/.test(ua) && safari && version >= 17) return 'mac';
  return null;
}

const KEY = 'cm-install-hint';
/** Fechou o aviso: volta só depois de um mês. */
const SNOOZE_MS = 30 * 86_400_000;

function snoozed() {
  try {
    const at = Number(localStorage.getItem(KEY) ?? 0);
    return Date.now() - at < SNOOZE_MS;
  } catch {
    return true;
  }
}
function snooze() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* modo privado: some só nesta visita */
  }
}

/**
 * iPhone: "Adicionar à Tela de Início" abre em tela cheia, como app, e com o nome da loja (e não
 * o título da aba, "Loja · Cardápio").
 */
export function useHomeScreenMeta(name: string) {
  useEffect(() => {
    const set = (n: string, v: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${n}"]`);
      if (!el) {
        el = Object.assign(document.createElement('meta'), { name: n });
        document.head.appendChild(el);
      }
      el.content = v;
    };
    set('apple-mobile-web-app-capable', 'yes');
    set('mobile-web-app-capable', 'yes');
    set('apple-mobile-web-app-title', name);
  }, [name]);
}

/** Uma vez por visita (ao trocar de tela não volta a aparecer). */
let shownThisVisit = false;

function currentKind() {
  return installKind({
    ua: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints ?? 0,
    standalone: isStandalone(),
    canPrompt: canPromptInstall(),
  });
}

/**
 * Aviso pequeno de instalar o cardápio como app, conforme o aparelho: "baixe o app" no Android,
 * "coloque na Tela de Início" no iPhone e "coloque na área de trabalho" no computador. Aparece
 * uma vez, depois de alguns segundos (não atrasa a abertura), com o ícone da loja caindo dentro
 * do aparelho desenhado. Fechou: some por um mês. Instalou: some de vez.
 */
export function InstallHint({
  name,
  logoUrl,
  delay = 5000,
}: {
  name: string;
  logoUrl: string | null;
  /** Quanto espera antes de aparecer (ms). */
  delay?: number;
}) {
  const [kind, setKind] = useState<InstallKind | null>(null);

  useEffect(() => {
    // Prévia da Loja online (dentro do painel) e quem já instalou ou fechou: nada.
    if (shownThisVisit || window.self !== window.top || wasInstalled() || snoozed()) return;
    const t = window.setTimeout(() => {
      const k = currentKind();
      if (!k) return;
      shownThisVisit = true;
      setKind(k);
    }, delay);
    // O Chrome pode avisar que dá para instalar depois do aviso já aberto com o passo a passo.
    const upgrade = () => setKind((k) => (k ? currentKind() : k));
    const gone = () => setKind(null);
    window.addEventListener('cm-installable', upgrade);
    window.addEventListener('cm-installed', gone);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('cm-installable', upgrade);
      window.removeEventListener('cm-installed', gone);
    };
  }, [delay]);

  if (!kind) return null;

  const close = () => {
    snooze();
    setKind(null);
  };
  const install = async () => {
    // Recusou ou aceitou: em qualquer caso não insiste mais neste mês.
    snooze();
    if (!(await promptInstall())) return;
    setKind(null);
  };

  const desk = kind === 'desktop' || kind === 'mac';
  const title =
    kind === 'phone'
      ? 'Baixe o app'
      : kind === 'desktop'
        ? 'Coloque na área de trabalho'
        : kind === 'mac'
          ? 'Coloque no Dock'
          : kind === 'ios'
            ? 'Coloque na Tela de Início'
            : 'Coloque na tela inicial';

  return (
    <aside className="sf-install" data-kind={kind} role="status" aria-label="Instalar o app">
      <span className="sf-install__art" data-device={desk ? 'desktop' : 'phone'} aria-hidden>
        <span className="sf-install__screen">
          <i />
          <i />
          <i />
          <span className="sf-install__slot">
            {logoUrl ? <img src={logoUrl} alt="" /> : <b>{name.slice(0, 1).toUpperCase()}</b>}
          </span>
        </span>
      </span>
      <span className="sf-install__text">
        <strong>{title}</strong>
        <small>
          {kind === 'phone' || kind === 'desktop' ? (
            'Abre direto no cardápio'
          ) : kind === 'ios' ? (
            <>
              Toque em{' '}
              <span className="sf-install__share">
                <Share size={14} aria-label="Compartilhar" />
              </span>{' '}
              › Adicionar à Tela de Início
            </>
          ) : kind === 'mac' ? (
            'Arquivo › Adicionar ao Dock'
          ) : (
            'Menu ⋮ › Adicionar à tela inicial'
          )}
        </small>
      </span>
      {(kind === 'phone' || kind === 'desktop') && (
        <button type="button" className="sf-install__go" onClick={() => void install()}>
          {kind === 'phone' ? 'Baixar' : 'Instalar'}
        </button>
      )}
      <button type="button" className="sf-install__close" aria-label="Agora não" onClick={close}>
        <X size={16} />
      </button>
    </aside>
  );
}
