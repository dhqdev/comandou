import {
  Check,
  ChefHat,
  CircleCheckBig,
  Flame,
  Maximize,
  Minimize,
  Play,
  RotateCcw,
  Timer,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  ChipGroup,
  EmptyState,
  ItemThumb,
  Spinner,
  useToast,
} from '../design-system';
import { useCan } from '../app/auth';
import { CHANNEL_LABELS, minutesSince, qty } from '../features/format';
import { api } from '../lib/api';
import { mediaUrl } from '../lib/media';
import { useDebounced, useRealtime } from '../lib/realtime';
import { useArrivalSound } from '../lib/sounds';
import type { OrderItem, Sector } from '../lib/types';

interface BoardOrder {
  id: string;
  number: number;
  channel: keyof typeof CHANNEL_LABELS;
  status: string;
  notes: string | null;
  createdAt: string;
  tableLabel: string | null;
  tabNumber: number | null;
  customerName: string | null;
  items: (Omit<OrderItem, 'options'> & { options: string[] })[];
}
interface Board {
  warnAfterMin: number;
  lateAfterMin: number;
  serverTime: string;
  orders: BoardOrder[];
}

const SECTOR_KEY = 'pm.kdsSector';

export function KitchenPage() {
  const toast = useToast();
  const canReopen = useCan('kitchen:reopen');
  const canOperate = useCan('kitchen:operate');
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [sectorId, setSectorId] = useState<string>(() => {
    try {
      return localStorage.getItem(SECTOR_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [board, setBoard] = useState<Board | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<Sector[]>('/sectors')
      .then((s) => setSectors(s.filter((x) => x.active)))
      .catch(() => setSectors([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const b = await api<Board>(`/kitchen${sectorId ? `?sectorId=${sectorId}` : ''}`);
      // Tempo de espera calculado com o relógio do servidor (tablets com hora errada não distorcem).
      setSkew(new Date(b.serverTime).getTime() - Date.now());
      setBoard(b);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sectorId]);
  const reload = useDebounced(load);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  useRealtime((e) => {
    if (e.type === 'order.changed' || e.type === 'kitchen.changed') reload();
  }, load);

  function pickSector(id: string) {
    setSectorId(id);
    try {
      localStorage.setItem(SECTOR_KEY, id);
    } catch {
      /* armazenamento indisponível */
    }
  }

  // Som de cozinha quando entra pedido novo na fila; som de alerta no pedido de cancelamento.
  const orders = board?.orders;
  const seenTicket = useArrivalSound(
    'kitchen',
    orders
      ?.filter((o) => o.items.some((i) => i.status === 'pending' || i.status === 'preparing'))
      .map((o) => o.id),
  );
  useArrivalSound(
    'cancel',
    orders?.filter((o) => o.status === 'cancel_requested').map((o) => o.id),
  );

  async function act(url: string, body: object = {}) {
    setBusy(url);
    try {
      await api(url, { method: 'POST', json: body });
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
      void load();
    } finally {
      setBusy(null);
    }
  }

  const columns = useMemo(() => {
    const orders = board?.orders ?? [];
    const open = (o: BoardOrder) =>
      o.items.some((i) => i.status === 'pending' || i.status === 'preparing');
    return [
      {
        key: 'todo',
        label: 'A fazer',
        icon: <Timer size={18} />,
        list: orders.filter((o) => open(o) && !o.items.some((i) => i.status !== 'pending')),
      },
      {
        key: 'doing',
        label: 'Preparando',
        icon: <Flame size={18} />,
        list: orders.filter((o) => open(o) && o.items.some((i) => i.status !== 'pending')),
      },
      {
        key: 'done',
        label: 'Pronto',
        icon: <CircleCheckBig size={18} />,
        list: orders.filter((o) => !open(o)),
      },
    ];
  }, [board]);

  const sectorParam = sectorId || undefined;
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Cozinha</h1>
          <p className="page-sub">Fila de produção por setor. Toque no item para avançar.</p>
        </div>
        <div className="actions-row">
          <ChipGroup label="Setor">
            <button
              className="chip"
              role="tab"
              aria-selected={!sectorId}
              onClick={() => pickSector('')}
            >
              Todos
            </button>
            {sectors.map((s) => (
              <button
                key={s.id}
                className="chip"
                role="tab"
                aria-selected={sectorId === s.id}
                onClick={() => pickSector(s.id)}
              >
                {s.name}
              </button>
            ))}
            <button
              className="chip"
              role="tab"
              aria-selected={sectorId === 'none'}
              onClick={() => pickSector('none')}
            >
              Sem setor
            </button>
          </ChipGroup>
          <FullscreenButton />
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!board ? (
        <Spinner />
      ) : (
        <div className="kds">
          {columns.map((c) => (
            <section key={c.key} className="kds__col" data-col={c.key} aria-label={c.label}>
              <h2 className="kds__head">
                <span className="kds__head-icon" aria-hidden>
                  {c.icon}
                </span>
                <span className="kds__head-label">{c.label}</span>
                <span className="kds__count" aria-label={`${c.list.length} pedidos`}>
                  {c.list.length}
                </span>
              </h2>
              {c.list.length === 0 && <EmptyState icon={<ChefHat size={20} />} title="Nada aqui" />}
              {c.list.map((o) => {
                const mins = minutesSince(o.createdAt, now + skew);
                const level =
                  c.key === 'done'
                    ? 'ok'
                    : mins >= board.lateAfterMin
                      ? 'late'
                      : mins >= board.warnAfterMin
                        ? 'warn'
                        : 'ok';
                const allPending = o.items.every((i) => i.status === 'pending');
                return (
                  <article
                    key={o.id}
                    className="kds-card"
                    data-level={level}
                    data-cancel={o.status === 'cancel_requested' || undefined}
                  >
                    <header className="kds-card__head">
                      <strong>#{o.number}</strong>
                      <span>
                        {o.tableLabel
                          ? `Mesa ${o.tableLabel}`
                          : (o.customerName ?? CHANNEL_LABELS[o.channel])}
                      </span>
                      <span className="kds-card__timer" aria-label={`${mins} minutos`}>
                        {mins} min
                      </span>
                    </header>
                    {o.status === 'cancel_requested' && (
                      <div className="kds-card__alert">Cancelamento solicitado — não produzir</div>
                    )}
                    <ul className="kds-card__items">
                      {o.items.map((i) => (
                        <li key={i.id} data-status={i.status}>
                          <button
                            className="kds-item"
                            disabled={
                              !canOperate ||
                              i.status === 'ready' ||
                              !!busy ||
                              o.status === 'cancel_requested'
                            }
                            onClick={() =>
                              act(
                                `/kitchen/items/${i.id}/${i.status === 'pending' ? 'start' : 'ready'}`,
                              )
                            }
                            aria-label={`${i.name}: ${i.status === 'pending' ? 'iniciar' : 'pronto'}`}
                          >
                            <ItemThumb src={mediaUrl(i.imageId)} name={i.name} size={36} />
                            <span className="kds-item__qty">{qty(i.quantity)}×</span>
                            <span>
                              {i.name}
                              {i.options.length > 0 && (
                                <span className="kds-item__opts">{i.options.join(' · ')}</span>
                              )}
                              {i.notes && <span className="kds-item__note">⚠ {i.notes}</span>}
                            </span>
                            <span className="kds-item__icon">
                              {i.status === 'pending' ? (
                                <Play size={16} />
                              ) : i.status === 'preparing' ? (
                                <Check size={16} />
                              ) : (
                                <Check size={16} />
                              )}
                            </span>
                          </button>
                          {i.status === 'ready' && canReopen && (
                            <Button
                              variant="ghost"
                              aria-label={`Reabrir ${i.name}`}
                              icon={<RotateCcw size={14} />}
                              onClick={() => {
                                const reason = window.prompt('Motivo para reabrir o item');
                                if (reason && reason.trim().length >= 3) {
                                  seenTicket(o.id);
                                  void act(`/kitchen/items/${i.id}/reopen`, {
                                    reason: reason.trim(),
                                  });
                                }
                              }}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                    {o.notes && <p className="kds-item__note">Pedido: {o.notes}</p>}
                    {canOperate && c.key !== 'done' && o.status !== 'cancel_requested' && (
                      <div className="actions-row">
                        {allPending && (
                          <Button
                            variant="secondary"
                            disabled={!!busy}
                            onClick={() =>
                              act(`/kitchen/orders/${o.id}/bump`, {
                                to: 'preparing',
                                sectorId: sectorParam,
                              })
                            }
                          >
                            Iniciar tudo
                          </Button>
                        )}
                        <Button
                          disabled={!!busy}
                          onClick={() =>
                            act(`/kitchen/orders/${o.id}/bump`, {
                              to: 'ready',
                              sectorId: sectorParam,
                            })
                          }
                        >
                          Tudo pronto
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** Tela cheia (a TV ou o tablet da cozinha fica só com a fila). Some onde o navegador não deixa. */
function FullscreenButton() {
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  if (!document.fullscreenEnabled) return null;
  const toggle = () =>
    void (full ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(
      () => undefined,
    );
  return (
    <Button
      variant="secondary"
      icon={full ? <Minimize size={16} /> : <Maximize size={16} />}
      onClick={toggle}
    >
      {full ? 'Sair da tela cheia' : 'Tela cheia'}
    </Button>
  );
}
