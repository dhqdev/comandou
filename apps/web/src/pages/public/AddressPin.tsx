import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed, MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import type { DeliveryQuote, PinnedQuote } from './store';

const pinIcon = L.divIcon({
  className: 'addr-pin',
  html: '<span></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
});

/**
 * Confirma o endereço no mapa (OpenStreetMap) e calcula a taxa da área de entrega. Busca o
 * endereço digitado; o cliente pode arrastar o pino até a casa dele ou usar a localização.
 */
export default function AddressPin({
  query,
  saved,
  onChange,
}: {
  /** "Rua, número, bairro" (vazio enquanto o endereço não está completo). */
  query: string;
  /** Ponto já salvo no endereço da conta. */
  saved?: { lat: number; lng: number } | null;
  onChange(v: PinnedQuote | null): void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(saved ?? null);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [status, setStatus] = useState<'idle' | 'searching' | 'notfound' | 'error'>('idle');
  const cb = useRef(onChange);
  cb.current = onChange;

  // Busca o endereço digitado (com uma pausa para não buscar a cada letra).
  useEffect(() => {
    if (saved) {
      setPoint(saved);
      return;
    }
    setQuote(null);
    cb.current(null);
    if (query.trim().length < 6) {
      setStatus('idle');
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setStatus('searching');
      try {
        const r = await api<{ lat: number; lng: number }[]>(
          `/store/geocode?q=${encodeURIComponent(query)}`,
        );
        if (!alive) return;
        if (r[0]) {
          setPoint({ lat: r[0].lat, lng: r[0].lng });
          setStatus('idle');
        } else {
          setPoint(null);
          setStatus('notfound');
        }
      } catch {
        if (alive) setStatus('error');
      }
    }, 900);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, saved?.lat, saved?.lng]);

  // Calcula a taxa sempre que o ponto muda.
  useEffect(() => {
    if (!point) return;
    let alive = true;
    api<DeliveryQuote>('/store/delivery-quote', { method: 'POST', json: point })
      .then((q) => {
        if (!alive) return;
        setQuote(q);
        cb.current({ ...point, quote: q });
      })
      .catch(() => alive && setStatus('error'));
    return () => {
      alive = false;
    };
  }, [point?.lat, point?.lng]);

  // Mapa pequeno com o pino arrastável.
  useEffect(() => {
    if (!point) {
      map.current?.remove();
      map.current = null;
      return;
    }
    if (!el.current) return;
    if (!map.current) {
      const m = L.map(el.current, { zoomControl: false, attributionControl: true });
      m.attributionControl.setPrefix(false);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(m);
      marker.current = L.marker([point.lat, point.lng], { icon: pinIcon, draggable: true }).addTo(
        m,
      );
      marker.current.on('dragend', () => {
        const ll = marker.current!.getLatLng();
        setPoint({ lat: round(ll.lat), lng: round(ll.lng) });
      });
      m.on('click', (e: L.LeafletMouseEvent) =>
        setPoint({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) }),
      );
      m.setView([point.lat, point.lng], 17);
      map.current = m;
    } else {
      marker.current?.setLatLng([point.lat, point.lng]);
      map.current.panTo([point.lat, point.lng]);
    }
  }, [point]);
  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      (p) => setPoint({ lat: round(p.coords.latitude), lng: round(p.coords.longitude) }),
      () => setStatus('error'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  return (
    <div className="addr-map">
      {point ? (
        <>
          <div ref={el} className="addr-map__map" aria-label="Mapa do endereço de entrega" />
          <p className="form-hint">
            <MapPin size={14} /> Confira o pino: arraste até a sua porta se precisar.
          </p>
        </>
      ) : (
        <p className="form-hint">
          {status === 'searching'
            ? 'Procurando o endereço no mapa…'
            : status === 'notfound'
              ? 'Não achamos esse endereço no mapa. Confira a rua e o bairro ou use sua localização.'
              : status === 'error'
                ? 'Não foi possível usar o mapa agora. Tente a sua localização.'
                : 'Preencha rua, número e bairro para calcular a entrega.'}
        </p>
      )}
      <button type="button" className="addr-map__locate" onClick={useMyLocation}>
        <LocateFixed size={16} /> Usar minha localização
      </button>
      {quote &&
        (quote.covered ? (
          <p className="addr-map__quote" data-ok>
            {quote.zone ? `${quote.zone.name}: ` : ''}
            entrega {Number(quote.fee) ? brl(quote.fee) : 'grátis'}
            {quote.etaMin && quote.etaMax ? ` · ${quote.etaMin}–${quote.etaMax} min` : ''}
            {quote.minOrder ? ` · pedido mínimo ${brl(quote.minOrder)}` : ''}
          </p>
        ) : (
          <p className="addr-map__quote">Ainda não entregamos neste endereço.</p>
        ))}
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
