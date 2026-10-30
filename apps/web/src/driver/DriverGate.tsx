import { LocateFixed } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Button } from '../design-system';

type Geo = 'checking' | 'prompt' | 'granted' | 'denied' | 'unsupported';

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

/**
 * Antes de mostrar as corridas, o entregador precisa deixar a localização permitida. Não precisa
 * instalar o app na tela inicial: funciona direto no navegador.
 */
export function DriverGate({ children }: { children: ReactNode }) {
  const { geo, error, ask } = useGeoPermission();

  if (geo === 'granted') return <>{children}</>;
  if (geo === 'checking') return null;

  return (
    <section className="dgate" aria-label="Antes de começar">
      <h1 className="dgate__title">Antes de começar</h1>
      <p className="cm-hint">Para receber corridas, deixe a localização do celular ligada.</p>
      <ol className="dgate__steps">
        <li>
          <span className="dgate__icon" aria-hidden>
            <LocateFixed size={22} />
          </span>
          <div>
            <strong>Permitir a localização</strong>
            {geo === 'unsupported' ? (
              <span className="cm-hint">Este aparelho não informa a localização.</span>
            ) : geo === 'denied' ? (
              <span className="cm-hint">
                A localização foi bloqueada. Abra os ajustes do celular, procure o navegador (ou o
                app instalado), deixe a localização como <b>Permitir</b> e volte aqui.
              </span>
            ) : (
              <span className="cm-hint">
                O restaurante e o cliente acompanham a entrega pelo mapa. Fica ligada enquanto o app
                estiver aberto.
              </span>
            )}
            {error && <span className="form-error">{error}</span>}
            {(geo === 'prompt' || geo === 'denied') && (
              <Button size="lg" icon={<LocateFixed size={18} />} onClick={ask}>
                {geo === 'denied' ? 'Tentar de novo' : 'Permitir localização'}
              </Button>
            )}
          </div>
        </li>
      </ol>
    </section>
  );
}
