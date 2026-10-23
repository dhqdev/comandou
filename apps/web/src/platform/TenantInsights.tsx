import { Link } from 'react-router';
import { brl } from '../lib/money';

import { Alert, Spinner } from '../design-system';
import { dateTime } from '../features/format';
import { useLoad } from './OverviewPages';
import type { Consumption, KeyCount, TeamMember, TenantInsights } from './types';
import { ago, bytes, Dot, Level, Section, Sparkline, Tile } from './ui';

const reais = (n: number | string) => brl(String(n));

const CHANNEL: Record<string, string> = {
  counter: 'Balcão',
  table: 'Mesa',
  delivery: 'Entrega',
  pickup: 'Retirada',
};
const ORDER_STATUS: Record<string, string> = {
  new: 'Novo',
  in_production: 'Em produção',
  ready: 'Pronto',
  dispatched: 'Saiu para entrega',
  completed: 'Concluído',
  cancel_requested: 'Cancelamento pedido',
  cancelled: 'Cancelado',
};
const METHOD: Record<string, string> = {
  cash: 'Dinheiro',
  credit: 'Crédito',
  debit: 'Débito',
  pix: 'Pix',
  voucher: 'Vale',
  other: 'Outro',
};
const DELIVERY: Record<string, string> = {
  out: 'Em rota',
  delivered: 'Entregue',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};
const GENERIC: Record<string, string> = {
  pending: 'Pendente',
  sent: 'Enviada',
  failed: 'Falhou',
  done: 'Concluído',
  error: 'Erro',
  rejected: 'Rejeitada',
  authorized: 'Autorizada',
  cancelled: 'Cancelada',
  processing: 'Processando',
  claimed: 'Em andamento',
  delivered: 'Entregue',
};
const ROLE: Record<string, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  cashier: 'Caixa',
  waiter: 'Garçom',
  kitchen: 'Cozinha',
  courier: 'Entregador',
};
const TABLE: Record<string, string> = {
  audit_log: 'Auditoria',
  orders: 'Pedidos',
  order_items: 'Itens dos pedidos',
  order_status_history: 'Histórico de status',
  payments: 'Pagamentos',
  products: 'Produtos',
  sessions: 'Sessões de login',
  message_outbox: 'Mensagens (WhatsApp)',
  fiscal_documents: 'Notas fiscais',
  print_jobs: 'Impressões',
  stock_movements: 'Movimentos de estoque',
  categories: 'Categorias',
  memberships: 'Equipe (vínculos)',
  tenant_provisioning_steps: 'Cadastro do restaurante',
  platform_audit_log: 'Auditoria da plataforma',
  subscriptions: 'Assinatura',
  tenant_domains: 'Domínios',
  stock_items: 'Itens de estoque',
  production_sectors: 'Setores de produção',
  dining_tables: 'Mesas',
  tabs: 'Comandas',
  cash_sessions: 'Turnos de caixa',
  cash_movements: 'Movimentos de caixa',
  couriers: 'Entregadores',
  deliveries: 'Entregas',
  print_agents: 'Agentes de impressão',
  finance_entries: 'Financeiro',
  idempotency_keys: 'Chaves de repetição',
};

