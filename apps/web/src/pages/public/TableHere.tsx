import { Check, Loader2, LocateFixed, MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useStore } from './context';
import { reducedMotion } from './morph';
import type { TablePresence } from './store';
import './table-here.css';

type Phase = 'idle' | 'locating' | 'ok' | 'far' | 'denied' | 'unavailable' | 'nogeo';

/** "350 m", "2,4 km". */
export function distanceText(m: number) {
  return m < 1000
    ? `${Math.max(10, Math.round(m / 10) * 10)} m`
    : `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

function position(): Promise<GeolocationPosition> {
  return new Promise((ok, fail) =>
    navigator.geolocation.getCurrentPosition(ok, fail, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 60_000,
    }),
  );
}

/**
 * QR Code da mesa: antes de pedir, o cliente confirma que está no restaurante (o celular manda
 * onde está e a API compara com o ponto da loja). Quem já tinha liberado a localização confere
 * sozinho, sem tocar em nada. A confirmação vale a refeição inteira (e vai junto com o pedido).
 */
export function TableHere() {
  const { table, setHere, leaveTable, menu } = useStore();
  const [phase, setPhase] = useState<Phase>(() =>
    typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'idle' : 'nogeo',
  );
  const [far, setFar] = useState<number | null>(null);
  const busy = useRef(false);
  const canLeave = menu.store.acceptsDelivery || menu.store.acceptsPickup;

  async function locate() {
    if (busy.current) return;
    busy.current = true;
    setPhase('locating');
    try {
      let pos: GeolocationPosition;
      try {
        pos = await position();
      } catch (e) {
        setPhase((e as GeolocationPositionError).code === 1 ? 'denied' : 'unavailable');
        return;
      }
      const p: TablePresence = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
      };
      const r = await api<{ ok: boolean; distanceM: number | null }>('/store/table-presence', {
        method: 'POST',
        json: p,
      }).catch(() => null);
      if (!r) return setPhase('unavailable');
      if (!r.ok) {
        setFar(r.distanceM);
        return setPhase('far');
      }
      setPhase('ok');
      navigator.vibrate?.(12);
      window.setTimeout(() => setHere(p), reducedMotion() ? 0 : 600);
    } finally {
      busy.current = false;
    }
  }

  // Localização já liberada neste navegador: confere sem pedir o toque.
  useEffect(() => {
    if (phase !== 'idle') return;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => p.state === 'granted' && void locate())
      .catch(() => undefined);
  }, []);

  if (!table) return null;
  const done = phase === 'ok';
  const text =
    phase === 'ok'
      ? 'Bom apetite.'
      : phase === 'far'
        ? `Você está a ${far !== null ? distanceText(far) : 'uma distância grande'} do restaurante. Peça daqui de dentro ou chame o garçom.`
        : phase === 'denied'
          ? 'A localização está bloqueada. Libere no cadeado da barra de endereço e tente de novo.'
          : phase === 'unavailable'
            ? 'Não achamos sua localização. Ligue o GPS e tente de novo.'
            : phase === 'nogeo'
              ? 'Este navegador não mostra a localização. Chame o garçom para pedir.'
              : `Para pedir pela Mesa ${table.label}, o celular confirma que você está no restaurante.`;
  const problem = phase === 'far' || phase === 'denied' || phase === 'unavailable';

  return (
    <div className="sf-here" role="dialog" aria-modal="true" aria-labelledby="sf-here-title">
      <div className="sf-here__card" data-phase={phase}>
        <span className="sf-here__pin" aria-hidden>
          {done ? <Check size={30} strokeWidth={2.6} /> : <MapPin size={30} />}
        </span>
        <h2 id="sf-here-title">{done ? 'Tudo certo!' : 'Confirme que você está aqui'}</h2>
        <p className={problem ? 'sf-here__problem' : undefined} aria-live="polite">
          {text}
        </p>
        {!done && phase !== 'nogeo' && (
          <button
            type="button"
            className="cta sf-here__go"
            disabled={phase === 'locating'}
            onClick={() => void locate()}
          >
            {phase === 'locating' ? (
              <>
                <Loader2 size={18} className="sf-here__spin" /> Procurando você…
              </>
            ) : (
              <>
                <LocateFixed size={18} /> {problem ? 'Tentar de novo' : 'Confirmar localização'}
              </>
            )}
          </button>
        )}
        {!done && canLeave && (
          <button type="button" className="link sf-here__out" onClick={leaveTable}>
            Não estou no restaurante
          </button>
        )}
      </div>
    </div>
  );
}
