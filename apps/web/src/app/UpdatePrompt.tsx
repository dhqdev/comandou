import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { APP_BUILD, fetchServerBuild } from '../lib/app-version';
import { claimReload, freshReload } from '../lib/fresh-reload';
import { onRealtimeReady } from '../lib/realtime-ready';

const POLL_MS = 60_000;
/** O deploy reinicia a API antes de o site novo estar no ar: confere de novo depois de reconectar. */
const AFTER_RECONNECT_S = [0, 20, 60, 180];
/** Quanto a faixa leva para encher antes de recarregar. */
export const FILL_MS = 1800;
/**
 * Alguém digitando ou com uma janela aberta (Nova venda, cobrança, cadastro): espera fechar, mas
 * no máximo este tempo.
 */
const BUSY_WAIT_MS = 5 * 60_000;
const BUSY_CHECK_MS = 2000;

/** Janela aberta: recarregar agora perderia uma venda ou um cadastro no meio. */
const dialogOpen = () => !!document.querySelector('dialog[open]');

/** Tem campo de texto com o foco (não recarrega no meio do que a pessoa está digitando). */
function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(
    type,
  );
}

/**
 * Atualiza o app sozinho quando sai versão nova (0.265: sem aviso nem botão "Atualizar").
 * Sinais: reconexão do tempo real (deploy reinicia a API), volta para a aba e uma consulta leve
 * a /version.json a cada minuto. Achou outra build no servidor: espera a pessoa parar de digitar
 * e fechar a janela aberta (até 5 min),
 * mostra uma faixa fina no topo enchendo, limpa os caches do app (service worker e arquivos
 * guardados) e recarrega direto do servidor. Cada build é tentada uma vez por aba (`claimReload`),
 * então um servidor que ainda entrega a cópia velha não deixa a tela recarregando em loop.
 *
 * Service worker novo esperando sem build nova no servidor (0.172): só o service worker ficou
 * para trás (outra aba ou o app instalado seguravam o antigo). Ele é ativado em silêncio, sem
 * recarregar a tela.
 */
export function UpdatePrompt() {
  const [serverBuild, setServerBuild] = useState<string | null>(null);
  /** Esta tela roda a versão do servidor? `pending` até a primeira resposta. */
  const [server, setServer] = useState<'pending' | 'current' | 'unknown'>('pending');
  const [updating, setUpdating] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      const build = await fetchServerBuild();
      if (!alive) return;
      if (!build) setServer((s) => (s === 'current' ? s : 'unknown'));
      else if (build === APP_BUILD) setServer('current');
      else setServerBuild(build);
    };
    const onVisible = () => void check();
    void check();
    const poll = setInterval(onVisible, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    const off = onRealtimeReady(() => {
      for (const s of AFTER_RECONNECT_S) {
        const t = setTimeout(() => {
          timers.delete(t);
          void check();
        }, s * 1000);
        timers.add(t);
      }
    });
    return () => {
      alive = false;
      clearInterval(poll);
      timers.forEach(clearTimeout);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      off();
    };
  }, []);

  // Sem build nova no servidor e service worker em espera: troca o service worker sem recarregar.
  useEffect(() => {
    if (needRefresh && server !== 'pending' && !serverBuild) void updateServiceWorker(false);
  }, [needRefresh, server, serverBuild, updateServiceWorker]);

  // Build nova no servidor: espera parar de digitar e começa a faixa.
  useEffect(() => {
    if (!serverBuild || updating) return;
    const since = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tryStart = () => {
      if ((typing() || dialogOpen()) && Date.now() - since < BUSY_WAIT_MS) {
        timer = setTimeout(tryStart, BUSY_CHECK_MS);
        return;
      }
      if (claimReload(serverBuild)) setUpdating(true);
    };
    tryStart();
    return () => clearTimeout(timer);
  }, [serverBuild, updating]);

  // A faixa enche e, no fim, limpa o cache e recarrega.
  useEffect(() => {
    if (!updating) return;
    const t = setTimeout(() => void freshReload(), FILL_MS);
    return () => clearTimeout(t);
  }, [updating]);

  if (!updating) return null;
  return (
    <div
      className="cm-autoupdate"
      role="status"
      aria-live="polite"
      style={{ ['--cm-autoupdate-ms' as string]: `${FILL_MS}ms` }}
    >
      <div className="cm-autoupdate__bar" />
      <span className="cm-autoupdate__note">Atualizando para a versão nova…</span>
    </div>
  );
}
