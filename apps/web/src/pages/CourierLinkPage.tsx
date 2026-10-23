import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Mascot, Spinner, ThemeToggle } from '../design-system';
import { DriverPanel } from '../features/DriverPanel';
import { api, ApiError } from '../lib/api';
import type { Delivery } from '../lib/types';
import '../app/shell.css';
import '../app/ops.css';

interface CourierHome {
  restaurant: string;
  courier: { name: string };
  deliveries: Delivery[];
}

/**
 * Link do entregador (sem login): o restaurante manda o link pelo WhatsApp e o motoboy vê só as
 * próprias corridas, abre a rota, liga para o cliente e marca entregue. Atualiza a cada 15 s.
 */
export function CourierLinkPage() {
  const { token = '' } = useParams();
  const base = `/courier-app/${encodeURIComponent(token)}`;
  const [data, setData] = useState<CourierHome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<CourierHome>(base));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.status === 404 || err.status === 403
          ? err.message
          : 'Sem conexão agora. Tentando de novo…',
      );
      if (err.status === 404 || err.status === 403) setData(null);
    }
  }, [base]);

  useEffect(() => {
    void load();
    const id = setInterval(load, 15_000);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const post = (url: string, json: object = {}) => api(`${base}${url}`, { method: 'POST', json });
  return (
    <main className="courier-page">
      <div className="courier-page__inner">
        <header className="courier-page__head">
          <Mascot size={40} badge title="Comandou" />
          <div>
            <strong>{data ? `Olá, ${data.courier.name.split(' ')[0]}` : 'Entregas'}</strong>
            <span className="cm-hint">{data?.restaurant ?? 'Painel do entregador'}</span>
          </div>
          <ThemeToggle />
        </header>
        {error && <Alert tone={data ? 'warning' : 'danger'}>{error}</Alert>}
        {!data && !error && <Spinner />}
        {data && (
          <DriverPanel
            deliveries={data.deliveries}
            onChanged={load}
            actions={{
              complete: (id) => post(`/deliveries/${id}/complete`),
              fail: (id, reason) => post(`/deliveries/${id}/fail`, { reason }),
              location: (id, lat, lng) => post(`/deliveries/${id}/location`, { lat, lng }),
            }}
          />
        )}
      </div>
    </main>
  );
}
