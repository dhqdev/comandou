import { Bike, CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Logo, Spinner, ThemeToggle } from '../design-system';
import { CustomerLiveMap, customerEta, type CustomerCourier } from '../features/CustomerTrack';
import { time } from '../features/format';
import type { LatLng } from '../features/live-geo';
import { api, ApiError } from '../lib/api';
import '../app/shell.css';
import '../app/ops.css';

interface Track {
  restaurant: string;
  orderNumber: number;
  status: 'out' | 'delivered' | 'failed';
  courier: string;
  dispatchedAt: string;
  finishedAt: string | null;
  location: CustomerCourier['location'];
  destination: { lat: string; lng: string } | null;
  store: { lat: number; lng: number } | null;
  trail: LatLng[];
}

/**
 * Página pública de rastreio (cliente final). Não exige login e mostra só o essencial: o mapa com
 * o entregador ao vivo, a previsão de chegada e a situação. Atualiza a cada 8 s enquanto está na
 * rua (e na hora em que o cliente volta para a aba).
 */
export function TrackingPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    async function load() {
      window.clearTimeout(timer);
      let next = 8_000;
      try {
        const t = await api<Track>(`/track/${encodeURIComponent(token)}`);
        if (stop) return;
        setData(t);
        setError(null);
        if (t.status !== 'out') next = 60_000;
      } catch (e) {
        if (stop) return;
        const err = e as ApiError;
        setError(
          err.status === 410
            ? 'Este link de rastreio expirou.'
            : err.status === 404
              ? 'Link de rastreio inválido.'
              : 'Não foi possível atualizar agora. Tentaremos de novo.',
        );
        if (err.status === 410 || err.status === 404) return;
        next = 15_000;
      }
      if (!stop) timer = window.setTimeout(load, next);
    }
    void load();
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    const clock = window.setInterval(() => tick((n) => n + 1), 5_000);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [token]);

  useEffect(() => {
    if (data) document.title = `Pedido #${data.orderNumber} · ${data.restaurant}`;
  }, [data]);

  const courier: CustomerCourier | null =
    data?.status === 'out'
      ? {
          name: data.courier,
          location: data.location,
          destination: data.destination,
          store: data.store,
          trail: data.trail,
        }
      : null;
  const eta = courier ? customerEta(courier) : null;
  const stage = !data
    ? 0
    : data.status !== 'out'
      ? 3
      : eta?.minutes === 0 || (eta?.meters ?? Infinity) < 400
        ? 2
        : 1;

  return (
    <main className="trk">
      <header className="trk__bar">
        <Logo size={26} />
        <strong>{data?.restaurant ?? 'Rastreio do pedido'}</strong>
        <ThemeToggle />
      </header>
      <div className="trk__body">
        {error && <Alert tone={data ? 'warning' : 'danger'}>{error}</Alert>}
        {!data && !error && <Spinner />}
        {courier && <CustomerLiveMap courier={courier} />}
        {data && (
          <section className="trk__card" aria-live="polite">
            <span className="cm-hint">Pedido #{data.orderNumber}</span>
            {data.status === 'out' ? (
              <>
                <div className="trk__hero">
                  <Bike size={30} />
                  <div>
                    <h1>
                      {stage === 2 ? `${data.courier} está chegando` : 'Seu pedido está a caminho'}
                    </h1>
                    <p>
                      Saiu às {time(data.dispatchedAt)} com {data.courier}.
                    </p>
                  </div>
                </div>
                <ol className="trk__steps">
                  <li data-on>Saiu da loja</li>
                  <li data-on={stage >= 1 || undefined}>A caminho</li>
                  <li data-on={stage >= 2 || undefined}>Chegando</li>
                </ol>
              </>
            ) : data.status === 'delivered' ? (
              <div className="trk__hero" style={{ ['--tone' as string]: 'var(--cm-success)' }}>
                <CheckCircle2 size={30} />
                <div>
                  <h1>Pedido entregue</h1>
                  <p>{data.finishedAt && `Às ${time(data.finishedAt)}. `}Bom apetite!</p>
                </div>
              </div>
            ) : (
              <div className="trk__hero" style={{ ['--tone' as string]: 'var(--cm-danger)' }}>
                <XCircle size={30} />
                <div>
                  <h1>A entrega não foi concluída</h1>
                  <p>O restaurante vai entrar em contato.</p>
                </div>
              </div>
            )}
          </section>
        )}
        <p className="cm-hint" style={{ textAlign: 'center', margin: 0 }}>
          Esta página se atualiza sozinha.
        </p>
      </div>
    </main>
  );
}
