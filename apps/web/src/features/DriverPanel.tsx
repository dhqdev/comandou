import { toCents } from '@comandou/shared';
import {
  Banknote,
  Bike,
  CheckCircle2,
  ChevronRight,
  Clock,
  History,
  House,
  KeyRound,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Phone,
  UserRound,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, EmptyState, TextField, useToast } from '../design-system';
import { brl, changeToBring } from '../lib/money';
import { useRealtimeEvents } from '../lib/realtime';
import { useArrivalSound } from '../lib/sounds';
import type { AvailableRun, CourierProfile, Delivery } from '../lib/types';
import { minutesSince, PAYMENT_METHOD_LABELS, time } from './format';
import { SelectField } from './forms';
import { bearing, distanceM, kmLabel, toPoint, type LatLng } from './live-geo';
import type { CourierEarningsData } from './CourierEarnings';
import {
  AvailableTab,
  DriverHomeTab,
  HistoryTab,
  ProfileTab,
  RideRow,
  type DriverData,
  type DriverTab,
} from './DriverTabs';
import { LiveMap, type MapRider } from './LiveMap';
import { NAV_APPS, navUrl, preferredNavApp, rememberNavApp, type NavApp } from './nav-apps';
import { useDriverPanelMounted } from '../driver/DriverShell';
import './driver-panel.css';

/** Posição do GPS enviada ao restaurante (velocidade em m/s, rumo em graus, precisão em m). */
export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
}

const COLLECT_METHODS = ['cash', 'pix', 'debit', 'credit', 'voucher', 'other'] as const;

