import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { KeyInUse } from './credentials/KeyInUse';
import { Bot, Gift, KeyRound, MinusCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { Alert, Button, Card, Segmented, TextField, useToast, Skeleton } from '../design-system';
import { SidePanel } from '../features/SidePanel';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import {
  ago,
  Dot,
  Level,
  levelFor,
  Monogram,
  PageHead,
  Section,
  Sparkline,
  Tabs,
  Tag,
  Tile,
} from './ui';

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
  /** Uso do mês por parte do restaurante (IA do WhatsApp, chat, modelo de impressão...). */
  parts: PartUse[];
}

/** Uma parte do restaurante que gasta IA (a fatia da pizza). */
export interface PartUse {
  key: string;
  label: string;
  tokens: number;
  costUsd: number;
  calls: number;
  /** Parte do total do período, em tokens. */
  percent: number;
  sources?: { source: string; label: string; tokens: number; costUsd: number; calls: number }[];
}

export type AiPeriod = 'month' | 'last' | 'all';

/** Cartão "Modelos em uso": para que serve o modelo, preço e uso do mês por fonte. */
export interface ModelCard {
  model: string;
  name: string;
  roles: { key: string; label: string; detail: string }[];
  price: { promptPerM: number; completionPerM: number; from: 'openrouter' | 'referencia' } | null;
  priceNote: string | null;
  why: string | null;
  month: { tokens: number; costUsd: number; calls: number };
  /** Parte do gasto do mês (0–100). */
  share: number;
  sources: {
    source: string;
    label: string;
    scope: 'tenant' | 'system';
    tokens: number;
    costUsd: number;
    calls: number;
  }[];
}

/** GET /platform/ai/tenants/:id/usage: o detalhe que abre ao tocar no cartão. */
export interface TenantUsage {
  tenantId: string;
  name: string;
  slug: string;
  period: AiPeriod;
  total: { tokens: number; costUsd: number; calls: number; bonusTokens: number };
  parts: PartUse[];
  models: { model: string; tokens: number; costUsd: number; calls: number }[];
  days: { day: string; tokens: number; costUsd: number }[];
  quota: {
    enabled: boolean;
    limit: number;
    override: number | null;
    usedMonth: number;
    bonus: number;
    available: number | null;
    percent: number | null;
    users: number;
    lastAt: string | null;
  };
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
    photoAiEnabled: boolean;
    model3dAiEnabled: boolean;
    visionModel: string;
    imageModel: string;
    importModel: string;
    updatedAt: string;
  };
  /** Um cartão por modelo (configurado ou que gastou no mês). */
  models: ModelCard[];
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
 * Tokens de IA (refeita na 0.265.3, pedido do David: "uma tela mais simples"). Aba Uso: o saldo do
 * OpenRouter, o gasto do mês e um cartão por restaurante; tocar no cartão abre o detalhe com a
 * pizza de quanto cada parte do restaurante gastou (IA do WhatsApp, chat, modelo de impressão,
 * fotos...), o limite e os tokens extras. Aba Chaves e assistente: as chaves do OpenRouter e o
 * modelo. Sem o extrato de chamadas na tela (a API ainda o devolve, para o histórico).
 */
export function AiPage() {
  const [fresh, setFresh] = useState(0);
  const [tab, setTab] = useState<'use' | 'setup'>('use');
  const data = useLoad<AiOverview>(`/platform/ai${fresh ? `?fresh=${fresh}` : ''}`);
  const o = data.data;
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (!o) return <Skeleton variant="page" />;
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
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFresh(Date.now())}
            icon={<RefreshCw size={14} />}
          >
            Atualizar saldo
          </Button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['use', 'Uso dos restaurantes'],
          ['setup', 'Chaves e assistente'],
        ]}
      />
      {tab === 'use' ? (
        <>
          <StatusSection o={o} />
          <TenantsSection o={o} onChanged={data.reload} />
        </>
      ) : (
        <>
          <KeysSection o={o} />
          <ModelsSection o={o} />
          <SettingsSection o={o} onSaved={(n) => data.setData(n)} />
        </>
      )}
    </>
  );
}

