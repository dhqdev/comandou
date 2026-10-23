import { Bike, Copy, Link2, MapPin, Truck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
import { DeliveryAreas } from '../features/DeliveryAreas';
import { DriverPanel } from '../features/DriverPanel';
import { SelectField } from '../features/forms';
import { SlideTabs } from '../features/SlideTabs';
import { useLinkParam } from '../lib/deep-link';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { Courier, Delivery, Order } from '../lib/types';

const trackingUrl = (path: string) => `${window.location.origin}${path}`;

/**
 * Entregas: despacho com entregador, acompanhamento de quem está na rua e conclusão.
 * O entregador (papel "Entregador") vê só as próprias corridas e envia a localização.
 */
type Aba = 'despacho' | 'entregadores' | 'area' | 'hoje';

export function DeliveriesPage() {
  const canManage = useCan('delivery:manage');
  const canSetup = useCan('settings:manage');
  const [ready, setReady] = useState<Order[]>([]);
  const [out, setOut] = useState<Delivery[] | null>(null);
  const [today, setToday] = useState<Delivery[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ title: string; path: string } | null>(null);
  const [aba, setAba] = useState<Aba>('despacho');
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
  useRealtime((e) => {
    if (e.type === 'delivery.changed' || e.type === 'order.changed') reload();
  }, load);

  // Entregador (sem gerenciar): painel simples, só com as próprias corridas.
  if (!canManage) {
    return (
      <>
        <div>
          <h1 className="page-title">Minhas entregas</h1>
          <p className="page-sub">Abra a rota, fale com o cliente e marque quando entregar.</p>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {out === null ? (
          <Spinner />
        ) : (
          <DriverPanel
            deliveries={[...out, ...today]}
            onChanged={load}
            actions={{
              complete: (id) => api(`/deliveries/${id}/complete`, { method: 'POST', json: {} }),
              fail: (id, reason) =>
                api(`/deliveries/${id}/fail`, { method: 'POST', json: { reason } }),
              location: (id, lat, lng) =>
                api(`/deliveries/${id}/location`, { method: 'POST', json: { lat, lng } }),
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div>
        <h1 className="page-title">Entregas</h1>
        <p className="page-sub">
          Despache pedidos prontos, acompanhe quem está na rua, mande o link para o entregador e
          desenhe as áreas de entrega no mapa.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <SlideTabs<Aba>
        label="Seções de entregas"
        value={aba}
        onChange={setAba}
        tabs={[
          { value: 'despacho', label: 'Despacho', count: ready.length + (out?.length ?? 0) },
          {
            value: 'entregadores',
            label: 'Entregadores',
            count: couriers.filter((c) => c.active).length,
          },
          { value: 'area', label: 'Área de entrega' },
          { value: 'hoje', label: 'Hoje', count: today.length },
        ]}
      />
      {aba === 'despacho' && (
        <>
          <Card title={`Prontos para sair (${ready.length})`}>
            {ready.length === 0 ? (
              <EmptyState
                icon={<Truck size={20} />}
                title="Nenhum pedido de delivery pronto"
                description="Quando a cozinha marcar um delivery como pronto, ele aparece aqui."
              />
            ) : couriers.filter((c) => c.active).length === 0 ? (
              <EmptyState
                icon={<Bike size={20} />}
                title="Cadastre um entregador"
                description="Na aba Entregadores, cadastre quem faz as entregas para despachar."
              />
            ) : (
              <ul className="plain-list">
                {ready.map((o) => (
                  <DispatchRow
                    key={o.id}
                    order={o}
                    couriers={couriers.filter((c) => c.active)}
                    onDone={(path) => {
                      setLink({ title: `Pedido #${o.number} saiu para entrega`, path });
                      void load();
                    }}
                  />
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Na rua (${out?.length ?? 0})`}>
            {out === null ? (
              <Spinner />
            ) : out.length === 0 ? (
              <EmptyState icon={<Bike size={20} />} title="Nenhuma entrega em andamento" />
            ) : (
              <div className="order-grid">
                {out.map((d) => (
                  <DeliveryCard
                    key={d.id}
                    d={d}
                    canManage={canManage}
                    onLink={(path) =>
                      setLink({ title: `Novo link do pedido #${d.orderNumber}`, path })
                    }
                    onChanged={load}
                  />
                ))}
              </div>
            )}
          </Card>
        </>
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
                    <th>Resultado</th>
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
                        {d.status === 'delivered' ? (
                          <Badge tone="success">
                            Entregue {d.finishedAt && time(d.finishedAt)}
                          </Badge>
                        ) : (
                          <Badge tone="danger">Não entregue: {d.failureReason}</Badge>
                        )}
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
        <CouriersCard couriers={couriers} out={out ?? []} onChanged={load} />
      )}
      {aba === 'area' && <DeliveryAreas canEdit={canSetup} />}
      <Modal open={!!link} title={link?.title ?? ''} onClose={() => setLink(null)}>
        {link && <TrackingLink path={link.path} />}
      </Modal>
    </>
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
    <li style={{ flexWrap: 'wrap', gap: 8 }}>
      <div style={{ flex: '1 1 220px' }}>
        <strong>#{order.number}</strong> {order.customerName}
        <div className="cm-hint">{order.deliveryAddress}</div>
        <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
          {PAYMENT_STATUS_LABEL[order.paymentStatus]} · {brl(order.total)}
        </Badge>
      </div>
      <div className="actions-row" style={{ alignItems: 'end' }}>
        <Select
          className="cm-input"
          aria-label={`Entregador do pedido ${order.number}`}
          value={courierId}
          onChange={(e) => setCourierId(e.target.value)}
        >
          <option value="">Entregador…</option>
          {couriers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button loading={busy} disabled={!courierId} onClick={go}>
          Saiu para entrega
        </Button>
      </div>
    </li>
  );
}

function DeliveryCard({
  d,
  canManage,
  onLink,
  onChanged,
}: {
  d: Delivery;
  canManage: boolean;
  onLink(path: string): void;
  onChanged(): void;
}) {
  const toast = useToast();
  const isDriver = useCan('delivery:operate');
  const [busy, setBusy] = useState(false);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');

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

  function sendLocation() {
    if (!navigator.geolocation) {
      toast('Este aparelho não informa localização', 'danger');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        void call(
          `/deliveries/${d.id}/location`,
          { lat: p.coords.latitude, lng: p.coords.longitude },
          'Localização enviada',
        ),
      () => toast('Permita o acesso à localização para enviar', 'danger'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  return (
    <article className="order-card">
      <div className="order-card__top">
        <strong>#{d.orderNumber}</strong>
        <span className="order-card__time">{minutesSince(d.dispatchedAt)} min na rua</span>
      </div>
      <div>
        {d.customerName ?? 'Cliente'}{' '}
        {d.customerPhone && <span className="cm-hint">· {d.customerPhone}</span>}
      </div>
      <div className="cm-hint">{d.deliveryAddress}</div>
      <div className="actions-row">
        <Badge tone="brand">{d.courierName}</Badge>
        <Badge tone={PAYMENT_STATUS_TONE[d.paymentStatus]}>
          {d.paymentStatus === 'paid' ? 'Pago' : `Cobrar ${brl(d.balance)}`}
        </Badge>
        {d.lastLocationAt && (
          <a
            className="link-btn"
            href={`https://www.openstreetmap.org/?mlat=${d.lastLat}&mlon=${d.lastLng}#map=17/${d.lastLat}/${d.lastLng}`}
            target="_blank"
            rel="noreferrer"
          >
            <MapPin size={14} style={{ verticalAlign: -2 }} /> {time(d.lastLocationAt)}
          </a>
        )}
      </div>
      {failing ? (
        <div className="inline-form">
          <TextField
            label="Por que não foi entregue?"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="actions-row">
            <Button variant="secondary" onClick={() => setFailing(false)}>
              Voltar
            </Button>
            <Button
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
        <div className="actions-row">
          <Button
            loading={busy}
            onClick={() => call(`/deliveries/${d.id}/complete`, {}, 'Entrega concluída')}
          >
            Entregue
          </Button>
          <Button variant="ghost" onClick={() => setFailing(true)}>
            Não entregue
          </Button>
          {isDriver && !canManage && (
            <Button variant="ghost" icon={<MapPin size={16} />} onClick={sendLocation}>
              Enviar localização
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" onClick={() => call(`/deliveries/${d.id}/tracking-link`)}>
              Novo link
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function CouriersCard({
  couriers,
  out,
  onChanged,
}: {
  couriers: Courier[];
  out: Delivery[];
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
