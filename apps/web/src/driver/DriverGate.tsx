import { CheckCircle2, Download, LocateFixed, Share, SquarePlus } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Button } from '../design-system';
import { canPromptInstall, isStandalone, promptInstall } from '../platform/pwa';

type Geo = 'checking' | 'prompt' | 'granted' | 'denied' | 'unsupported';

const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Situação da permissão de localização, acompanhando mudanças (o motoboy pode desligar). */
function useGeoPermission() {
  const [geo, setGeo] = useState<Geo>('checking');
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(() => {
    if (!navigator.geolocation) return setGeo('unsupported');
    setError(null);
    navigator.geolocation.getCurrentPosition(
      () => setGeo('granted'),
      (e) => {
        if (e.code === e.PERMISSION_DENIED) setGeo('denied');
        else {
          setGeo('prompt');
          setError('Não achamos o GPS agora. Confira se a localização do celular está ligada.');
        }
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeo('unsupported');
      return;
    }
    let status: PermissionStatus | null = null;
    let stop = false;
    const perms = navigator.permissions;
    if (!perms?.query) {
      // Sem a API de permissões (iPhone antigo): pergunta direto; quem já permitiu passa sozinho.
      ask();
      return;
    }
    perms
      .query({ name: 'geolocation' })
      .then((s) => {
        if (stop) return;
        status = s;
        setGeo(s.state);
        s.onchange = () => setGeo(s.state);
      })
      .catch(() => ask());
    return () => {
      stop = true;
      if (status) status.onchange = null;
    };
  }, [ask]);

  return { geo, error, ask };
}

/** O app já está instalado na tela inicial (aberto pelo atalho)? */
function useInstalled() {
  const [installed, setInstalled] = useState(isStandalone);
  const [installable, setInstallable] = useState(canPromptInstall);
  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const sync = () => setInstalled(isStandalone());
    const offer = () => setInstallable(canPromptInstall());
    mq?.addEventListener?.('change', sync);
    window.addEventListener('cm-installable', offer);
    window.addEventListener('appinstalled', sync);
    return () => {
      mq?.removeEventListener?.('change', sync);
      window.removeEventListener('cm-installable', offer);
      window.removeEventListener('appinstalled', sync);
    };
  }, []);
  return { installed, installable, setInstallable };
}

/**
 * Antes de mostrar as corridas, o entregador precisa (1) abrir pelo atalho na tela inicial
 * (app instalado) e (2) deixar a localização permitida. Sem os dois, a tela só explica como.
 */
export function DriverGate({ children }: { children: ReactNode }) {
  const { installed, installable, setInstallable } = useInstalled();
  const { geo, error, ask } = useGeoPermission();

  if (installed && geo === 'granted') return <>{children}</>;
  if (geo === 'checking') return null;

  const install = async () => {
    await promptInstall();
    setInstallable(canPromptInstall());
  };

  return (
    <section className="dgate" aria-label="Antes de começar">
      <h1 className="dgate__title">Antes de começar</h1>
      <p className="cm-hint">
        Para receber corridas, o app precisa estar na tela inicial e com a localização ligada.
      </p>
      <ol className="dgate__steps">
        <li data-done={installed || undefined}>
          <span className="dgate__icon" aria-hidden>
            {installed ? <CheckCircle2 size={22} /> : <SquarePlus size={22} />}
          </span>
          <div>
            <strong>Colocar o atalho na tela inicial</strong>
            {installed ? (
              <span className="cm-hint">Pronto.</span>
            ) : ios() ? (
              <span className="cm-hint">
                No Safari, toque em <Share size={14} aria-label="Compartilhar" /> Compartilhar e em{' '}
                <b>Adicionar à Tela de Início</b>. Depois abra o Comandou pelo ícone novo.
              </span>
            ) : installable ? (
              <span className="cm-hint">Instale e depois abra pelo ícone novo.</span>
            ) : (
              <span className="cm-hint">
                No Chrome, toque no menu ⋮ e em <b>Instalar app</b> (ou{' '}
                <b>Adicionar à tela inicial</b>). Depois abra pelo ícone novo.
              </span>
            )}
            {!installed && installable && (
              <Button size="lg" icon={<Download size={18} />} onClick={() => void install()}>
                Instalar o app
              </Button>
            )}
          </div>
        </li>
        <li data-done={geo === 'granted' || undefined}>
          <span className="dgate__icon" aria-hidden>
            {geo === 'granted' ? <CheckCircle2 size={22} /> : <LocateFixed size={22} />}
          </span>
          <div>
            <strong>Permitir a localização</strong>
            {geo === 'granted' ? (
              <span className="cm-hint">Pronto.</span>
            ) : geo === 'unsupported' ? (
              <span className="cm-hint">Este aparelho não informa a localização.</span>
            ) : geo === 'denied' ? (
              <span className="cm-hint">
                A localização foi bloqueada. Abra os ajustes do celular, procure o navegador (ou o
                app instalado), deixe a localização como <b>Permitir</b> e volte aqui.
              </span>
            ) : (
              <span className="cm-hint">
                O restaurante e o cliente acompanham a entrega pelo mapa. Fica ligada enquanto o
                app estiver aberto.
              </span>
            )}
            {error && <span className="form-error">{error}</span>}
            {(geo === 'prompt' || geo === 'denied') && (
              <Button
                size="lg"
                variant={installed ? 'primary' : 'secondary'}
                icon={<LocateFixed size={18} />}
                onClick={ask}
              >
                {geo === 'denied' ? 'Tentar de novo' : 'Permitir localização'}
              </Button>
            )}
          </div>
        </li>
      </ol>
    </section>
  );
}
