import { Bike, KeyRound } from 'lucide-react';
import {
  agoLabel,
  distanceM,
  etaMinutes,
  kmLabel,
  signalOf,
  toPoint,
  type LatLng,
} from './live-geo';
import { LiveMap } from './LiveMap';
import './customer-track.css';

/** O que o cliente recebe sobre a corrida (link de rastreio ou acompanhamento do pedido). */
export interface CustomerCourier {
  name: string;
  location: {
    lat: string;
    lng: string;
    at: string;
    heading?: number | null;
    speed?: number | null;
  } | null;
  destination?: { lat: string | number; lng: string | number } | null;
  store?: { lat: number; lng: number } | null;
  trail?: LatLng[];
  /** Código de entrega (4 dígitos) que o cliente passa ao entregador. */
  code?: string | null;
}

/** Código de entrega em destaque, como no iFood: sem ele o entregador não conclui. */
export function DeliveryCode({ code }: { code: string }) {
  return (
    <section className="dcode" aria-label="Código de entrega">
      <KeyRound size={22} aria-hidden />
      <div>
        <strong>Código de entrega</strong>
        <span>Informe ao entregador quando ele chegar.</span>
      </div>
      <span className="dcode__num">{code}</span>
    </section>
  );
}

/** Previsão para o cliente: minutos, distância e se o sinal está em dia. */
export function customerEta(c: CustomerCourier) {
  const pos = c.location ? toPoint(c.location.lat, c.location.lng) : null;
  const dest = c.destination ? toPoint(c.destination.lat, c.destination.lng) : null;
  const signal = signalOf(c.location?.at);
  if (!pos || !dest) return { pos, dest, signal, minutes: null, meters: null };
  return {
    pos,
    dest,
    signal,
    minutes: etaMinutes(pos, dest, c.location?.speed),
    meters: distanceM(pos, dest),
  };
}

/**
 * Mapa ao vivo para o cliente: a moto (com a direção), o caminho que já fez, a loja e o destino.
 * Embaixo, a previsão de chegada e quando foi a última atualização do GPS.
 */
export function CustomerLiveMap({
  courier,
  className = '',
}: {
  courier: CustomerCourier;
  className?: string;
}) {
  const eta = customerEta(courier);
  const first = courier.name.split(' ')[0];
  return (
    <div className={`ctrack ${className}`}>
      <LiveMap
        className="ctrack__map"
        store={courier.store ? [courier.store.lat, courier.store.lng] : null}
        riders={[
          {
            id: 'courier',
            label: first ?? 'Entregador',
            title: courier.name,
            position: eta.pos,
            heading: courier.location?.heading,
            at: courier.location?.at,
            trail: courier.trail ?? [],
            destination: eta.dest,
          },
        ]}
        emptyHint={`${first} já saiu. A posição aparece aqui assim que o GPS dele atualizar.`}
      />
      <div className="ctrack__bar" data-signal={eta.signal}>
        <span className="ctrack__icon">
          <Bike size={20} />
        </span>
        <div className="ctrack__text">
          <strong>
            {eta.minutes === null
              ? `${first} está a caminho`
              : eta.minutes === 0
                ? `${first} está chegando`
                : `Chega em ~${eta.minutes} min`}
          </strong>
          <span>
            {eta.meters !== null && eta.minutes !== 0 && `${kmLabel(eta.meters)} de você · `}
            {courier.location
              ? eta.signal === 'lost'
                ? `sem sinal do GPS ${agoLabel(courier.location.at)}`
                : `atualizado ${agoLabel(courier.location.at)}`
              : 'aguardando o GPS do entregador'}
          </span>
        </div>
        {eta.signal === 'live' && <span className="ctrack__live">ao vivo</span>}
      </div>
    </div>
  );
}
