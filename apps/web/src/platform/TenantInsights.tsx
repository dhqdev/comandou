import { Link } from 'react-router';
import { brl } from '../lib/money';

import { Alert, Skeleton } from '../design-system';
import { dateTime } from '../features/format';
import { useLoad } from './OverviewPages';
import { isOnline, ROLE } from './TenantOverview';
import type { Consumption, KeyCount, TeamMember, TenantInsights } from './types';
import { Columns, Donut, Ranking, SplitBar, type Part } from './charts';
import { ago, bytes, Dot, Level, Section, Tile } from './ui';

/**
 * Real a partir de número ou texto. Arredonda para centavos antes: médias (ex.: faturamento médio
 * por dia da semana) saem com várias casas, e `brl` só aceita até 2 (lançava e derrubava a aba).
 */
const reais = (n: number | string) => {
  const v = Number(n);
  return brl(Number.isFinite(v) ? (Math.round(v * 100) / 100).toFixed(2) : '0');
};

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
/** Nome de cada tabela em português (as que guardam dados do restaurante). */
const TABLE: Record<string, string> = {
  agenda_events: 'Agenda (compromissos)',
  agenda_settings: 'Agenda (ajustes)',
  agenda_tags: 'Agenda (etiquetas)',
  ai_agent_settings: 'IA do WhatsApp (ajustes)',
  ai_customer_chats: 'IA do WhatsApp (conversas)',
  ai_customer_messages: 'IA do WhatsApp (mensagens)',
  ai_messages: 'Assistente de IA (mensagens)',
  ai_usage: 'Assistente de IA (uso)',
  audit_log: 'Registro de ações',
  backup_runs: 'Backups',
  bank_accounts: 'Contas bancárias',
  bank_reconciliations: 'Conciliação bancária',
  bank_statement_lines: 'Extrato bancário',
  billing_cards: 'Cartão da mensalidade',
  billing_customers: 'Cliente no Asaas',
  billing_invoices: 'Faturas da mensalidade',
  cash_movements: 'Movimentos de caixa',
  cash_registers: 'Caixas',
  cash_sessions: 'Turnos de caixa',
  categories: 'Categorias',
  chat_conversations: 'Chat da equipe (conversas)',
  chat_members: 'Chat da equipe (participantes)',
  chat_messages: 'Chat da equipe (mensagens)',
  chat_notices: 'Chat da equipe (avisos)',
  chat_posts: 'Chat da equipe (mural)',
  courier_pay_settings: 'Pagamento de entregadores (ajustes)',
  courier_payouts: 'Pagamento de entregadores',
  couriers: 'Entregadores',
  customer_addresses: 'Endereços de clientes',
  customer_password_resets: 'Clientes (troca de senha)',
  customer_sessions: 'Clientes (sessões)',
  customers: 'Clientes',
  deliveries: 'Entregas',
  delivery_positions: 'Entregas (posição no mapa)',
  delivery_zones: 'Áreas de entrega',
  dining_tables: 'Mesas',
  finance_entries: 'Financeiro (contas)',
  finance_reconciliations: 'Financeiro (conferências)',
  finance_settings: 'Financeiro (ajustes)',
  finance_settlements: 'Recebíveis das maquininhas',
  fiscal_documents: 'Notas fiscais',
  fiscal_events: 'Notas fiscais (eventos)',
  fiscal_ncm_rules: 'Notas fiscais (regras por NCM)',
  fiscal_received: 'Notas recebidas',
  fiscal_rules: 'Notas fiscais (regras)',
  fiscal_voids: 'Inutilizações de nota',
  idempotency_keys: 'Chaves de repetição',
  ifood_connections: 'iFood (conexão)',
  ifood_merchant_claims: 'iFood (lojas)',
  ifood_pending_auth: 'iFood (autorização)',
  ifood_sync_map: 'iFood (vínculos)',
  item_families: 'Famílias de itens',
  kitchen_settings: 'Cozinha (ajustes)',
  loyalty_entries: 'Fidelidade (pontos)',
  loyalty_programs: 'Fidelidade (programa)',
  loyalty_rewards: 'Fidelidade (prêmios)',
  mail_outbox: 'E-mails enviados',
  mascot_prefs: 'Panda (preferências)',
  media: 'Fotos e arquivos',
  memberships: 'Equipe (vínculos)',
  menu_events: 'Cardápios (histórico)',
  menu_items: 'Cardápios (itens)',
  menus: 'Cardápios',
  message_outbox: 'Mensagens de WhatsApp',
  online_charges: 'Pagamentos pelo app',
  online_pay_accounts: 'Pagamentos pelo app (conta)',
  online_pay_states: 'Pagamentos pelo app (conexão)',
  option_groups: 'Grupos de adicionais',
  option_recipes: 'Fichas dos adicionais',
  options: 'Adicionais',
  order_item_options: 'Adicionais dos pedidos',
  order_items: 'Itens dos pedidos',
  order_status_history: 'Histórico de status dos pedidos',
  orders: 'Pedidos',
  payment_refunds: 'Estornos',
  payments: 'Pagamentos',
  pix_receipts: 'Comprovantes de Pix',
  platform_ai_token_grants: 'Tokens doados',
  platform_audit_log: 'Registro do painel',
  platform_lifecycle_mails: 'Avisos de cobrança enviados',
  platform_support_chats: 'Suporte (conversas)',
  platform_support_files: 'Suporte (arquivos)',
  platform_support_messages: 'Suporte (mensagens)',
  platform_tickets: 'Chamados',
  pricing_settings: 'Preços (ajustes)',
  print_agents: 'Agentes de impressão',
  print_jobs: 'Impressões',
  print_templates: 'Modelos de impressão',
  product_models: 'Modelos 3D dos produtos',
  product_option_groups: 'Adicionais por produto',
  product_photos: 'Fotos dos produtos',
  product_pricing: 'Preço dos produtos',
  product_recipes: 'Fichas técnicas',
  product_review_likes: 'Avaliações (curtidas)',
  product_reviews: 'Avaliações',
  production_sectors: 'Cozinhas (setores)',
  products: 'Produtos',
  reservation_settings: 'Reservas (ajustes)',
  reservations: 'Reservas',
  salon_settings: 'Salão (ajustes)',
  sessions: 'Sessões de login',
  signup_entry_tokens: 'Entrada pelo site',
  site_ai_generations: 'Sites montados pela IA',
  staff_password_resets: 'Equipe (troca de senha)',
  stock_cost_changes: 'Estoque (mudanças de custo)',
  stock_counts: 'Estoque (contagens)',
  stock_item_recipes: 'Estoque (preparos)',
  stock_items: 'Itens de estoque',
  stock_lots: 'Estoque (lotes)',
  stock_movements: 'Movimentos de estoque',
  stock_productions: 'Estoque (produções)',
  stock_receipt_lines: 'Entradas de estoque (itens)',
  stock_receipts: 'Entradas de estoque',
  stock_unit_factors: 'Estoque (unidades)',
  store_banners: 'Loja online (banners)',
  store_chat_files: 'Chat da loja (arquivos)',
  store_chat_messages: 'Chat da loja (mensagens)',
  store_chats: 'Chat da loja (conversas)',
  subscriptions: 'Assinatura',
  tabs: 'Comandas',
  tenant_ai_settings: 'Assistente de IA (ajustes)',
  tenant_contracts: 'Contratos',
  tenant_counters: 'Numeração',
  tenant_databases: 'Banco de dados',
  tenant_db_jobs: 'Tarefas do banco',
  tenant_domains: 'Domínios',
  tenant_fiscal_settings: 'Notas fiscais (ajustes)',
  tenant_messaging_settings: 'WhatsApp (ajustes)',
  tenant_migrations: 'Migrações',
  tenant_online_pay_fees: 'Taxa dos pagamentos pelo app',
  tenant_profiles: 'Cadastro',
  tenant_provisioning_steps: 'Cadastro do restaurante (passos)',
  tenant_receptions: 'Recebimentos de outro servidor',
  tenant_store_settings: 'Loja online (ajustes)',
  trial_signups: 'Teste criado pelo site',
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
      <Skeleton variant="cards" />
    </div>
  );
}

