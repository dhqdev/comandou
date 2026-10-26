import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import type { Delivery } from '../lib/types';
import { CustomerLiveMap } from './CustomerTrack';
import type { LatLng } from './live-geo';

/**
 * Mapa ao vivo dentro do detalhe de um pedido que saiu para entrega: mesma visão do cliente,
 * com o nome do entregador, a previsão de chegada e o caminho feito.
 */
export function OrderLiveMap({ orderId }: { orderId: string }) {
  const [d, setD] = useState<Delivery | null>(null);
  const [map, setMap] = useState<{ store: LatLng | null; trail: LatLng[] }>({
    store: null,
    trail: [],
  });

  const load = useCallback(async () => {
    try {
      const list = await api<Delivery[]>('/deliveries?scope=active');
      const cur = list.find((x) => x.orderId === orderId) ?? null;
      setD(cur);
      if (!cur) return;
      const r = await api<{
        store: { lat: number; lng: number } | null;
        trails: Record<string, LatLng[]>;
      }>(`/deliveries/live-map?ids=${cur.id}`);
      setMap({ store: r.store ? [r.store.lat, r.store.lng] : null, trail: r.trails[cur.id] ?? [] });
    } catch {
      /* sem permissão ou sem conexão: o detalhe do pedido segue sem o mapa */
    }
  }, [orderId]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'delivery.location' && e.deliveryId === d?.id) {
      setD((x) =>
        x
          ? {
              ...x,
              lastLat: String(e.lat),
              lastLng: String(e.lng),
              lastHeading: e.heading ?? x.lastHeading,
              lastSpeed: e.speed,
              lastLocationAt: e.at,
            }
          : x,
      );
      setMap((m) => ({ ...m, trail: [...m.trail, [e.lat, e.lng]] }));
    } else if (e.type === 'delivery.changed') void load();
  }, load);

  if (!d) return null;
  return (
    <CustomerLiveMap
      courier={{
        name: d.courierName,
        location:
          d.lastLat && d.lastLng && d.lastLocationAt
            ? {
                lat: d.lastLat,
                lng: d.lastLng,
                at: d.lastLocationAt,
                heading: d.lastHeading,
                speed: d.lastSpeed,
              }
            : null,
        destination:
          d.deliveryLat && d.deliveryLng ? { lat: d.deliveryLat, lng: d.deliveryLng } : null,
        store: map.store ? { lat: map.store[0], lng: map.store[1] } : null,
        trail: map.trail,
      }}
    />
  );
}
