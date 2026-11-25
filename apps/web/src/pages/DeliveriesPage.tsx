import {
  Bike,
  CheckCircle2,
  Copy,
  Link2,
  MessageCircle,
  MapPin,
  Navigation,
  PackageCheck,
  Route,
  Timer,
  Truck,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { channelInfo, PIN_LENGTH } from '@comandou/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  TextField,
  useToast,
  Select,
  Skeleton,
} from '../design-system';
import { useCan } from '../app/auth';
import { minutesSince, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, time } from '../features/format';
import { CourierSettlement } from '../features/CourierPayouts';
import { DeliveryAreas } from '../features/DeliveryAreas';
import { routeUrl } from '../features/DriverPanel';
import { LiveMap, RIDER_COLORS, type MapRider } from '../features/LiveMap';
import {
  agoLabel,
  distanceM,
  etaMinutes,
  kmLabel,
  signalOf,
  toPoint,
  type LatLng,
} from '../features/live-geo';
import {
  COURIER_COLORS,
  COURIER_STATE,
  courierState,
  type CourierState,
  lastSeen,
  phoneLabel,
  whatsappNumber,
} from '../features/courier-status';
import { SelectField } from '../features/forms';
import { SlideTabs } from '../features/SlideTabs';
import { useLinkParam } from '../lib/deep-link';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { type RealtimeEvent, useDebounced, useRealtime } from '../lib/realtime';
import { useArrivalSound } from '../lib/sounds';
import type { Courier, Delivery, Order } from '../lib/types';
import './deliveries.css';
import { TourButton } from '../features/tour/PageTour';
import { AppDriverTag, appDriverTakes } from '../features/channels/AppDriver';
import { ChannelBadge } from '../features/channels/ChannelBadge';

const trackingUrl = (path: string) => `${window.location.origin}${path}`;

/**
 * Entregas: despacho com entregador, acompanhamento de quem está na rua e conclusão.
 * O entregador não passa por aqui: tem o app próprio (driver/DriverApp), só com as corridas dele.
 * Pelo painel, a entrega conclui sem o código do cliente (cliente sem o código, por exemplo).
 */
type Aba = 'despacho' | 'entregadores' | 'area' | 'hoje' | 'acerto';

