import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Segmented, Skeleton } from '../design-system';
import { AgentAvatar } from '../features/tickets/TicketParts';
import { Columns, Ranking } from './charts';
import { useLoad } from './OverviewPages';
import { ago, Tile } from './ui';

type Period = 'month' | 'last' | 'all';

/** GET /platform/tickets/ai-usage: o que a esteira gastou de IA (separado dos restaurantes). */
export interface PipelineAiUsage {
  period: Period;
  aiKey: 'owner' | 'clients' | null;
  hasOwnerKey: boolean;
  model: string;
  total: { tokens: number; costUsd: number; calls: number; tickets: number; perTicketUsd: number };
  days: { day: string; tokens: number; costUsd: number; calls: number }[];
  models: { model: string; tokens: number; costUsd: number; calls: number }[];
  steps: {
    id: string;
    label: string;
    agent: string;
    tokens: number;
    costUsd: number;
    calls: number;
  }[];
  tickets: {
    ref: string | null;
    id: string | null;
    number: number | null;
    title: string | null;
    stage: string | null;
    stageLabel: string | null;
    tokens: number;
    costUsd: number;
    calls: number;
    lastAt: string;
  }[];
  keys: { key: string; tokens: number; costUsd: number; calls: number }[];
  recent: {
    id: string;
    ref: string | null;
    step: string | null;
    stepLabel: string | null;
    agent: string | null;
    model: string;
    key: string;
    tokens: number;
    costUsd: number;
    at: string;
  }[];
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'month', label: 'Este mês' },
  { value: 'last', label: 'Mês passado' },
  { value: 'all', label: 'Desde o início' },
];

const usd = (n: number, digits = 2) =>
  `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })}`;
