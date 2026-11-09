import {
  Bike,
  CheckCircle2,
  Copy,
  Link2,
  MapPin,
  Navigation,
  PackageCheck,
  Route,
  Timer,
  Truck,
  XCircle,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
  Select,
} from '../design-system';
import { useCan } from '../app/auth';
import { minutesSince, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, time } from '../features/format';
import { CourierCollections } from '../features/CourierCollections';
import { CourierPayouts } from '../features/CourierPayouts';
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
import { SelectField } from '../features/forms';
import { SlideTabs } from '../features/SlideTabs';
import { useLinkParam } from '../lib/deep-link';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { type RealtimeEvent, useDebounced, useRealtime } from '../lib/realtime';
import { useArrivalSound } from '../lib/sounds';
import type { Courier, Delivery, Order } from '../lib/types';
import './deliveries.css';

const trackingUrl = (path: string) => `${window.location.origin}${path}`;

/**
 * Entregas: despacho com entregador, acompanhamento de quem está na rua e conclusão.
 * O entregador não passa por aqui: tem o app próprio (driver/DriverApp), só com as corridas dele.
 * Pelo painel, a entrega conclui sem o código do cliente (cliente sem o código, por exemplo).
 */
type Aba = 'despacho' | 'entregadores' | 'area' | 'hoje' | 'acerto' | 'repasses';

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
  useLinkParam('aba', (a) => setAba(a as Aba));

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
        <div className="dl-head__title">
          <h1 className="page-title">Entregas</h1>
          <p className="page-sub">
            Despache os pedidos prontos e acompanhe cada entregador no mapa, ao vivo.
          </p>
        </div>
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
          ...(canSettle ? [{ value: 'acerto' as const, label: 'Acerto' }] : []),
          ...(canPay ? [{ value: 'repasses' as const, label: 'Repasses' }] : []),
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
                  <Spinner />
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
        <CouriersCard couriers={couriers} out={out ?? []} colorOf={colorOf} onChanged={load} />
      )}
      {aba === 'area' && <DeliveryAreas canEdit={canSetup} />}
      {aba === 'acerto' && canSettle && <CourierCollections />}
      {aba === 'repasses' && canPay && <CourierPayouts />}
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
function courierColors(couriers: Courier[]) {
  const ids = [...couriers].sort((a, b) => a.id.localeCompare(b.id)).map((c) => c.id);
  return (id: string) => {
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
  if (!data) return <Spinner />;
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
            </option>
          ))}
        </Select>
        <Button loading={busy} disabled={!courierId} icon={<Bike size={16} />} onClick={go}>
          Saiu para entrega
        </Button>
      </div>
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
  colorOf,
  onChanged,
}: {
  couriers: Courier[];
  out: Delivery[];
  colorOf(id: string): string;
  onChanged(): void;
}) {
  const toast = useToast();
  const canUsers = useCan('users:manage');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [userId, setUserId] = useState('');
  const [shared, setShared] = useState<{ courier: Courier; url: string } | null>(null);
  const [drivers, setDrivers] = useState<
    { id: string; name: string; role: string; status: string }[]
  >([]);
  useEffect(() => {
    if (canUsers)
      void api<typeof drivers>('/users')
        .then((u) => setDrivers(u.filter((x) => x.role === 'driver' && x.status === 'active')))
        .catch(() => undefined);
  }, [canUsers]);

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

  async function makeLink(c: Courier) {
    if (c.linkCreatedAt && !window.confirm('Gerar um link novo? O link antigo para de funcionar.'))
      return;
    const r = await call(`/couriers/${c.id}/link`, 'POST', {}, '');
    if (r && typeof r === 'object' && r.path)
      setShared({ courier: c, url: `${window.location.origin}${r.path}` });
  }

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
          {canUsers && (
            <SelectField
              label="Login (opcional)"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Sem login</option>
              {drivers.map((u) => (
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
          entregue, sem precisar de login. Quem tem login (papel Entregador na Equipe) vê o mesmo
          painel ao entrar.
        </p>
        <ul className="plain-list courier-list">
          {couriers.map((c) => {
            const running = out.filter((d) => d.courierId === c.id).length;
            return (
              <li key={c.id} data-search-id={`entregador-${c.id}`}>
                <span className="courier-list__who">
                  <span
                    className="courier-list__dot"
                    style={{ ['--rider' as string]: colorOf(c.id) }}
                    aria-hidden
                  />
                  <strong>{c.name}</strong>{' '}
                  {c.phone && <span className="cm-hint">· {c.phone}</span>}{' '}
                  {running > 0 && <Badge tone="brand">{running} na rua</Badge>}{' '}
                  {c.userName && <Badge tone="info">login: {c.userName}</Badge>}{' '}
                  {c.linkCreatedAt && <Badge tone="success">link ativo</Badge>}{' '}
                  {!c.active && <Badge>inativo</Badge>}
                </span>
                <span className="actions-row">
                  {c.active && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Link2 size={14} />}
                      onClick={() => makeLink(c)}
                    >
                      {c.linkCreatedAt ? 'Novo link' : 'Link do entregador'}
                    </Button>
                  )}
                  {c.linkCreatedAt && (
                    <button
                      className="link-btn"
                      onClick={() =>
                        window.confirm(`Desligar o link de ${c.name}?`) &&
                        void call(`/couriers/${c.id}/link`, 'DELETE', {}, 'Link desligado')
                      }
                    >
                      desligar link
                    </button>
                  )}
                  <button
                    className="link-btn"
                    onClick={() =>
                      call(
                        `/couriers/${c.id}`,
                        'PATCH',
                        { active: !c.active },
                        'Entregador atualizado',
                      )
                    }
                  >
                    {c.active ? 'desativar' : 'ativar'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      <Modal
        open={!!shared}
        title={shared ? `Link de ${shared.courier.name}` : ''}
        onClose={() => setShared(null)}
      >
        {shared && <CourierLink courier={shared.courier} url={shared.url} />}
      </Modal>
    </>
  );
}

function CourierLink({ courier, url }: { courier: Courier; url: string }) {
  const toast = useToast();
  const phone = (courier.phone ?? '').replace(/\D/g, '');
  const wa = phone ? (phone.length >= 12 ? phone : `55${phone}`) : '';
  const text = `Olá, ${courier.name.split(' ')[0]}! Este é o seu painel de entregas: ${url}`;
  return (
    <>
      <p style={{ marginTop: 0 }}>
        Mande este link para o entregador. Ele aparece só agora: se perder, gere um novo (o antigo
        para de funcionar).
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
