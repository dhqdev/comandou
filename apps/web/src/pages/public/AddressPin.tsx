import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed, MapPin, RotateCw } from 'lucide-react';
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

/** Endereço que o mapa procura (a API completa cidade e UF com as da loja). */
export interface PinAddress {
  street: string;
  number: string;
  district: string;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}

/** Quanto o ponto achado diz do endereço (GET /store/locate). */
type Precision = 'house' | 'street' | 'district' | 'city' | 'store';
interface Located {
  lat: number;
  lng: number;
  label: string;
  precision: Precision;
}

/** Só a casa ou a rua valem sozinhas; bairro, cidade ou loja: o cliente marca no mapa. */
const ROUGH: Precision[] = ['district', 'city', 'store'];
const ZOOM: Record<Precision, number> = {
  house: 17,
  street: 17,
  district: 16,
  city: 14,
  store: 14,
};

/**
 * Confirma o endereço no mapa (OpenStreetMap) e calcula a taxa da área de entrega. A API procura
 * o endereço em etapas (a casa, a rua, o bairro, a cidade); o mapa sempre aparece, e quando só
 * achou o bairro (ou nada) o cliente toca no mapa ou arrasta o pino até a casa dele.
 */
export default function AddressPin({
  address,
  saved,
  onChange,
}: {
  /** Endereço digitado ou salvo (null enquanto falta rua, número ou bairro). */
  address: PinAddress | null;
  /** Ponto já salvo no endereço da conta. */
  saved?: { lat: number; lng: number } | null;
  onChange(v: PinnedQuote | null): void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(saved ?? null);
  // Ponto que vale para a taxa: a casa ou a rua achadas, o ponto salvo ou o que o cliente marcou.
  const [confirmed, setConfirmed] = useState(!!saved);
  const [precision, setPrecision] = useState<Precision | 'saved' | 'marked'>(
    saved ? 'saved' : 'house',
  );
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [status, setStatus] = useState<'idle' | 'searching' | 'error'>('idle');
  const [retry, setRetry] = useState(0);
  const cb = useRef(onChange);
  cb.current = onChange;

  const params = address
    ? new URLSearchParams(
        Object.entries({
          street: address.street.trim(),
          number: address.number.trim(),
          district: address.district.trim(),
          city: address.city?.trim() ?? '',
          state: address.state?.trim() ?? '',
          cep: address.cep?.replace(/\D/g, '') ?? '',
        }).filter(([, v]) => v),
      ).toString()
    : '';

  // Procura o endereço (com uma pausa para não buscar a cada letra).
  useEffect(() => {
    if (saved) {
      setPoint(saved);
      setConfirmed(true);
      setPrecision('saved');
      return;
    }
    setQuote(null);
    cb.current(null);
    if (!params) {
      setPoint(null);
      setStatus('idle');
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setStatus('searching');
      try {
        const r = await api<Located | null>(`/store/locate?${params}`);
        if (!alive) return;
        setStatus(r ? 'idle' : 'error');
        setPoint(r ? { lat: r.lat, lng: r.lng } : null);
        setPrecision(r?.precision ?? 'store');
        setConfirmed(!!r && !ROUGH.includes(r.precision));
      } catch {
        if (alive) setStatus('error');
      }
    }, 700);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [params, saved?.lat, saved?.lng, retry]);

  // Calcula a taxa quando o ponto vale (achado ou marcado pelo cliente).
  useEffect(() => {
    if (!point || !confirmed) {
      setQuote(null);
      cb.current(null);
      return;
    }
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
  }, [point?.lat, point?.lng, confirmed]);

  // Mapa pequeno com o pino arrastável; tocar no mapa também move o pino.
  useEffect(() => {
    if (!point) {
      map.current?.remove();
      map.current = null;
      return;
    }
    if (!el.current) return;
    const zoom = precision === 'saved' || precision === 'marked' ? 17 : ZOOM[precision];
    if (!map.current) {
      const m = L.map(el.current, { zoomControl: false, attributionControl: true });
      m.attributionControl.setPrefix(false);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(m);
      const mark = (lat: number, lng: number) => {
        setPrecision('marked');
        setConfirmed(true);
        setPoint({ lat: round(lat), lng: round(lng) });
      };
      marker.current = L.marker([point.lat, point.lng], { icon: pinIcon, draggable: true }).addTo(
        m,
      );
      marker.current.on('dragend', () => {
        const ll = marker.current!.getLatLng();
        mark(ll.lat, ll.lng);
      });
      m.on('click', (e: L.LeafletMouseEvent) => mark(e.latlng.lat, e.latlng.lng));
      m.setView([point.lat, point.lng], zoom);
      map.current = m;
    } else {
      marker.current?.setLatLng([point.lat, point.lng]);
      if (precision === 'marked') map.current.panTo([point.lat, point.lng]);
      else map.current.setView([point.lat, point.lng], zoom);
    }
  }, [point, precision]);
  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setPrecision('marked');
        setConfirmed(true);
        setStatus('idle');
        setPoint({ lat: round(p.coords.latitude), lng: round(p.coords.longitude) });
      },
      () => setStatus('error'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  const rough = !confirmed && !!point;
  return (
    <div className="addr-map">
      {point && (
        <div
          ref={el}
          className="addr-map__map"
          data-rough={rough || undefined}
          aria-label="Mapa do endereço de entrega"
        />
      )}
      {status === 'searching' ? (
        <p className="form-hint">Procurando o endereço no mapa…</p>
      ) : rough ? (
        <p className="form-hint addr-map__ask" role="status">
          <MapPin size={14} />
          {precision === 'district'
            ? 'Achamos o bairro, mas não a rua. Toque no mapa ou arraste o pino até a sua casa.'
            : 'Não achamos esse endereço no mapa. Toque no mapa ou arraste o pino até a sua casa.'}
        </p>
      ) : point ? (
        <p className="form-hint">
          <MapPin size={14} />
          {precision === 'marked'
            ? 'Pronto: a entrega vai para o ponto que você marcou.'
            : precision === 'street'
              ? 'Achamos a rua. Arraste o pino até a sua porta se precisar.'
              : 'Confira o pino: arraste até a sua porta se precisar.'}
        </p>
      ) : status === 'error' ? (
        <p className="form-hint">
          Não foi possível abrir o mapa agora.{' '}
          <button type="button" className="link" onClick={() => setRetry((n) => n + 1)}>
            <RotateCw size={13} /> Tentar de novo
          </button>{' '}
          ou use sua localização.
        </p>
      ) : (
        <p className="form-hint">Preencha rua, número e bairro para calcular a entrega.</p>
      )}
      <button type="button" className="addr-map__locate" onClick={useMyLocation}>
        <LocateFixed size={16} /> Usar minha localização
      </button>
      {quote &&
        confirmed &&
        (quote.covered ? (
          <p className="addr-map__quote" data-ok>
            {quote.zone ? `${quote.zone.name}: ` : ''}
            entrega {Number(quote.fee) ? brl(quote.fee) : 'grátis'}
            {quote.etaMin && quote.etaMax ? ` · ${quote.etaMin}–${quote.etaMax} min` : ''}
            {quote.minOrder ? ` · pedido mínimo ${brl(quote.minOrder)}` : ''}
          </p>
        ) : (
          <p className="addr-map__quote">
            Ainda não entregamos neste ponto. Se o pino não está na sua casa, arraste até ela.
          </p>
        ))}
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
