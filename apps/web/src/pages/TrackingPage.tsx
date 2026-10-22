import { Bike, CheckCircle2, MapPin, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Card, Spinner } from '../design-system';
import { time } from '../features/format';
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
  location: { lat: string; lng: string; at: string } | null;
}

/** Página pública de rastreio (cliente final). Não exige login e mostra só o essencial. */
export function TrackingPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const t = await api<Track>(`/track/${encodeURIComponent(token)}`);
        if (!stop) {
          setData(t);
          setError(null);
        }
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
      }
    }
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [token]);

  return (
    <main className="track-page">
      <div className="track-page__inner">
        <div className="brand" style={{ padding: 0, color: 'var(--pm-text)' }}>
          <div className="brand__mark" aria-hidden>
            P+
          </div>
          <div className="brand__name">Rastreio do pedido</div>
        </div>
        {error && <Alert tone={data ? 'warning' : 'danger'}>{error}</Alert>}
        {!data && !error && <Spinner />}
        {data && (
          <Card title={`${data.restaurant} · Pedido #${data.orderNumber}`}>
            {data.status === 'out' ? (
              <p style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 0 }}>
                <Bike size={22} /> <strong>Saiu para entrega</strong> às {time(data.dispatchedAt)}{' '}
                com {data.courier}.
              </p>
            ) : data.status === 'delivered' ? (
              <p style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 0 }}>
                <CheckCircle2 size={22} /> <strong>Entregue</strong>
                {data.finishedAt && ` às ${time(data.finishedAt)}`}. Bom apetite!
              </p>
            ) : (
              <p style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 0 }}>
                <XCircle size={22} /> A entrega não foi concluída. O restaurante vai entrar em
                contato.
              </p>
            )}
            {data.location && (
              <a
                className="pm-btn pm-btn--secondary"
                href={`https://www.openstreetmap.org/?mlat=${data.location.lat}&mlon=${data.location.lng}#map=16/${data.location.lat}/${data.location.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin size={16} /> Ver última localização ({time(data.location.at)})
              </a>
            )}
            <p className="pm-hint">Esta página se atualiza sozinha a cada 30 segundos.</p>
          </Card>
        )}
      </div>
    </main>
  );
}