/** Os 30 dias (no fuso do restaurante) com pedidos e faturamento, do mais antigo a hoje. */
function dailyPoints(byDay: { day: string; count: number; revenue: number }[], timeZone: string) {
  const map = new Map(byDay.map((d) => [d.day.slice(0, 10), d]));
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' });
  } catch {
    // Fuso vazio ou desconhecido pelo navegador: usa o de Brasília em vez de quebrar a aba.
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' });
  }
  const out: { day: string; count: number; revenue: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = fmt.format(new Date(Date.now() - i * 86_400_000));
    const x = map.get(day);
    out.push({ day, count: Number(x?.count ?? 0), revenue: Number(x?.revenue ?? 0) });
  }
  return out;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** Ordem fixa das cores: a mesma forma de pagamento e o mesmo canal têm sempre a mesma cor. */
const CHANNEL_SLOT: Record<string, number> = { counter: 1, table: 2, delivery: 3, pickup: 4 };
const METHOD_SLOT: Record<string, number> = {
  pix: 1,
  credit: 2,
  debit: 3,
  cash: 4,
  voucher: 5,
  other: 6,
};
const br = (d: string) => d.slice(5).split('-').reverse().join('/');

export function ConsumptionPanel({ id }: { id: string }) {
  const { data, error } = useInsights(id);
  if (!data) return <Loading error={error} />;
  const f = data.footprint;
  const tr = data.traffic;
  // Maior primeiro (a API devolvia em ordem de texto: "9 KB" passava na frente de "8 MB").
  const tables = [...f.tables].sort((a, b) => b.bytes - a.bytes);
  return (
    <div className="adm-stack">
      <div className="adm-grid">
        <Tile
          label="Dados no banco"
          value={bytes(f.bytes)}
          sub={
            f.database
              ? `banco próprio inteiro: ${bytes(f.databaseBytes)} (com índices)`
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
          rows={tables.map((t) => ({
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

export function OperationPanel({
  id,
  team,
  timezone,
}: {
  id: string;
  team: TeamMember[] | null;
  timezone: string;
}) {
  const { data, error } = useInsights(id);
  if (!data) return <Loading error={error} />;
  const o = data.operation;
  const users = new Map(o.users.map((u) => [u.id, u]));
  const points = dailyPoints(o.byDay, timezone);
  // Média por dia da semana (dias com e sem pedido entram na conta).
  const week = WEEKDAYS.map((name, wd) => {
    const same = points.filter((p) => new Date(`${p.day}T12:00:00Z`).getUTCDay() === wd);
    const revenue = same.reduce((n, p) => n + p.revenue, 0) / Math.max(same.length, 1);
    const count = same.reduce((n, p) => n + p.count, 0) / Math.max(same.length, 1);
    return { name, revenue, count };
  });
  const bestDay = week.reduce((b, d, i) => (d.revenue > week[b]!.revenue ? i : b), 0);
  const channels: Part[] = o.byChannel.map((c) => ({
    key: c.key,
    label: label(CHANNEL, c.key),
    value: c.revenue,
    text: `${c.count} · ${reais(c.revenue)}`,
    slot: CHANNEL_SLOT[c.key],
  }));
  const payments: Part[] = [...o.payments]
    .sort((a, b) => (METHOD_SLOT[a.key] ?? 9) - (METHOD_SLOT[b.key] ?? 9))
    .map((p) => ({
      key: p.key,
      label: label(METHOD, p.key),
      value: p.amount,
      text: `${p.count} · ${reais(p.amount)}`,
      slot: METHOD_SLOT[p.key],
    }));
  const statuses: Part[] = o.byStatus.map((x, i) => ({
    key: x.key,
    label: label(ORDER_STATUS, x.key),
    value: x.count,
    text: String(x.count),
    slot: x.key === 'cancelled' ? undefined : (i % 6) + 1,
  }));
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

      <Block title="Faturamento por dia · últimos 30 dias">
        <div className="adm-panel__body">
          <Columns
            label="Faturamento por dia nos últimos 30 dias"
            format={(n) => reais(Math.round(n))}
            ticks={[0, 7, 14, 21, 29]}
            cols={points.map((p, i) => ({
              key: p.day,
              label: i === 29 ? 'hoje' : br(p.day),
              value: p.revenue,
              tip: `${br(p.day)}: ${reais(p.revenue)} · ${p.count} ${p.count === 1 ? 'pedido' : 'pedidos'}`,
              strong: i === 29,
            }))}
          />
        </div>
      </Block>

      <div className="adm-grid adm-grid--2">
        <Block title="Canais · faturamento">
          <div className="adm-panel__body">
            <Donut
              parts={channels}
              center={reais(Math.round(o.orders.revenue))}
              centerLabel="em 30 dias"
              label="Faturamento por canal"
            />
          </div>
        </Block>
        <Block title="Formas de pagamento">
          <div className="adm-panel__body">
            <SplitBar parts={payments} />
          </div>
        </Block>
        <Block title={`Horários · pico às ${String(busiest).padStart(2, '0')}h`}>
          <div className="adm-panel__body">
            <Columns
              label="Pedidos por hora do dia"
              format={(n) => `${Math.round(n)} ped.`}
              average={false}
              height={120}
              ticks={[0, 6, 12, 18, 23]}
              cols={hours.map((n, h) => ({
                key: String(h),
                label: `${h}h`,
                value: n,
                tip: `${h}h: ${n} ${n === 1 ? 'pedido' : 'pedidos'}`,
                strong: h === busiest && n > 0,
              }))}
            />
          </div>
        </Block>
        <Block title={`Dia da semana · melhor: ${week[bestDay]!.name}`}>
          <div className="adm-panel__body">
            <Columns
              label="Faturamento médio por dia da semana"
              format={(n) => reais(Math.round(n))}
              average={false}
              height={120}
              cols={week.map((d, i) => ({
                key: d.name,
                label: d.name,
                value: d.revenue,
                tip: `${d.name}: média ${reais(d.revenue)} · ${d.count.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pedidos`,
                strong: i === bestDay && d.revenue > 0,
              }))}
            />
          </div>
        </Block>
        <Block title="Mais vendidos">
          <div className="adm-panel__body">
            <Ranking
              rows={o.topProducts.map((p) => ({
                key: p.name,
                name: p.name,
                value: Number(p.qty),
                text: `${Number(p.qty).toLocaleString('pt-BR')} un.`,
              }))}
            />
          </div>
        </Block>
        <Block title="Pedidos por situação">
          <div className="adm-panel__body">
            <SplitBar parts={statuses} />
          </div>
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
            <Skeleton />
          </div>
        ) : (
          <div className="adm-rows">
            {team.map((m) => {
              const u = users.get(m.id);
              return (
                <div key={m.id} className="adm-row">
                  <Dot
                    level={
                      m.status !== 'active' || m.disabledAt ? 'off' : isOnline(m) ? 'ok' : 'info'
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
            <Skeleton variant="table" />
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