const pct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.001 ? 2 : 1)}%`;
const label = (map: Record<string, string>, k: string) => map[k] ?? GENERIC[k] ?? k;

/** Linhas com barra proporcional ao maior valor da lista. */
function Bars({
  rows,
}: {
  rows: { key: string; name: string; value: number; text: string; level?: Level }[];
}) {
  const top = Math.max(...rows.map((r) => r.value), 1);
  if (rows.length === 0) return <div className="adm-empty">Sem dados nos últimos 30 dias</div>;
  return (
    <div className="adm-rows">
      {rows.map((r) => (
        <div key={r.key} className="adm-row adm-row--bar">
          <span className="adm-row__main">
            <span className="adm-row__title">{r.name}</span>
            <span className="adm-bar" aria-hidden>
              <i
                style={{ width: `${Math.max((r.value / top) * 100, 1.5)}%` }}
                data-level={r.level}
              />
            </span>
          </span>
          <span className="adm-row__side">{r.text}</span>
        </div>
      ))}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="adm-panel">
      <div className="adm-panel__head">{title}</div>
      {children}
    </div>
  );
}

const counts = (list: KeyCount[], map: Record<string, string>) =>
  list.map((x) => ({ key: x.key, name: label(map, x.key), value: x.count, text: String(x.count) }));

function useInsights(id: string) {
  return useLoad<TenantInsights>(`/platform/tenants/${id}/insights`);
}

function Loading({ error }: { error: string | null }) {
  return error ? (
    <Alert tone="danger">{error}</Alert>
  ) : (
    <div className="adm-panel adm-panel__body">
      <Spinner />
    </div>
  );
}

/** Dias do período preenchidos com zero, do mais antigo ao de hoje. */
function dailySeries(
  byDay: { day: string; count: number; revenue: number }[],
  key: 'count' | 'revenue',
) {
  const map = new Map(byDay.map((d) => [d.day.slice(0, 10), d[key]]));
  const out: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push(Number(map.get(d) ?? 0));
  }
  return out;
}

export function ConsumptionPanel({ id }: { id: string }) {
  const { data, error } = useInsights(id);
  if (!data) return <Loading error={error} />;
  const f = data.footprint;
  const tr = data.traffic;
  return (
    <div className="adm-stack">
      <div className="adm-grid">
        <Tile
          label="Dados no banco"
          value={bytes(f.bytes)}
          sub={
            f.database
              ? `banco próprio: ${bytes(f.databaseBytes)}`
              : `${pct(f.share)} do banco central`
          }
        />
        <Tile
          label="Linhas"
          value={f.rows.toLocaleString('pt-BR')}
          sub={`${f.tables.length} tabelas`}
        />
        <Tile
          label="Online agora"
          value={data.onlineNow}
          sub="ativos nos últimos 15 min"
          level={data.onlineNow ? 'ok' : undefined}
        />
        <Tile
          label="Requisições"
          value={tr ? tr.requests.toLocaleString('pt-BR') : '—'}
          sub={tr ? `${tr.errors} com erro 5xx · desde o último reinício` : 'medição desligada'}
          level={tr && tr.errors ? 'warn' : undefined}
        />
      </div>
      {tr ? (
        <div className="adm-grid">
          <Tile
            label="Tempo de servidor"
            value={`${tr.seconds.toFixed(1)} s`}
            sub={`${pct(tr.timeShare)} do total de todos os restaurantes`}
          />
          <Tile
            label="Tempo médio por requisição"
            value={tr.requests ? `${Math.round((tr.seconds / tr.requests) * 1000)} ms` : '—'}
          />
        </div>
      ) : (
        <Alert tone="info">
          Para medir requisições e tempo de servidor por restaurante, ligue METRICS_PER_TENANT=true
          na API (veja o guia de produção).
        </Alert>
      )}
      <Block title="Tamanho dos dados por tabela (estimado)">
        <Bars
          rows={f.tables.map((t) => ({
            key: t.table,
            name: TABLE[t.table] ?? t.table,
            value: t.bytes,
            text: `${bytes(t.bytes)} · ${t.rows.toLocaleString('pt-BR')} linhas`,
          }))}
        />
      </Block>
      <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
        Memória (RAM) e CPU do servidor são compartilhadas entre todos os restaurantes: o sistema
        não separa isso por restaurante. Aqui você vê o que dá para medir de verdade: dados
        guardados, movimento no banco e tempo de servidor consumido. Os tamanhos são só dos dados
        das linhas, sem índices.
      </p>
    </div>
  );
}

export function OperationPanel({ id, team }: { id: string; team: TeamMember[] | null }) {
  const { data, error } = useInsights(id);
  if (!data) return <Loading error={error} />;
  const o = data.operation;
  const users = new Map(o.users.map((u) => [u.id, u]));
  const days = dailySeries(o.byDay, 'count');
  const revenue = dailySeries(o.byDay, 'revenue');
  const hours = Array.from(
    { length: 24 },
    (_, h) => o.byHour.find((x) => x.hour === h)?.count ?? 0,
  );
  const busiest = hours.indexOf(Math.max(...hours));
  const failed = (list: KeyCount[]) =>
    list.filter((x) => /fail|error|rejec/.test(x.key)).reduce((n, x) => n + x.count, 0);
  return (
    <div className="adm-stack">
      <div className="adm-grid">
        <Tile
          label="Pedidos (30 dias)"
          value={o.orders.total}
          sub={`${o.orders.allTime} no total · ${o.orders.last ? `último ${ago(o.orders.last)}` : 'nenhum ainda'}`}
        />
        <Tile
          label="Faturamento (30 dias)"
          value={reais(o.orders.revenue)}
          sub={`ticket médio ${reais(o.orders.avgTicket)}`}
        />
        <Tile
          label="Em andamento agora"
          value={o.orders.open}
          level={o.orders.open ? 'info' : undefined}
        />
        <Tile
          label="Cancelados (30 dias)"
          value={o.orders.cancelled}
          level={o.orders.total && o.orders.cancelled / o.orders.total > 0.15 ? 'warn' : undefined}
          sub={o.orders.total ? pct(o.orders.cancelled / o.orders.total) : undefined}
        />
      </div>

      <div className="adm-grid adm-grid--2">
        <Block title="Pedidos por dia">
          <div className="adm-panel__body">
            <Sparkline values={days} label="Pedidos por dia" color="var(--a-accent)" />
          </div>
        </Block>
        <Block title="Faturamento por dia">
          <div className="adm-panel__body">
            <Sparkline values={revenue} label="Faturamento por dia" color="var(--a-ok)" />
          </div>
        </Block>
      </div>

      <Block title={`Horários (pico às ${String(busiest).padStart(2, '0')}h)`}>
        <div className="adm-panel__body">
          <div className="adm-hours" role="img" aria-label="Pedidos por hora do dia">
            {hours.map((n, h) => (
              <i
                key={h}
                title={`${h}h: ${n}`}
                style={{ height: `${Math.max((n / Math.max(...hours, 1)) * 100, 3)}%` }}
              />
            ))}
          </div>
        </div>
      </Block>

      <div className="adm-grid adm-grid--2">
        <Block title="Canais">
          <Bars
            rows={o.byChannel.map((c) => ({
              key: c.key,
              name: label(CHANNEL, c.key),
              value: c.count,
              text: `${c.count} · ${reais(c.revenue)}`,
            }))}
          />
        </Block>
        <Block title="Formas de pagamento">
          <Bars
            rows={o.payments.map((p) => ({
              key: p.key,
              name: label(METHOD, p.key),
              value: p.amount,
              text: `${p.count} · ${reais(p.amount)}`,
            }))}
          />
        </Block>
        <Block title="Mais vendidos">
          <Bars
            rows={o.topProducts.map((p) => ({
              key: p.name,
              name: p.name,
              value: p.qty,
              text: String(Number(p.qty)),
            }))}
          />
        </Block>
        <Block title="Pedidos por situação">
          <Bars rows={counts(o.byStatus, ORDER_STATUS)} />
        </Block>
      </div>

      <div className="adm-grid">
        <Tile
          label="Cardápio"
          value={o.catalog.products}
          sub={`${o.catalog.categories} categorias · ${o.catalog.soldOut} esgotados`}
        />
        <Tile label="Mesas" value={o.catalog.tables} sub={`${o.cash.openTabs} comandas abertas`} />
        <Tile
          label="Caixa"
          value={o.cash.openSessions ? 'aberto' : 'fechado'}
          level={o.cash.openSessions ? 'ok' : 'off'}
          sub={`${o.cash.sessions30d} turnos · diferença ${reais(o.cash.difference30d)}`}
        />
        <Tile
          label="Estoque"
          value={o.stock.items}
          level={o.stock.belowMin ? 'warn' : undefined}
          sub={o.stock.belowMin ? `${o.stock.belowMin} abaixo do mínimo` : 'itens controlados'}
        />
      </div>

      <div className="adm-grid adm-grid--2">
        <Block title={`Entregas · ${o.delivery.couriers} entregador(es)`}>
          <Bars rows={counts(o.delivery.byStatus, DELIVERY)} />
        </Block>
        <Block title="Notas fiscais">
          <Bars rows={counts(o.fiscal, {})} />
        </Block>
        <Block title="Mensagens de WhatsApp">
          <Bars rows={counts(o.messages, {})} />
        </Block>
        <Block title="Impressão">
          <Bars rows={counts(o.printJobs, {})} />
          {o.printAgents.length > 0 && (
            <div className="adm-rows">
              {o.printAgents.map((a) => (
                <div key={a.name} className="adm-row">
                  <Dot
                    level={
                      !a.active
                        ? 'off'
                        : a.lastSeenAt && Date.now() - new Date(a.lastSeenAt).getTime() < 120_000
                          ? 'ok'
                          : 'warn'
                    }
                  />
                  <span className="adm-row__main">
                    <span className="adm-row__title">{a.name}</span>
                    <span className="adm-row__meta">
                      {a.version ? `v${a.version} · ` : ''}visto {ago(a.lastSeenAt)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Block>
      </div>

      {(failed(o.fiscal) > 0 || failed(o.messages) > 0) && (
        <Alert tone="warning">
          Falhas nos últimos 30 dias: {failed(o.fiscal)} nota(s) fiscal(is) e {failed(o.messages)}{' '}
          mensagem(ns).
        </Alert>
      )}

      <Block title="Atividade da equipe (30 dias)">
        {!team ? (
          <div className="adm-panel__body">
            <Spinner />
          </div>
        ) : (
          <div className="adm-rows">
            {team.map((m) => {
              const u = users.get(m.id);
              return (
                <div key={m.id} className="adm-row">
                  <Dot
                    level={
                      m.status !== 'active' || m.disabledAt
                        ? 'off'
                        : m.activeSessions
                          ? 'ok'
                          : 'info'
                    }
                  />
                  <span className="adm-row__main">
                    <span className="adm-row__title">{m.name}</span>
                    <span className="adm-row__meta">
                      {label(ROLE, m.role)} · último acesso {ago(m.lastSeenAt)}
                      {m.lastSeenAt ? ` (${dateTime(m.lastSeenAt)})` : ''}
                    </span>
                  </span>
                  <span className="adm-row__side">
                    {u?.orders30d ?? 0} pedidos
                    <br />
                    {u?.payments30d ?? 0} pagamentos
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Block>
      {o.orders.first && (
        <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
          Primeiro pedido em {dateTime(o.orders.first)}. Só números agregados: nome, telefone e
          endereço de clientes finais não aparecem aqui.
        </p>
      )}
    </div>
  );
}

/** Ranking de todos os restaurantes: quem guarda mais dados e quem mais usa o servidor. */
export function ConsumptionRanking() {
  const { data, error } = useLoad<Consumption>('/platform/consumption');
  const top = Math.max(...(data?.tenants.map((t) => t.bytes) ?? [1]), 1);
  return (
    <Section
      title="Consumo por restaurante"
      sub={data ? `todos os bancos: ${bytes(data.databaseBytes)}` : undefined}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="adm-panel">
        {!data ? (
          <div className="adm-panel__body">
            <Spinner />
          </div>
        ) : data.tenants.length === 0 ? (
          <div className="adm-empty">Nenhum restaurante</div>
        ) : (
          <div className="adm-rows">
            {data.tenants.map((t) => (
              <Link key={t.id} to={`/restaurantes/${t.id}`} className="adm-row adm-row--bar">
                <span className="adm-row__main">
                  <span className="adm-row__title">{t.name}</span>
                  <span className="adm-bar" aria-hidden>
                    <i style={{ width: `${Math.max((t.bytes / top) * 100, 1.5)}%` }} />
                  </span>
                </span>
                <span className="adm-row__side">
                  {bytes(t.bytes)} · {t.rows.toLocaleString('pt-BR')} linhas
                  <br />
                  {t.requests !== null
                    ? `${t.requests.toLocaleString('pt-BR')} req · ${pct(t.timeShare ?? 0)} do tempo`
                    : data.trafficEnabled
                      ? ''
                      : 'req: medição desligada'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
