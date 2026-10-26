import { toCents } from '@comandou/shared';
import {
  Banknote,
  Bike,
  CheckCircle2,
  LocateFixed,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, TextField, useToast } from '../design-system';
import { brl } from '../lib/money';
import type { Delivery } from '../lib/types';
import { minutesSince, PAYMENT_METHOD_LABELS, time } from './format';
import { bearing, distanceM, kmLabel, toPoint, type LatLng } from './live-geo';
import { CourierEarnings, type CourierEarningsData } from './CourierEarnings';
import { LiveMap, type MapRider } from './LiveMap';
import { SlideTabs } from './SlideTabs';
import { NAV_APPS, navUrl, preferredNavApp, rememberNavApp, type NavApp } from './nav-apps';
import './driver-panel.css';

/** Posição do GPS enviada ao restaurante (velocidade em m/s, rumo em graus, precisão em m). */
export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
}

export interface DriverActions {
  complete(id: string): Promise<unknown>;
  fail(id: string, reason: string): Promise<unknown>;
  location(id: string, fix: Fix): Promise<unknown>;
}

const NAV_LABEL_SHORT: Record<NavApp, string> = { waze: 'Waze', google: 'Google', apple: 'Apple' };

const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');
const waPhone = (s: string | null) => {
  const d = digits(s);
  return d.length >= 12 ? d : `55${d}`;
};

/** Rota no Google Maps (painel do restaurante). */
export const routeUrl = (d: Pick<Delivery, 'deliveryLat' | 'deliveryLng' | 'deliveryAddress'>) =>
  navUrl('google', d);

/**
 * Painel do entregador: feito para o celular, com botões grandes. Mostra as corridas na rua
 * (endereço, rota no app de mapas preferido, contato, quanto cobrar e quanto ele ganha) e as
 * encerradas hoje; na aba "Meus ganhos", a central com o que ganhou e o que falta receber.
 * Usado pelo entregador com login (tela Entregas) e pelo link do entregador (sem login).
 */
export function DriverPanel({
  deliveries,
  actions,
  onChanged,
  store,
  earnings,
}: {
  deliveries: Delivery[];
  actions: DriverActions;
  onChanged(): void;
  store?: LatLng | null;
  /** Carrega a central de ganhos (sem ela, a aba não aparece). */
  earnings?: () => Promise<CourierEarningsData>;
}) {
  const [tab, setTab] = useState<'runs' | 'earnings'>('runs');
  const out = deliveries.filter((d) => d.status === 'out');
  return (
    <div className="driver">
      {earnings && (
        <SlideTabs<'runs' | 'earnings'>
          label="Painel do entregador"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'runs', label: 'Corridas', count: out.length },
            { value: 'earnings', label: 'Meus ganhos' },
          ]}
        />
      )}
      {tab === 'earnings' && earnings ? (
        <CourierEarnings load={earnings} />
      ) : (
        <Runs deliveries={deliveries} actions={actions} onChanged={onChanged} store={store} />
      )}
    </div>
  );
}

