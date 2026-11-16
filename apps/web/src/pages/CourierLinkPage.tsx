import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import type { CourierEarningsData } from '../features/CourierEarnings';
import { DriverPanel } from '../features/DriverPanel';
import type { DriverData, HistoryPage } from '../features/DriverTabs';
import { DriverShell, usePolling } from '../driver/DriverShell';
import { api, ApiError } from '../lib/api';
import { useArrivalSound } from '../lib/sounds';
import type { AvailableRun, CourierProfile, Delivery } from '../lib/types';

interface CourierHome {
  restaurant: string;
  courier: { name: string };
  deliveries: Delivery[];
  store: { lat: number; lng: number } | null;
}

/**
 * Link do entregador (sem login): o restaurante manda o link pelo WhatsApp e o motoboy vê as
 * próprias corridas, pega os pedidos prontos, abre a rota, liga para o cliente e conclui com o
 * código do cliente; também tem o histórico e o perfil. Mesmas exigências do app com login
 * (atalho na tela inicial e localização). Atualiza a cada 15 s.
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
  usePolling(load);

  // Corrida nova atribuída ao motoboy toca o som de chamada.
  useArrivalSound(
    'courier',
    data?.deliveries.filter((d) => d.status === 'out').map((d) => d.id),
  );

  const earnings = useCallback(() => api<CourierEarningsData>(`${base}/earnings`), [base]);
  const post = (url: string, json: object = {}) => api(`${base}${url}`, { method: 'POST', json });
  const more = useMemo<DriverData>(
    () => ({
      available: () => api<AvailableRun[]>(`${base}/available`),
      claim: (orderId) => api(`${base}/orders/${orderId}/claim`, { method: 'POST', json: {} }),
      history: (before) =>
        api<HistoryPage>(`${base}/history${before ? `?before=${encodeURIComponent(before)}` : ''}`),
      profile: () => api<CourierProfile>(`${base}/profile`),
    }),
    [base],
  );
  return (
    <DriverShell
      name={data?.courier.name ?? null}
      restaurant={data?.restaurant ?? null}
      error={error}
      loading={!data}
    >
      {data && (
        <DriverPanel
          deliveries={data.deliveries}
          store={data.store ? [data.store.lat, data.store.lng] : null}
          onChanged={load}
          actions={{
            complete: (id, code, method) => post(`/deliveries/${id}/complete`, { code, method }),
            fail: (id, reason) => post(`/deliveries/${id}/fail`, { reason }),
            location: (id, fix) => post(`/deliveries/${id}/location`, fix),
          }}
          earnings={earnings}
          data={more}
        />
      )}
    </DriverShell>
  );
}