const compact = (n: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const KEY_NAME: Record<string, string> = {
  owner: 'chave do sistema',
  clients: 'chave dos restaurantes',
  typed: 'chave digitada no teste',
  site: 'antiga chave dos sites',
};

/**
 * Chamados › Uso de IA (pedido do David, 0.269): quanto a esteira gastou, por dia, por agente
 * (etapa), por modelo e por chamado, e de qual chave saiu. O uso dos restaurantes fica em Tokens
 * de IA; aqui é só o do próprio Comandou.
 */
export function PipelineUsage({ onOpen }: { onOpen: (ticketId: string) => void }) {
  const [period, setPeriod] = useState<Period>('month');
  const data = useLoad<PipelineAiUsage>(`/platform/tickets/ai-usage?period=${period}`);
  const u = data.data;
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (!u) return <Skeleton variant="page" />;
  const byKey = new Map(u.keys.map((k) => [k.key, k]));
  const fromClients = byKey.get('clients')?.costUsd ?? 0;
  const busiest = [...u.steps].sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens)[0];
  return (
    <div className="tk-usage">
      <div className="tk-usage__bar">
        <Segmented<Period> label="Período" value={period} onChange={setPeriod} options={PERIODS} />
        <span className="tk-usage__model">
          Modelo dos agentes: <code className="cm-selectable">{u.model || '—'}</code>
        </span>
      </div>

      {u.aiKey !== 'owner' && (
        <Alert tone="warning">
          {u.aiKey === 'clients'
            ? 'A esteira está gastando da chave dos restaurantes. Cadastre a chave do sistema para o gasto do Comandou ficar separado no OpenRouter: '
            : 'Sem chave do OpenRouter, a esteira roda sem IA. '}
          <Link to="/credenciais#cred-openrouter_owner">
            {u.hasOwnerKey ? 'colar de novo a chave do sistema' : 'cadastrar a chave do sistema'}
          </Link>
          .
        </Alert>
      )}

      <div className="adm-grid">
        <Tile
          label="Gasto da esteira"
          value={usd(u.total.costUsd)}
          sub={`${compact(u.total.tokens)} tokens`}
        />
        <Tile label="Chamadas de IA" value={u.total.calls.toLocaleString('pt-BR')} />
        <Tile
          label="Chamados atendidos"
          value={u.total.tickets.toLocaleString('pt-BR')}
          sub={u.total.tickets ? `média de ${usd(u.total.perTicketUsd)} por chamado` : undefined}
        />
        <Tile
          label="Saiu da chave"
          value={
            u.aiKey === 'owner'
              ? 'do sistema'
              : u.aiKey === 'clients'
                ? 'dos restaurantes'
                : 'nenhuma'
          }
          level={u.aiKey === 'owner' ? 'ok' : 'warn'}
          sub={
            fromClients > 0 ? `${usd(fromClients, 4)} da dos restaurantes no período` : undefined
          }
        />
      </div>

      <div className="adm-panel">
        <div className="adm-panel__head">Gasto por dia · últimos 30 dias</div>
        <div className="adm-panel__body">
          <Columns
            label="Gasto da esteira por dia nos últimos 30 dias"
            format={(n) => usd(n)}
            ticks={[0, 7, 14, 21, 29]}
            cols={u.days.map((d, i) => ({
              key: d.day,
              label: i === u.days.length - 1 ? 'hoje' : br(d.day),
              value: d.costUsd > 0 ? d.costUsd : 0,
              tip: `${br(d.day)}: ${usd(d.costUsd, 4)} · ${compact(d.tokens)} tokens · ${d.calls} chamada(s)`,
              strong: i === u.days.length - 1,
            }))}
          />
        </div>
      </div>

      <div className="adm-grid adm-grid--2">
        <div className="adm-panel">
          <div className="adm-panel__head">
            Por agente
            {busiest && busiest.calls
              ? ` · quem mais gasta: ${busiest.agent || busiest.label}`
              : ''}
          </div>
          <div className="adm-panel__body">
            <ul className="tk-usage__steps">
              {u.steps.map((s) => (
                <li key={s.id || 'none'} data-off={s.calls === 0 || undefined}>
                  {s.id ? (
                    <AgentAvatar stage={s.id} size={26} />
                  ) : (
                    <span className="tk-usage__noavatar" />
                  )}
                  <span className="tk-usage__who">
                    <b>{s.agent || 'Sem etapa'}</b>
                    <small>{s.label}</small>
                  </span>
                  <span className="tk-usage__num">
                    {usd(s.costUsd)}
                    <small>
                      {compact(s.tokens)} tokens · {s.calls} chamada(s)
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="adm-panel">
          <div className="adm-panel__head">Por modelo</div>
          <div className="adm-panel__body">
            <Ranking
              rows={u.models.map((m) => ({
                key: m.model,
                name: m.model,
                value: m.costUsd > 0 ? m.costUsd : m.tokens,
                text: m.costUsd > 0 ? usd(m.costUsd) : `${compact(m.tokens)} tokens`,
              }))}
            />
          </div>
        </div>
      </div>

      <div className="adm-panel">
        <div className="adm-panel__head">Chamados que mais gastaram</div>
        {u.tickets.length === 0 ? (
          <div className="adm-empty">Nenhum chamado usou IA no período.</div>
        ) : (
          <div className="adm-rows tk-usage__rows">
            {u.tickets.map((t) => (
              <button
                type="button"
                key={t.ref ?? 'sem'}
                className="adm-row"
                disabled={!t.id}
                onClick={() => t.id && onOpen(t.id)}
              >
                <span className="adm-row__main">
                  <span className="adm-row__title">
                    {t.ref ?? '—'} · {t.title ?? 'chamado apagado'}
                  </span>
                  <span className="adm-row__meta">
                    {t.stageLabel ? `${t.stageLabel} · ` : ''}
                    {t.calls} chamada(s) · última {ago(t.lastAt)}
                  </span>
                </span>
                <span className="adm-row__side tk-usage__side">
                  <b>{usd(t.costUsd)}</b>
                  <span>{compact(t.tokens)} tokens</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="adm-panel">
        <div className="adm-panel__head">Últimas chamadas de IA da esteira</div>
        {u.recent.length === 0 ? (
          <div className="adm-empty">Nada no período.</div>
        ) : (
          <div className="adm-rows tk-usage__rows">
            {u.recent.map((r) => (
              <div key={r.id} className="adm-row">
                <span className="adm-row__main">
                  <span className="adm-row__title">
                    {r.ref ?? '—'} · {r.agent ? `${r.agent}, ${r.stepLabel}` : 'sem etapa'}
                  </span>
                  <span className="adm-row__meta">
                    {r.model} · {KEY_NAME[r.key] ?? r.key}
                  </span>
                </span>
                <span className="adm-row__side tk-usage__side">
                  <b>{usd(r.costUsd, 4)}</b>
                  <span>
                    {compact(r.tokens)} tokens · {ago(r.at)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="adm-sub tk-usage__foot">
        Valores em US$, do jeito que o OpenRouter cobrou cada chamada. O uso dos restaurantes (chat,
        WhatsApp, fotos, cardápio) fica em <Link to="/ia">Tokens de IA</Link>.
      </p>
    </div>
  );
}