export interface DriverActions {
  /**
   * Conclui com o código de 4 dígitos que o cliente recebeu. `method`: como o entregador
   * recebeu o valor em aberto (vai para o acerto no caixa).
   */
  complete(id: string, code: string, method?: string): Promise<unknown>;
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

const TABS: { id: DriverTab; label: string; icon: typeof House }[] = [
  { id: 'home', label: 'Início', icon: House },
  { id: 'available', label: 'Disponíveis', icon: Package },
  { id: 'runs', label: 'Entregas', icon: Bike },
  { id: 'history', label: 'Histórico', icon: History },
  { id: 'profile', label: 'Perfil', icon: UserRound },
];

/**
 * Painel do entregador: feito para o celular, com botões grandes e as abas embaixo. Início
 * resume o dia; em Disponíveis ele pega sozinho um pedido pronto (o restaurante também pode
 * despachar para ele pelo painel); Entregas mostra as corridas na rua (endereço, rota no app de
 * mapas preferido, contato, quanto cobrar e quanto ele ganha) e as encerradas hoje; Histórico
 * guarda as corridas e os ganhos; Perfil mostra o score e os números dele.
 * A entrega só é concluída com o código que o cliente recebeu (como no iFood). A localização
 * fica sempre ligada (o DriverGate só libera a tela com ela permitida).
 * Usado pelo app do entregador com login e pelo link do entregador (sem login).
 */
export function DriverPanel({
  deliveries,
  actions,
  onChanged,
  store,
  earnings,
  data,
  live = false,
  preview = false,
}: {
  deliveries: Delivery[];
  actions: DriverActions;
  onChanged(): void;
  store?: LatLng | null;
  /** Carrega a central de ganhos (sem ela, Histórico mostra só as entregas). */
  earnings?: () => Promise<CourierEarningsData>;
  /** Pedidos para pegar, histórico e perfil. */
  data: DriverData;
  /**
   * Entregador com login: a aba Disponíveis recarrega na hora pelo tempo real (`runs.changed`).
   * Sem login (link), não há conexão: a lista é consultada a cada poucos segundos.
   */
  live?: boolean;
  /** Prévia do administrador: sem GPS nem tela acesa (as ações respondem que é só para ver). */
  preview?: boolean;
}) {
  useDriverPanelMounted();
  const [tab, setTab] = useState<DriverTab>('home');
  const [available, setAvailable] = useState<AvailableRun[] | null>(null);
  const [profile, setProfile] = useState<CourierProfile | null>(null);
  const out = deliveries.filter((d) => d.status === 'out');

  // Pedidos para pegar: na hora pelo tempo real (com login) e, de reserva, a cada poucos segundos
  // e quando a tela volta. Falha aparece na aba (ex.: login sem cadastro de entregador), em vez de
  // fingir que não há pedido.
  const [availableError, setAvailableError] = useState<string | null>(null);
  const loadAvailable = useCallback(async () => {
    try {
      setAvailable(await data.available());
      setAvailableError(null);
    } catch (e) {
      setAvailable((cur) => cur ?? []);
      setAvailableError((e as Error).message);
    }
  }, [data]);
  useEffect(() => {
    void loadAvailable();
    const id = setInterval(loadAvailable, live ? 20_000 : 8_000);
    const onVisible = () => document.visibilityState === 'visible' && void loadAvailable();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadAvailable, live]);
  useRealtimeEvents((e) => {
    if (e.type === 'runs.changed' || e.type === 'delivery.changed') void loadAvailable();
  }, live);
  // Pedido novo para pegar toca o som de chamada.
  useArrivalSound(
    'courier',
    available?.map((r) => r.orderId),
  );

  // Perfil e score: ao abrir e a cada corrida encerrada.
  const closed = deliveries.length - out.length;
  useEffect(() => {
    let alive = true;
    data.profile().then(
      (p) => alive && setProfile(p),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [data, closed]);

  // Ganhos do Início (só no app com login): ao abrir e a cada corrida encerrada.
  const [earn, setEarn] = useState<CourierEarningsData | null>(null);
  useEffect(() => {
    if (!earnings) return;
    let alive = true;
    earnings().then(
      (e) => alive && setEarn(e),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [earnings, closed]);

  const go = (t: DriverTab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  const count: Partial<Record<DriverTab, number>> = {
    available: available?.length ?? 0,
    runs: out.length,
  };

  return (
    <div className="driver driver--tabs">
      <div key={tab} className="driver__view">
        {tab === 'home' && (
          <DriverHomeTab
            deliveries={deliveries}
            available={available}
            profile={profile}
            earnings={earn}
            onGo={go}
          />
        )}
        {tab === 'available' && (
          <AvailableTab
            list={available}
            error={availableError}
            claim={data.claim}
            onClaimed={(ok) => {
              void loadAvailable();
              onChanged();
              if (ok) go('runs');
            }}
          />
        )}
        {tab === 'runs' && (
          <Runs
            deliveries={deliveries}
            actions={actions}
            onChanged={onChanged}
            store={store}
            share={!preview}
          />
        )}
        {tab === 'history' && <HistoryTab load={data.history} earnings={earnings} />}
        {tab === 'profile' && <ProfileTab profile={profile} />}
      </div>
      <nav className="dnav" aria-label="Painel do entregador">
        <div className="dnav__bar">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="dnav__item"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => go(id)}
            >
              <span className="dnav__icon">
                <Icon size={21} strokeWidth={tab === id ? 2.25 : 1.9} aria-hidden />
                {!!count[id] && <b aria-hidden>{count[id]! > 9 ? '9+' : count[id]}</b>}
              </span>
              <span className="dnav__label">{label}</span>
              {!!count[id] && <span className="cm-sr-only"> ({count[id]})</span>}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Runs({
  deliveries,
  actions,
  onChanged,
  store,
  share,
}: {
  deliveries: Delivery[];
  actions: DriverActions;
  onChanged(): void;
  store?: LatLng | null;
  /** Manda a posição do celular (desligado na prévia do administrador). */
  share: boolean;
}) {
  const out = deliveries.filter((d) => d.status === 'out');
  const done = deliveries.filter((d) => d.status !== 'out');
  const sharing = useShareLocation(out, actions, share);
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
          emptyHint={share ? 'Procurando o seu GPS…' : 'Na prévia o GPS fica desligado.'}
        />
      )}
      {sharing.error && <p className="form-error">{sharing.error}</p>}

      <header className="driver__head">
        <h2 className="driver__title">Na rua</h2>
        {out.length > 0 && <span className="dhome__count">{out.length}</span>}
      </header>
      {out.length === 0 ? (
        <EmptyState
          mascot
          title="Nenhuma entrega com você agora"
          description="Pegue um pedido em Disponíveis ou espere o restaurante despachar um para você."
        />
      ) : (
        <div className="driver__runs">
          {out.map((d) => (
            <RunCard
              key={d.id}
              d={d}
              me={me}
              nav={nav}
              onNav={pickNav}
              actions={actions}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <section className="dday">
          <header className="dday__head">
            <strong>Encerradas hoje</strong>
            <span>
              {done.length} {done.length === 1 ? 'corrida' : 'corridas'}
            </span>
          </header>
          <ul className="dlist">
            {done.map((d) => (
              <RideRow key={d.id} d={d} />
            ))}
          </ul>
        </section>
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
  const [step, setStep] = useState<'idle' | 'code' | 'fail'>('idle');
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const toCollect = d.paymentStatus !== 'paid' && toCents(d.balance) > 0;
  const [method, setMethod] = useState<string>(d.paymentHint ?? 'cash');

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

  const payLabel =
    d.paymentHint &&
    (PAYMENT_METHOD_LABELS[d.paymentHint as keyof typeof PAYMENT_METHOD_LABELS] ?? d.paymentHint);
  const mins = minutesSince(d.dispatchedAt);
  const near = dist !== null && dist < 80;
  const name = d.customerName ?? 'Cliente';

  return (
    <article className="run run--live" data-search-id={`entrega-${d.id}`}>
      <header className="run__head">
        <div className="run__id">
          <span>Pedido</span>
          <strong className="run__num">#{d.orderNumber}</strong>
        </div>
        <span className="run__clock" data-late={mins >= 40 || undefined}>
          <Clock size={14} aria-hidden /> {mins} min
        </span>
      </header>

      <ol className="run__steps" aria-label="Andamento">
        <li data-done>
          <i aria-hidden />
          <span>Saiu {time(d.dispatchedAt)}</span>
        </li>
        <li data-done={near || undefined} data-now={!near || undefined}>
          <i aria-hidden />
          <span>{dist === null ? 'A caminho' : near ? 'Chegou' : `Faltam ${kmLabel(dist)}`}</span>
        </li>
        <li data-now={near || undefined}>
          <i aria-hidden />
          <span>Entregar</span>
        </li>
      </ol>

      <section className="run__cust">
        <span className="run__avatar" aria-hidden>
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <div>
          <strong>{name}</strong>
          {d.customerPhone && <span className="cm-hint">{d.customerPhone}</span>}
        </div>
        {d.customerPhone && (
          <div className="run__contact">
            <a
              className="run__round"
              href={`tel:${digits(d.customerPhone)}`}
              aria-label="Ligar para o cliente"
            >
              <Phone size={18} />
            </a>
            <a
              className="run__round"
              href={`https://wa.me/${waPhone(d.customerPhone)}`}
              target="_blank"
              rel="noreferrer"
              aria-label="WhatsApp do cliente"
            >
              <MessageCircle size={18} />
            </a>
          </div>
        )}
      </section>

      <a
        className="run__addr"
        href={navUrl(nav, d)}
        target="_blank"
        rel="noreferrer"
        onClick={() => onNav(nav)}
      >
        <MapPin size={18} />
        <span>
          {d.deliveryAddress ?? 'Endereço não informado'}
          {d.notes && <small>Obs.: {d.notes}</small>}
        </span>
        <ChevronRight size={18} className="run__chev" />
      </a>

      <dl className="run__money">
        <div data-tone={toCollect ? 'due' : 'paid'}>
          <dt>
            <Banknote size={16} aria-hidden />
            {toCollect ? 'Cobrar na entrega' : 'Já está pago'}
          </dt>
          <dd>
            <strong>{brl(toCollect ? d.balance : d.total)}</strong>
            {toCollect && (payLabel || d.changeFor) && (
              <small>
                {payLabel}
                {d.changeFor && `${payLabel ? ' · ' : ''}troco para ${brl(d.changeFor)}`}
                {changeToBring(d.changeFor, d.balance) &&
                  ` · leve ${brl(changeToBring(d.changeFor, d.balance)!)} de troco`}
              </small>
            )}
          </dd>
        </div>
        {d.payEstimate && toCents(d.payEstimate) > 0 && (
          <div data-tone="earn">
            <dt>
              <Wallet size={16} aria-hidden />
              Você ganha
            </dt>
            <dd>
              <strong>{brl(d.payEstimate)}</strong>
            </dd>
          </div>
        )}
      </dl>

      {step === 'idle' && (
        <div className="run__nav" role="group" aria-label="Abrir a rota">
          {[nav, ...NAV_APPS.map((a) => a.id).filter((a) => a !== nav)].map((app, i) => (
            <a
              key={app}
              className={`cm-btn cm-btn--lg ${i === 0 ? 'cm-btn--primary' : 'cm-btn--secondary'}`}
              href={navUrl(app, d)}
              target="_blank"
              rel="noreferrer"
              onClick={() => onNav(app)}
            >
              {i === 0 && <Navigation size={16} />}
              {i === 0
                ? `Ir com ${NAV_APPS.find((a) => a.id === app)!.label}`
                : NAV_LABEL_SHORT[app]}
            </a>
          ))}
        </div>
      )}
      {step === 'fail' ? (
        <div key="fail" className="inline-form run__step">
          <TextField
            label="Por que não foi entregue?"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: cliente ausente, endereço errado"
          />
          <div className="run__actions">
            <Button variant="secondary" size="lg" onClick={() => setStep('idle')}>
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
      ) : step === 'code' ? (
        <form
          key="code"
          className="run__code run__step"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 4)
              void run(
                () => actions.complete(d.id, code, toCollect ? method : undefined),
                'Entrega concluída',
              );
          }}
        >
          <TextField
            label="Código de entrega"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="0000"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            hint="Peça ao cliente: são 4 números que ele recebeu no acompanhamento do pedido."
          />
          {toCollect && (
            <SelectField
              label={`Como recebeu ${brl(d.balance)}?`}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {COLLECT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </SelectField>
          )}
          <div className="run__actions">
            <Button variant="secondary" size="lg" type="button" onClick={() => setStep('idle')}>
              Voltar
            </Button>
            <Button
              variant="success"
              size="lg"
              type="submit"
              loading={busy}
              disabled={code.length !== 4}
              icon={<CheckCircle2 size={18} />}
            >
              Confirmar entrega
            </Button>
          </div>
        </form>
      ) : (
        <div className="run__actions run__actions--main">
          <Button
            variant="ghost"
            size="lg"
            icon={<XCircle size={18} />}
            onClick={() => setStep('fail')}
          >
            Não consegui
          </Button>
          <Button
            variant="success"
            size="lg"
            icon={<KeyRound size={18} />}
            onClick={() => {
              setCode('');
              setStep('code');
            }}
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
 * ~25 m andados (no mínimo a cada 5 s) e, parado, a cada 20 s. Sempre ligado: o entregador só
 * chega aqui com a localização permitida. Mantém a tela acesa durante as corridas (o navegador
 * pausa o GPS com a tela apagada).
 */
function useShareLocation(out: Delivery[], actions: DriverActions, on: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [fixAt, setFixAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = out.map((d) => d.id).join(',');
  const ref = useRef({ ids, actions });
  ref.current = { ids, actions };

  useEffect(() => {
    if (!on) return;
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
        const list = ref.current.ids.split(',').filter(Boolean);
        if (!list.length) return;
        const now = Date.now();
        const moved = sent ? distanceM(sent.p, p) : Infinity;
        const since = sent ? now - sent.at : Infinity;
        if (since < SEND_MIN_MS || (moved < SEND_MIN_M && since < SEND_MAX_MS)) return;
        sent = { at: now, p };
        void Promise.all(list.map((id) => ref.current.actions.location(id, f))).catch(
          () => undefined,
        );
      },
      (err) =>
        setError(
          // Só a recusa (código 1) pede para mexer na permissão; sinal fraco ou demora não.
          err.code === 1
            ? 'Permita o acesso à localização nas configurações do celular.'
            : 'Sem sinal de GPS agora. Tentando de novo…',
        ),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [on]);

  useWakeLock(on && !!ids);
  return { fix, fixAt, error };
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
