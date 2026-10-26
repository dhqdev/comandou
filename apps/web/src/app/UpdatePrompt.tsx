import { RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '../design-system';
import { APP_BUILD, fetchServerBuild } from '../lib/app-version';
import { onRealtimeReady } from '../lib/realtime';

const POLL_MS = 60_000;
/** O deploy reinicia a API antes de o site novo estar no ar: confere de novo depois de reconectar. */
const AFTER_RECONNECT_S = [0, 20, 60, 180];

function waitInstalled(sw: ServiceWorker, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      sw.removeEventListener('statechange', onChange);
      clearTimeout(t);
      resolve();
    };
    const onChange = () => {
      if (sw.state !== 'installing') done();
    };
    const t = setTimeout(done, ms);
    sw.addEventListener('statechange', onChange);
  });
}

/**
 * Avisa em tempo real que saiu versão nova e deixa a pessoa escolher a hora de atualizar.
 * Sinais: reconexão do tempo real (deploy reinicia a API), volta para a aba e uma consulta leve
 * a /version.json a cada minuto. O service worker novo fica esperando até o clique em "Atualizar".
 */
export function UpdatePrompt() {
  const reg = useRef<ServiceWorkerRegistration | null>(null);
  const [serverBuild, setServerBuild] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const {
    needRefresh: [needRefresh],
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      reg.current = registration ?? null;
    },
  });

  useEffect(() => {
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      const build = await fetchServerBuild();
      if (!alive || !build || build === APP_BUILD) return;
      setServerBuild(build);
      // Já baixa a versão nova em segundo plano, para o clique em "Atualizar" ser imediato.
      void reg.current?.update().catch(() => undefined);
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

  const update = async () => {
    setBusy(true);
    const reload = () => window.location.reload();
    // Garantia: se o service worker não responder, recarrega do mesmo jeito.
    setTimeout(reload, 8000);
    const r = reg.current;
    if (!r) return reload();
    try {
      if (!r.waiting) await r.update();
      if (!r.waiting && r.installing) await waitInstalled(r.installing, 6000);
    } catch {
      /* sem rede para o service worker: recarrega mesmo assim */
    }
    if (!r.waiting) return reload();
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    r.waiting.postMessage({ type: 'SKIP_WAITING' });
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
      <Button size="sm" loading={busy} onClick={() => void update()}>
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
