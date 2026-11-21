import { isPinOnlyEmail, isPinRole, spDate, SUBSCRIPTION_LABELS } from '@comandou/shared';
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  KeyRound,
  LogOut,
  MessagesSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Trash2,
} from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, Button, Modal, TextField, useToast, Select, Skeleton } from '../design-system';
import { dateTime } from '../features/format';
import { SelectField } from '../features/forms';
import { api } from '../lib/api';
import { useAutoReload, useLoad } from './OverviewPages';
import { TenantHistory } from './audit';
import { ConsumptionPanel, OperationPanel } from './TenantInsights';
import { TenantBillingPanel } from './TenantBilling';
import { isOnline, ROLE, TenantOverview } from './TenantOverview';
import { DatabasePanel, DatabaseProgress, DeleteTenantModal, dbBusy } from './TenantDatabase';
import { ProfilePanel, TIMEZONES } from './NewTenant';
import { ContractsPanel } from './TenantContracts';
import { KitchenPanel } from './TenantKitchen';
import type { Plan, SupportLink, TeamMember, TenantDetail, TenantRow } from './types';
import { ago, Dot, Level, Monogram, MoreMenu, PageHead, Tabs, Tag } from './ui';

export const TENANT_STATUS: Record<string, [string, Level]> = {
  provisioned: ['ativo', 'ok'],
  suspended: ['suspenso', 'warn'],
  failed: ['falha no cadastro', 'bad'],
  provisioning: ['em cadastro', 'info'],
  recovering: ['recuperando', 'info'],
  requested: ['solicitado', 'off'],
  moving: ['mudando de banco', 'info'],
  deleting: ['sendo excluído', 'warn'],
  migrated: ['migrado para outro servidor', 'off'],
};
const SUB_LEVEL: Record<string, Level> = {
  trialing: 'info',
  active: 'ok',
  past_due: 'warn',
  cancelled: 'off',
};

/** Domínio base, a partir de admin.<base>. */
export const baseDomain = () => window.location.hostname.replace(/^admin\./, '');
const port = () => (window.location.port ? `:${window.location.port}` : '');
export const tenantUrl = (slug: string, path = '/') =>
  `${window.location.protocol}//${slug}.${baseDomain()}${port()}${path}`;

/**
 * Abre o sistema do restaurante já logado (link de uso único, 2 min). A janela é aberta no
 * clique, antes da resposta da API, para o navegador não bloquear como pop-up.
 */
