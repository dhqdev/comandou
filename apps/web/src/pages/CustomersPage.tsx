import { Ban, MessageCircle, Search, UserCheck, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../app/auth';
import { Alert, Badge, Button, Card, EmptyState, Spinner, useToast } from '../design-system';
import { CHANNEL_LABELS, dateTime, ORDER_STATUS_LABELS, STATUS_TONE } from '../features/format';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { SidePanel } from '../features/SidePanel';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { brl } from '../lib/money';
import type { CustomerDetail, CustomerList } from '../lib/types';
import './online-store.css';

const fmtPhone = (d: string) =>
  d.length === 11
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : d.length === 10
      ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
      : d;
const waLink = (d: string) => `https://wa.me/55${d}`;
const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Ficha do cliente: contato, endereços, números, favoritos, pedidos e observações da equipe. */
function CustomerPanel({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose(): void;
  onChanged(): void;
}) {
  const { me } = useAuth();
  const toast = useToast();
  const canManage = !!me?.permissions.includes('customers:manage');
  const [c, setC] = useState<CustomerDetail | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<string | null>(null);
  useEffect(() => {
    setC(null);
    if (!id) return;
    api<CustomerDetail>(`/customers/${id}`).then(
      (x) => {
        setC(x);
        setNotes(x.staffNotes ?? '');
      },
      (e: Error) => toast(e.message, 'danger'),
    );
  }, [id, toast]);

  async function save(json: { staffNotes?: string | null; blocked?: boolean }, ok: string) {
    if (!c) return;
    setBusy(true);
    try {
      setC(await api<CustomerDetail>(`/customers/${c.id}`, { method: 'PATCH', json }));
      toast(ok, 'success');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidePanel open={id !== null} title="Cliente" onClose={onClose}>
      {!c ? (
        <Spinner />
      ) : (
        <div className="cl-detail">
          <div className="cl-head">
            <span className="cl-avatar cl-avatar--lg">{initials(c.name)}</span>
            <div>
              <strong>{c.name}</strong> {c.blocked && <Badge tone="danger">Bloqueado</Badge>}
              <p>
                <a className="cl-wa" href={waLink(c.phone)} target="_blank" rel="noreferrer">
                  <MessageCircle size={14} style={{ verticalAlign: -2 }} /> {fmtPhone(c.phone)}
                </a>
                {c.email && <> · {c.email}</>}
              </p>
              <p>
                Cliente desde {date(c.createdAt)}
                {c.lastLoginAt && <> · último acesso {dateTime(c.lastLoginAt)}</>}
                {c.marketingOptIn && <> · aceita novidades</>}
              </p>
            </div>
          </div>

          <div className="cl-stats">
            <div>
              <small>Pedidos</small>
              <strong>{c.stats.orders}</strong>
            </div>
            <div>
              <small>Total gasto</small>
              <strong>{brl(c.stats.spent)}</strong>
            </div>
            <div>
              <small>Ticket médio</small>
              <strong>{brl(c.stats.avgTicket)}</strong>
            </div>
          </div>

          {c.favorites.length > 0 && (
            <section>
              <h3>Mais pede</h3>
              <div className="cl-favs">
                {c.favorites.map((f) => (
                  <Badge key={f.name} tone="brand">
                    {f.name} · {f.quantity}×
                  </Badge>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3>Endereços</h3>
            {c.addresses.length === 0 ? (
              <p className="cm-hint">Nenhum endereço salvo.</p>
            ) : (
              <ul className="cl-list">
                {c.addresses.map((a) => (
                  <li key={a.id}>
                    <span>
                      {a.label && <strong>{a.label}: </strong>}
                      {a.street}, {a.number}
                      {a.complement && ` (${a.complement})`} · {a.district}
                      {a.reference && <small> · {a.reference}</small>}
                    </span>
                    {a.isDefault && <Badge>principal</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>Pedidos</h3>
            {c.orders.length === 0 ? (
              <p className="cm-hint">Ainda não pediu pela conta.</p>
            ) : (
              <ul className="cl-list cl-orders">
                {c.orders.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="cm-btn cm-btn--ghost"
                      style={{ padding: 0, minHeight: 0 }}
                      onClick={() => setOrder(o.id)}
                    >
                      #{o.number}
                    </button>
                    <small>
                      {dateTime(o.createdAt)} ·{' '}
                      {CHANNEL_LABELS[o.channel as keyof typeof CHANNEL_LABELS] ?? o.channel}
                    </small>
                    <Badge tone={STATUS_TONE[o.status as keyof typeof STATUS_TONE] ?? 'neutral'}>
                      {ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS] ??
                        o.status}
                    </Badge>
                    <strong>{brl(o.total)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>Observações da equipe</h3>
            <p className="cm-hint" style={{ margin: '0 0 8px' }}>
              Só a equipe vê. Ex.: “prefere sem cebola”, “interfone quebrado”.
            </p>
            <textarea
              className="cm-input"
              rows={3}
              maxLength={1000}
              value={notes}
              disabled={!canManage}
              onChange={(e) => setNotes(e.target.value)}
              style={{ width: '100%', resize: 'vertical' }}
            />
            {canManage && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
                  loading={busy}
                  disabled={notes.trim() === (c.staffNotes ?? '')}
                  onClick={() => save({ staffNotes: notes.trim() || null }, 'Observação salva')}
                >
                  Salvar observação
                </Button>
                <Button
                  variant={c.blocked ? 'secondary' : 'danger'}
                  icon={c.blocked ? <UserCheck size={16} /> : <Ban size={16} />}
                  loading={busy}
                  onClick={() =>
                    (c.blocked ||
                      window.confirm(
                        'Bloquear este cliente? Ele sai da conta e não consegue mais entrar nem pedir logado.',
                      )) &&
                    save(
                      { blocked: !c.blocked },
                      c.blocked ? 'Cliente desbloqueado' : 'Cliente bloqueado',
                    )
                  }
                >
                  {c.blocked ? 'Desbloquear' : 'Bloquear'}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
      <OrderDetailModal orderId={order} onClose={() => setOrder(null)} />
    </SidePanel>
  );
}

/** Clientes com conta no cardápio online: quem são, quanto pedem e quando voltaram. */
export function CustomersPage() {
  const toast = useToast();
  const [data, setData] = useState<CustomerList | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useLinkParam('abrir', setOpen);
  const load = useCallback(
    (q: string) =>
      api<CustomerList>(`/customers?search=${encodeURIComponent(q)}`).then(setData, (e: Error) =>
        toast(e.message, 'danger'),
      ),
    [toast],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(search.trim()), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-sub">
            Quem criou conta no cardápio online: contato, endereços e histórico de pedidos.
          </p>
        </div>
      </div>
      {data && (
        <div className="stat-grid">
          <div className="cm-card stat">
            <div className="stat__label">Clientes com conta</div>
            <div className="stat__value">{data.summary.total}</div>
          </div>
          <div className="cm-card stat">
            <div className="stat__label">Novos (30 dias)</div>
            <div className="stat__value">{data.summary.new30}</div>
          </div>
          <div className="cm-card stat">
            <div className="stat__label">Pediram (30 dias)</div>
            <div className="stat__value">{data.summary.active30}</div>
          </div>
        </div>
      )}
      <Card
        title="Lista"
        bodyless
        actions={
          <label className="cl-search">
            <Search size={16} aria-hidden />
            <input
              className="cm-input"
              type="search"
              aria-label="Buscar cliente"
              placeholder="Nome, celular ou e-mail"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        }
      >
        {!data ? (
          <Spinner />
        ) : data.customers.length === 0 ? (
          <EmptyState
            icon={<Users size={20} />}
            title={search ? 'Ninguém encontrado' : 'Nenhum cliente com conta ainda'}
            description={
              search
                ? 'Tente outro nome ou número.'
                : 'Quando alguém criar conta no cardápio online (/pedir), aparece aqui.'
            }
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table cm-table--click">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Celular</th>
                  <th className="cm-num">Pedidos</th>
                  <th className="cm-num">Total gasto</th>
                  <th>Último pedido</th>
                  <th>Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((c) => (
                  <tr key={c.id} onClick={() => setOpen(c.id)}>
                    <td>
                      <span className="cl-name">
                        <span className="cl-avatar">{initials(c.name)}</span>
                        <span>
                          {c.name} {c.blocked && <Badge tone="danger">Bloqueado</Badge>}
                          {c.email && (
                            <>
                              <br />
                              <small className="cm-hint">{c.email}</small>
                            </>
                          )}
                        </span>
                      </span>
                    </td>
                    <td>
                      <a
                        className="cl-wa"
                        href={waLink(c.phone)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {fmtPhone(c.phone)}
                      </a>
                    </td>
                    <td className="cm-num">{c.orders}</td>
                    <td className="cm-num">{brl(c.spent)}</td>
                    <td>{c.lastOrderAt ? dateTime(c.lastOrderAt) : '—'}</td>
                    <td>{date(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && data.summary.total === 0 && (
        <Alert tone="info">
          Dica: em <strong>Loja online → Aparência</strong> você liga ou desliga o cadastro de
          clientes.
        </Alert>
      )}
      <CustomerPanel id={open} onClose={() => setOpen(null)} onChanged={() => load(search)} />
    </>
  );
}
