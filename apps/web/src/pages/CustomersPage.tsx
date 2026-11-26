import { formatDocument, IE_INDICATORS, isValidCnpj, isValidCpf } from '@comandou/shared';
import {
  Ban,
  Bell,
  CalendarDays,
  Clock,
  KeyRound,
  Mail,
  MapPin,
  MessageCircle,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../app/auth';
import { Alert, Badge, Button, EmptyState, TextField, useToast, Skeleton } from '../design-system';
import { SelectField } from '../features/forms';
import { CHANNEL_LABELS, dateTime, ORDER_STATUS_LABELS, STATUS_TONE } from '../features/format';
import {
  fold,
  ListTable,
  ListToolbar,
  useListView,
  type ListField,
  type ListSort,
  type ListTab,
} from '../features/list-view';
import { OrderDetailModal } from '../features/OrderDetailModal';
import { SidePanel } from '../features/SidePanel';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { brl } from '../lib/money';
import { useLiveData } from '../lib/realtime';
import type { CustomerDetail, CustomerList, CustomerRow } from '../lib/types';
import { CustomerAvatar } from './public/avatars';
import { CustomerCharts, CustomerKpis, CustomerMix, readings } from './customers/CustomerInsights';
import { CustomerPrivacy, PrivacyRequestModal } from './customers/PrivacyTools';
import './customers/customers.css';
import './online-store.css';

const fmtPhone = (d: string) =>
  d.length === 11
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : d.length === 10
      ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
      : d;
const waLink = (d: string) => `https://wa.me/55${d}`;
const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
/** "hoje", "ontem", "há 5 dias". */
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`;
};
/** Foto ou avatar que o cliente escolheu no cardápio; sem nenhum dos dois, as iniciais. */
function ClAvatar({
  c,
  lg,
}: {
  c: { id: string; name: string; avatar?: string | null; photoUrl?: string | null };
  lg?: boolean;
}) {
  if (c.photoUrl || c.avatar)
    return <CustomerAvatar customer={c} size={lg ? 56 : 34} className="cl-avatar-img" decorative />;
  return <span className={`cl-avatar${lg ? ' cl-avatar--lg' : ''}`}>{initials(c.name)}</span>;
}

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

  async function save(json: Record<string, unknown>, ok: string) {
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
    <SidePanel open={id !== null} title="Cliente" size="xl" onClose={onClose}>
      {!c ? (
        <Skeleton variant="detail" />
      ) : (
        <div className="cl-detail">
          <div className="cl-head">
            <ClAvatar c={c} lg />
            <div className="cl-head__main">
              <div className="cl-head__name">
                <strong>{c.name}</strong>
                {c.blocked && <Badge tone="danger">Bloqueado</Badge>}
              </div>
              <ul className="cl-contact">
                <li>
                  <MessageCircle size={16} aria-hidden />
                  <a className="cl-wa" href={waLink(c.phone)} target="_blank" rel="noreferrer">
                    {fmtPhone(c.phone)}
                  </a>
                </li>
                <li>
                  <Mail size={16} aria-hidden />
                  {c.email ? <span>{c.email}</span> : <span className="cm-hint">Sem e-mail</span>}
                </li>
                <li>
                  <CalendarDays size={16} aria-hidden />
                  <span>Cliente desde {date(c.createdAt)}</span>
                </li>
                <li>
                  <Clock size={16} aria-hidden />
                  <span>
                    {c.lastLoginAt
                      ? `Último acesso ${dateTime(c.lastLoginAt)}`
                      : 'Ainda não entrou na conta'}
                  </span>
                </li>
                <li>
                  <Bell size={16} aria-hidden />
                  <span>{c.marketingOptIn ? 'Aceita novidades' : 'Não quer novidades'}</span>
                </li>
              </ul>
            </div>
          </div>

          <CustomerKpis c={c} />

          <div className="cl-cols2">
            <div className="cl-main">
              {c.stats.orders === 0 ? (
                <section className="cl-block">
                  <header className="cl-block__head">
                    <h3>Gráficos</h3>
                  </header>
                  <p className="cm-hint">
                    Os gráficos aparecem depois do primeiro pedido: o que mais pede, quando pede e
                    como paga.
                  </p>
                </section>
              ) : (
                <>
                  {readings(c).length > 0 && (
                    <section className="cl-block">
                      <header className="cl-block__head">
                        <h3>Em poucas palavras</h3>
                      </header>
                      <ul className="cl-readings">
                        {readings(c).map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <CustomerMix c={c} />
                  <CustomerCharts c={c} />
                </>
              )}
            </div>

            <div className="cl-side">
              <section className="cl-block">
                <header className="cl-block__head">
                  <h3>Pedidos</h3>
                  {c.orders.length > 0 && (
                    <span>
                      {c.orders.length === 30
                        ? 'os 30 mais recentes'
                        : `${c.orders.length} no total`}
                    </span>
                  )}
                </header>
                {c.orders.length === 0 ? (
                  <p className="cm-hint">Ainda não pediu pela conta.</p>
                ) : (
                  <ul className="cl-orders">
                    {c.orders.map((o) => (
                      <li key={o.id}>
                        <button type="button" onClick={() => setOrder(o.id)}>
                          <span className="cl-orders__top">
                            <strong>#{o.number}</strong>
                            <Badge
                              tone={STATUS_TONE[o.status as keyof typeof STATUS_TONE] ?? 'neutral'}
                            >
                              {ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS] ??
                                o.status}
                            </Badge>
                          </span>
                          <span
                            className="cl-orders__total"
                            data-off={o.status === 'cancelled' || undefined}
                          >
                            {brl(o.total)}
                          </span>
                          <small>
                            {dateTime(o.createdAt)} ·{' '}
                            {CHANNEL_LABELS[o.channel as keyof typeof CHANNEL_LABELS] ?? o.channel}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="cl-block">
                <header className="cl-block__head">
                  <h3>Endereços</h3>
                </header>
                {c.addresses.length === 0 ? (
                  <p className="cm-hint">Nenhum endereço salvo.</p>
                ) : (
                  <ul className="cl-addr">
                    {c.addresses.map((a) => (
                      <li key={a.id}>
                        <MapPin size={16} aria-hidden />
                        <span>
                          <span className="cl-addr__top">
                            <strong>{a.label || 'Endereço'}</strong>
                            {a.isDefault && <Badge>principal</Badge>}
                          </span>
                          <span>
                            {a.street}, {a.number}
                            {a.complement && ` (${a.complement})`}
                          </span>
                          <small>
                            {a.district}
                            {a.reference && <> · {a.reference}</>}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <TaxData c={c} canManage={canManage} busy={busy} save={save} />

              <section className="cl-block">
                <header className="cl-block__head">
                  <h3>Observações da equipe</h3>
                </header>
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
                    {!c.blocked && (
                      <Button
                        variant="secondary"
                        icon={<KeyRound size={16} />}
                        loading={busy}
                        onClick={async () => {
                          if (
                            !window.confirm('Gerar um código para o cliente criar uma nova senha?')
                          )
                            return;
                          setBusy(true);
                          try {
                            const r = await api<{ code: string; expiresInMinutes: number }>(
                              `/customers/${c.id}/reset-code`,
                              { method: 'POST', json: {} },
                            );
                            window.alert(
                              `Código do cliente: ${r.code}\n\nPasse pelo WhatsApp. Vale por ${r.expiresInMinutes} minutos. Ele usa em "Esqueci minha senha" no cardápio.`,
                            );
                          } catch (e) {
                            toast((e as Error).message, 'danger');
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Código de nova senha
                      </Button>
                    )}
                  </div>
                )}
              </section>

              {canManage && (
                <CustomerPrivacy
                  customerId={c.id}
                  onErased={() => {
                    onChanged();
                    onClose();
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
      <OrderDetailModal orderId={order} onClose={() => setOrder(null)} />
    </SidePanel>
  );
}

const ordersBucket = (n: number) => (n === 0 ? '0' : n === 1 ? '1' : n <= 5 ? '2-5' : '6+');

const FIELDS: ListField<CustomerRow>[] = [
  {
    key: 'orders',
    label: 'Pedidos',
    value: (c) => ordersBucket(c.orders),
    options: [
      { value: '0', label: 'Nunca pediu' },
      { value: '1', label: '1 pedido' },
      { value: '2-5', label: '2 a 5 pedidos' },
      { value: '6+', label: '6 ou mais' },
    ],
    pinned: true,
  },
  { key: 'last', label: 'Último pedido', kind: 'date', date: (c) => c.lastOrderAt, pinned: true },
  { key: 'created', label: 'Cadastro', kind: 'date', date: (c) => c.createdAt },
  {
    key: 'status',
    label: 'Situação',
    value: (c) => (c.blocked ? 'blocked' : 'ok'),
    options: [
      { value: 'ok', label: 'Ativo' },
      { value: 'blocked', label: 'Bloqueado' },
    ],
  },
  {
    key: 'optin',
    label: 'Aceita novidades',
    value: (c) => (c.marketingOptIn ? 'yes' : 'no'),
    options: [
      { value: 'yes', label: 'Sim' },
      { value: 'no', label: 'Não' },
    ],
  },
  {
    key: 'email',
    label: 'E-mail',
    value: (c) => (c.email ? 'yes' : 'no'),
    options: [
      { value: 'yes', label: 'Com e-mail' },
      { value: 'no', label: 'Sem e-mail' },
    ],
  },
];

const TABS: ListTab[] = [
  { id: 'todos', label: 'Todos', filters: {} },
  { id: 'recorrentes', label: 'Recorrentes', filters: { orders: ['2-5', '6+'] } },
  { id: 'sem-pedido', label: 'Sem pedido', filters: { orders: ['0'] } },
  { id: 'bloqueados', label: 'Bloqueados', filters: { status: ['blocked'] } },
];

const SORTS: ListSort<CustomerRow>[] = [
  { key: 'last', label: 'Último pedido', get: (c) => c.lastOrderAt ?? '' },
  { key: 'spent', label: 'Total gasto', get: (c) => Number(c.spent) },
  { key: 'orders', label: 'Pedidos', get: (c) => c.orders },
  { key: 'name', label: 'Nome', get: (c) => fold(c.name), asc: true },
  { key: 'created', label: 'Cadastro', get: (c) => c.createdAt },
];

// O servidor também acha pelo CPF/CNPJ: sem ele aqui, a linha vinha e sumia na tela.
const searchText = (c: CustomerRow) =>
  `${c.name} ${c.email ?? ''} ${c.phone} ${fmtPhone(c.phone)} ${c.document ?? ''}`;

/** Clientes com conta no cardápio online: quem são, quanto pedem e quando voltaram. */
export function CustomersPage() {
  const toast = useToast();
  const { me } = useAuth();
  const [lgpd, setLgpd] = useState(false);
  const [data, setData] = useState<CustomerList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useLinkParam('abrir', setOpen);
  const lv = useListView({
    id: 'clientes',
    rows: data?.customers ?? null,
    fields: FIELDS,
    tabs: TABS,
    search: searchText,
    sorts: SORTS,
  });
  const search = lv.query.trim();
  const load = useCallback(
    (q: string) =>
      api<CustomerList>(`/customers?search=${encodeURIComponent(q)}`).then(setData, (e: Error) =>
        toast(e.message, 'danger'),
      ),
    [toast],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(search), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, load]);
  // Cliente novo ou pedido de cliente (pontos, total gasto) chega sozinho na lista.
  useLiveData(['customers'], () => void load(search), ['order.changed'], 1500);
  const rows = lv.visible;

  return (
    <>
      <h1 className="page-title cm-sr-only">Clientes</h1>
      {data && (
        <dl className="cl-kpis cl-kpis--page">
          <div>
            <dt>Clientes com conta</dt>
            <dd>{data.summary.total}</dd>
          </div>
          <div>
            <dt>Novos (30 dias)</dt>
            <dd>{data.summary.new30}</dd>
          </div>
          <div>
            <dt>Pediram (30 dias)</dt>
            <dd>{data.summary.active30}</dd>
            {data.summary.total > 0 && (
              <dd className="cl-kpis__sub">
                {Math.round((data.summary.active30 / data.summary.total) * 100)}% dos clientes
              </dd>
            )}
          </div>
          <div>
            <dt>Total gasto</dt>
            <dd>{brl(data.summary.spent ?? '0')}</dd>
            <dd className="cl-kpis__sub">pelos clientes com conta</dd>
          </div>
          <div>
            <dt>Ticket médio</dt>
            <dd>{brl(data.summary.avgTicket ?? '0')}</dd>
          </div>
        </dl>
      )}
      <section className="cm-card">
        <ListToolbar
          lv={lv}
          searchLabel="Buscar cliente"
          searchHint="nome, celular ou e-mail"
          actions={
            me?.permissions.includes('customers:manage') && (
              <Button
                variant="secondary"
                icon={<ShieldCheck size={16} />}
                onClick={() => setLgpd(true)}
              >
                Pedido LGPD
              </Button>
            )
          }
          summary={
            rows &&
            `${rows.length} ${rows.length === 1 ? 'cliente' : 'clientes'}` +
              (data && data.customers.length >= 300 ? ' (300 mais recentes)' : '')
          }
        />
        {!rows ? (
          <Skeleton variant="table" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users size={20} />}
            title={data?.customers.length ? 'Ninguém encontrado' : 'Nenhum cliente com conta ainda'}
            description={
              data?.customers.length
                ? 'Tente outro nome, número ou filtro.'
                : 'Quando alguém criar conta no cardápio online (/pedir), aparece aqui.'
            }
          />
        ) : (
          <ListTable>
            <table className="cm-table cm-table--click lv-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Celular</th>
                  <th>Mais pede</th>
                  <th className="cm-num">Pedidos</th>
                  <th className="cm-num">Total gasto</th>
                  <th>Último pedido</th>
                  <th>Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    onClick={() => setOpen(c.id)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && e.key === 'Enter') setOpen(c.id);
                    }}
                  >
                    <td>
                      <span className="cl-name">
                        <ClAvatar c={c} />
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
                    <td>
                      {c.topItem ? (
                        <span className="cl-top" title={c.topItem}>
                          {c.topItem}
                        </span>
                      ) : (
                        <span className="cm-hint">—</span>
                      )}
                    </td>
                    <td className="cm-num">{c.orders}</td>
                    <td className="cm-num">
                      {brl(c.spent)}
                      {c.orders > 0 && (
                        <>
                          <br />
                          <small className="cm-hint">
                            {brl((Number(c.spent) / c.orders).toFixed(2))} por pedido
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      {c.lastOrderAt ? (
                        <>
                          {dateTime(c.lastOrderAt)}
                          <br />
                          <small className="cm-hint">{ago(c.lastOrderAt)}</small>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{date(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListTable>
        )}
      </section>
      {data && data.summary.total === 0 && (
        <Alert tone="info">
          Dica: em <strong>Loja online → Aparência</strong> você liga ou desliga o cadastro de
          clientes.
        </Alert>
      )}
      <CustomerPanel id={open} onClose={() => setOpen(null)} onChanged={() => load(search)} />
      <PrivacyRequestModal
        open={lgpd}
        onClose={() => setLgpd(false)}
        onChanged={() => load(search)}
      />
    </>
  );
}

/** CPF/CNPJ e inscrição estadual: usados quando o cliente pede nota (NFC-e com CPF ou NF-e). */
function TaxData({
  c,
  canManage,
  busy,
  save,
}: {
  c: CustomerDetail;
  canManage: boolean;
  busy: boolean;
  save(json: Record<string, unknown>, ok: string): Promise<void>;
}) {
  const [doc, setDoc] = useState(c.document ? formatDocument(c.document) : '');
  const [ie, setIe] = useState(c.stateRegistration ?? '');
  const [ind, setInd] = useState(String(c.ieIndicator ?? ''));
  useEffect(() => {
    setDoc(c.document ? formatDocument(c.document) : '');
    setIe(c.stateRegistration ?? '');
    setInd(String(c.ieIndicator ?? ''));
  }, [c.document, c.stateRegistration, c.ieIndicator]);
  const digits = doc.replace(/\D/g, '');
  const docError = !digits
    ? undefined
    : digits.length === 11
      ? isValidCpf(digits)
        ? undefined
        : 'CPF inválido'
      : digits.length === 14
        ? isValidCnpj(digits)
          ? undefined
          : 'CNPJ inválido'
        : 'CPF tem 11 dígitos e CNPJ tem 14';
  const company = digits.length === 14;
  const dirty =
    digits !== (c.document ?? '') ||
    (ie.trim() || null) !== (c.stateRegistration ?? null) ||
    ind !== String(c.ieIndicator ?? '');
  return (
    <section className="cl-block">
      <header className="cl-block__head">
        <h3>Dados para nota fiscal</h3>
      </header>
      <div className="form-grid">
        <TextField
          label="CPF ou CNPJ"
          inputMode="numeric"
          value={doc}
          maxLength={18}
          disabled={!canManage}
          onChange={(e) => setDoc(e.target.value)}
          error={docError}
        />
        {company && (
          <>
            <SelectField
              label="Contribuinte do ICMS"
              value={ind}
              disabled={!canManage}
              onChange={(e) => setInd(e.target.value)}
            >
              <option value="">Não informado</option>
              {IE_INDICATORS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Inscrição estadual"
              value={ie}
              maxLength={14}
              disabled={!canManage}
              onChange={(e) => setIe(e.target.value.toUpperCase())}
              hint="Só números, ou ISENTO"
            />
          </>
        )}
      </div>
      {canManage && (
        <Button
          variant="secondary"
          size="sm"
          style={{ marginTop: 8, justifySelf: 'start' }}
          loading={busy}
          disabled={!dirty || !!docError}
          onClick={() =>
            void save(
              {
                document: digits || null,
                stateRegistration: company ? ie.trim() || null : null,
                ieIndicator: company && ind ? Number(ind) : null,
              },
              'Dados fiscais salvos',
            )
          }
        >
          Salvar dados fiscais
        </Button>
      )}
    </section>
  );
}