export function DeliveriesPage() {
  const canManage = useCan('delivery:manage');
  const canSetup = useCan('settings:manage');
  const canPay = useCan('finance:read');
  const canSettle = useCan('payments:create');
  const [ready, setReady] = useState<Order[]>([]);
  const [out, setOut] = useState<Delivery[] | null>(null);
  const [today, setToday] = useState<Delivery[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ title: string; path: string } | null>(null);
  const [aba, setAba] = useState<Aba>('despacho');
  const [focus, setFocus] = useState<string | null>(null);
  const [route, setRoute] = useState<Delivery | null>(null);
  /** Celular: a aba Ao vivo mostra a lista ou o mapa (um de cada vez, sem rolar entre os dois). */
  const [view, setView] = useState<'lista' | 'mapa'>('lista');
  const phone = useMedia('(max-width: 860px)');
  // Links antigos da aba Repasses (que entrou no Acerto) caem no Acerto.
  useLinkParam('aba', (a) => setAba((a === 'repasses' ? 'acerto' : a) as Aba));

  const load = useCallback(async () => {
    try {
      const [o, t, r, c] = await Promise.all([
        api<Delivery[]>('/deliveries?scope=active'),
        api<Delivery[]>('/deliveries?scope=today'),
        canManage ? api<Order[]>('/orders?status=ready&channel=delivery') : Promise.resolve([]),
        canManage ? api<Courier[]>('/couriers') : Promise.resolve([]),
      ]);
      setOut(o);
      setToday(t.filter((d) => d.status !== 'out'));
      setReady(r);
      setCouriers(c);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [canManage]);
  useEffect(() => {
    void load();
  }, [load]);
  const reload = useDebounced(load);
  const tracks = useLiveTrails(out, setOut);
  useRealtime((e) => {
    if (e.type === 'delivery.location') tracks.onLocation(e);
    else if (e.type === 'delivery.changed' || e.type === 'order.changed') reload();
  }, load);
  useTick(5_000);

  // Sons: pedido pronto esperando entregador e entrega finalizada.
  useArrivalSound('delivery', canManage ? ready.map((o) => o.id) : null);
  useArrivalSound(
    'delivered',
    canManage ? today.filter((d) => d.status === 'delivered').map((d) => d.id) : null,
  );

  const activeCouriers = couriers.filter((c) => c.active);
  const colorOf = courierColors(couriers);
  const delivered = today.filter((d) => d.status === 'delivered');
  const avgMin = delivered.length
    ? Math.round(
        delivered.reduce(
          (a, d) =>
            a +
            (new Date(d.finishedAt ?? d.dispatchedAt).getTime() -
              new Date(d.dispatchedAt).getTime()),
          0,
        ) /
          delivered.length /
          60_000,
      )
    : null;
  const riders: MapRider[] = (out ?? []).map((d) => ({
    id: d.id,
    label: `#${d.orderNumber}`,
    title: `${d.courierName} · pedido #${d.orderNumber}`,
    position: toPoint(d.lastLat, d.lastLng),
    heading: d.lastHeading,
    at: d.lastLocationAt,
    trail: tracks.trails[d.id] ?? [],
    destination: toPoint(d.deliveryLat, d.deliveryLng),
    color: colorOf(d.courierId),
  }));

  const live = aba === 'despacho';
  const showMap = !phone || view === 'mapa';
  const showLists = !phone || view === 'lista';
  return (
    <div className="dl-page" data-fit={(live && showMap) || undefined}>
      <header className="dl-head">
        <h1 className="page-title cm-sr-only">Entregas</h1>
        <div className="dl-kpis dl-kpis--bar">
          <Kpi
            icon={<PackageCheck size={16} />}
            label="Prontos para sair"
            short="Prontos"
            value={ready.length}
            tone="warning"
          />
          <Kpi
            icon={<Bike size={16} />}
            label="Na rua agora"
            short="Na rua"
            value={out?.length ?? 0}
            tone="brand"
          />
          <Kpi
            icon={<CheckCircle2 size={16} />}
            label="Entregues hoje"
            short="Entregues"
            value={delivered.length}
            tone="success"
          />
          <Kpi
            icon={<Timer size={16} />}
            label="Tempo médio na rua"
            short="Tempo médio"
            value={avgMin === null ? '—' : `${avgMin} min`}
            tone="info"
          />
        </div>
        <div className="dl-head__tour">
          <TourButton tour="entregas" />
        </div>
      </header>
      {error && <Alert tone="danger">{error}</Alert>}
      <SlideTabs<Aba>
        label="Seções de entregas"
        value={aba}
        onChange={setAba}
        tabs={[
          { value: 'despacho', label: 'Ao vivo', count: ready.length + (out?.length ?? 0) },
          { value: 'entregadores', label: 'Entregadores', count: activeCouriers.length },
          { value: 'area', label: 'Área de entrega' },
          { value: 'hoje', label: 'Hoje', count: today.length },
          ...(canSettle || canPay ? [{ value: 'acerto' as const, label: 'Acerto' }] : []),
        ]}
      />
      {live && phone && (
        <SlideTabs<'lista' | 'mapa'>
          label="Lista ou mapa"
          size="sm"
          className="dl-switch"
          value={view}
          onChange={setView}
          tabs={[
            { value: 'lista', label: 'Lista', count: ready.length + (out?.length ?? 0) },
            { value: 'mapa', label: 'Mapa' },
          ]}
        />
      )}
      {live && (
        <div
          className="dl-live"
          data-view={phone ? view : undefined}
          data-out-empty={!out?.length || undefined}
        >
          {showMap && (
            <section className="dl-live__map">
              <LiveMap
                riders={riders}
                store={tracks.store}
                focusId={focus}
                onSelect={(id) => {
                  setFocus((f) => (f === id ? null : id));
                  document
                    .querySelector(`[data-delivery="${id}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
                emptyHint={
                  out?.length
                    ? 'Esperando o GPS do entregador. A posição aparece assim que ele ligar a localização no painel dele.'
                    : 'Nenhum entregador na rua agora.'
                }
              />
              {(out?.length ?? 0) > 0 && (
                <div className="dl-legend" aria-label="Entregadores na rua">
                  {[...new Set((out ?? []).map((d) => d.courierId))].map((cid) => {
                    const d = out!.find((x) => x.courierId === cid)!;
                    return (
                      <span key={cid} style={{ ['--rider' as string]: colorOf(cid) }}>
                        {d.courierName.split(' ')[0]}
                      </span>
                    );
                  })}
                </div>
              )}
            </section>
          )}
          {showLists && (
            <>
              <section className="dl-panel dl-panel--ready">
                <header className="dl-panel__head">
                  <h2>
                    <PackageCheck size={17} /> Prontos para sair
                  </h2>
                  <Badge tone={ready.length ? 'warning' : 'neutral'}>{ready.length}</Badge>
                </header>
                {ready.length === 0 ? (
                  <p className="dl-panel__empty">
                    Quando a cozinha marcar um delivery como pronto, ele aparece aqui.
                  </p>
                ) : activeCouriers.length === 0 ? (
                  <EmptyState
                    icon={<Bike size={20} />}
                    title="Cadastre um entregador"
                    description="Na aba Entregadores, cadastre quem faz as entregas para despachar."
                  />
                ) : (
                  <ul className="dl-ready dl-scroll">
                    {ready.map((o) => (
                      <DispatchRow
                        key={o.id}
                        order={o}
                        couriers={activeCouriers}
                        onDone={(path) => {
                          setLink({ title: `Pedido #${o.number} saiu para entrega`, path });
                          void load();
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>
              <section className="dl-panel dl-panel--out">
                <header className="dl-panel__head">
                  <h2>
                    <Bike size={17} /> Na rua
                  </h2>
                  <Badge tone={out?.length ? 'brand' : 'neutral'}>{out?.length ?? 0}</Badge>
                </header>
                {out === null ? (
                  <Skeleton />
                ) : out.length === 0 ? (
                  <p className="dl-panel__empty">Nenhuma entrega em andamento.</p>
                ) : (
                  <div className="dl-runs dl-scroll">
                    {out.map((d) => (
                      <DeliveryCard
                        key={d.id}
                        d={d}
                        color={colorOf(d.courierId)}
                        selected={focus === d.id}
                        onSelect={() => {
                          // No celular, tocar na corrida mostra onde ela está no mapa.
                          if (phone) {
                            setFocus(d.id);
                            setView('mapa');
                          } else setFocus((f) => (f === d.id ? null : d.id));
                        }}
                        onLink={(path) =>
                          setLink({ title: `Novo link do pedido #${d.orderNumber}`, path })
                        }
                        onChanged={load}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
      {aba === 'hoje' && (
        <Card title="Encerradas hoje" bodyless>
          {today.length === 0 ? (
            <EmptyState icon={<Truck size={20} />} title="Nenhuma entrega encerrada hoje" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="cm-table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Entregador</th>
                    <th>Saída</th>
                    <th>Tempo</th>
                    <th>Resultado</th>
                    <th aria-label="Trajeto" />
                  </tr>
                </thead>
                <tbody>
                  {today.map((d) => (
                    <tr key={d.id}>
                      <td>
                        #{d.orderNumber} {d.customerName && `· ${d.customerName}`}
                      </td>
                      <td>{d.courierName}</td>
                      <td>{time(d.dispatchedAt)}</td>
                      <td>
                        {d.finishedAt
                          ? `${Math.max(1, Math.round((new Date(d.finishedAt).getTime() - new Date(d.dispatchedAt).getTime()) / 60_000))} min`
                          : '—'}
                      </td>
                      <td>
                        {d.status === 'delivered' ? (
                          <Badge tone="success">
                            Entregue {d.finishedAt && time(d.finishedAt)}
                          </Badge>
                        ) : (
                          <Badge tone="danger">Não entregue: {d.failureReason}</Badge>
                        )}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Route size={14} />}
                          onClick={() => setRoute(d)}
                        >
                          Trajeto
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {aba === 'entregadores' && (
        <CouriersCard
          couriers={couriers}
          out={out ?? []}
          today={today}
          colorOf={colorOf}
          onChanged={load}
        />
      )}
      {aba === 'area' && <DeliveryAreas canEdit={canSetup} />}
      {aba === 'acerto' && (canSettle || canPay) && (
        <CourierSettlement colorOf={colorOf} canPay={canPay} canSettle={canSettle} />
      )}
      <Modal open={!!link} title={link?.title ?? ''} onClose={() => setLink(null)}>
        {link && <TrackingLink path={link.path} />}
      </Modal>
      <Modal
        open={!!route}
        size="lg"
        title={route ? `Trajeto do pedido #${route.orderNumber}` : ''}
        onClose={() => setRoute(null)}
      >
        {route && <RouteReplay d={route} color={colorOf(route.courierId)} />}
      </Modal>
    </div>
  );
}

function Kpi({
  icon,
  label,
  short,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  /** Nome curto para o celular, onde os quatro ficam lado a lado. */
  short: string;
  value: ReactNode;
  tone: 'brand' | 'success' | 'warning' | 'info';
}) {
  return (
    <div className="dl-kpi" data-tone={tone} title={label}>
      <span className="dl-kpi__icon">{icon}</span>
      <span className="dl-kpi__label">
        <span className="dl-kpi__long">{label}</span>
        <span className="dl-kpi__short">{short}</span>
      </span>
      <strong className="dl-kpi__value">{value}</strong>
    </div>
  );
}

/** Acompanha uma media query (ex.: celular), para trocar o que é montado na tela. */
function useMedia(query: string) {
  const [on, setOn] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const sync = () => setOn(m.matches);
    sync();
    m.addEventListener('change', sync);
    return () => m.removeEventListener('change', sync);
  }, [query]);
  return on;
}

/** Cor fixa por entregador (pela ordem do cadastro), a mesma no mapa, na lista e na legenda. */
/** Cor de cada entregador: a escolhida no cartão dele, senão uma automática (fixa pelo id). */
function courierColors(couriers: Courier[]) {
  const ids = [...couriers].sort((a, b) => a.id.localeCompare(b.id)).map((c) => c.id);
  const chosen = new Map(couriers.filter((c) => c.color).map((c) => [c.id, c.color!]));
  return (id: string) => {
    const own = chosen.get(id);
    if (own) return own;
    const i = ids.indexOf(id);
    return RIDER_COLORS[(i < 0 ? 0 : i) % RIDER_COLORS.length]!;
  };
}

/** Rerender periódico para atualizar "há X s" e o sinal do GPS. */
function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

/**
 * Trajeto das corridas na rua. Busca o caminho quando a lista muda e, a cada posição nova que
 * chega pelo tempo real, move a moto e estica o caminho sem recarregar a tela.
 */
function useLiveTrails(
  out: Delivery[] | null,
  setOut: (fn: (o: Delivery[] | null) => Delivery[] | null) => void,
) {
  const [trails, setTrails] = useState<Record<string, LatLng[]>>({});
  const [store, setStore] = useState<LatLng | null>(null);
  const ids = (out ?? []).map((d) => d.id).join(',');
  useEffect(() => {
    let stop = false;
    void api<{ store: { lat: number; lng: number } | null; trails: Record<string, LatLng[]> }>(
      `/deliveries/live-map?ids=${ids}`,
    )
      .then((r) => {
        if (stop) return;
        setStore(r.store ? [r.store.lat, r.store.lng] : null);
        setTrails(r.trails);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [ids]);
  function onLocation(e: Extract<RealtimeEvent, { type: 'delivery.location' }>) {
    setOut((list) =>
      list
        ? list.map((d) =>
            d.id === e.deliveryId
              ? {
                  ...d,
                  lastLat: String(e.lat),
                  lastLng: String(e.lng),
                  lastHeading: e.heading ?? d.lastHeading,
                  lastSpeed: e.speed,
                  lastLocationAt: e.at,
                }
              : d,
          )
        : list,
    );
    setTrails((t) => ({ ...t, [e.deliveryId]: [...(t[e.deliveryId] ?? []), [e.lat, e.lng]] }));
  }
  return { trails, store, onLocation };
}

/** Caminho que o entregador fez numa corrida já encerrada. */
function RouteReplay({ d, color }: { d: Delivery; color: string }) {
  const [data, setData] = useState<{ store: LatLng | null; trail: LatLng[] } | null>(null);
  useEffect(() => {
    void api<{ store: { lat: number; lng: number } | null; trails: Record<string, LatLng[]> }>(
      `/deliveries/live-map?ids=${d.id}`,
    )
      .then((r) =>
        setData({
          store: r.store ? [r.store.lat, r.store.lng] : null,
          trail: r.trails[d.id] ?? [],
        }),
      )
      .catch(() => setData({ store: null, trail: [] }));
  }, [d.id]);
  if (!data) return <Skeleton variant="detail" />;
  const last = data.trail.at(-1) ?? toPoint(d.lastLat, d.lastLng);
  return (
    <div className="dl-replay">
      <LiveMap
        className="dl-replay__map"
        store={data.store}
        riders={[
          {
            id: d.id,
            label: `#${d.orderNumber}`,
            title: d.courierName,
            position: last,
            trail: data.trail.slice(0, -1),
            destination: toPoint(d.deliveryLat, d.deliveryLng),
            color,
          },
        ]}
        emptyHint="Esta corrida não tem posições registradas (o entregador não ligou a localização)."
      />
      <p className="cm-hint">
        {d.courierName} saiu às {time(d.dispatchedAt)}
        {d.finishedAt && ` e encerrou às ${time(d.finishedAt)}`} · {data.trail.length} pontos de GPS
        registrados.
      </p>
    </div>
  );
}

function TrackingLink({ path }: { path: string }) {
  const toast = useToast();
  const url = trackingUrl(path);
  return (
    <>
      <p style={{ marginTop: 0 }}>
        Envie este link ao cliente para acompanhar a entrega. Ele aparece só agora: se perder, gere
        um novo na entrega.
      </p>
      <TextField label="Link de rastreio" readOnly value={url} onFocus={(e) => e.target.select()} />
      <div className="actions-row">
        <Button
          icon={<Copy size={16} />}
          onClick={() =>
            navigator.clipboard
              ?.writeText(url)
              .then(() => toast('Link copiado', 'success'))
              .catch(() => toast('Não foi possível copiar; selecione o texto', 'danger'))
          }
        >
          Copiar
        </Button>
        <a
          className="cm-btn cm-btn--secondary"
          href={`https://wa.me/?text=${encodeURIComponent(`Acompanhe seu pedido: ${url}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Enviar no WhatsApp
        </a>
      </div>
    </>
  );
}

function DispatchRow({
  order,
  couriers,
  onDone,
}: {
  order: Order;
  couriers: Courier[];
  onDone(path: string): void;
}) {
  const toast = useToast();
  const [courierId, setCourierId] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await api<{ trackingPath: string }>(`/orders/${order.id}/dispatch`, {
        method: 'POST',
        json: { courierId },
      });
      onDone(r.trackingPath);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="dl-ready__row">
      <div className="dl-ready__info">
        <span className="dl-ready__top">
          <strong>#{order.number}</strong>
          {order.appChannel && (
            <ChannelBadge channel={order.appChannel} code={order.externalCode} size="sm" />
          )}
          <span className="dl-ready__name">{order.customerName}</span>
          <span className="dl-ready__wait">há {minutesSince(order.createdAt)} min</span>
          <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
            {PAYMENT_STATUS_LABEL[order.paymentStatus]} · {brl(order.total)}
          </Badge>
        </span>
        <span className="dl-ready__addr">
          <MapPin size={13} /> {order.deliveryAddress ?? 'Endereço não informado'}
        </span>
      </div>
      {order.appChannel && appDriverTakes(order) ? (
        <div className="dl-ready__go dl-ready__app">
          <AppDriverTag channel={order.appChannel} status={order.appDriverStatus} />
          <span>Quem leva é o entregador do {channelInfo(order.appChannel).label}</span>
        </div>
      ) : (
        <div className="dl-ready__go">
          <Select
            className="cm-input"
            aria-label={`Entregador do pedido ${order.number}`}
            value={courierId}
            onChange={(e) => setCourierId(e.target.value)}
          >
            <option value="">Escolha o entregador…</option>
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {!c.userId && !c.linkCreatedAt ? ' (sem app)' : ''}
              </option>
            ))}
          </Select>
          <Button loading={busy} disabled={!courierId} icon={<Bike size={16} />} onClick={go}>
            Saiu para entrega
          </Button>
        </div>
      )}
    </li>
  );
}

function DeliveryCard({
  d,
  color,
  selected,
  onSelect,
  onLink,
  onChanged,
}: {
  d: Delivery;
  color: string;
  selected: boolean;
  onSelect(): void;
  onLink(path: string): void;
  onChanged(): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  const pos = toPoint(d.lastLat, d.lastLng);
  const dest = toPoint(d.deliveryLat, d.deliveryLng);
  const signal = signalOf(d.lastLocationAt);
  const dist = pos && dest ? distanceM(pos, dest) : null;
  const eta = pos && dest ? etaMinutes(pos, dest, d.lastSpeed) : null;

  async function call(url: string, json?: object, ok?: string) {
    setBusy(true);
    try {
      const r = await api<{ trackingPath?: string }>(url, { method: 'POST', json: json ?? {} });
      if (ok) toast(ok, 'success');
      if (r?.trackingPath) onLink(r.trackingPath);
      onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="dl-run"
      data-delivery={d.id}
      data-selected={selected || undefined}
      style={{ ['--rider' as string]: color }}
    >
      <button type="button" className="dl-run__main" onClick={onSelect} aria-pressed={selected}>
        <span className="dl-run__top">
          <strong className="dl-run__num">#{d.orderNumber}</strong>
          <span className="dl-run__courier">
            <span className="dl-run__dot" /> {d.courierName}
          </span>
          <span className="dl-run__time">{minutesSince(d.dispatchedAt)} min na rua</span>
        </span>
        <span className="dl-run__who" title={d.deliveryAddress ?? undefined}>
          <span className="dl-run__name">
            {d.customerName ?? 'Cliente'}
            {d.customerPhone && <span className="cm-hint"> · {d.customerPhone}</span>}
          </span>
          <span className="dl-run__addr">
            <MapPin size={13} /> {d.deliveryAddress ?? 'Endereço não informado'}
          </span>
        </span>
        <span className="dl-run__live" data-signal={signal}>
          <span className="dl-run__signal" />
          {signal === 'none'
            ? 'Aguardando o GPS do entregador'
            : signal === 'lost'
              ? `Sem sinal ${agoLabel(d.lastLocationAt)}`
              : `${signal === 'live' ? 'Ao vivo' : 'Atualizado'} ${agoLabel(d.lastLocationAt)}`}
          {eta !== null && dist !== null && (
            <strong className="dl-run__eta">
              {eta === 0 ? 'Chegando' : `~${eta} min`} · {kmLabel(dist)}
            </strong>
          )}
        </span>
      </button>
      {failing ? (
        <div className="inline-form">
          <TextField
            label="Por que não foi entregue?"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="dl-run__actions">
            <Button size="sm" variant="secondary" onClick={() => setFailing(false)}>
              Voltar
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={async () => {
                if (
                  await call(`/deliveries/${d.id}/fail`, { reason }, 'Pedido voltou para "pronto"')
                )
                  setFailing(false);
              }}
            >
              Confirmar
            </Button>
          </div>
        </div>
      ) : (
        <div className="dl-run__foot">
          <span className="dl-run__chips">
            <Badge tone={PAYMENT_STATUS_TONE[d.paymentStatus]}>
              {d.paymentStatus === 'paid' ? 'Pago' : `Cobrar ${brl(d.balance)}`}
            </Badge>
            <a
              className="link-btn"
              href={routeUrl(d)}
              target="_blank"
              rel="noreferrer"
              title="Abrir a rota até o cliente"
            >
              <Navigation size={13} style={{ verticalAlign: -2 }} /> rota
            </a>
            <button
              type="button"
              className="link-btn"
              title="Gerar um novo link de acompanhamento para o cliente"
              onClick={() => call(`/deliveries/${d.id}/tracking-link`)}
            >
              <Link2 size={13} style={{ verticalAlign: -2 }} /> link
            </button>
          </span>
          <span className="dl-run__actions">
            <Button
              size="sm"
              variant="secondary"
              icon={<XCircle size={14} />}
              onClick={() => setFailing(true)}
            >
              Não entregue
            </Button>
            <Button
              size="sm"
              variant="success"
              icon={<CheckCircle2 size={14} />}
              loading={busy}
              onClick={() => call(`/deliveries/${d.id}/complete`, {}, 'Entrega concluída')}
            >
              Entregue
            </Button>
          </span>
        </div>
      )}
    </article>
  );
}

function CouriersCard({
  couriers,
  out,
  today,
  colorOf,
  onChanged,
}: {
  couriers: Courier[];
  out: Delivery[];
  today: Delivery[];
  colorOf(id: string): string;
  onChanged(): void;
}) {
  const toast = useToast();
  const canUsers = useCan('users:manage');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [userId, setUserId] = useState('');
  const [shared, setShared] = useState<{ courier: Courier; url: string } | null>(null);
  const [pinFor, setPinFor] = useState<Courier | null>(null);
  const [drivers, setDrivers] = useState<
    { id: string; name: string; role: string; status: string }[]
  >([]);
  useEffect(() => {
    if (canUsers)
      void api<typeof drivers>('/users')
        .then((u) => setDrivers(u.filter((x) => x.role === 'driver' && x.status === 'active')))
        .catch(() => undefined);
  }, [canUsers]);
  // "Disponível" e "visto há X" vêm de quando o app foi aberto: confere de novo a cada 30 s.
  useEffect(() => {
    const id = window.setInterval(onChanged, 30_000);
    return () => window.clearInterval(id);
  }, [onChanged]);
  // Quem entra com login já ganha o cadastro aqui sozinho: o seletor só oferece quem falta.
  const linked = new Set(couriers.map((c) => c.userId).filter(Boolean));
  const freeDrivers = drivers.filter((u) => !linked.has(u.id));

  async function call(url: string, method: 'POST' | 'PATCH' | 'DELETE', json: object, ok: string) {
    try {
      const r = await api<{ path?: string }>(url, { method, json });
      if (ok) toast(ok, 'success');
      onChanged();
      return r ?? true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    }
  }

  /** Link atual do entregador; sem link (ou link antigo, de antes da cópia) gera um. */
  async function linkOf(c: Courier): Promise<string | null> {
    try {
      if (c.linkCreatedAt && c.linkCopyable) {
        const r = await api<{ path: string | null }>(`/couriers/${c.id}/link`);
        if (r.path) return `${window.location.origin}${r.path}`;
      }
      if (
        c.linkCreatedAt &&
        !window.confirm(
          `O link de ${c.name} é de antes desta versão e não dá para copiar de novo. Criar um link novo? O antigo para de abrir.`,
        )
      )
        return null;
      const r = await api<{ path: string }>(`/couriers/${c.id}/link`, { method: 'POST', json: {} });
      onChanged();
      return `${window.location.origin}${r.path}`;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return null;
    }
  }

  async function copyLink(c: Courier) {
    const url = await linkOf(c);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast(`Link de ${c.name.split(' ')[0]} copiado`, 'success');
    } catch {
      setShared({ courier: c, url }); // sem permissão de copiar: mostra para selecionar
    }
  }

  async function sendWhatsApp(c: Courier) {
    // Abre a aba já no clique (senão o navegador bloqueia) e põe o endereço quando o link chega.
    const tab = window.open('', '_blank');
    const url = await linkOf(c);
    if (!url) {
      tab?.close();
      return;
    }
    const href = whatsappHref(c, url);
    if (tab) tab.location.href = href;
    else window.location.href = href;
  }

  async function toggle(c: Courier) {
    if (c.userId) {
      // Entra com login: ativo ou não é o acesso dele na Equipe (a API segue a Equipe).
      if (
        c.active &&
        !window.confirm(`Desativar ${c.name}? O acesso dele na Equipe também é desativado.`)
      )
        return;
      await call(
        `/users/${c.userId}`,
        'PATCH',
        { status: c.active ? 'revoked' : 'active' },
        c.active ? 'Entregador desativado' : 'Entregador ativado',
      );
      return;
    }
    if (c.active && !window.confirm(`Desativar ${c.name}? Ele para de receber pedidos.`)) return;
    await call(
      `/couriers/${c.id}`,
      'PATCH',
      { active: !c.active },
      c.active ? 'Entregador desativado' : 'Entregador ativado',
    );
  }

  const now = Date.now();
  const rows = couriers
    .map((c) => {
      const runs = out.filter((d) => d.courierId === c.id);
      const done = today.filter((d) => d.courierId === c.id);
      return { c, runs, done, state: courierState(c, runs.length, now) };
    })
    .sort(
      (a, b) =>
        COURIER_STATE[a.state].order - COURIER_STATE[b.state].order ||
        a.c.name.localeCompare(b.c.name, 'pt-BR'),
    );
  const count = (st: CourierState) => rows.filter((r) => r.state === st).length;

  return (
    <>
      <Card title="Entregadores">
        <form
          className="filters"
          style={{ alignItems: 'end' }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await call(
                '/couriers',
                'POST',
                { name, phone: phone || null, userId: userId || null },
                'Entregador cadastrado',
              )
            ) {
              setName('');
              setPhone('');
              setUserId('');
            }
          }}
        >
          <TextField
            label="Nome"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Celular (WhatsApp)"
            value={phone}
            maxLength={30}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
          />
          {canUsers && freeDrivers.length > 0 && (
            <SelectField
              label="Login (opcional)"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Sem login</option>
              {freeDrivers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </SelectField>
          )}
          <Button type="submit" disabled={!name.trim()}>
            Cadastrar
          </Button>
        </form>
        <p className="cm-hint">
          O jeito mais simples: gere o <strong>link do entregador</strong> e mande no WhatsApp dele.
          Pelo link ele vê só as próprias corridas, abre a rota, liga para o cliente e marca
          entregue, sem precisar de login. Ou cadastre a pessoa em <strong>Equipe</strong> com o
          papel Entregador: ela entra em <strong>/entregas</strong> só com o PIN de 6 números e já
          aparece aqui.
        </p>
        {rows.length > 0 && (
          <p className="dl-cour-sum" aria-live="polite">
            {(['rua', 'disponivel', 'offline', 'sem-acesso', 'desligado'] as const)
              .filter((st) => count(st) > 0 || st === 'rua' || st === 'disponivel')
              .map((st) => (
                <span key={st} data-state={st}>
                  <i aria-hidden /> {count(st)} {COURIER_STATE[st].label.toLowerCase()}
                </span>
              ))}
          </p>
        )}
        {rows.length === 0 ? (
          <EmptyState
            icon={<Bike size={28} />}
            title="Nenhum entregador ainda"
            description="Cadastre o primeiro acima e mande o link dele no WhatsApp."
          />
        ) : (
          <div className="dl-cour-grid">
            {rows.map(({ c, runs, done, state }) => (
              <CourierCard
                key={c.id}
                courier={c}
                color={colorOf(c.id)}
                state={state}
                runs={runs}
                done={done}
                now={now}
                canUsers={canUsers}
                onCopy={() => void copyLink(c)}
                onWhatsApp={() => void sendWhatsApp(c)}
                onToggle={() => void toggle(c)}
                onPin={() => setPinFor(c)}
                onColor={(color) =>
                  void call(`/couriers/${c.id}`, 'PATCH', { color }, 'Cor do entregador salva')
                }
              />
            ))}
          </div>
        )}
      </Card>
      <Modal
        open={!!shared}
        title={shared ? `Link de ${shared.courier.name}` : ''}
        onClose={() => setShared(null)}
      >
        {shared && <CourierLink courier={shared.courier} url={shared.url} />}
      </Modal>
      <Modal
        open={!!pinFor}
        title={pinFor ? `Senha de ${pinFor.name}` : ''}
        onClose={() => setPinFor(null)}
      >
        {pinFor && <CourierPin courier={pinFor} onDone={() => setPinFor(null)} />}
      </Modal>
    </>
  );
}

/** Um cartão por entregador: situação, o dia dele, acesso, cor e as três ações. */
function CourierCard({
  courier: c,
  color,
  state,
  runs,
  done,
  now,
  canUsers,
  onCopy,
  onWhatsApp,
  onToggle,
  onPin,
  onColor,
}: {
  courier: Courier;
  color: string;
  state: CourierState;
  runs: Delivery[];
  done: Delivery[];
  now: number;
  canUsers: boolean;
  onCopy(): void;
  onWhatsApp(): void;
  onToggle(): void;
  onPin(): void;
  onColor(color: string): void;
}) {
  const seen = lastSeen(c);
  const delivered = done.filter((d) => d.status === 'delivered').length;
  const failed = done.filter((d) => d.status === 'failed').length;
  const note =
    state === 'rua'
      ? `${runs.length === 1 ? '1 corrida' : `${runs.length} corridas`}: ${runs
          .map((d) => `#${d.orderNumber}`)
          .reverse()
          .join(', ')} · saiu ${agoLabel(runs[runs.length - 1]!.dispatchedAt, now)}`
      : state === 'disponivel'
        ? `App aberto ${agoLabel(seen, now)}`
        : state === 'offline'
          ? seen
            ? `Visto ${seenLabel(seen, now)}`
            : 'Ainda não abriu o app'
          : state === 'sem-acesso'
            ? 'Mande o link para ele receber os pedidos'
            : 'Não recebe pedidos';
  const link = !c.linkCreatedAt
    ? 'Ainda não criado'
    : !c.active
      ? 'Pausado'
      : c.linkSeenAt
        ? `Ativo · aberto ${seenLabel(c.linkSeenAt, now)}`
        : 'Ativo · ainda não aberto';
  return (
    <article
      className="dl-cour"
      data-state={state}
      data-search-id={`entregador-${c.id}`}
      style={{ ['--rider' as string]: color }}
    >
      <header className="dl-cour__head">
        <span className="dl-cour__avatar" aria-hidden>
          {initials(c.name)}
        </span>
        <span className="dl-cour__who">
          <strong title={c.name}>{c.name}</strong>
          <span className="dl-cour__phone">{c.phone ? phoneLabel(c.phone) : 'sem celular'}</span>
        </span>
      </header>
      <p className="dl-cour__now">
        <span className="dl-cour__state">
          <i aria-hidden />
          {COURIER_STATE[state].label}
        </span>
        <span className="dl-cour__note">{note}</span>
      </p>
      <dl className="dl-cour__facts">
        <div>
          <dt>Hoje</dt>
          <dd>
            {delivered === 1 ? '1 entregue' : `${delivered} entregues`}
            {failed > 0 && ` · ${failed} não ${failed === 1 ? 'entregue' : 'entregues'}`}
          </dd>
        </div>
        <div>
          <dt>Link</dt>
          <dd>{link}</dd>
        </div>
        <div>
          <dt>Acesso</dt>
          <dd>
            {c.userId ? (
              <>
                Senha (PIN) em /entregas
                {canUsers && (
                  <>
                    {' · '}
                    <button type="button" className="link-btn" onClick={onPin}>
                      Alterar senha
                    </button>
                  </>
                )}
              </>
            ) : (
              'Pelo link, sem senha'
            )}
          </dd>
        </div>
        <div>
          <dt>Cor</dt>
          <dd className="dl-cour__colors" role="radiogroup" aria-label="Cor no calendário">
            {COURIER_COLORS.map((hex) => (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-checked={hex === color.toLowerCase()}
                aria-label={`Cor ${hex}`}
                title="Cor no mapa e no calendário de pagamento"
                className="dl-cour__swatch"
                style={{ ['--sw' as string]: hex }}
                onClick={() => hex !== color.toLowerCase() && onColor(hex)}
              />
            ))}
          </dd>
        </div>
      </dl>
      <footer className="dl-cour__actions">
        <Button
          size="sm"
          variant="secondary"
          icon={<Copy size={14} />}
          onClick={onCopy}
          disabled={!c.active}
        >
          Copiar link
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<MessageCircle size={14} />}
          onClick={onWhatsApp}
          disabled={!c.active}
        >
          WhatsApp
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={c.active ? <UserX size={14} /> : <UserCheck size={14} />}
          onClick={onToggle}
          disabled={!!c.userId && !canUsers}
          title={c.userId && !canUsers ? 'Quem entra com login é ativado em Equipe' : undefined}
          data-danger={c.active || undefined}
        >
          {c.active ? 'Desativar' : 'Ativar'}
        </Button>
      </footer>
    </article>
  );
}

/** Troca o PIN de 6 números de quem entra com login (o novo aparece só agora). */
function CourierPin({ courier, onDone }: { courier: Courier; onDone(): void }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  async function save(chosen: string | null) {
    setBusy(true);
    try {
      const r = await api<{ pin: string }>(`/users/${courier.userId}/pin`, {
        method: 'POST',
        json: chosen ? { pin: chosen } : {},
      });
      setDone(r.pin);
      toast('Senha trocada', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <div className="dl-pin">
        <p style={{ marginTop: 0 }}>
          A senha nova de {courier.name.split(' ')[0]} é{' '}
          <strong className="dl-pin__code">{done}</strong>. Ela aparece só agora. Quem estava
          entrando com a antiga sai dos aparelhos.
        </p>
        <div className="actions-row">
          <Button onClick={onDone}>Pronto</Button>
        </div>
      </div>
    );
  return (
    <form
      className="dl-pin"
      onSubmit={(e) => {
        e.preventDefault();
        void save(pin);
      }}
    >
      <p style={{ marginTop: 0 }}>
        {courier.name.split(' ')[0]} entra em <strong>/entregas</strong> com esta senha de{' '}
        {PIN_LENGTH} números. Ao trocar, a antiga para de funcionar.
      </p>
      <TextField
        label={`Senha nova (${PIN_LENGTH} números)`}
        value={pin}
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_LENGTH}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
      />
      <div className="actions-row">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>
          Sortear uma
        </Button>
        <Button type="submit" variant="primary" disabled={busy || pin.length !== PIN_LENGTH}>
          Salvar senha
        </Button>
      </div>
    </form>
  );
}

const whatsappHref = (c: Courier, url: string) =>
  `https://wa.me/${whatsappNumber(c.phone)}?text=${encodeURIComponent(
    `Olá, ${c.name.split(' ')[0]}! Este é o seu painel de entregas: ${url}`,
  )}`;

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/** "há 5 min", "há 3 h" e, de outro dia, "em 19/11 às 21:10". */
function seenLabel(iso: string, now: number) {
  if (now - new Date(iso).getTime() < 12 * 3_600_000) return agoLabel(iso, now);
  return `em ${dayLabel(iso)} às ${time(iso)}`;
}

function CourierLink({ courier, url }: { courier: Courier; url: string }) {
  const toast = useToast();
  const wa = whatsappNumber(courier.phone);
  const text = `Olá, ${courier.name.split(' ')[0]}! Este é o seu painel de entregas: ${url}`;
  return (
    <>
      <p style={{ marginTop: 0 }}>
        Copie e mande este link para o entregador. Ele é o mesmo sempre: dá para copiar de novo pelo
        cartão dele.
      </p>
      <TextField
        label="Link do entregador"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
      />
      <div className="actions-row">
        <Button
          icon={<Copy size={16} />}
          onClick={() =>
            navigator.clipboard
              ?.writeText(url)
              .then(() => toast('Link copiado', 'success'))
              .catch(() => toast('Não foi possível copiar; selecione o texto', 'danger'))
          }
        >
          Copiar
        </Button>
        <a
          className="cm-btn cm-btn--secondary"
          href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
        >
          Enviar no WhatsApp
        </a>
      </div>
    </>
  );
}