function StatusSection({ o }: { o: AiOverview }) {
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
    <Section title="Saldo e gasto do mês">
      {!s.hasApiKey && (
        <Alert tone="info">
          Coloque a chave do OpenRouter em Credenciais para ligar o assistente.
        </Alert>
      )}
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
                ? `limite de ${usd(b.totalUsd)} na ${b.from === 'owner' ? 'chave do sistema' : 'chave dos restaurantes'}`
                : s.hasAdminKey
                  ? 'sem resposta do OpenRouter'
                  : 'cadastre a chave de gerenciamento em Credenciais'
          }
          meter={balancePct}
        />
        <Tile
          label="Gasto dos restaurantes"
          value={usd(o.month.costUsd, 2)}
          sub={`${compact(o.month.tokens)} tokens · ${int(o.month.calls)} uso(s) da IA este mês`}
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const list = term
    ? o.tenants.filter((t) => t.name.toLowerCase().includes(term) || t.slug.includes(term))
    : o.tenants;
  const current = o.tenants.find((t) => t.id === openId) ?? null;
  return (
    <Section
      title="Restaurantes"
      sub={`uso deste mês · limite padrão ${o.settings.defaultMonthlyTokens ? `${compact(o.settings.defaultMonthlyTokens)} tokens/mês` : 'sem limite'} · toque para ver por parte`}
    >
      {o.tenants.length > 6 && (
        <TextField
          label="Pesquisar"
          aria-label="Pesquisar restaurante"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          wrapClass="adm-ai-search"
        />
      )}
      {list.length === 0 ? (
        <div className="adm-panel">
          <div className="adm-empty">Nenhum restaurante.</div>
        </div>
      ) : (
        <div className="adm-ai-cards">
          {list.map((t) => (
            <TenantCard key={t.id} t={t} onOpen={() => setOpenId(t.id)} />
          ))}
        </div>
      )}
      <SidePanel
        open={!!current}
        size="xl"
        title={current?.name ?? 'Restaurante'}
        onClose={() => setOpenId(null)}
        className="adm-ai-panel"
      >
        {current && (
          <TenantDetail
            key={current.id}
            t={current}
            defaultLimit={o.settings.defaultMonthlyTokens}
            onChanged={onChanged}
          />
        )}
      </SidePanel>
    </Section>
  );
}

/** Cartão de um restaurante: uso do mês contra o limite e a faixa das partes. */
function TenantCard({ t, onOpen }: { t: TenantUse; onOpen(): void }) {
  const level = !t.enabled ? 'off' : tenantLevel(t);
  const top = [...t.parts].sort((a, b) => b.tokens - a.tokens)[0];
  return (
    <button type="button" className="adm-ai-card" onClick={onOpen}>
      <span className="adm-ai-card__head">
        <Monogram name={t.name} size={36} />
        <span className="adm-ai-card__name">
          <strong>{t.name}</strong>
          <small>
            <Dot level={level} /> {t.lastAt ? `usou ${ago(t.lastAt)}` : 'nunca usou'}
            {!t.enabled && ' · IA desligada'}
          </small>
        </span>
        <span className="adm-ai-card__cost">
          {usd(t.costUsd, 2)}
          <small>no mês</small>
        </span>
      </span>
      <span className="adm-ai-card__use">
        <span>
          <b>{compact(t.tokens)}</b> de {t.limit > 0 ? compact(t.limit) : '∞'} tokens
          {t.bonus > 0 ? ` · +${compact(t.bonus)} extras` : ''}
        </span>
        {t.percent !== null && <span>{t.percent.toLocaleString('pt-BR')}%</span>}
      </span>
      <span className="adm-bar" aria-hidden>
        <i
          style={{
            width: `${t.limit > 0 ? Math.min(Math.max(t.percent ?? 0, t.tokens ? 1.5 : 0), 100) : t.tokens ? 100 : 0}%`,
          }}
          data-level={tenantLevel(t)}
        />
      </span>
      {t.parts.length > 0 ? (
        <>
          <PartsBar parts={t.parts} />
          <span className="adm-ai-card__top">
            Mais usado: <b>{top!.label}</b> ({top!.percent.toLocaleString('pt-BR')}%)
          </span>
        </>
      ) : (
        <span className="adm-ai-card__top">Sem uso de IA este mês</span>
      )}
    </button>
  );
}

