import { FormEvent, useEffect, useMemo, useState } from 'react';
import { KeyInUse } from './credentials/KeyInUse';
import { Gift, KeyRound, MinusCircle, RefreshCw } from 'lucide-react';
import { Alert, Button, Card, LivePanda, Spinner, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import { ago, Dot, Level, levelFor, PageHead, Section, Sparkline, Tabs, Tag, Tile } from './ui';

export interface ModelInfo {
  id: string;
  name: string;
  promptPerM: number;
  completionPerM: number;
  context: number | null;
}

export interface Account {
  totalUsd: number | null;
  usedUsd: number | null;
  remainingUsd: number | null;
  keyLabel: string | null;
  keyLimitUsd: number | null;
  keyDayUsd: number | null;
  keyMonthUsd: number | null;
  keyTotalUsd: number | null;
  error: string | null;
}

export interface TenantUse {
  id: string;
  name: string;
  slug: string;
  status: string;
  enabled: boolean;
  override: number | null;
  limit: number;
  /** Tokens extras que sobram (doados pelo Super Admin; não vencem). */
  bonus: number;
  bonusUsed: number;
  granted: number;
  /** Limite que sobra no mês + extras; null = sem limite. */
  available: number | null;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  calls: number;
  users: number;
  percent: number | null;
  lastAt: string | null;
  totalTokens: number;
}

export type KeyKind = 'owner' | 'clients';

/** Saldo do topo: créditos da conta (chave de gerenciamento) ou o que sobra no limite da chave. */
export interface Balance {
  totalUsd: number | null;
  usedUsd: number | null;
  remainingUsd: number | null;
  from: 'conta' | 'clients' | 'owner' | null;
  error: string | null;
}

export interface UsageEntry {
  id: string;
  key: KeyKind;
  /** Chave que pagou: owner, clients, site ou typed (digitada no teste). */
  via: string;
  source: string;
  sourceLabel: string;
  tenantId: string | null;
  tenantName: string | null;
  ref: string | null;
  model: string;
  tokens: number;
  bonus: number;
  costUsd: number;
  at: string;
}

export interface Grant {
  id: string;
  tenantId?: string;
  tenantName?: string;
  delta: number;
  balanceAfter: number;
  note: string | null;
  adminName: string | null;
  at: string;
}

export interface AiOverview {
  settings: {
    enabled: boolean;
    hasApiKey: boolean;
    keyReadable: boolean;
    hasOwnerKey: boolean;
    ownerKeyReadable: boolean;
    hasAdminKey: boolean;
    adminKeyReadable: boolean;
    keyConfigured: boolean;
    model: string;
    modelPrice: ModelInfo | null;
    assistantName: string;
    defaultMonthlyTokens: number;
    lowBalanceUsd: number;
    updatedAt: string;
  };
  account: Account | null;
  ownerAccount: Account | null;
  balance: Balance;
  systemKey: KeyKind | null;
  month: { tokens: number; costUsd: number; calls: number };
  system: {
    tokens: number;
    costUsd: number;
    calls: number;
    byKey: { owner: number; clients: number; site: number };
    bySource: { source: string; label: string; tokens: number; costUsd: number; calls: number }[];
  };
  days: { day: string; tokens: number; costUsd: number; system: number }[];
  tenants: TenantUse[];
  log: UsageEntry[];
  grants: Grant[];
}

const int = (n: number) => new Intl.NumberFormat('pt-BR').format(Math.round(n));
const usd = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined
    ? '—'
    : `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })}`;
/** 1.234.567 → "1,2 mi"; 12.300 → "12,3 mil". */
const compact = (n: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const perM = (m: ModelInfo) =>
  m.promptPerM === 0 && m.completionPerM === 0
    ? 'grátis'
    : `US$ ${m.promptPerM.toFixed(2)} entrada · US$ ${m.completionPerM.toFixed(2)} saída por 1 mi`;

/**
 * Tokens: saldo e uso das duas chaves do OpenRouter (a sua e a dos restaurantes), limite do mês
 * por restaurante, tokens extras que só o Super Admin doa ou retira e o extrato de uso. As chaves
 * em si se cadastram em Super Admin › Credenciais.
 */
export function AiPage() {
  const [fresh, setFresh] = useState(0);
  const data = useLoad<AiOverview>(`/platform/ai${fresh ? `?fresh=${fresh}` : ''}`);
  const o = data.data;
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (!o) return <Spinner />;
  return (
    <>
      <PageHead
        page
        title="Tokens de IA"
        sub={
          <span>
            {o.settings.enabled
              ? `${o.settings.assistantName} · ${o.settings.model}`
              : 'Assistente desligado'}
          </span>
        }
      />
      <StatusSection o={o} onRefresh={() => setFresh(Date.now())} />
      <KeysSection o={o} />
      <TenantsSection o={o} onChanged={data.reload} />
      <UsageSection o={o} />
      <SettingsSection o={o} onSaved={(n) => data.setData(n)} />
    </>
  );
}

function StatusSection({ o, onRefresh }: { o: AiOverview; onRefresh(): void }) {
  const a = o.account;
  const b = o.balance;
  const s = o.settings;
  const low = b.remainingUsd != null && b.remainingUsd <= s.lowBalanceUsd;
  const balancePct =
    b.remainingUsd != null && b.totalUsd ? (b.remainingUsd / b.totalUsd) * 100 : null;
  // Passou do limite e sem extras: parou de responder. Com extras, segue gastando deles.
  const overLimit = o.tenants.filter((t) => t.enabled && t.available === 0);
  const onBonus = o.tenants.filter(
    (t) => t.enabled && t.percent !== null && t.percent >= 100 && (t.available ?? 0) > 0,
  );
  const nearLimit = o.tenants.filter(
    (t) => t.percent !== null && t.percent >= 80 && t.percent < 100,
  );
  return (
    <Section
      title="Saldo e uso"
      actions={
        <Button variant="ghost" size="sm" onClick={onRefresh} icon={<RefreshCw size={14} />}>
          Atualizar saldo
        </Button>
      }
    >
      <div className="adm-ai-hero">
        <LivePanda size={64} mood={!s.enabled ? 'sleep' : low ? 'sad' : 'happy'} />
        <div>
          <strong>
            {!s.hasApiKey
              ? 'Coloque a chave do OpenRouter para ligar o assistente'
              : !s.enabled
                ? 'Assistente desligado para todos os restaurantes'
                : `${s.assistantName} está ajudando as equipes`}
          </strong>
          <span className="adm-sub">
            {s.modelPrice ? perM(s.modelPrice) : 'Preço do modelo aparece ao carregar a lista'}
          </span>
        </div>
      </div>
      {!s.keyConfigured && (
        <Alert tone="danger">
          A API está sem INTEGRATIONS_KEY: não dá para guardar a chave do OpenRouter com segurança.
        </Alert>
      )}
      {s.hasApiKey && !s.keyReadable && s.keyConfigured && (
        <Alert tone="danger">
          A chave salva não abre com a INTEGRATIONS_KEY atual. Cole a chave de novo em Credenciais.
        </Alert>
      )}
      {low && (
        <Alert tone="warning">
          {b.from === 'conta'
            ? `Saldo do OpenRouter baixo: ${usd(b.remainingUsd)}. Coloque créditos em openrouter.ai para o assistente não parar.`
            : `Sobra pouco no limite da chave: ${usd(b.remainingUsd)}. Aumente o limite da chave em openrouter.ai para o assistente não parar.`}
        </Alert>
      )}
      {a?.error && s.hasApiKey && <Alert tone="warning">{a.error}</Alert>}
      {b.error && <Alert tone="warning">{b.error}</Alert>}
      {onBonus.length > 0 && (
        <Alert tone="info">
          {onBonus.map((t) => t.name).join(', ')} já {onBonus.length > 1 ? 'passaram' : 'passou'} do
          limite e {onBonus.length > 1 ? 'estão' : 'está'} usando os tokens extras.
        </Alert>
      )}
      {(overLimit.length > 0 || nearLimit.length > 0) && (
        <Alert tone={overLimit.length ? 'danger' : 'warning'}>
          {overLimit.length > 0 &&
            `${overLimit.map((t) => t.name).join(', ')} ${overLimit.length > 1 ? 'chegaram' : 'chegou'} ao limite do mês e não ${overLimit.length > 1 ? 'têm' : 'tem'} tokens extras. `}
          {nearLimit.length > 0 &&
            `${nearLimit.map((t) => t.name).join(', ')} já ${nearLimit.length > 1 ? 'passaram' : 'passou'} de 80%.`}
        </Alert>
      )}
      <div className="adm-grid">
        <Tile
          label={b.from === 'conta' || !b.from ? 'Saldo no OpenRouter' : 'Sobra no limite da chave'}
          value={usd(b.remainingUsd)}
          level={b.remainingUsd == null ? 'off' : low ? 'bad' : 'ok'}
          sub={
            b.from === 'conta'
              ? `de ${usd(b.totalUsd)} em créditos`
              : b.from
                ? `limite de ${usd(b.totalUsd)} na ${b.from === 'owner' ? 'sua chave' : 'chave dos restaurantes'}`
                : s.hasAdminKey
                  ? 'sem resposta do OpenRouter'
                  : 'cadastre a chave de gerenciamento em Credenciais'
          }
          meter={balancePct}
        />
        <Tile
          label="Gasto dos restaurantes"
          value={usd(o.month.costUsd, 2)}
          sub={`${compact(o.month.tokens)} tokens · ${int(o.month.calls)} pergunta(s) este mês`}
        />
        <Tile
          label="Seu uso (sistema)"
          value={usd(o.system.costUsd, 2)}
          sub={`${compact(o.system.tokens)} tokens · ${int(o.system.calls)} chamada(s) este mês`}
        />
        <Tile
          label="Tokens extras doados"
          value={compact(o.tenants.reduce((n, t) => n + t.bonus, 0))}
          sub={`sobrando em ${o.tenants.filter((t) => t.bonus > 0).length} restaurante(s)`}
        />
      </div>
      <div className="adm-panel adm-ai-chart">
        <div className="adm-row__meta">
          Tokens por dia (restaurantes + sistema) · últimos 30 dias
        </div>
        <Sparkline
          values={o.days.map((d) => d.tokens + d.system)}
          color="var(--a-accent)"
          label="Tokens por dia nos últimos 30 dias"
        />
        <div className="adm-ai-chart__axis">
          <span>{o.days[0]?.day.slice(5).split('-').reverse().join('/')}</span>
          <span>hoje</span>
        </div>
      </div>
    </Section>
  );
}

/** Vermelho só quando parou (sem limite e sem extras); usando extras fica amarelo. */
function tenantLevel(t: TenantUse): Level {
  if (t.available === 0) return 'bad';
  if (t.percent !== null && t.percent >= 100) return 'warn';
  return levelFor(t.percent, 80, 100);
}

function TenantsSection({ o, onChanged }: { o: AiOverview; onChanged(): void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const list = term
    ? o.tenants.filter((t) => t.name.toLowerCase().includes(term) || t.slug.includes(term))
    : o.tenants;
  return (
    <Section
      title="Consumo por restaurante"
      sub={`limite padrão ${o.settings.defaultMonthlyTokens ? `${compact(o.settings.defaultMonthlyTokens)} tokens/mês` : 'sem limite'}`}
    >
      {o.tenants.length > 6 && (
        <TextField
          label="Buscar restaurante"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          wrapClass="adm-ai-search"
        />
      )}
      <div className="adm-panel">
        <div className="adm-rows">
          {list.map((t) =>
            editing === t.id ? (
              <TenantEditor
                key={t.id}
                t={t}
                defaultLimit={o.settings.defaultMonthlyTokens}
                onClose={(changed) => {
                  setEditing(null);
                  if (changed) onChanged();
                }}
              />
            ) : (
              <button
                key={t.id}
                type="button"
                className="adm-row adm-row--bar adm-ai-row"
                onClick={() => setEditing(t.id)}
                title="Ajustar limite e doar tokens"
              >
                <Dot level={!t.enabled ? 'off' : tenantLevel(t)} />
                <span className="adm-row__main">
                  <span className="adm-row__title">
                    {t.name}
                    {!t.enabled && <small className="adm-ai-off"> · IA desligada</small>}
                    {t.override !== null && t.enabled && (
                      <small className="adm-ai-off"> · limite próprio</small>
                    )}
                  </span>
                  <span className="adm-bar" aria-hidden>
                    <i
                      style={{
                        width: `${t.limit > 0 ? Math.min(Math.max(t.percent ?? 0, t.tokens ? 1.5 : 0), 100) : t.tokens ? 100 : 0}%`,
                      }}
                      data-level={tenantLevel(t)}
                    />
                  </span>
                  <span className="adm-row__meta">
                    {compact(t.tokens)} de {t.limit > 0 ? compact(t.limit) : '∞'} tokens
                    {t.percent !== null ? ` (${t.percent.toLocaleString('pt-BR')}%)` : ''}
                    {t.bonus > 0 ? ` · +${compact(t.bonus)} extras` : ''} · {t.users} pessoa(s) ·{' '}
                    {t.calls} pergunta(s)
                  </span>
                </span>
                <span className="adm-row__side">
                  {usd(t.costUsd, 4)}
                  <br />
                  <small>{t.lastAt ? `usou ${ago(t.lastAt)}` : 'nunca usou'}</small>
                </span>
              </button>
            ),
          )}
          {list.length === 0 && <div className="adm-empty">Nenhum restaurante.</div>}
        </div>
      </div>
    </Section>
  );
}

function TenantEditor({
  t,
  defaultLimit,
  onClose,
}: {
  t: TenantUse;
  defaultLimit: number;
  onClose(changed: boolean): void;
}) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(t.enabled);
  const [mode, setMode] = useState<'default' | 'custom' | 'none'>(
    t.override === null ? 'default' : t.override === 0 ? 'none' : 'custom',
  );
  const [value, setValue] = useState(
    String(t.override && t.override > 0 ? t.override : defaultLimit),
  );
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/platform/ai/tenants/${t.id}`, {
        method: 'PUT',
        json: {
          enabled,
          monthlyTokens: mode === 'default' ? null : mode === 'none' ? 0 : Number(value || 0),
        },
      });
      toast(`IA de ${t.name} atualizada`, 'success');
      onClose(true);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="adm-row adm-ai-edit">
      <form className="adm-row__main" onSubmit={save}>
        <span className="adm-row__main">
          <span className="adm-row__title">{t.name}</span>
          <label className="adm-ai-inline">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Assistente ligado neste restaurante
          </label>
          <div className="adm-ai-modes" role="radiogroup" aria-label="Limite do mês">
            {(
              [
                ['default', `Padrão (${defaultLimit ? compact(defaultLimit) : 'sem limite'})`],
                ['custom', 'Limite próprio'],
                ['none', 'Sem limite'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={`adm-ai-mode ${mode === k ? 'is-on' : ''}`}>
                <input
                  type="radio"
                  name={`mode-${t.id}`}
                  checked={mode === k}
                  onChange={() => setMode(k)}
                />
                {label}
              </label>
            ))}
          </div>
          {mode === 'custom' && (
            <TextField
              label="Tokens por mês"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
              hint={value ? `${int(Number(value))} tokens` : undefined}
              autoFocus
            />
          )}
          <div className="adm-form-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => onClose(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={busy}>
              Salvar
            </Button>
          </div>
        </span>
      </form>
      <GrantBox t={t} onDone={() => onClose(true)} />
    </div>
  );
}

const QUICK_GRANTS = [50_000, 100_000, 500_000, 1_000_000];

/** Doar ou retirar tokens extras (não vencem; gastos só depois do limite do mês) + extrato. */
function GrantBox({ t, onDone }: { t: TenantUse; onDone(): void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'add' | 'remove' | null>(null);
  const hist = useLoad<{ usage: UsageEntry[]; grants: Grant[] }>(
    `/platform/ai/tenants/${t.id}/history`,
  );
  async function send(sign: 1 | -1) {
    const n = Number(amount || 0);
    if (!n) return;
    setBusy(sign > 0 ? 'add' : 'remove');
    try {
      const r = await api<{ bonus: number; delta: number }>(`/platform/ai/tenants/${t.id}/tokens`, {
        method: 'POST',
        json: { delta: sign * n, note: note.trim() || undefined },
      });
      toast(
        r.delta > 0
          ? `${int(r.delta)} tokens doados para ${t.name}`
          : `${int(-r.delta)} tokens retirados de ${t.name}`,
        'success',
      );
      onDone();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="adm-ai-grant">
      <div className="adm-ai-grant__head">
        <Gift size={16} aria-hidden />
        <strong>Tokens extras</strong>
        <span className="adm-sub">
          sobram {int(t.bonus)} · só são gastos depois do limite do mês e não vencem
        </span>
      </div>
      <div className="adm-ai-modes" aria-label="Valores rápidos">
        {QUICK_GRANTS.map((n) => (
          <button
            key={n}
            type="button"
            className={`adm-ai-mode ${Number(amount) === n ? 'is-on' : ''}`}
            onClick={() => setAmount(String(n))}
          >
            +{compact(n)}
          </button>
        ))}
      </div>
      <div className="adm-ai-grant__form">
        <TextField
          label="Quantidade de tokens"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
          hint={amount ? `${int(Number(amount))} tokens` : undefined}
        />
        <TextField
          label="Motivo (opcional)"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: cortesia, compra de pacote"
        />
      </div>
      <div className="adm-form-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<MinusCircle size={14} />}
          onClick={() => send(-1)}
          loading={busy === 'remove'}
          disabled={!!busy || !Number(amount) || t.bonus <= 0}
        >
          Retirar
        </Button>
        <Button
          type="button"
          size="sm"
          icon={<Gift size={14} />}
          onClick={() => send(1)}
          loading={busy === 'add'}
          disabled={!!busy || !Number(amount)}
        >
          Doar tokens
        </Button>
      </div>
      {hist.data && hist.data.grants.length > 0 && (
        <ul className="adm-ai-ledger" aria-label="Extrato de tokens extras">
          {hist.data.grants.slice(0, 8).map((g) => (
            <li key={g.id}>
              <Tag level={g.delta > 0 ? 'ok' : 'warn'}>
                {g.delta > 0 ? '+' : '−'}
                {compact(Math.abs(g.delta))}
              </Tag>
              <span>
                {g.note || (g.delta > 0 ? 'Doação' : 'Retirada')}
                <small>
                  {' '}
                  · {g.adminName ?? 'Super Admin'} · {ago(g.at)} · saldo {compact(g.balanceAfter)}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** As duas chaves do OpenRouter: a sua (sistema e esteira) e a dos restaurantes. */
function KeysSection({ o }: { o: AiOverview }) {
  return (
    <Section title="Chaves de API" sub="OpenRouter · gasto de cada chave">
      <div className="adm-ai-keys">
        <KeyCard kind="owner" o={o} />
        <KeyCard kind="clients" o={o} />
      </div>
    </Section>
  );
}

function KeyCard({ kind, o }: { kind: KeyKind; o: AiOverview }) {
  const s = o.settings;
  const owner = kind === 'owner';
  const has = owner ? s.hasOwnerKey : s.hasApiKey;
  const readable = owner ? s.ownerKeyReadable : s.keyReadable;
  const acc = owner ? o.ownerAccount : o.account;
  // Uso no OpenRouter que não passou pelo Comandou (esteira fora do sistema, CI, scripts). O
  // sistema sem a sua chave gasta da dos restaurantes; o OpenRouter conta o mês em UTC.
  const tracked = owner ? o.system.byKey.owner : o.month.costUsd + o.system.byKey.clients;
  const outside = acc?.keyMonthUsd != null ? Math.max(0, acc.keyMonthUsd - tracked) : null;
  const level: Level = !has
    ? owner
      ? 'off'
      : 'bad'
    : !readable
      ? 'bad'
      : acc?.error
        ? 'warn'
        : 'ok';

  return (
    <Card>
      <div className="adm-ai-key">
        <div className="adm-ai-key__head">
          <KeyRound size={18} aria-hidden />
          <div>
            <strong>{owner ? 'Sua chave' : 'Chave dos restaurantes'}</strong>
            <span className="adm-sub">
              {owner
                ? 'Esteira de chamados, testes e o que mais o sistema fizer por você.'
                : 'O assistente do chat e do WhatsApp de cada restaurante gasta desta chave.'}
            </span>
          </div>
          <Tag level={level}>
            {!has
              ? owner
                ? 'usando a dos restaurantes'
                : 'falta a chave'
              : !readable
                ? 'salve de novo'
                : acc?.keyLabel || 'salva'}
          </Tag>
        </div>
        <dl className="adm-ai-key__stats">
          <div>
            <dt title="O OpenRouter conta o dia em UTC (vira às 21h de Brasília)">Hoje (UTC)</dt>
            <dd>{usd(acc?.keyDayUsd)}</dd>
          </div>
          <div>
            <dt>Este mês</dt>
            <dd>{usd(acc?.keyMonthUsd)}</dd>
          </div>
          <div>
            <dt>Desde sempre</dt>
            <dd>{usd(acc?.keyTotalUsd)}</dd>
          </div>
          <div>
            <dt>Limite da chave</dt>
            <dd>{acc?.keyLimitUsd != null ? usd(acc.keyLimitUsd) : 'sem limite'}</dd>
          </div>
        </dl>
        <p className="adm-sub">
          {owner
            ? `Pelo sistema este mês: ${usd(o.system.costUsd)} em ${int(o.system.calls)} chamada(s)${o.system.bySource.length ? ` (${o.system.bySource.map((x) => `${x.label} ${compact(x.tokens)}`).join(', ')})` : ''}.${o.system.byKey.clients > 0 ? ` Desse total, ${usd(o.system.byKey.clients, 4)} saiu da chave dos restaurantes.` : ''}${o.system.byKey.site > 0 ? ` ${usd(o.system.byKey.site, 4)} saiu da antiga chave dos sites.` : ''}`
            : `Pelos restaurantes este mês: ${usd(o.month.costUsd)} em ${int(o.month.calls)} pergunta(s).${o.system.byKey.clients > 0 ? ` O sistema gastou mais ${usd(o.system.byKey.clients, 4)} desta chave.` : ''}`}
          {outside !== null &&
            outside > 0.0001 &&
            ` Fora do Comandou (CI, scripts), aprox.: ${usd(outside)}.`}
        </p>
        {acc?.error && has && <Alert tone="warning">{acc.error}</Alert>}
        <KeyInUse
          ids={owner ? ['openrouter_owner', 'openrouter_clients'] : ['openrouter_clients']}
        />
      </div>
    </Card>
  );
}

/** Com qual chave saiu cada chamada do extrato. */
const VIA: Record<string, string> = {
  owner: 'sua chave',
  clients: 'chave dos restaurantes',
  site: 'antiga chave dos sites',
  typed: 'chave digitada no teste',
};

function UsageSection({ o }: { o: AiOverview }) {
  const [tab, setTab] = useState<'all' | KeyKind | 'grants'>('all');
  const list = tab === 'all' ? o.log : o.log.filter((x) => x.key === tab);
  return (
    <Section title="Extrato de uso" sub="as últimas chamadas e doações">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['all', 'Tudo'],
          ['clients', 'Restaurantes'],
          ['owner', 'Sistema'],
          ['grants', 'Doações'],
        ]}
      />
      <div className="adm-panel">
        <div className="adm-rows">
          {tab === 'grants'
            ? o.grants.map((g) => (
                <div key={g.id} className="adm-row">
                  <Dot level={g.delta > 0 ? 'ok' : 'warn'} />
                  <span className="adm-row__main">
                    <span className="adm-row__title">
                      {g.tenantName} · {g.delta > 0 ? 'doação' : 'retirada'}
                    </span>
                    <span className="adm-row__meta">
                      {g.note || 'sem motivo'} · {g.adminName ?? 'Super Admin'} · saldo{' '}
                      {int(g.balanceAfter)}
                    </span>
                  </span>
                  <span className="adm-row__side">
                    {g.delta > 0 ? '+' : '−'}
                    {int(Math.abs(g.delta))}
                    <br />
                    <small>{ago(g.at)}</small>
                  </span>
                </div>
              ))
            : list.map((x) => (
                <div key={x.id} className="adm-row">
                  <Dot level={x.key === 'owner' ? 'info' : x.bonus > 0 ? 'warn' : 'ok'} />
                  <span className="adm-row__main">
                    <span className="adm-row__title">
                      {x.key === 'owner' ? `Sistema · ${x.sourceLabel}` : x.tenantName}
                      {x.key === 'clients' && (
                        <small className="adm-ai-off"> · {x.sourceLabel}</small>
                      )}
                      {x.ref && <small className="adm-ai-off"> · {x.ref}</small>}
                    </span>
                    <span className="adm-row__meta">
                      {int(x.tokens)} tokens
                      {x.bonus > 0 ? ` (${int(x.bonus)} dos extras)` : ''} · {x.model} ·{' '}
                      {VIA[x.via] ?? 'sua chave'}
                    </span>
                  </span>
                  <span className="adm-row__side">
                    {usd(x.costUsd, 4)}
                    <br />
                    <small>{ago(x.at)}</small>
                  </span>
                </div>
              ))}
          {(tab === 'grants' ? o.grants.length : list.length) === 0 && (
            <div className="adm-empty">Nada por aqui ainda.</div>
          )}
        </div>
      </div>
    </Section>
  );
}

type Form = {
  enabled: boolean;
  apiKey: string;
  model: string;
  assistantName: string;
  defaultMonthlyTokens: string;
  lowBalanceUsd: string;
};

const toForm = (s: AiOverview['settings']): Form => ({
  enabled: s.enabled,
  apiKey: '',
  model: s.model,
  assistantName: s.assistantName,
  defaultMonthlyTokens: String(s.defaultMonthlyTokens),
  lowBalanceUsd: String(s.lowBalanceUsd).replace('.', ','),
});

interface TestResult {
  ok: boolean;
  reply?: string;
  error?: string;
  ms: number;
  usage?: { promptTokens: number; completionTokens: number; costUsd: number };
}

function SettingsSection({ o, onSaved }: { o: AiOverview; onSaved(n: AiOverview): void }) {
  const toast = useToast();
  const s = o.settings;
  const [f, setF] = useState<Form>(() => toForm(s));
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const set = (k: keyof Form) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    api<ModelInfo[]>('/platform/ai/models').then(setModels, () => undefined);
  }, []);
  const picked = useMemo(() => models.find((m) => m.id === f.model.trim()), [models, f.model]);

  const body = () => ({
    enabled: f.enabled,
    apiKey: f.apiKey.trim() || undefined,
    model: f.model.trim(),
    assistantName: f.assistantName.trim(),
    defaultMonthlyTokens: Number(f.defaultMonthlyTokens || 0),
    lowBalanceUsd: Number(f.lowBalanceUsd.replace(',', '.') || 0),
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      const n = await api<AiOverview>('/platform/ai/settings', { method: 'PUT', json: body() });
      onSaved(n);
      setF(toForm(n.settings));
      toast('Configuração da IA salva', 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy('test');
    setError(null);
    setTest(null);
    try {
      const b = body();
      setTest(
        await api<TestResult>('/platform/ai/test', {
          method: 'POST',
          json: { key: 'clients', model: b.model },
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Assistente" sub="modelo, nome e limite padrão (só o super admin muda)">
      <Card>
        <form onSubmit={save}>
          <div className="adm-backup-grid">
            <TextField
              label="Modelo"
              list="adm-ai-models"
              value={f.model}
              onChange={(e) => set('model')(e.target.value)}
              hint={
                picked
                  ? perM(picked)
                  : models.length
                    ? 'Modelo não encontrado na lista do OpenRouter'
                    : 'Ex.: google/gemini-2.5-flash-lite (barato e rápido)'
              }
            />
            <datalist id="adm-ai-models">
              {models.slice(0, 300).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {perM(m)}
                </option>
              ))}
            </datalist>
            <TextField
              label="Nome do assistente"
              value={f.assistantName}
              maxLength={30}
              onChange={(e) => set('assistantName')(e.target.value)}
              hint="Como o panda se apresenta para a equipe"
            />
            <TextField
              label="Limite padrão por restaurante"
              inputMode="numeric"
              value={f.defaultMonthlyTokens}
              onChange={(e) => set('defaultMonthlyTokens')(e.target.value.replace(/\D/g, ''))}
              hint={
                Number(f.defaultMonthlyTokens)
                  ? `${int(Number(f.defaultMonthlyTokens))} tokens por mês${picked ? ` ≈ ${usd((Number(f.defaultMonthlyTokens) / 1e6) * (picked.promptPerM * 0.8 + picked.completionPerM * 0.2), 2)}` : ''}`
                  : '0 = sem limite'
              }
            />
            <TextField
              label="Avisar com saldo abaixo de (US$)"
              inputMode="decimal"
              value={f.lowBalanceUsd}
              onChange={(e) => set('lowBalanceUsd')(e.target.value.replace(/[^\d,.]/g, ''))}
            />
          </div>
          <label className="adm-check" style={{ margin: '16px 0' }}>
            <input
              type="checkbox"
              checked={f.enabled}
              onChange={(e) => set('enabled')(e.target.checked)}
            />
            <span>
              <strong>Assistente ligado</strong>
              <span className="adm-sub">
                Aparece na aba IA do chat da equipe, em todos os restaurantes que não foram
                desligados acima.
              </span>
            </span>
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          {test && (
            <Alert tone={test.ok ? 'info' : 'danger'}>
              {test.ok
                ? `Funcionou em ${(test.ms / 1000).toFixed(1)} s: “${(test.reply ?? '').replace(/[*_#`]/g, '')}”${test.usage ? ` · ${test.usage.promptTokens + test.usage.completionTokens} tokens` : ''}`
                : `Não funcionou: ${test.error}`}
            </Alert>
          )}
          <div className="adm-form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={runTest}
              loading={busy === 'test'}
              disabled={!!busy || !s.hasApiKey || !f.model.trim()}
            >
              Testar
            </Button>
            <Button type="submit" loading={busy === 'save'} disabled={!!busy}>
              Salvar
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}