export function useOpenTenant() {
  const toast = useToast();
  const [fallback, setFallback] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function open(tenantId: string, userId?: string) {
    const w = window.open('about:blank', '_blank');
    if (w) w.opener = null;
    setBusy(userId ?? tenantId);
    try {
      const r = await api<SupportLink>(`/platform/tenants/${tenantId}/access`, {
        method: 'POST',
        json: userId ? { userId } : {},
      });
      const url = tenantUrl(r.slug, `/suporte#${r.token}`);
      if (w) w.location.href = url;
      else setFallback(url);
      toast(`Entrando como ${r.user.name}`, 'success');
    } catch (e) {
      w?.close();
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }
  const sheet = fallback && (
    <Modal open title="Abrir restaurante" onClose={() => setFallback(null)}>
      <p style={{ marginTop: 0 }}>
        O navegador bloqueou a nova aba. Toque para abrir (vale 2 min):
      </p>
      <a
        className="adm-action adm-action--primary"
        href={fallback}
        target="_blank"
        rel="noreferrer noopener"
        onClick={() => setFallback(null)}
      >
        <ExternalLink size={14} /> Abrir agora
      </a>
    </Modal>
  );
  return { open, busy, sheet };
}

function StatusTag({ status }: { status: string }) {
  const [label, level] = TENANT_STATUS[status] ?? [status, 'off' as Level];
  return <Tag level={level}>{label}</Tag>;
}

export function TenantsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = new URLSearchParams({ ...(search ? { search } : {}), ...(status ? { status } : {}) });
  const { data, error, reload } = useLoad<TenantRow[]>(`/platform/tenants?${q}`);
  useAutoReload(reload);
  const { open, busy, sheet } = useOpenTenant();
  const navigate = useNavigate();
  return (
    <>
      <PageHead
        page
        title="Restaurantes"
        sub={
          data ? (
            <span>{data.length === 1 ? '1 cliente' : `${data.length} clientes`}</span>
          ) : undefined
        }
        actions={
          <button
            className="adm-action adm-action--primary"
            onClick={() => navigate('/restaurantes/novo')}
          >
            <Plus size={15} /> Novo
          </button>
        }
      />
      <div className="adm-section">
        <div className="adm-search">
          <input
            className="cm-input"
            placeholder="Buscar por nome ou endereço"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar"
          />
          <Select
            className="cm-input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Situação"
          >
            <option value="">Todas as situações</option>
            {Object.entries(TENANT_STATUS).map(([k, [l]]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="adm-panel">
          {!data ? (
            <div className="adm-panel__body">
              <Skeleton variant="table" />
            </div>
          ) : data.length === 0 ? (
            <div className="adm-empty">Nenhum restaurante encontrado</div>
          ) : (
            <div>
              <div className="adm-tlist__row adm-tlist__head" aria-hidden>
                <span />
                <span>Restaurante</span>
                <span>Plano</span>
                <span>Situação</span>
                <span className="adm-tlist__cell--num">Pedidos no mês</span>
                <span />
              </div>
              {data.map((t) => {
                const subLabel =
                  t.subscriptionStatus && t.subscriptionStatus !== 'active'
                    ? (SUBSCRIPTION_LABELS[
                        t.subscriptionStatus as keyof typeof SUBSCRIPTION_LABELS
                      ] ?? t.subscriptionStatus)
                    : null;
                return (
                  <div
                    key={t.id}
                    className="adm-tlist__row is-link"
                    onClick={() => navigate(`/restaurantes/${t.id}`)}
                  >
                    <Monogram name={t.name} src={t.iconUrl} />
                    <span className="adm-tlist__cell">
                      <Link
                        to={`/restaurantes/${t.id}`}
                        className="adm-row__title"
                        style={{ color: 'var(--a-text)', textDecoration: 'none' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t.name}
                      </Link>
                      <span className="adm-row__meta">
                        {t.slug}.{baseDomain()}
                        {t.city ? ` · ${t.city}${t.state ? `/${t.state}` : ''}` : ''}
                      </span>
                    </span>
                    <span className="adm-tlist__cell adm-tlist__plan">
                      <span>{t.planName ?? 'Sem plano'}</span>
                      {subLabel && <span className="adm-row__meta">{subLabel}</span>}
                    </span>
                    <span className="adm-tlist__cell adm-tlist__status">
                      <StatusTag status={t.status} />
                    </span>
                    <span className="adm-tlist__cell adm-tlist__cell--num">
                      <span style={{ color: 'var(--a-text)' }}>{t.ordersMonth}</span>
                      <span className="adm-row__meta">
                        {t.lastOrderAt ? ago(t.lastOrderAt) : 'sem pedidos'}
                      </span>
                    </span>
                    <span className="adm-tlist__open">
                      {t.status === 'provisioned' && (
                        <button
                          type="button"
                          className="adm-icon-btn"
                          title="Abrir o sistema do restaurante"
                          aria-label={`Abrir ${t.name}`}
                          aria-busy={busy === t.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void open(t.id);
                          }}
                        >
                          <ExternalLink size={16} />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {sheet}
    </>
  );
}

// O dia é o de Brasília: o fim do período é gravado como 23:59:59 (-03:00), que em UTC já é o dia
// seguinte. Cortar o texto ISO mostrava um dia a mais no campo (e a cada "Salvar" a data andava).
const toInputDate = (iso: string | null) => (iso ? spDate(iso) : '');
const fromInputDate = (d: string) =>
  d ? new Date(`${d}T23:59:59-03:00`).toISOString() : undefined;

type DetailTab =
  | 'overview'
  | 'subscription'
  | 'profile'
  | 'contract'
  | 'database'
  | 'operation'
  | 'kitchen'
  | 'usage'
  | 'team'
  | 'history';

export function TenantDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: t, error, setData, reload } = useLoad<TenantDetail>(`/platform/tenants/${id}`);
  const team = useLoad<TeamMember[]>(`/platform/tenants/${id}/team`);
  useAutoReload(reload);
  // Enquanto o banco é criado, mudado ou excluído, a tela se atualiza sozinha.
  const busyDb = !!t && dbBusy(t);
  const wasBusy = useRef(false);
  const wasDeleting = useRef(false);
  useEffect(() => {
    if (t) wasDeleting.current = t.status === 'deleting';
    if (!busyDb) {
      if (wasBusy.current) team.reload();
      wasBusy.current = false;
      return;
    }
    wasBusy.current = true;
    const timer = setInterval(reload, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyDb, t?.status]);
  useEffect(() => {
    if (error && wasDeleting.current) {
      toast('Restaurante excluído', 'success');
      navigate('/restaurantes');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  const plans = useLoad<Plan[]>('/platform/plans').data ?? [];
  const { open, busy: opening, sheet } = useOpenTenant();
  // O e-mail "falta a sua assinatura" abre direto na aba Contrato (?aba=contrato&contrato=<id>).
  const [params] = useSearchParams();
  const [tab, setTab] = useState<DetailTab>(
    params.get('aba') === 'contrato'
      ? 'contract'
      : params.get('aba') === 'cozinha'
        ? 'kitchen'
        : 'overview',
  );
  const [sheetKind, setSheetKind] = useState<
    'suspended' | 'provisioned' | 'rename' | 'sessions' | 'cache' | 'delete' | null
  >(null);
  const [member, setMember] = useState<TeamMember | null>(null);
  const [reason, setReason] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // Muda a cada assinatura salva: a parte de Cobrança logo abaixo recarrega junto.
  const [billingRev, setBillingRev] = useState(0);
  const [sub, setSub] = useState<{
    planId: string;
    status: string;
    trialEndsAt: string;
    currentPeriodEnd: string;
    notes: string;
  } | null>(null);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!t) return <Skeleton variant="detail" />;
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
  const address = `${t.slug}.${baseDomain()}`;

  async function run<T>(key: string, fn: () => Promise<T>, ok: string): Promise<T | null> {
    setBusy(key);
    try {
      const r = await fn();
      toast(ok, 'success');
      return r;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return null;
    } finally {
      setBusy(null);
    }
  }
  const runDetail = async (key: string, fn: () => Promise<TenantDetail>, ok: string) => {
    const r = await run(key, fn, ok);
    if (r) setData(r);
    return !!r;
  };

  const saveSub = (e: FormEvent) => {
    e.preventDefault();
    void runDetail(
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
    ).then((ok) => {
      if (!ok) return;
      setSub(null);
      setBillingRev((n) => n + 1);
    });
  };

  const closeSheet = () => {
    setSheetKind(null);
    setReason('');
  };

  return (
    <>
      <Link to="/restaurantes" className="adm-back">
        <ArrowLeft size={14} /> Restaurantes
      </Link>
      <div className="adm-section">
        <PageHead
          lead={<Monogram name={t.name} size={48} src={t.iconUrl} />}
          title={
            <>
              {t.name} <StatusTag status={t.status} />
            </>
          }
          sub={
            <>
              <span>{address}</span>
              <span>fuso {TIMEZONES.find(([v]) => v === t.timezone)?.[1] ?? t.timezone}</span>
              <span>cadastrado em {new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
            </>
          }
          actions={
            <>
              {t.status === 'provisioned' && (
                <button
                  className="adm-action adm-action--primary"
                  disabled={!!opening}
                  onClick={() => open(t.id)}
                >
                  <ExternalLink size={15} /> {opening ? 'Abrindo…' : 'Abrir sistema'}
                </button>
              )}
              <button className="adm-action" onClick={() => navigate(`/conversas?r=${t.id}`)}>
                <MessagesSquare size={15} /> Conversar
              </button>
              {(t.status === 'provisioned' || t.status === 'suspended') && (
                <button className="adm-action" onClick={() => setSheetKind('cache')}>
                  <RefreshCcw size={15} /> Limpar cache
                </button>
              )}
              {t.status === 'provisioned' && (
                <button
                  className="adm-action adm-action--danger"
                  onClick={() => setSheetKind('suspended')}
                >
                  <Pause size={15} /> Suspender
                </button>
              )}
              {t.status === 'suspended' && (
                <button className="adm-action" onClick={() => setSheetKind('provisioned')}>
                  <Play size={15} /> Reativar
                </button>
              )}
              <MoreMenu
                items={[
                  {
                    label: 'Copiar endereço',
                    icon: <Copy size={16} />,
                    onClick: () =>
                      void navigator.clipboard
                        ?.writeText(tenantUrl(t.slug))
                        .then(() => toast('Endereço copiado', 'success')),
                  },
                  {
                    label: 'Renomear',
                    icon: <Pencil size={16} />,
                    onClick: () => {
                      setNewName(t.name);
                      setSheetKind('rename');
                    },
                  },
                  {
                    label: 'Encerrar sessões',
                    icon: <LogOut size={16} />,
                    onClick: () => setSheetKind('sessions'),
                  },
                  {
                    label: 'Excluir restaurante',
                    icon: <Trash2 size={16} />,
                    danger: true,
                    hidden: busyDb || !['provisioned', 'suspended', 'failed'].includes(t.status),
                    onClick: () => setSheetKind('delete'),
                  },
                ]}
              />
            </>
          }
        />
        <DatabaseProgress t={t} />
        {t.status === 'suspended' && (
          <Alert tone="warning">Suspenso: ninguém entra nem opera. Nenhum dado foi apagado.</Alert>
        )}
        {!busyDb && t.provisioning.some((p) => p.status !== 'done') && (
          <Alert tone="danger">
            Cadastro incompleto:{' '}
            {t.provisioning
              .filter((p) => p.status !== 'done')
              .map((p) => `${p.step} (${p.lastError ?? p.status})`)
              .join('; ')}
          </Alert>
        )}
      </div>

      <div className="adm-section">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ['overview', 'Visão geral'],
            ['subscription', 'Assinatura'],
            ['profile', 'Cadastro'],
            ['contract', 'Contrato'],
            ['database', 'Banco de dados'],
            ['operation', 'Operação'],
            ['kitchen', 'Cozinha'],
            ['usage', 'Consumo'],
            ['team', `Equipe (${team.data?.length ?? '…'})`],
            ['history', 'Histórico'],
          ]}
        />

        {tab === 'overview' && <TenantOverview t={t} team={team.data} plans={plans} go={setTab} />}

        {tab === 'subscription' && (
          <div className="adm-panel adm-panel__body">
            <div style={{ marginBottom: 12 }}>
              {s ? (
                <Tag level={SUB_LEVEL[s.status]}>{SUBSCRIPTION_LABELS[s.status]}</Tag>
              ) : (
                <span className="adm-sub" style={{ whiteSpace: 'normal' }}>
                  Sem assinatura: nenhum limite de plano se aplica.
                </span>
              )}
            </div>
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
            <TenantBillingPanel tenantId={t.id} revision={billingRev} onChanged={reload} />
          </div>
        )}

        {tab === 'profile' && <ProfilePanel t={t} onSaved={setData} />}
        {tab === 'contract' && (
          <ContractsPanel t={t} initialOpen={params.get('contrato') ?? undefined} />
        )}
        {tab === 'database' && <DatabasePanel t={t} onChanged={setData} />}
        {tab === 'operation' && <OperationPanel id={t.id} team={team.data} timezone={t.timezone} />}
        {tab === 'kitchen' && <KitchenPanel t={t} />}
        {tab === 'usage' && <ConsumptionPanel id={t.id} />}

        {tab === 'team' && (
          <div className="adm-panel">
            {!team.data ? (
              <div className="adm-panel__body">
                <Skeleton />
              </div>
            ) : team.data.length === 0 ? (
              <div className="adm-empty">Sem equipe</div>
            ) : (
              <div className="adm-rows">
                {team.data.map((m) => (
                  <button key={m.id} className="adm-row" onClick={() => setMember(m)}>
                    <Dot
                      level={
                        m.status !== 'active' || m.disabledAt ? 'off' : isOnline(m) ? 'ok' : 'info'
                      }
                    />
                    <span className="adm-row__main">
                      <span className="adm-row__title">{m.name}</span>
                      <span className="adm-row__meta">
                        {ROLE[m.role] ?? m.role} ·{' '}
                        {isPinOnlyEmail(m.email) ? 'entra com PIN' : m.email}
                        {m.status !== 'active' || m.disabledAt ? ' · sem acesso' : ''}
                      </span>
                    </span>
                    <span className="adm-row__side">
                      {isOnline(m)
                        ? 'online agora'
                        : m.lastSeenAt
                          ? `último acesso ${ago(m.lastSeenAt)}`
                          : 'nunca entrou'}
                      <br />
                      {m.activeSessions === 1
                        ? '1 aparelho conectado'
                        : `${m.activeSessions} aparelhos conectados`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'history' && <TenantHistory tenantId={t.id} plans={plans} />}
      </div>

      {/* Suspender / reativar */}
      <Modal
        open={sheetKind === 'suspended' || sheetKind === 'provisioned'}
        title={sheetKind === 'suspended' ? 'Suspender restaurante' : 'Reativar restaurante'}
        onClose={closeSheet}
        footer={
          <button
            className={`adm-action ${sheetKind === 'suspended' ? 'adm-action--danger' : 'adm-action--primary'}`}
            disabled={reason.trim().length < 3 || busy === 'status'}
            onClick={async () => {
              const ok = await runDetail(
                'status',
                () =>
                  api<TenantDetail>(`/platform/tenants/${t.id}/status`, {
                    method: 'POST',
                    json: { status: sheetKind, reason },
                  }),
                sheetKind === 'suspended' ? 'Restaurante suspenso' : 'Restaurante reativado',
              );
              if (ok) closeSheet();
            }}
          >
            {sheetKind === 'suspended' ? 'Suspender' : 'Reativar'}
          </button>
        }
      >
        <p style={{ marginTop: 0 }}>
          {sheetKind === 'suspended'
            ? 'A equipe perde o acesso na hora (login e operação). Nada é apagado e dá para reativar depois.'
            : 'A equipe volta a entrar e operar normalmente.'}
        </p>
        <TextField
          label="Motivo (fica na auditoria)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>

      <DeleteTenantModal
        t={t}
        open={sheetKind === 'delete'}
        onClose={closeSheet}
        onChanged={setData}
      />

      {/* Renomear */}
      <Modal
        open={sheetKind === 'rename'}
        title="Renomear restaurante"
        onClose={closeSheet}
        footer={
          <button
            className="adm-action adm-action--primary"
            disabled={!newName.trim() || newName.trim() === t.name || busy === 'rename'}
            onClick={async () => {
              const ok = await runDetail(
                'rename',
                () =>
                  api<TenantDetail>(`/platform/tenants/${t.id}/name`, {
                    method: 'PUT',
                    json: { name: newName.trim() },
                  }),
                'Nome alterado',
              );
              if (ok) closeSheet();
            }}
          >
            Salvar
          </button>
        }
      >
        <TextField
          label="Nome"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          hint={`O endereço (${address}) não muda.`}
        />
      </Modal>

      {/* Encerrar todas as sessões */}
      <Modal
        open={sheetKind === 'sessions'}
        title="Encerrar sessões"
        onClose={closeSheet}
        footer={
          <button
            className="adm-action adm-action--danger"
            disabled={busy === 'sessions'}
            onClick={async () => {
              const r = await run(
                'sessions',
                () =>
                  api<{ revoked: number }>(`/platform/tenants/${t.id}/sessions/revoke`, {
                    method: 'POST',
                    json: {},
                  }),
                'Sessões encerradas',
              );
              if (r) {
                closeSheet();
                team.reload();
              }
            }}
          >
            Encerrar todas
          </button>
        }
      >
        <p style={{ marginTop: 0 }}>
          Todo mundo do restaurante precisa entrar de novo (computadores, tablets e celulares). Útil
          se um aparelho foi perdido ou alguém saiu da equipe.
        </p>
      </Modal>

      {/* Limpar o cache do restaurante (API e todas as telas abertas) */}
      <Modal
        open={sheetKind === 'cache'}
        title="Limpar cache do restaurante"
        onClose={closeSheet}
        footer={
          <>
            <Button variant="ghost" onClick={closeSheet}>
              Voltar
            </Button>
            <Button
              loading={busy === 'cache'}
              onClick={async () => {
                const r = await run(
                  'cache',
                  () =>
                    api<{ clearedAt: string; screens: number }>(
                      `/platform/tenants/${t.id}/cache/clear`,
                      { method: 'POST', json: {} },
                    ),
                  'Cache limpo',
                );
                if (r) {
                  closeSheet();
                  toast(
                    r.screens === 1
                      ? '1 tela aberta está recarregando'
                      : r.screens > 1
                        ? `${r.screens} telas abertas estão recarregando`
                        : 'Nenhuma tela aberta agora: cada aparelho limpa ao abrir',
                    'neutral',
                  );
                }
              }}
            >
              Limpar agora
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          Apaga tudo que fica guardado deste restaurante: no servidor e em todas as telas abertas
          (sistema, app instalado, cozinha, garçom, entregador e cardápio online). Cada tela
          recarrega sozinha em seguida, direto do servidor. Aparelho fechado ou sem internet limpa
          quando abrir de novo.
        </p>
        <Alert tone="warning">
          Quem estiver no meio de uma venda perde o que ainda não salvou. Prefira um horário com
          pouco movimento.
        </Alert>
        <p style={{ marginBottom: 0 }}>
          Nada é apagado do banco. Ficam no aparelho as vendas feitas sem internet que ainda não
          subiram, o login e os ajustes de cada aparelho (impressora, setor da cozinha, tema).
        </p>
      </Modal>

      {member && (
        <MemberSheet
          tenantId={t.id}
          member={member}
          canOpen={t.status === 'provisioned'}
          onOpen={() => open(t.id, member.id)}
          onClose={() => setMember(null)}
          onChanged={() => team.reload()}
        />
      )}
      {sheet}
    </>
  );
}

function MemberSheet({
  tenantId,
  member: m,
  canOpen,
  onOpen,
  onClose,
  onChanged,
}: {
  tenantId: string;
  member: TeamMember;
  canOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'idle' | 'password'>('idle');
  const [busy, setBusy] = useState(false);
  const active = m.status === 'active' && !m.disabledAt;
  /** Garçom e entregador entram só com o PIN: não há senha para redefinir. */
  const pinRole = isPinRole(m.role);

  async function call(path: string, json: object, ok: string) {
    setBusy(true);
    try {
      await api(`/platform/tenants/${tenantId}/${path}`, { method: 'POST', json });
      toast(ok, 'success');
      onChanged();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={m.name} onClose={onClose}>
      <dl className="adm-kv">
        <dt>Função</dt>
        <dd>{ROLE[m.role] ?? m.role}</dd>
        <dt>Entra com</dt>
        <dd>{pinRole ? 'PIN' : 'E-mail e senha'}</dd>
        {!isPinOnlyEmail(m.email) && (
          <>
            <dt>E-mail</dt>
            <dd>{m.email}</dd>
          </>
        )}
        <dt>Último acesso</dt>
        <dd>{m.lastSeenAt ? `${dateTime(m.lastSeenAt)} (${ago(m.lastSeenAt)})` : 'nunca'}</dd>
        <dt>Aparelhos conectados</dt>
        <dd>{m.activeSessions}</dd>
        <dt>Situação</dt>
        <dd>{active ? 'ativo' : 'sem acesso'}</dd>
      </dl>
      <div className="adm-actions" style={{ marginTop: 16 }}>
        {canOpen && active && (
          <button className="adm-action adm-action--primary" onClick={onOpen}>
            <ExternalLink size={14} /> Entrar como {m.name.split(' ')[0]}
          </button>
        )}
        <button
          className="adm-action"
          disabled={busy || !m.activeSessions}
          onClick={() => call('sessions/revoke', { userId: m.id }, 'Sessões encerradas')}
        >
          <LogOut size={14} /> Encerrar sessões
        </button>
        {!pinRole && (
          <button className="adm-action" onClick={() => setMode('password')}>
            <KeyRound size={14} /> Redefinir senha
          </button>
        )}
      </div>
      {pinRole && (
        <p className="cm-hint" style={{ marginTop: 12 }}>
          {ROLE[m.role]} entra só com o PIN, sem senha. O restaurante cria ou troca o PIN em Equipe.
        </p>
      )}
      {mode === 'password' && (
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          <TextField
            label="Nova senha"
            type="text"
            autoComplete="off"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            hint="Mínimo 10 caracteres. Passe para a pessoa por um canal seguro."
          />
          {m.otherTenants > 0 && (
            <Alert tone="warning">
              Esta conta também entra em {m.otherTenants} outro(s) restaurante(s): a senha nova vale
              para todos.
            </Alert>
          )}
          <button
            className="adm-action adm-action--danger"
            disabled={pw.length < 10 || busy}
            onClick={() =>
              call(
                'password',
                { userId: m.id, password: pw },
                'Senha redefinida, sessões encerradas',
              )
            }
          >
            Salvar nova senha
          </button>
        </div>
      )}
    </Modal>
  );
}