function Runs({
  deliveries,
  actions,
  onChanged,
  store,
}: {
  deliveries: Delivery[];
  actions: DriverActions;
  onChanged(): void;
  store?: LatLng | null;
}) {
  const out = deliveries.filter((d) => d.status === 'out');
  const done = deliveries.filter((d) => d.status !== 'out');
  const sharing = useShareLocation(out, actions);
  const me = sharing.fix ? ([sharing.fix.lat, sharing.fix.lng] as LatLng) : null;
  const riders: MapRider[] = [
    {
      id: 'me',
      label: 'Você',
      position: me,
      heading: sharing.fix?.heading,
      at: sharing.fix ? sharing.fixAt : null,
    },
    ...out.map((d) => ({
      id: d.id,
      label: `#${d.orderNumber}`,
      title: `Pedido #${d.orderNumber}`,
      position: null,
      destination: toPoint(d.deliveryLat, d.deliveryLng),
    })),
  ];
  const [nav, setNav] = useState<NavApp>(preferredNavApp);
  const pickNav = (app: NavApp) => {
    rememberNavApp(app);
    setNav(app);
  };
  return (
    <>
      {out.length > 0 && (
        <LiveMap
          className="driver__map"
          riders={riders}
          store={store}
          emptyHint={
            sharing.on ? 'Procurando o seu GPS…' : 'Ligue a localização para ver você no mapa.'
          }
        />
      )}
      <div className="driver__share" data-on={sharing.on || undefined}>
        <LocateFixed size={20} />
        <div>
          <strong>{sharing.on ? 'Localização ligada' : 'Localização desligada'}</strong>
          <span className="cm-hint">
            {sharing.on
              ? sharing.last
                ? `Última enviada às ${time(sharing.last)}. O restaurante e o cliente veem você no mapa.`
                : 'Enviando…'
              : 'Ligue para o restaurante e o cliente acompanharem você no mapa.'}
          </span>
        </div>
        <Button
          variant={sharing.on ? 'secondary' : 'primary'}
          size="sm"
          onClick={sharing.toggle}
          disabled={!out.length && !sharing.on}
        >
          {sharing.on ? 'Desligar' : 'Ligar'}
        </Button>
      </div>
      {sharing.error && <p className="form-error">{sharing.error}</p>}

      <h2 className="driver__title">
        <Bike size={18} /> Na rua ({out.length})
      </h2>
      {out.length === 0 ? (
        <EmptyState
          mascot
          title="Nenhuma entrega com você agora"
          description="Quando o restaurante despachar um pedido para você, ele aparece aqui."
        />
      ) : (
        out.map((d) => (
          <RunCard
            key={d.id}
            d={d}
            me={me}
            nav={nav}
            onNav={pickNav}
            actions={actions}
            onChanged={onChanged}
          />
        ))
      )}

      {done.length > 0 && (
        <>
          <h2 className="driver__title">Encerradas hoje ({done.length})</h2>
          <ul className="driver__done">
            {done.map((d) => (
              <li key={d.id}>
                <span>
                  <strong>#{d.orderNumber}</strong> {d.customerName}
                </span>
                <span className="earn__amount">
                  {d.status === 'delivered' ? (
                    <Badge tone="success">Entregue {d.finishedAt && time(d.finishedAt)}</Badge>
                  ) : (
                    <Badge tone="danger">Não entregue</Badge>
                  )}
                  {d.courierPay && <strong>{brl(d.courierPay)}</strong>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function RunCard({
  d,
  me,
  nav,
  onNav,
  actions,
  onChanged,
}: {
  d: Delivery;
  me: LatLng | null;
  nav: NavApp;
  onNav(app: NavApp): void;
  actions: DriverActions;
  onChanged(): void;
}) {
  const dest = toPoint(d.deliveryLat, d.deliveryLng);
  const dist = me && dest ? distanceM(me, dest) : null;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  const toCollect = d.paymentStatus !== 'paid' && toCents(d.balance) > 0;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'success');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="run" data-search-id={`entrega-${d.id}`}>
      <header className="run__top">
        <strong className="run__num">#{d.orderNumber}</strong>
        <span className="cm-hint">
          saiu {time(d.dispatchedAt)} · {minutesSince(d.dispatchedAt)} min
        </span>
      </header>
      {dist !== null && (
        <div className="run__dist">
          <Navigation size={15} /> {dist < 80 ? 'Você chegou' : `Faltam ${kmLabel(dist)}`}
        </div>
      )}
      <div className="run__who">
        <strong>{d.customerName ?? 'Cliente'}</strong>
        {d.customerPhone && <span className="cm-hint">{d.customerPhone}</span>}
      </div>
      <a
        className="run__addr"
        href={navUrl(nav, d)}
        target="_blank"
        rel="noreferrer"
        onClick={() => onNav(nav)}
      >
        <MapPin size={18} />
        <span>{d.deliveryAddress ?? 'Endereço não informado'}</span>
      </a>
      {d.notes && <p className="run__notes">Obs.: {d.notes}</p>}
      <div className={`run__pay ${toCollect ? 'is-due' : ''}`}>
        <Banknote size={18} />
        {toCollect ? (
          <span>
            Cobrar <strong>{brl(d.balance)}</strong>
            {d.paymentHint &&
              ` · ${PAYMENT_METHOD_LABELS[d.paymentHint as keyof typeof PAYMENT_METHOD_LABELS] ?? d.paymentHint}`}
            {d.changeFor && ` · troco para ${brl(d.changeFor)}`}
          </span>
        ) : (
          <span>Já está pago · {brl(d.total)}</span>
        )}
      </div>
      {d.payEstimate && (
        <div className="run__earn">
          <span>Você ganha nesta entrega</span>
          <strong>{brl(d.payEstimate)}</strong>
        </div>
      )}
      <div className="run__nav" role="group" aria-label="Abrir a rota">
        {[nav, ...NAV_APPS.map((a) => a.id).filter((a) => a !== nav)].map((app, i) => (
          <a
            key={app}
            className={`cm-btn ${i === 0 ? 'cm-btn--primary' : 'cm-btn--secondary'}`}
            href={navUrl(app, d)}
            target="_blank"
            rel="noreferrer"
            onClick={() => onNav(app)}
          >
            {i === 0 && <Navigation size={16} />}
            {i === 0 ? `Ir com ${NAV_APPS.find((a) => a.id === app)!.label}` : NAV_LABEL_SHORT[app]}
          </a>
        ))}
      </div>
      {d.customerPhone && (
        <div className="run__links">
          <a
            className="cm-btn cm-btn--secondary"
            href={`tel:${digits(d.customerPhone)}`}
            aria-label="Ligar para o cliente"
          >
            <Phone size={16} />
          </a>
          <a
            className="cm-btn cm-btn--secondary"
            href={`https://wa.me/${waPhone(d.customerPhone)}`}
            target="_blank"
            rel="noreferrer"
            aria-label="WhatsApp do cliente"
          >
            <MessageCircle size={16} />
          </a>
        </div>
      )}
      {failing ? (
        <div className="inline-form">
          <TextField
            label="Por que não foi entregue?"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: cliente ausente, endereço errado"
          />
          <div className="run__actions">
            <Button variant="secondary" size="lg" onClick={() => setFailing(false)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              size="lg"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => run(() => actions.fail(d.id, reason.trim()), 'Avisamos o restaurante')}
            >
              Confirmar
            </Button>
          </div>
        </div>
      ) : (
        <div className="run__actions">
          <Button
            variant="secondary"
            size="lg"
            icon={<XCircle size={18} />}
            onClick={() => setFailing(true)}
          >
            Não consegui
          </Button>
          <Button
            variant="success"
            size="lg"
            loading={busy}
            icon={<CheckCircle2 size={18} />}
            onClick={() => run(() => actions.complete(d.id), 'Entrega concluída')}
          >
            Entreguei
          </Button>
        </div>
      )}
    </article>
  );
}

/** Envia quando andou isso ou quando passou o intervalo máximo, o que vier primeiro. */
const SEND_MIN_MS = 5_000;
const SEND_MIN_M = 25;
const SEND_MAX_MS = 20_000;

/**
 * Envia a posição do celular para as corridas na rua enquanto a tela estiver aberta: a cada
 * ~25 m andados (no mínimo a cada 5 s) e, parado, a cada 20 s. Mantém a tela acesa enquanto
 * está ligado (o navegador pausa o GPS com a tela apagada). Fica ligado entre visitas.
 */
function useShareLocation(out: Delivery[], actions: DriverActions) {
  const KEY = 'cm-driver-share';
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const [last, setLast] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [fixAt, setFixAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = out.map((d) => d.id).join(',');
  const ref = useRef({ ids, actions });
  ref.current = { ids, actions };

  useEffect(() => {
    if (!on || !ids) return;
    if (!navigator.geolocation) {
      setError('Este aparelho não informa a localização.');
      return;
    }
    let sent: { at: number; p: LatLng } | null = null;
    let prev: LatLng | null = null;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const p: LatLng = [c.latitude, c.longitude];
        // Alguns aparelhos não dão o rumo: calcula pelo último ponto quando andou o bastante.
        let heading = c.heading != null && !Number.isNaN(c.heading) ? c.heading : null;
        if (heading == null && prev && distanceM(prev, p) > 15) heading = bearing(prev, p);
        if (!prev || distanceM(prev, p) > 15) prev = p;
        const f: Fix = {
          lat: p[0],
          lng: p[1],
          accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
          speed: c.speed != null && !Number.isNaN(c.speed) ? Math.max(0, c.speed) : null,
          heading,
        };
        setFix(f);
        setFixAt(new Date().toISOString());
        setError(null);
        const now = Date.now();
        const moved = sent ? distanceM(sent.p, p) : Infinity;
        const since = sent ? now - sent.at : Infinity;
        if (since < SEND_MIN_MS || (moved < SEND_MIN_M && since < SEND_MAX_MS)) return;
        sent = { at: now, p };
        const list = ref.current.ids.split(',').filter(Boolean);
        void Promise.all(list.map((id) => ref.current.actions.location(id, f)))
          .then(() => setLast(new Date().toISOString()))
          .catch(() => undefined);
      },
      () => setError('Permita o acesso à localização nas configurações do navegador.'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [on, ids]);

  useWakeLock(on && !!ids);

  const toggle = () =>
    setOn((v) => {
      try {
        localStorage.setItem(KEY, v ? '0' : '1');
      } catch {
        /* sem armazenamento: vale só agora */
      }
      return !v;
    });
  return { on, last, fix, fixAt, error, toggle };
}

/** Mantém a tela acesa enquanto o entregador compartilha a posição (quando o navegador deixa). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    const wl = (
      navigator as Navigator & {
        wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> };
      }
    ).wakeLock;
    if (!active || !wl) return;
    let lock: { release(): Promise<void> } | null = null;
    let stop = false;
    const grab = () => {
      if (document.visibilityState !== 'visible') return;
      void wl
        .request('screen')
        .then((l) => {
          if (stop) void l.release();
          else lock = l;
        })
        .catch(() => undefined);
    };
    grab();
    document.addEventListener('visibilitychange', grab);
    return () => {
      stop = true;
      document.removeEventListener('visibilitychange', grab);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
