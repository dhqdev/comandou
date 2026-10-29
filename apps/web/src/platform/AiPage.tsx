import { FormEvent, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Alert, Button, Card, LivePanda, Spinner, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import { ago, Dot, levelFor, Section, Sparkline, Tile } from './ui';

interface ModelInfo {
  id: string;
  name: string;
  promptPerM: number;
  completionPerM: number;
  context: number | null;
}

interface Account {
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

interface TenantUse {
  id: string;
  name: string;
  slug: string;
  status: string;
  enabled: boolean;
  override: number | null;
  limit: number;
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

interface AiOverview {
  settings: {
    enabled: boolean;
    hasApiKey: boolean;
    keyReadable: boolean;
    keyConfigured: boolean;
    model: string;
    modelPrice: ModelInfo | null;
    assistantName: string;
    defaultMonthlyTokens: number;
    lowBalanceUsd: number;
    updatedAt: string;
  };
  account: Account | null;
  month: { tokens: number; costUsd: number; calls: number };
  days: { day: string; tokens: number; costUsd: number }[];
  tenants: TenantUse[];
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
 * IA (OpenRouter): chave e modelo do assistente, saldo da conta, consumo do mês e quanto cada
 * restaurante gastou, com a barra até o limite e o ajuste do limite por cliente.
 */
export function AiPage() {
  const [fresh, setFresh] = useState(0);
  const data = useLoad<AiOverview>(`/platform/ai${fresh ? `?fresh=${fresh}` : ''}`);
  const o = data.data;
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (!o) return <Spinner />;
  return (
    <>
      <StatusSection o={o} onRefresh={() => setFresh(Date.now())} />
      <TenantsSection o={o} onChanged={data.reload} />
      <SettingsSection o={o} onSaved={(n) => data.setData(n)} />
    </>
  );
}

function StatusSection({ o, onRefresh }: { o: AiOverview; onRefresh(): void }) {
  const a = o.account;
  const s = o.settings;
  const low = a?.remainingUsd != null && a.remainingUsd <= s.lowBalanceUsd;
  const balancePct =
    a?.remainingUsd != null && a.totalUsd ? (a.remainingUsd / a.totalUsd) * 100 : null;
  const overLimit = o.tenants.filter((t) => t.percent !== null && t.percent >= 100);
  const nearLimit = o.tenants.filter(
    (t) => t.percent !== null && t.percent >= 80 && t.percent < 100,
  );
  return (
    <Section
      title="Assistente de IA"
      sub={s.enabled ? `${s.assistantName} · ${s.model}` : 'desligado'}
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
          A chave salva não abre com a INTEGRATIONS_KEY atual. Cole a chave de novo abaixo.
        </Alert>
      )}
      {low && (
        <Alert tone="warning">
          Saldo do OpenRouter baixo: {usd(a?.remainingUsd)}. Coloque créditos em openrouter.ai para
          o assistente não parar.
        </Alert>
      )}
      {a?.error && s.hasApiKey && <Alert tone="warning">{a.error}</Alert>}
      {(overLimit.length > 0 || nearLimit.length > 0) && (
        <Alert tone={overLimit.length ? 'danger' : 'warning'}>
          {overLimit.length > 0 &&
            `${overLimit.map((t) => t.name).join(', ')} ${overLimit.length > 1 ? 'chegaram' : 'chegou'} ao limite do mês. `}
          {nearLimit.length > 0 &&
            `${nearLimit.map((t) => t.name).join(', ')} já ${nearLimit.length > 1 ? 'passaram' : 'passou'} de 80%.`}
        </Alert>
      )}
      <div className="adm-grid">
        <Tile
          label="Saldo no OpenRouter"
          value={usd(a?.remainingUsd)}
          level={a?.remainingUsd == null ? 'off' : low ? 'bad' : 'ok'}
          sub={
            a?.totalUsd != null
              ? `de ${usd(a.totalUsd)} em créditos`
              : a?.keyLimitUsd != null
                ? `limite da chave ${usd(a.keyLimitUsd)}`
                : 'sem dados'
          }
          meter={balancePct}
        />
        <Tile
          label="Gasto este mês"
          value={usd(o.month.costUsd, 2)}
          sub={a?.keyDayUsd != null ? `hoje ${usd(a.keyDayUsd)} na chave` : 'somado das conversas'}
        />
        <Tile
          label="Tokens este mês"
          value={compact(o.month.tokens)}
          sub={`${int(o.month.tokens)} tokens`}
        />
        <Tile
          label="Perguntas este mês"
          value={int(o.month.calls)}
          sub={`${o.tenants.filter((t) => t.calls > 0).length} restaurante(s) usando`}
        />
      </div>
      <div className="adm-panel adm-ai-chart">
        <div className="adm-row__meta">Tokens por dia · últimos 30 dias</div>
        <Sparkline
          values={o.days.map((d) => d.tokens)}
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
                title="Ajustar limite"
              >
                <Dot level={!t.enabled ? 'off' : levelFor(t.percent, 80, 100)} />
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
                      data-level={levelFor(t.percent, 80, 100)}
                    />
                  </span>
                  <span className="adm-row__meta">
                    {compact(t.tokens)} de {t.limit > 0 ? compact(t.limit) : '∞'} tokens
                    {t.percent !== null ? ` (${t.percent.toLocaleString('pt-BR')}%)` : ''} ·{' '}
                    {t.users} pessoa(s) · {t.calls} pergunta(s)
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
    <form className="adm-row adm-ai-edit" onSubmit={save}>
      <span className="adm-row__main">
        <span className="adm-row__title">{t.name}</span>
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
          json: { apiKey: b.apiKey, model: b.model },
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="OpenRouter" sub="chave, modelo e limites (só o super admin vê)">
      <Card>
        <form onSubmit={save}>
          <div className="adm-backup-grid">
            <TextField
              label="Chave da API (OpenRouter)"
              type="password"
              autoComplete="new-password"
              value={f.apiKey}
              placeholder={s.hasApiKey ? '•••••••• (salva)' : 'sk-or-v1-…'}
              onChange={(e) => set('apiKey')(e.target.value.trim())}
              hint={
                s.hasApiKey
                  ? 'Deixe em branco para manter a salva. Fica cifrada; nunca é mostrada.'
                  : 'Crie em openrouter.ai › Keys'
              }
            />
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
                ? `Funcionou em ${(test.ms / 1000).toFixed(1)} s: “${test.reply}”${test.usage ? ` · ${test.usage.promptTokens + test.usage.completionTokens} tokens` : ''}`
                : `Não funcionou: ${test.error}`}
            </Alert>
          )}
          <div className="adm-form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={runTest}
              loading={busy === 'test'}
              disabled={!!busy || (!f.apiKey && !s.hasApiKey) || !f.model.trim()}
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