/** Faixa fina com as partes lado a lado (sem texto: o cartão diz a principal). */
function PartsBar({ parts }: { parts: PartUse[] }) {
  const total = parts.reduce((n, p) => n + p.tokens, 0);
  if (total <= 0) return null;
  return (
    <span className="adm-ai-split" aria-hidden>
      {parts
        .filter((p) => p.tokens > 0)
        .map((p) => (
          <i key={p.key} data-part={p.key} style={{ flexGrow: p.tokens }} />
        ))}
    </span>
  );
}

const PERIODS: { value: AiPeriod; label: string }[] = [
  { value: 'month', label: 'Este mês' },
  { value: 'last', label: 'Mês passado' },
  { value: 'all', label: 'Desde sempre' },
];

/**
 * Detalhe de um restaurante (abre ao tocar no cartão): a pizza das partes, a tabela com os
 * números de cada uma (e das fontes dentro dela), os últimos 30 dias, os modelos, o limite do mês
 * e os tokens extras. Os números saem de `ai_usage`, a mesma soma que o limite do mês desconta.
 */
function TenantDetail({
  t,
  defaultLimit,
  onChanged,
}: {
  t: TenantUse;
  defaultLimit: number;
  onChanged(): void;
}) {
  const [period, setPeriod] = useState<AiPeriod>('month');
  const [measure, setMeasure] = useState<'tokens' | 'cost'>('tokens');
  const [stamp, setStamp] = useState(0);
  const d = useLoad<TenantUsage>(
    `/platform/ai/tenants/${t.id}/usage?period=${period}${stamp ? `&v=${stamp}` : ''}`,
  );
  const u = d.data;
  const changed = () => {
    setStamp(Date.now());
    onChanged();
  };
  const q = u?.quota;
  return (
    <div className="adm-ai-detail">
      <div className="adm-ai-detail__bar">
        <Segmented label="Período" value={period} onChange={setPeriod} options={PERIODS} />
        <Segmented
          label="Medir por"
          value={measure}
          onChange={setMeasure}
          options={[
            { value: 'tokens', label: 'Tokens' },
            { value: 'cost', label: 'Custo (US$)' },
          ]}
        />
      </div>
      {d.error && <Alert tone="danger">{d.error}</Alert>}
      {!u ? (
        !d.error && <Skeleton variant="detail" />
      ) : (
        <>
          <dl className="adm-ai-kpis">
            <div>
              <dt>Tokens descontados</dt>
              <dd>{int(u.total.tokens)}</dd>
            </div>
            <div>
              <dt>Custo no OpenRouter</dt>
              <dd>{usd(u.total.costUsd, 4)}</dd>
            </div>
            <div>
              <dt>Usos da IA</dt>
              <dd>{int(u.total.calls)}</dd>
            </div>
            <div>
              <dt>Dos tokens extras</dt>
              <dd>{int(u.total.bonusTokens)}</dd>
            </div>
          </dl>
          {u.parts.length === 0 ? (
            <div className="adm-empty">Nenhum uso de IA neste período.</div>
          ) : (
            <div className="adm-ai-share">
              <AiPie parts={u.parts} measure={measure} />
              <PartsTable parts={u.parts} measure={measure} />
            </div>
          )}
          {q && (
            <div className="adm-ai-limit">
              <div className="adm-ai-limit__head">
                <strong>Limite deste mês</strong>
                <span>
                  {int(q.usedMonth)} de {q.limit > 0 ? `${int(q.limit)} tokens` : 'sem limite'}
                  {q.percent !== null ? ` (${q.percent.toLocaleString('pt-BR')}%)` : ''}
                </span>
              </div>
              {q.limit > 0 && (
                <span className="adm-bar" aria-hidden>
                  <i
                    style={{ width: `${Math.min(q.percent ?? 0, 100)}%` }}
                    data-level={tenantLevel(t)}
                  />
                </span>
              )}
              <span className="adm-sub">
                {q.available === null
                  ? 'Sem limite: tudo o que usar sai da chave dos restaurantes.'
                  : `Sobram ${int(q.available)} tokens${q.bonus > 0 ? ` (${int(q.bonus)} são extras)` : ''}. Toda parte da tabela acima desconta deste mesmo limite.`}
                {` ${q.users} pessoa(s) usaram este mês.`}
              </span>
            </div>
          )}
          <div className="adm-ai-days">
            <div className="adm-row__meta">Tokens por dia · últimos 30 dias</div>
            <Sparkline
              values={u.days.map((x) => x.tokens)}
              color="var(--a-accent)"
              label="Tokens por dia nos últimos 30 dias"
            />
            <div className="adm-ai-chart__axis">
              <span>{u.days[0]?.day.slice(5).split('-').reverse().join('/')}</span>
              <span>hoje</span>
            </div>
          </div>
          {u.models.length > 0 && (
            <div className="adm-ai-models">
              <div className="adm-row__meta">Modelos usados no período</div>
              <ul>
                {u.models.map((m) => (
                  <li key={m.model}>
                    <code>{m.model}</code>
                    <span>
                      {compact(m.tokens)} tokens · {usd(m.costUsd, 4)} · {int(m.calls)} uso(s)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="adm-ai-detail__setup">
        <LimitForm t={t} defaultLimit={defaultLimit} onSaved={changed} />
        <GrantBox t={t} onDone={changed} />
        <ResetUsage t={t} onDone={changed} />
      </div>
    </div>
  );
}

const pieValue = (p: PartUse, m: 'tokens' | 'cost') => (m === 'tokens' ? p.tokens : p.costUsd);

/**
 * Pizza (rosca) das partes, pedida pelo David. Cada parte tem a sua cor fixa (`data-part`, em
 * admin.css), na ordem fixa das partes, com 2px de fundo entre as fatias; o total vai no meio e a
 * tabela ao lado repete nome e número de cada parte (a cor nunca é a única pista).
 */
function AiPie({ parts, measure }: { parts: PartUse[]; measure: 'tokens' | 'cost' }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = parts.reduce((n, p) => n + pieValue(p, measure), 0);
  const r = 70;
  const c = 2 * Math.PI * r;
  const gap = parts.filter((p) => pieValue(p, measure) > 0).length > 1 ? 2 : 0;
  let acc = 0;
  const slices = parts
    .filter((p) => pieValue(p, measure) > 0)
    .map((p) => {
      const len = (pieValue(p, measure) / total) * c;
      const out = { p, len, start: acc };
      acc += len;
      return out;
    });
  const shown = hover ? parts.find((p) => p.key === hover) : null;
  const summary = parts.map((p) => `${p.label} ${p.percent.toLocaleString('pt-BR')}%`).join(', ');
  return (
    <figure className="adm-ai-pie">
      <svg viewBox="0 0 180 180" role="img" aria-label={`Uso por parte: ${summary}`}>
        {total > 0 &&
          slices.map(({ p, len, start }) => (
            <circle
              key={p.key}
              className="adm-ai-pie__slice"
              data-part={p.key}
              data-dim={hover && hover !== p.key ? '' : undefined}
              cx="90"
              cy="90"
              r={r}
              strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`}
              strokeDashoffset={-start}
              onMouseEnter={() => setHover(p.key)}
              onMouseLeave={() => setHover(null)}
            >
              <title>
                {p.label}: {measure === 'tokens' ? `${int(p.tokens)} tokens` : usd(p.costUsd, 4)}
              </title>
            </circle>
          ))}
      </svg>
      <figcaption className="adm-ai-pie__mid" aria-hidden>
        <strong>
          {shown
            ? measure === 'tokens'
              ? compact(shown.tokens)
              : usd(shown.costUsd, 2)
            : measure === 'tokens'
              ? compact(total)
              : usd(total, 2)}
        </strong>
        <small>{shown ? shown.label : measure === 'tokens' ? 'tokens' : 'no total'}</small>
      </figcaption>
    </figure>
  );
}

/** Tabela ao lado da pizza: cada parte com a cor, a %, os tokens, o custo e as fontes dela. */
function PartsTable({ parts, measure }: { parts: PartUse[]; measure: 'tokens' | 'cost' }) {
  const total = parts.reduce((n, p) => n + pieValue(p, measure), 0);
  const pct = (v: number) =>
    total > 0 ? `${(Math.round((v / total) * 1000) / 10).toLocaleString('pt-BR')}%` : '0%';
  return (
    <table className="adm-ai-parts">
      <thead>
        <tr>
          <th>Parte</th>
          <th>%</th>
          <th>Tokens</th>
          <th>Custo</th>
          <th>Usos</th>
        </tr>
      </thead>
      <tbody>
        {parts.map((p) => (
          <PartRows key={p.key} p={p} pct={pct(pieValue(p, measure))} />
        ))}
      </tbody>
    </table>
  );
}

function PartRows({ p, pct }: { p: PartUse; pct: string }) {
  const many = (p.sources?.length ?? 0) > 1;
  return (
    <>
      <tr className="adm-ai-parts__part">
        <th scope="row">
          <i className="adm-ai-swatch" data-part={p.key} aria-hidden /> {p.label}
        </th>
        <td>{pct}</td>
        <td>{int(p.tokens)}</td>
        <td>{usd(p.costUsd, 4)}</td>
        <td>{int(p.calls)}</td>
      </tr>
      {many &&
        p.sources!.map((x) => (
          <tr key={x.source} className="adm-ai-parts__src">
            <th scope="row">{x.label}</th>
            <td />
            <td>{int(x.tokens)}</td>
            <td>{usd(x.costUsd, 4)}</td>
            <td>{int(x.calls)}</td>
          </tr>
        ))}
    </>
  );
}

/** Limite do mês do restaurante e o interruptor da IA dele. */
function LimitForm({
  t,
  defaultLimit,
  onSaved,
}: {
  t: TenantUse;
  defaultLimit: number;
  onSaved(): void;
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
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="adm-ai-limitform" onSubmit={save}>
      <strong>Limite do mês</strong>
      <label className="adm-ai-inline">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
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
        />
      )}
      <div className="adm-form-actions">
        <Button type="submit" size="sm" variant="secondary" loading={busy}>
          Salvar limite
        </Button>
      </div>
    </form>
  );
}

const QUICK_GRANTS = [50_000, 100_000, 500_000, 1_000_000];

/**
 * Zerar o uso de IA do restaurante (ex.: trocou a chave e quer testar do zero). Apaga o uso de
 * todos os períodos; pede a confirmação na própria caixa. Fica no histórico do restaurante.
 */
function ResetUsage({ t, onDone }: { t: TenantUse; onDone(): void }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  async function reset() {
    setBusy(true);
    try {
      const r = await api<{ tokens: number; calls: number }>(
        `/platform/ai/tenants/${t.id}/usage/reset`,
        { method: 'POST' },
      );
      toast(
        r.calls
          ? `Uso de IA de ${t.name} zerado (${int(r.tokens)} tokens apagados)`
          : `${t.name} já estava sem uso de IA`,
        'success',
      );
      setAsking(false);
      onDone();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="adm-ai-grant">
      <div className="adm-ai-grant__head">
        <RotateCcw size={16} aria-hidden />
        <strong>Zerar uso</strong>
        <span className="adm-sub">
          apaga o uso de IA de todos os períodos; o limite do mês volta a contar do zero
        </span>
      </div>
      {asking ? (
        <>
          <Alert tone="warning">
            Apagar todo o uso de IA de {t.name}? Isso não pode ser desfeito. Os tokens extras já
            gastos não voltam.
          </Alert>
          <div className="adm-form-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAsking(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              icon={<RotateCcw size={14} />}
              onClick={reset}
              loading={busy}
            >
              Sim, zerar
            </Button>
          </div>
        </>
      ) : (
        <div className="adm-form-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={14} />}
            onClick={() => setAsking(true)}
          >
            Zerar uso
          </Button>
        </div>
      )}
    </div>
  );
}

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

/** As duas chaves do OpenRouter: a do sistema (esteira e testes) e a dos restaurantes. */
function KeysSection({ o }: { o: AiOverview }) {
  return (
    <Section
      title="Chaves de API"
      sub="OpenRouter · cada chave se cadastra em Credenciais e mostra o próprio gasto aqui"
    >
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
  // sistema sem a chave dele gasta da dos restaurantes; o OpenRouter conta o mês em UTC.
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
            <strong>{owner ? 'Chave do sistema' : 'Chave dos restaurantes'}</strong>
            <span className="adm-sub">
              {owner
                ? 'Só do Comandou, separada da dos restaurantes: a esteira de chamados e os testes do painel gastam desta chave.'
                : 'Só dos restaurantes: chat e WhatsApp, fotos e 3D, importar cardápio e os sites com IA.'}
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
        {owner && (!has || !readable) && (
          <Alert tone="warning">
            {!has
              ? 'A chave do sistema não está cadastrada, então a esteira está gastando da chave dos restaurantes. '
              : 'A chave do sistema não abre com a chave mestra do servidor. '}
            <Link to="/credenciais#cred-openrouter_owner" className="adm-ai-key__go">
              {has ? 'Colar de novo' : 'Cadastrar a chave do sistema'} em Credenciais
            </Link>
          </Alert>
        )}
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

/** Preço do cartão do modelo: por 1 milhão de tokens ou por imagem. */
function modelPrice(m: ModelCard): string {
  if (m.price)
    return m.price.promptPerM === 0 && m.price.completionPerM === 0
      ? 'grátis'
      : `US$ ${m.price.promptPerM.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} entrada · US$ ${m.price.completionPerM.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} saída por 1 mi de tokens${m.price.from === 'referencia' ? ' (referência)' : ''}`;
  return m.priceNote ?? 'preço não informado pelo OpenRouter';
}

/**
 * Um cartão por modelo (pedido do David, 0.269): para que serve cada um no Comandou, quanto
 * custa, quanto foi usado no mês e em que partes, separando restaurantes e o próprio sistema.
 */
function ModelsSection({ o }: { o: AiOverview }) {
  if (!o.models?.length) return null;
  return (
    <Section title="Modelos em uso" sub="para que serve cada modelo e quanto foi usado neste mês">
      <div className="adm-ai-models">
        {o.models.map((m) => (
          <ModelCardView key={m.model} m={m} />
        ))}
      </div>
    </Section>
  );
}

function ModelCardView({ m }: { m: ModelCard }) {
  const max = Math.max(1, ...m.sources.map((x) => (m.month.costUsd > 0 ? x.costUsd : x.tokens)));
  return (
    <Card>
      <div className="adm-ai-model">
        <div className="adm-ai-model__head">
          <Bot size={18} aria-hidden />
          <div>
            <strong>{m.name}</strong>
            <code className="adm-ai-model__id cm-selectable">{m.model}</code>
          </div>
          <Tag level={m.month.calls ? 'ok' : 'off'}>
            {m.month.calls ? `${String(m.share).replace('.', ',')}% do mês` : 'sem uso no mês'}
          </Tag>
        </div>
        {m.roles.length ? (
          <ul className="adm-ai-model__roles">
            {m.roles.map((r) => (
              <li key={r.key}>
                <strong>{r.label}</strong>
                <span className="adm-sub">{r.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="adm-sub">Não está configurado agora: usado antes neste mês.</p>
        )}
        <p className="adm-sub">
          {modelPrice(m)}
          {m.why ? `. ${m.why}` : ''}
        </p>
        <dl className="adm-ai-key__stats">
          <div>
            <dt>Gasto no mês</dt>
            <dd>{usd(m.month.costUsd)}</dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd>{compact(m.month.tokens)}</dd>
          </div>
          <div>
            <dt>Chamadas</dt>
            <dd>{int(m.month.calls)}</dd>
          </div>
        </dl>
        {m.sources.length > 0 && (
          <ul className="adm-ai-model__uses" aria-label={`Onde o ${m.name} foi usado`}>
            {m.sources.map((x) => (
              <li key={`${x.scope}-${x.source}`}>
                <span className="adm-ai-model__use">
                  <span>{x.label}</span>
                  <small>{x.scope === 'tenant' ? 'restaurantes' : 'sistema'}</small>
                </span>
                <span className="adm-ai-model__bar" aria-hidden>
                  <span
                    style={{
                      width: `${Math.max(3, ((m.month.costUsd > 0 ? x.costUsd : x.tokens) / max) * 100)}%`,
                    }}
                  />
                </span>
                <span className="adm-ai-model__num">
                  {m.month.costUsd > 0 ? usd(x.costUsd, 2) : `${compact(x.tokens)} tokens`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

type Form = {
  enabled: boolean;
  apiKey: string;
  model: string;
  assistantName: string;
  defaultMonthlyTokens: string;
  lowBalanceUsd: string;
  photoAiEnabled: boolean;
  model3dAiEnabled: boolean;
  visionModel: string;
  imageModel: string;
  importModel: string;
};

const toForm = (s: AiOverview['settings']): Form => ({
  enabled: s.enabled,
  apiKey: '',
  model: s.model,
  assistantName: s.assistantName,
  defaultMonthlyTokens: String(s.defaultMonthlyTokens),
  lowBalanceUsd: String(s.lowBalanceUsd).replace('.', ','),
  photoAiEnabled: s.photoAiEnabled,
  model3dAiEnabled: s.model3dAiEnabled,
  visionModel: s.visionModel,
  imageModel: s.imageModel,
  importModel: s.importModel,
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
  const vision = useMemo(
    () => models.find((m) => m.id === f.visionModel.trim()),
    [models, f.visionModel],
  );
  const importer = useMemo(
    () => models.find((m) => m.id === f.importModel.trim()),
    [models, f.importModel],
  );

  const body = () => ({
    enabled: f.enabled,
    apiKey: f.apiKey.trim() || undefined,
    model: f.model.trim(),
    assistantName: f.assistantName.trim(),
    defaultMonthlyTokens: Number(f.defaultMonthlyTokens || 0),
    lowBalanceUsd: Number(f.lowBalanceUsd.replace(',', '.') || 0),
    photoAiEnabled: f.photoAiEnabled,
    model3dAiEnabled: f.model3dAiEnabled,
    visionModel: f.visionModel.trim(),
    imageModel: f.imageModel.trim(),
    importModel: f.importModel.trim(),
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
    <Section title="Assistente" sub="modelos, nome e limite padrão (só o super admin muda)">
      <Card>
        <form onSubmit={save}>
          <div className="adm-backup-grid">
            <TextField
              label="Modelo da conversa"
              list="adm-ai-models"
              value={f.model}
              onChange={(e) => set('model')(e.target.value)}
              hint={
                picked
                  ? `${perM(picked)}. Chat, WhatsApp, impressão e página; se falhar, responde o google/gemini-2.5-flash-lite`
                  : models.length
                    ? 'Modelo não encontrado na lista do OpenRouter'
                    : 'Padrão: deepseek/deepseek-v4-flash (o mais barato que conversa bem)'
              }
            />
            <TextField
              label="Modelo que lê o cardápio"
              list="adm-ai-models"
              value={f.importModel}
              onChange={(e) => set('importModel')(e.target.value)}
              hint={
                importer
                  ? `${perM(importer)}. Importar cardápio (PDF, foto, link) e achar o restaurante no Google`
                  : 'Padrão: google/gemini-2.5-flash (lê PDF e foto com precisão; uma vez por restaurante)'
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
          <fieldset className="adm-ai-menu">
            <legend>Fotos e 3D do cardápio</legend>
            <p className="adm-sub">
              Nos itens do cardápio: “Melhorar a foto” (a IA olha e sugere um retoque leve, ou refaz
              só o fundo) e “Fazer o 3D pela foto” (a IA lê a forma do prato e o Comandou monta o
              modelo). Desconta dos tokens de cada restaurante, como o resto da IA. Os textos que
              guiam a IA ficam em apps/api/assets/ai.
            </p>
            <label className="adm-check">
              <input
                type="checkbox"
                checked={f.photoAiEnabled}
                onChange={(e) => set('photoAiEnabled')(e.target.checked)}
              />
              <span>
                <strong>Melhorar a foto com IA</strong>
              </span>
            </label>
            <label className="adm-check">
              <input
                type="checkbox"
                checked={f.model3dAiEnabled}
                onChange={(e) => set('model3dAiEnabled')(e.target.checked)}
              />
              <span>
                <strong>3D pela foto com IA</strong>
                <span className="adm-sub">
                  Desligado, o restaurante ainda monta o 3D escolhendo a forma do prato (sem IA).
                </span>
              </span>
            </label>
            <div className="adm-backup-grid">
              <TextField
                label="Modelo que olha a foto"
                list="adm-ai-models"
                value={f.visionModel}
                onChange={(e) => set('visionModel')(e.target.value)}
                hint={
                  vision
                    ? perM(vision)
                    : 'O mais barato que lê imagem (ex.: google/gemini-2.5-flash-lite)'
                }
              />
              <TextField
                label="Modelo que refaz o fundo"
                value={f.imageModel}
                onChange={(e) => set('imageModel')(e.target.value)}
                hint="API de imagens do OpenRouter (ex.: openai/gpt-image-2, ~US$ 0,014 por foto)"
              />
            </div>
          </fieldset>
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
