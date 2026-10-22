import { SUBSCRIPTION_LABELS, validateTenantSlug } from '@pedemais/shared';
import { ArrowLeft, Building2, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
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
} from '../design-system';
import { dateTime } from '../features/format';
import { SelectField } from '../features/forms';
import { api } from '../lib/api';
import { AuditTable, useLoad } from './OverviewPages';
import type { Plan, TenantDetail, TenantRow } from './types';

export const TENANT_STATUS: Record<
  string,
  [string, 'success' | 'warning' | 'danger' | 'neutral' | 'info']
> = {
  provisioned: ['ativo', 'success'],
  suspended: ['suspenso', 'warning'],
  failed: ['falha no cadastro', 'danger'],
  provisioning: ['em cadastro', 'info'],
  recovering: ['recuperando', 'info'],
  requested: ['solicitado', 'neutral'],
};
const SUB_TONE = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  cancelled: 'neutral',
} as const;

function StatusBadge({ status }: { status: string }) {
  const [label, tone] = TENANT_STATUS[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}

export function TenantsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const q = new URLSearchParams({ ...(search ? { search } : {}), ...(status ? { status } : {}) });
  const { data, error } = useLoad<TenantRow[]>(`/platform/tenants?${q}`);
  const navigate = useNavigate();
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Restaurantes</h1>
          <p className="page-sub">Uso do mês, plano e situação de cada restaurante.</p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
          Novo restaurante
        </Button>
      </div>
      <div className="form-grid" style={{ maxWidth: 560 }}>
        <TextField
          label="Buscar"
          placeholder="nome ou endereço"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <SelectField label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option>
          {Object.entries(TENANT_STATUS).map(([k, [l]]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </SelectField>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card bodyless>
        {!data ? (
          <div className="pm-card__body">
            <Spinner />
          </div>
        ) : data.length === 0 ? (
          <EmptyState icon={<Building2 size={20} />} title="Nenhum restaurante encontrado" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pm-table pm-table--click">
              <thead>
                <tr>
                  <th>Restaurante</th>
                  <th>Situação</th>
                  <th>Plano</th>
                  <th className="pm-num">Equipe</th>
                  <th className="pm-num">Produtos</th>
                  <th className="pm-num">Pedidos no mês</th>
                  <th>Último pedido</th>
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id} onClick={() => navigate(`/restaurantes/${t.id}`)}>
                    <td>
                      <strong>{t.name}</strong>
                      <div className="pm-hint">{t.slug}</div>
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td>
                      {t.planName ?? <span className="pm-hint">sem assinatura</span>}
                      {t.subscriptionStatus && t.subscriptionStatus !== 'active' && (
                        <div>
                          <Badge tone={SUB_TONE[t.subscriptionStatus as keyof typeof SUB_TONE]}>
                            {SUBSCRIPTION_LABELS[
                              t.subscriptionStatus as keyof typeof SUBSCRIPTION_LABELS
                            ] ?? t.subscriptionStatus}
                          </Badge>
                        </div>
                      )}
                    </td>
                    <td className="pm-num">{t.users}</td>
                    <td className="pm-num">{t.products}</td>
                    <td className="pm-num">{t.ordersMonth}</td>
                    <td>{t.lastOrderAt ? dateTime(t.lastOrderAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <NewTenantModal onClose={() => setCreating(false)} />}
    </>
  );
}

function NewTenantModal({ onClose }: { onClose(): void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const plans = useLoad<Plan[]>('/platform/plans').data?.filter((p) => p.active) ?? [];
  const [f, setF] = useState({
    slug: '',
    name: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    planCode: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const slugCheck = f.slug ? validateTenantSlug(f.slug) : null;
  const base = window.location.hostname.replace(/^admin\./, '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await api<TenantDetail>('/platform/tenants', {
        method: 'POST',
        json: { ...f, planCode: f.planCode || undefined },
      });
      toast('Restaurante criado', 'success');
      navigate(`/restaurantes/${t.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Novo restaurante" onClose={onClose} size="lg">
      <form onSubmit={submit}>
        <div className="form-grid">
          <TextField label="Nome do restaurante" value={f.name} onChange={set('name')} />
          <TextField
            label="Endereço"
            value={f.slug}
            onChange={(e) => setF((x) => ({ ...x, slug: e.target.value.toLowerCase() }))}
            hint={f.slug ? `${f.slug}.${base}` : 'Ex.: cantina-da-praca'}
            error={slugCheck && !slugCheck.ok ? slugCheck.reason : undefined}
          />
          <TextField
            label="Nome do administrador"
            value={f.adminName}
            onChange={set('adminName')}
          />
          <TextField
            label="E-mail do administrador"
            type="email"
            value={f.adminEmail}
            onChange={set('adminEmail')}
          />
          <TextField
            label="Senha inicial"
            type="password"
            autoComplete="new-password"
            value={f.adminPassword}
            onChange={set('adminPassword')}
            hint="Mínimo 10 caracteres. Se o e-mail já tem conta, a senha dele continua."
          />
          <SelectField label="Plano" value={f.planCode} onChange={set('planCode')}>
            <option value="">Padrão (ou nenhum)</option>
            {plans.map((p) => (
              <option key={p.id} value={p.code}>
                {p.name}
              </option>
            ))}
          </SelectField>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="pm-modal__footer" style={{ padding: 0, marginTop: 16 }}>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={
              !f.name ||
              !slugCheck?.ok ||
              !f.adminName ||
              !f.adminEmail ||
              f.adminPassword.length < 10
            }
          >
            Criar restaurante
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const toInputDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const fromInputDate = (d: string) =>
  d ? new Date(`${d}T23:59:59-03:00`).toISOString() : undefined;

export function TenantDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data: t, error, setData } = useLoad<TenantDetail>(`/platform/tenants/${id}`);
  const plans = useLoad<Plan[]>('/platform/plans').data ?? [];
  const [statusModal, setStatusModal] = useState<'suspended' | 'provisioned' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sub, setSub] = useState<{
    planId: string;
    status: string;
    trialEndsAt: string;
    currentPeriodEnd: string;
    notes: string;
  } | null>(null);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!t) return <Spinner />;
  const s = t.subscription;
  const form = sub ?? {
    planId: s?.planId ?? '',
    status: s?.status ?? 'active',
    trialEndsAt: toInputDate(s?.trialEndsAt ?? null),
    currentPeriodEnd: toInputDate(s?.currentPeriodEnd ?? null),
    notes: s?.notes ?? '',
  };
  const setForm = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setSub({ ...form, [k]: e.target.value });

  async function run(key: string, fn: () => Promise<TenantDetail>, ok: string) {
    setBusy(key);
    try {
      setData(await fn());
      toast(ok, 'success');
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const saveSub = (e: FormEvent) => {
    e.preventDefault();
    void run(
      'sub',
      () =>
        api<TenantDetail>(`/platform/tenants/${t.id}/subscription`, {
          method: 'PUT',
          json: {
            planId: form.planId || undefined,
            status: form.status,
            trialEndsAt: form.status === 'trialing' ? fromInputDate(form.trialEndsAt) : undefined,
            currentPeriodEnd: fromInputDate(form.currentPeriodEnd),
            notes: form.notes || undefined,
          },
        }),
      form.status === 'cancelled' ? 'Assinatura cancelada' : 'Assinatura salva',
    ).then((ok) => ok && setSub(null));
  };

  return (
    <>
      <Link to="/restaurantes" className="pm-hint" style={{ display: 'inline-flex', gap: 4 }}>
        <ArrowLeft size={14} /> Restaurantes
      </Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {t.name} <StatusBadge status={t.status} />
          </h1>
          <p className="page-sub">
            {t.slug} · criado em {dateTime(t.createdAt)} ·{' '}
            {t.owners.map((o) => `${o.name} <${o.email}>`).join(', ') || 'sem administrador'}
          </p>
        </div>
        {t.status === 'provisioned' && (
          <Button variant="danger" onClick={() => setStatusModal('suspended')}>
            Suspender
          </Button>
        )}
        {t.status === 'suspended' && (
          <Button onClick={() => setStatusModal('provisioned')}>Reativar</Button>
        )}
      </div>
      {t.status === 'suspended' && (
        <Alert tone="warning">
          Restaurante suspenso: ninguém consegue entrar nem operar. Nenhum dado foi apagado.
        </Alert>
      )}
      <div className="stat-grid">
        <div className="pm-card stat">
          <div className="stat__label">Equipe ativa</div>
          <div className="stat__value">{t.usage.users}</div>
        </div>
        <div className="pm-card stat">
          <div className="stat__label">Produtos ativos</div>
          <div className="stat__value">{t.usage.products}</div>
        </div>
        <div className="pm-card stat">
          <div className="stat__label">Pedidos no mês</div>
          <div className="stat__value">{t.usage.ordersMonth}</div>
          <div className="pm-hint">
            {t.usage.lastOrderAt ? `último ${dateTime(t.usage.lastOrderAt)}` : 'nenhum pedido'}
          </div>
        </div>
        <div className="pm-card stat">
          <div className="stat__label">Falhas em 7 dias</div>
          <div className="stat__value">{t.usage.fiscalErrors + t.usage.messageFailures}</div>
          <div className="pm-hint">
            {t.usage.fiscalErrors} NFC-e · {t.usage.messageFailures} WhatsApp
          </div>
        </div>
      </div>
      <div className="two-cols">
        <Card
          title="Assinatura"
          actions={s && <Badge tone={SUB_TONE[s.status]}>{SUBSCRIPTION_LABELS[s.status]}</Badge>}
        >
          {!s && <p className="pm-hint">Sem assinatura: nenhum limite de plano se aplica.</p>}
          <form onSubmit={saveSub} className="form-grid">
            <SelectField label="Plano" value={form.planId} onChange={setForm('planId')}>
              <option value="">Escolha</option>
              {plans
                .filter((p) => p.active || p.id === s?.planId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </SelectField>
            <SelectField label="Situação" value={form.status} onChange={setForm('status')}>
              {(['trialing', 'active', 'past_due'] as const).map((k) => (
                <option key={k} value={k}>
                  {SUBSCRIPTION_LABELS[k]}
                </option>
              ))}
              {s && <option value="cancelled">Cancelar assinatura</option>}
            </SelectField>
            {form.status === 'trialing' && (
              <TextField
                label="Teste até"
                type="date"
                value={form.trialEndsAt}
                onChange={setForm('trialEndsAt')}
                hint="Vazio usa os dias de teste do plano"
              />
            )}
            <TextField
              label="Período pago até"
              type="date"
              value={form.currentPeriodEnd}
              onChange={setForm('currentPeriodEnd')}
            />
            <TextField label="Observação" value={form.notes} onChange={setForm('notes')} />
            <div style={{ alignSelf: 'end' }}>
              <Button
                type="submit"
                loading={busy === 'sub'}
                disabled={form.status !== 'cancelled' && !form.planId}
                variant={form.status === 'cancelled' ? 'danger' : 'primary'}
              >
                {form.status === 'cancelled' ? 'Cancelar assinatura' : 'Salvar'}
              </Button>
            </div>
          </form>
          <p className="pm-hint">
            A cobrança ainda é feita fora do sistema: registre aqui a situação do pagamento.
          </p>
        </Card>
        <Card title="Domínios próprios">
          {t.domains.length === 0 ? (
            <p className="pm-hint" style={{ margin: 0 }}>
              Nenhum. O restaurante cadastra em “Plano e domínio”.
            </p>
          ) : (
            <ul className="plain-list">
              {t.domains.map((d) => (
                <li key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="mono-break">{d.hostname}</span>
                  <Badge tone={d.verifiedAt ? 'success' : 'warning'}>
                    {d.verifiedAt ? 'verificado' : 'pendente'}
                  </Badge>
                  <span style={{ flex: 1 }} />
                  <Button
                    variant="ghost"
                    loading={busy === d.id}
                    onClick={() =>
                      run(
                        d.id,
                        () =>
                          api<TenantDetail>(`/platform/tenants/${t.id}/domains/${d.id}/remove`, {
                            method: 'POST',
                          }),
                        'Domínio removido',
                      )
                    }
                  >
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {t.provisioning.some((p) => p.status !== 'done') && (
            <Alert tone="danger">
              Cadastro incompleto:{' '}
              {t.provisioning
                .filter((p) => p.status !== 'done')
                .map((p) => `${p.step} (${p.lastError ?? p.status})`)
                .join('; ')}
            </Alert>
          )}
        </Card>
      </div>
      <Card title="Histórico no painel" bodyless>
        <AuditTable rows={t.audit} />
      </Card>
      <Modal
        open={!!statusModal}
        title={statusModal === 'suspended' ? 'Suspender restaurante?' : 'Reativar restaurante?'}
        onClose={() => setStatusModal(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStatusModal(null)}>
              Voltar
            </Button>
            <Button
              variant={statusModal === 'suspended' ? 'danger' : 'primary'}
              loading={busy === 'status'}
              disabled={reason.trim().length < 3}
              onClick={async () => {
                const ok = await run(
                  'status',
                  () =>
                    api<TenantDetail>(`/platform/tenants/${t.id}/status`, {
                      method: 'POST',
                      json: { status: statusModal, reason },
                    }),
                  statusModal === 'suspended' ? 'Restaurante suspenso' : 'Restaurante reativado',
                );
                if (ok) {
                  setStatusModal(null);
                  setReason('');
                }
              }}
            >
              {statusModal === 'suspended' ? 'Suspender' : 'Reativar'}
            </Button>
          </>
        }
      >
        <p>
          {statusModal === 'suspended'
            ? 'A equipe perde o acesso na hora (login e operação). Nada é apagado e dá para reativar depois.'
            : 'A equipe volta a entrar e operar normalmente.'}
        </p>
        <TextField
          label="Motivo (fica na auditoria)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </>
  );
}
