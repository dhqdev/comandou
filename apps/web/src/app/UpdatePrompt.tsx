import { RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '../design-system';
import { APP_BUILD, fetchServerBuild } from '../lib/app-version';
import { freshReload } from '../lib/fresh-reload';
import { onRealtimeReady } from '../lib/realtime-ready';

const POLL_MS = 60_000;
/** O deploy reinicia a API antes de o site novo estar no ar: confere de novo depois de reconectar. */
const AFTER_RECONNECT_S = [0, 20, 60, 180];

/**
 * Avisa em tempo real que saiu versão nova e deixa a pessoa escolher a hora de atualizar.
 * Sinais: reconexão do tempo real (deploy reinicia a API), volta para a aba e uma consulta leve
 * a /version.json a cada minuto. O clique em "Atualizar" limpa os caches do app (service worker e
 * arquivos guardados) e recarrega direto do servidor, então ninguém fica preso na versão velha.
 */
export function UpdatePrompt() {
  const [serverBuild, setServerBuild] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const {
    needRefresh: [needRefresh],
  } = useRegisterSW();

  useEffect(() => {
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      const build = await fetchServerBuild();
      if (!alive || !build || build === APP_BUILD) return;
      setServerBuild(build);
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

  const key = serverBuild ?? (needRefresh ? 'sw' : null);
  if (!key || dismissed === key) return null;

  const update = () => {
    setBusy(true);
    void freshReload();
  };

  return (
    <div className="cm-update" role="status" aria-live="polite">
      <span className="cm-update__icon" aria-hidden="true">
        <RefreshCw size={18} />
      </span>
      <div className="cm-update__text">
        <strong>Nova versão disponível</strong>
        <span>Atualize para usar as novidades.</span>
      </div>
      <Button size="sm" loading={busy} onClick={update}>
        Atualizar
      </Button>
      <button
        type="button"
        className="cm-update__close"
        aria-label="Agora não"
        onClick={() => setDismissed(key)}
      >
        <X size={16} />
      </button>
    </div>
  );
}
