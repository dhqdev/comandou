import { formatDocument, IE_INDICATORS, isValidCnpj, isValidCpf } from '@comandou/shared';
import { Ban, KeyRound, MessageCircle, UserCheck, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../app/auth';
import { Alert, Badge, Button, EmptyState, Spinner, TextField, useToast } from '../design-system';
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
import type { CustomerDetail, CustomerList, CustomerRow } from '../lib/types';
import { CustomerAvatar } from './public/avatars';
import './online-store.css';

const fmtPhone = (d: string) =>
  d.length === 11
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : d.length === 10
      ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
      : d;
const waLink = (d: string) => `https://wa.me/55${d}`;
const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
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
    <SidePanel open={id !== null} title="Cliente" onClose={onClose}>
      {!c ? (
        <Spinner />
      ) : (
        <div className="cl-detail">
          <div className="cl-head">
            <ClAvatar c={c} lg />
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

          <TaxData c={c} canManage={canManage} busy={busy} save={save} />

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
                {!c.blocked && (
                  <Button
                    variant="secondary"
                    icon={<KeyRound size={16} />}
                    loading={busy}
                    onClick={async () => {
                      if (!window.confirm('Gerar um código para o cliente criar uma nova senha?'))
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
  const rows = lv.visible;

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
      <section className="cm-card">
        <ListToolbar
          lv={lv}
          searchLabel="Buscar cliente"
          placeholder="Buscar: nome, celular ou e-mail"
          summary={
            rows &&
            `${rows.length} ${rows.length === 1 ? 'cliente' : 'clientes'}` +
              (data && data.customers.length >= 300 ? ' (300 mais recentes)' : '')
          }
        />
        {!rows ? (
          <Spinner />
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
                  <th className="cm-num">Pedidos</th>
                  <th className="cm-num">Total gasto</th>
                  <th>Último pedido</th>
                  <th>Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => setOpen(c.id)}>
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
                    <td className="cm-num">{c.orders}</td>
                    <td className="cm-num">{brl(c.spent)}</td>
                    <td>{c.lastOrderAt ? dateTime(c.lastOrderAt) : '—'}</td>
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
    <section>
      <h3>Dados para nota fiscal</h3>
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
          style={{ marginTop: 8 }}
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
