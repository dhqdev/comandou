import { useCallback, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from '../app/auth';
import type { CourierEarningsData } from '../features/CourierEarnings';
import { DriverPanel } from '../features/DriverPanel';
import { api } from '../lib/api';
import { useArrivalSound } from '../lib/sounds';
import type { Delivery } from '../lib/types';
import { DriverShell, usePolling } from './DriverShell';

interface Home {
  deliveries: Delivery[];
  store: [number, number] | null;
}

/**
 * App do entregador com login (/entregas): só as corridas dele e "Meus ganhos". Sem menu,
 * pedidos, cardápio ou ajustes da loja (o servidor também bloqueia: o papel só tem
 * delivery:operate). Mesmo painel do link do entregador.
 */
export function DriverApp() {
  const { me, logout } = useAuth();
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [out, today, map] = await Promise.all([
        api<Delivery[]>('/deliveries?scope=active'),
        api<Delivery[]>('/deliveries?scope=today'),
        api<{ store: { lat: number; lng: number } | null }>('/deliveries/live-map'),
      ]);
      setData({
        deliveries: [...out, ...today.filter((d) => d.status !== 'out')],
        store: map.store ? [map.store.lat, map.store.lng] : null,
      });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  usePolling(load);

  useArrivalSound(
    'courier',
    data?.deliveries.filter((d) => d.status === 'out').map((d) => d.id),
  );
  const earnings = useCallback(() => api<CourierEarningsData>('/deliveries/my-earnings'), []);
  const post = (url: string, json: object = {}) => api(url, { method: 'POST', json });

  return (
    <Routes>
      <Route
        path="entregas"
        element={
          <DriverShell
            name={me?.user.name ?? null}
            restaurant={me?.tenant.name ?? null}
            error={error}
            loading={!data}
            onLogout={() => void logout()}
          >
            {data && (
              <DriverPanel
                deliveries={data.deliveries}
                store={data.store}
                onChanged={load}
                actions={{
                  complete: (id, code) => post(`/deliveries/${id}/complete`, { code }),
                  fail: (id, reason) => post(`/deliveries/${id}/fail`, { reason }),
                  location: (id, fix) => post(`/deliveries/${id}/location`, fix),
                }}
                earnings={earnings}
              />
            )}
          </DriverShell>
        }
      />
      <Route path="*" element={<Navigate to="/entregas" replace />} />
    </Routes>
  );
}
