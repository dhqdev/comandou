import { toCents } from '@comandou/shared';
import type { OrderChannel } from '@comandou/shared';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Lightbulb,
  Printer,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  CSSProperties,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, DateInput, EmptyState, Modal, Skeleton } from '../design-system';
import { CheckField, SelectField } from '../features/forms';
import { CHANNEL_LABELS, PAYMENT_METHOD_LABELS, qty } from '../features/format';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import {
  abcClasses,
  addDays,
  buildInsights,
  change,
  daysBetween,
  fmtPct,
  grossProfit,
  type Insight,
  type InsightProduct,
  type InsightsData,
  MENU_CLASS,
  type MenuClass,
  menuMatrix,
  type Preset,
  presetRange,
  productsCsv,
  projection,
  WEEKDAY_NAMES,
} from './reports-insights';

const money = (cents: number) => brl((cents / 100).toFixed(2));
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabel = (
  d: string,
  opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' },
) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', opts);

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'lastMonth', label: 'Mês passado' },
  { value: 'custom', label: 'Escolher datas' },
];

/* ---------- Blocos que o gerente liga, desliga e reordena ---------- */

type BlockId =
  | 'insights'
  | 'trend'
  | 'heat'
  | 'menu'
  | 'products'
  | 'categories'
  | 'channels'
  | 'customers'
  | 'staff'
  | 'operation'
  | 'payments'
  | 'idle';

const BLOCKS: { id: BlockId; label: string; hint: string; wide?: boolean }[] = [
  {
    id: 'insights',
    label: 'O que merece atenção',
    hint: 'Alertas e oportunidades do período',
    wide: true,
  },
  { id: 'trend', label: 'Faturamento por dia', hint: 'Comparado ao período anterior', wide: true },
  { id: 'heat', label: 'Mapa de movimento', hint: 'Pedidos por dia da semana e hora', wide: true },
  {
    id: 'menu',
    label: 'Engenharia de cardápio',
    hint: 'Estrelas, burros de carga, quebra-cabeças e abacaxis',
    wide: true,
  },
  {
    id: 'products',
    label: 'Produtos',
    hint: 'Ranking com margem, tendência e curva ABC',
    wide: true,
  },
  { id: 'categories', label: 'Categorias', hint: 'Quanto cada categoria vende e lucra' },
  { id: 'channels', label: 'Canais de venda', hint: 'Balcão, mesa, delivery e retirada' },
  { id: 'customers', label: 'Clientes', hint: 'Novos, recorrentes e quem mais compra' },
  { id: 'staff', label: 'Equipe', hint: 'Vendas por pessoa que lançou o pedido' },
  { id: 'operation', label: 'Operação', hint: 'Cancelamentos e tempo de cozinha' },
  { id: 'payments', label: 'Recebimentos', hint: 'Por forma de pagamento' },
  { id: 'idle', label: 'Produtos parados', hint: 'Ativos no cardápio e sem nenhuma venda' },
];
const DEFAULT_ORDER = BLOCKS.map((b) => b.id);
const LAYOUT_KEY = 'cm-rp:layout';

interface Layout {
  order: BlockId[];
  hidden: BlockId[];
}

function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const l = JSON.parse(raw) as Layout;
      const known = new Set<string>(DEFAULT_ORDER);
      const order = l.order.filter((id) => known.has(id));
      // Blocos novos (de versões futuras) entram no fim.
      for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
      return { order, hidden: l.hidden.filter((id) => known.has(id)) };
    }
  } catch {
    /* sem armazenamento: usa o padrão */
  }
  return { order: DEFAULT_ORDER, hidden: [] };
}

/* ---------- Tela ---------- */

export function InsightsView() {
  const [preset, setPreset] = useState<Preset>('30d');
  const [range, setRange] = useState(() => presetRange('30d', isoToday()));
  const [channel, setChannel] = useState<OrderChannel | ''>('');
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [editing, setEditing] = useState(false);

  // "Hoje" vem do servidor no fuso do restaurante (o relógio do aparelho pode estar em outro dia).
  useEffect(() => {
    if (data && preset !== 'custom') {
      const r = presetRange(preset, data.today);
      if (r.from !== range.from || r.to !== range.to) setRange(r);
    }
  }, [data, preset, range.from, range.to]);

  useEffect(() => {
    let alive = true;
    setData(null);
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    if (channel) qs.set('channel', channel);
    api<InsightsData>(`/reports/insights?${qs}`)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [range.from, range.to, channel]);

  const pick = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p, data?.today ?? isoToday()));
  };

  const exportCsv = () => {
    if (!data) return;
    const blob = new Blob([productsCsv(data.products)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `produtos_${data.from}_a_${data.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const visible = layout.order.filter((id) => !layout.hidden.includes(id));

  return (
    <div className="rp rp-print">
      <div className="rp-filters">
        <div className="rp-chips" role="group" aria-label="Período">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className="rp-chip"
              aria-pressed={preset === p.value}
              onClick={() => pick(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="rp-filters__row">
          {preset === 'custom' && (
            <div className="rp-range">
              <label>
                <span className="cm-label">De</span>
                <DateInput
                  value={range.from}
                  max={range.to}
                  onChange={(e) =>
                    e.target.value && setRange((r) => ({ ...r, from: e.target.value }))
                  }
                />
              </label>
              <label>
                <span className="cm-label">Até</span>
                <DateInput
                  value={range.to}
                  min={range.from}
                  onChange={(e) =>
                    e.target.value && setRange((r) => ({ ...r, to: e.target.value }))
                  }
                />
              </label>
            </div>
          )}
          <div className="rp-channel">
            <SelectField
              label="Canal"
              value={channel}
              onChange={(e) => setChannel(e.target.value as OrderChannel | '')}
            >
              <option value="">Todos os canais</option>
              {(Object.keys(CHANNEL_LABELS) as OrderChannel[]).map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="rp-actions rp-noprint">
            <Button
              variant="secondary"
              size="sm"
              icon={<SlidersHorizontal size={15} />}
              onClick={() => setEditing(true)}
            >
              Personalizar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download size={15} />}
              onClick={exportCsv}
              disabled={!data}
            >
              Planilha
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Printer size={15} />}
              onClick={() => window.print()}
              disabled={!data}
            >
              Imprimir
            </Button>
          </div>
        </div>
        {data && (
          <p className="rp-period">
            {data.from === data.to
              ? dayLabel(data.from, { weekday: 'long', day: '2-digit', month: 'long' })
              : `${dayLabel(data.from)} a ${dayLabel(data.to, { day: '2-digit', month: '2-digit', year: 'numeric' })}`}
            {' · '}comparado com {dayLabel(addDays(data.from, -data.days))} a{' '}
            {dayLabel(addDays(data.from, -1))}
            {data.channel && ` · só ${CHANNEL_LABELS[data.channel]}`}
          </p>
        )}
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? (
        !error && <Skeleton variant="page" />
      ) : (
        <>
          <InsightKpis data={data} />
          <div className="rp-blocks">
            {visible.map((id) => {
              const meta = BLOCKS.find((b) => b.id === id)!;
              const body = renderBlock(id, data);
              if (!body) return null;
              return (
                <div key={id} className="rp-block" data-wide={meta.wide || undefined}>
                  {body}
                </div>
              );
            })}
          </div>
        </>
      )}

      <CustomizeModal
        open={editing}
        layout={layout}
        onClose={() => setEditing(false)}
        onSave={(l) => {
          setLayout(l);
          try {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
          } catch {
            /* sem armazenamento: vale só nesta visita */
          }
          setEditing(false);
        }}
      />
    </div>
  );
}

function renderBlock(id: BlockId, d: InsightsData): ReactNode {
  switch (id) {
    case 'insights':
      return <InsightList data={d} />;
    case 'trend':
      return <TrendCard data={d} />;
    case 'heat':
      return <HeatCard data={d} />;
    case 'menu':
      return <MenuCard data={d} />;
    case 'products':
      return <ProductsCard data={d} />;
    case 'categories':
      return <CategoriesCard data={d} />;
    case 'channels':
      return d.channel ? null : <ChannelsCard data={d} />;
    case 'customers':
      return <CustomersCard data={d} />;
    case 'staff':
      return <StaffCard data={d} />;
    case 'operation':
      return <OperationCard data={d} />;
    case 'payments':
      return d.channel ? null : <PaymentsCard data={d} />;
    case 'idle':
      return d.channel ? null : <IdleCard data={d} />;
  }
}

/* ---------- Indicadores ---------- */

export function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  const g = change(cur, prev);
  if (g === null) return <span className="rp-delta">sem base anterior</span>;
  const good = invert ? g <= 0 : g >= 0;
  return (
    <span className="rp-delta" data-tone={Math.abs(g) < 0.5 ? undefined : good ? 'up' : 'down'}>
      {g >= 0 ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
      {fmtPct(Math.abs(g))} <span className="rp-delta__vs">vs. anterior</span>
    </span>
  );
}

function InsightKpis({ data }: { data: InsightsData }) {
  const t = data.totals;
  const p = data.previous;
  const rev = toCents(t.revenue);
  const prevRev = toCents(p.revenue);
  const profit = grossProfit(t);
  const prevProfit = grossProfit(p);
  const ticket = t.orders ? Math.round(rev / t.orders) : 0;
  const prevTicket = p.orders ? Math.round(prevRev / p.orders) : 0;
  const all = t.orders + t.cancelled;
  const proj = projection(data);
  return (
    <div className="rp-kpis">
      <KpiBox label="Faturamento" value={money(rev)} main>
        <Delta cur={rev} prev={prevRev} />
        {proj ? <span className="rp-kpi__hint">Projeção: {money(proj)}</span> : null}
      </KpiBox>
      <KpiBox label="Lucro bruto" value={money(profit)} tone={profit < 0 ? 'down' : undefined}>
        <span className="rp-kpi__hint">Margem {rev ? fmtPct((profit / rev) * 100) : '–'}</span>
        <Delta cur={profit} prev={prevProfit} />
      </KpiBox>
      <KpiBox label="Pedidos" value={t.orders.toLocaleString('pt-BR')}>
        <Delta cur={t.orders} prev={p.orders} />
      </KpiBox>
      <KpiBox label="Ticket médio" value={money(ticket)}>
        <Delta cur={ticket} prev={prevTicket} />
      </KpiBox>
      <KpiBox label="Custo dos insumos" value={money(toCents(t.cost))}>
        <span className="rp-kpi__hint">
          {rev ? fmtPct((toCents(t.cost) / rev) * 100) : '–'} do faturamento
        </span>
      </KpiBox>
      <KpiBox label="Clientes" value={t.customers.toLocaleString('pt-BR')}>
        <span className="rp-kpi__hint">
          {data.customers.new} novos · {data.customers.repeat} voltaram
        </span>
      </KpiBox>
      <KpiBox
        label="Cancelados"
        value={t.cancelled.toLocaleString('pt-BR')}
        tone={all && t.cancelled / all >= 0.05 ? 'down' : undefined}
      >
        <span className="rp-kpi__hint">
          {all ? fmtPct((t.cancelled / all) * 100) : '–'} · {money(toCents(t.cancelledValue))}
        </span>
      </KpiBox>
    </div>
  );
}

export function KpiBox({
  label,
  value,
  children,
  tone,
  main,
}: {
  label: string;
  value: string;
  children?: ReactNode;
  tone?: 'down';
  main?: boolean;
}) {
  return (
    <div className="cm-card rp-kpi" data-main={main || undefined}>
      <span className="rp-kpi__label">{label}</span>
      <strong className="rp-kpi__value" data-tone={tone} title={value}>
        {value}
      </strong>
      {children}
    </div>
  );
}

/* ---------- Insights ---------- */

const TONE_ICON: Record<Insight['tone'], ReactNode> = {
  good: <TrendingUp size={17} aria-hidden />,
  bad: <TrendingDown size={17} aria-hidden />,
  warn: <AlertTriangle size={17} aria-hidden />,
  info: <Lightbulb size={17} aria-hidden />,
};
const TONE_LABEL: Record<Insight['tone'], string> = {
  good: 'Boa notícia',
  bad: 'Atenção',
  warn: 'Vale olhar',
  info: 'Dica',
};

function InsightList({ data }: { data: InsightsData }) {
  const all = useMemo(() => buildInsights(data), [data]);
  const [more, setMore] = useState(false);
  const list = more ? all : all.slice(0, 6);
  return (
    <Card title="O que merece atenção" bodyless>
      {all.length === 0 ? (
        <div className="rp-insight rp-insight--ok">
          <CheckCircle2 size={17} aria-hidden />
          <div>
            <strong>Tudo dentro do esperado</strong>
            <p>Nenhum alerta para este período.</p>
          </div>
        </div>
      ) : (
        <ul className="rp-insights">
          {list.map((i) => (
            <li key={i.id} className="rp-insight" data-tone={i.tone}>
              <span className="rp-insight__icon" title={TONE_LABEL[i.tone]}>
                {TONE_ICON[i.tone]}
                <span className="cm-sr-only">{TONE_LABEL[i.tone]}</span>
              </span>
              <div className="rp-insight__text">
                <strong>{i.title}</strong>
                <p>{i.detail}</p>
              </div>
              {i.link && (
                <Link className="rp-insight__link rp-noprint" to={i.link.to}>
                  {i.link.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {all.length > 6 && (
        <div className="rp-more rp-noprint">
          <Button variant="ghost" size="sm" onClick={() => setMore((m) => !m)}>
            {more ? 'Mostrar menos' : `Ver mais ${all.length - 6}`}
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ---------- Gráfico de linha: faturamento por dia x período anterior ---------- */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const shortMoney = (cents: number) => {
  const v = cents / 100;
  if (Math.abs(v) >= 1000)
    return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
};

function TrendCard({ data }: { data: InsightsData }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const byDay = new Map(data.daily.map((x) => [x.day, toCents(x.revenue)]));
  const n = data.days;
  const cur = Array.from({ length: n }, (_, i) => byDay.get(addDays(data.from, i)) ?? 0);
  const prevFrom = addDays(data.from, -n);
  const prev = Array.from({ length: n }, (_, i) => byDay.get(addDays(prevFrom, i)) ?? 0);
  // Dias futuros (período ainda correndo) não entram na linha atual.
  const lastIdx = Math.min(
    n - 1,
    data.to > data.today ? daysBetween(data.from, data.today) - 1 : n - 1,
  );
  const H = 220;
  const pad = { l: 8, r: 8, t: 12, b: 26 };
  const max = Math.max(1, ...cur, ...prev);
  const nice = niceMax(max);
  const x = (i: number) =>
    pad.l + (n === 1 ? (width - pad.l - pad.r) / 2 : (i / (n - 1)) * (width - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / nice) * (H - pad.t - pad.b);
  const path = (vals: number[], upto = vals.length - 1) =>
    vals
      .slice(0, upto + 1)
      .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join('');
  const curPath = path(cur, lastIdx);
  const area = `${curPath}L${x(lastIdx).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const ticks = [0, 0.5, 1].map((f) => f * nice);
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 70))));
  const best = cur.indexOf(Math.max(...cur.slice(0, lastIdx + 1)));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left - pad.l) / (r.width - pad.l - pad.r);
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };

  const totalCur = cur.reduce((a, b) => a + b, 0);
  const totalPrev = prev.reduce((a, b) => a + b, 0);

  return (
    <Card
      title="Faturamento por dia"
      actions={
        <div className="rp-legend">
          <span>
            <i className="rp-swatch rp-swatch--cur" /> Período
          </span>
          <span>
            <i className="rp-swatch rp-swatch--prev" /> Anterior
          </span>
        </div>
      }
    >
      {n === 1 ? (
        <p className="cm-hint">
          Um dia só: {money(totalCur)} contra {money(totalPrev)} no dia anterior. Escolha um período
          maior para ver a curva.
        </p>
      ) : (
        <div className="rp-chart" ref={ref}>
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`Faturamento por dia: ${money(totalCur)} no período, ${money(totalPrev)} no anterior`}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className="rp-grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
                {t > 0 && (
                  <text className="rp-axis" x={pad.l + 2} y={y(t) - 4}>
                    {shortMoney(t)}
                  </text>
                )}
              </g>
            ))}
            <path className="rp-line rp-line--prev" d={path(prev)} />
            <path className="rp-area" d={area} />
            <path className="rp-line rp-line--cur" d={curPath} />
            {cur.map((_, i) =>
              (i % step === 0 && n - 1 - i >= step * 0.6) || i === n - 1 ? (
                <text
                  key={i}
                  className="rp-axis"
                  x={x(i)}
                  y={H - 8}
                  textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                >
                  {dayLabel(addDays(data.from, i))}
                </text>
              ) : null,
            )}
            {best >= 0 && cur[best]! > 0 && hover === null && (
              <g>
                <circle className="rp-dot-cur" cx={x(best)} cy={y(cur[best]!)} r={4.5} />
                <text
                  className="rp-axis rp-axis--strong"
                  x={x(best)}
                  y={y(cur[best]!) - 10}
                  textAnchor={best < n * 0.15 ? 'start' : best > n * 0.85 ? 'end' : 'middle'}
                >
                  {shortMoney(cur[best]!)}
                </text>
              </g>
            )}
            {hover !== null && (
              <g>
                <line className="rp-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />
                <circle className="rp-dot-prev" cx={x(hover)} cy={y(prev[hover]!)} r={4} />
                {hover <= lastIdx && (
                  <circle className="rp-dot-cur" cx={x(hover)} cy={y(cur[hover]!)} r={4.5} />
                )}
              </g>
            )}
            <rect
              x={0}
              y={0}
              width={width}
              height={H}
              fill="transparent"
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
          {hover !== null && (
            <div
              className="rp-tip"
              style={{ left: Math.min(Math.max(x(hover), 90), width - 90) } as CSSProperties}
            >
              <strong>
                {dayLabel(addDays(data.from, hover), {
                  weekday: 'short',
                  day: '2-digit',
                  month: '2-digit',
                })}
              </strong>
              <span>
                <i className="rp-swatch rp-swatch--cur" />{' '}
                {hover <= lastIdx ? money(cur[hover]!) : '–'}
              </span>
              <span className="rp-muted">
                <i className="rp-swatch rp-swatch--prev" /> {dayLabel(addDays(prevFrom, hover))}:{' '}
                {money(prev[hover]!)}
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function niceMax(v: number) {
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

/* ---------- Mapa dia x hora ---------- */

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function HeatCard({ data }: { data: InsightsData }) {
  if (!data.heat.length)
    return (
      <Card title="Mapa de movimento">
        <p className="cm-hint">Sem pedidos no período.</p>
      </Card>
    );
  const from = Math.min(...data.heat.map((h) => h.hour));
  const to = Math.max(...data.heat.map((h) => h.hour));
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const cell = new Map(data.heat.map((h) => [`${h.dow}-${h.hour}`, h]));
  const max = Math.max(1, ...data.heat.map((h) => h.orders));
  const top = [...data.heat].sort((a, b) => b.orders - a.orders)[0]!;
  return (
    <Card title="Mapa de movimento">
      <p className="rp-lead">
        Pico em{' '}
        <strong>
          {WEEKDAY_NAMES[top.dow]} às {top.hour}h
        </strong>
        . Quanto mais escura a célula, mais pedidos naquele dia e hora.
      </p>
      <div className="rp-heat-wrap">
        <table className="rp-heat" style={{ '--cols': hours.length } as CSSProperties}>
          <thead>
            <tr>
              <th />
              {hours.map((h) => (
                <th key={h} scope="col">
                  {h}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DOW_ORDER.map((dow) => (
              <tr key={dow}>
                <th scope="row">{DOW_SHORT[dow]}</th>
                {hours.map((h) => {
                  const c = cell.get(`${dow}-${h}`);
                  const v = c?.orders ?? 0;
                  return (
                    <td
                      key={h}
                      style={{ '--heat': `${Math.round((v / max) * 100)}%` } as CSSProperties}
                      data-zero={v === 0 || undefined}
                      data-dark={v / max > 0.55 || undefined}
                      title={`${DOW_SHORT[dow]} ${h}h: ${v} pedidos${c ? ` · ${brl(c.revenue)}` : ''}`}
                    >
                      {v > 0 ? v : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Engenharia de cardápio ---------- */

function MenuCard({ data }: { data: InsightsData }) {
  const matrix = useMemo(() => menuMatrix(data.products), [data.products]);
  const withRecipe = data.products.filter((p) => p.hasRecipe).length;
  if (matrix.size === 0)
    return (
      <Card title="Engenharia de cardápio">
        <EmptyState
          title="Cadastre as fichas técnicas"
          description="Sem o custo dos produtos não dá para saber quais dão mais lucro. Cadastre a ficha técnica no Estoque."
        />
      </Card>
    );
  const order: MenuClass[] = ['star', 'plowhorse', 'puzzle', 'dog'];
  return (
    <Card title="Engenharia de cardápio">
      <p className="rp-lead">
        Cruza <strong>quanto vende</strong> com <strong>quanto sobra por unidade</strong>. Considera
        os {withRecipe} produtos com ficha técnica.
      </p>
      <div className="rp-matrix">
        {order.map((c) => {
          const rows = data.products
            .filter((p) => matrix.get(p.productId) === c)
            .sort((a, b) => Number(b.quantity) - Number(a.quantity));
          return (
            <section key={c} className="rp-quad" data-class={c}>
              <header>
                <strong>{MENU_CLASS[c].label}</strong>
                <span className="rp-quad__count">{rows.length}</span>
              </header>
              <p className="rp-quad__hint">{MENU_CLASS[c].hint}</p>
              {rows.length ? (
                <ul>
                  {rows.slice(0, 5).map((p) => {
                    const unit = (toCents(p.revenue) - toCents(p.cost)) / Number(p.quantity);
                    return (
                      <li key={p.productId}>
                        <span className="rp-ellipsis">{p.name}</span>
                        <span className="rp-quad__nums">
                          {qty(p.quantity)} un. · {money(Math.round(unit))}/un.
                        </span>
                      </li>
                    );
                  })}
                  {rows.length > 5 && <li className="rp-muted">e mais {rows.length - 5}</li>}
                </ul>
              ) : (
                <p className="rp-muted rp-quad__empty">Nenhum</p>
              )}
            </section>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------- Produtos ---------- */

type SortKey = 'revenue' | 'quantity' | 'profit' | 'margin' | 'trend';

function ProductsCard({ data }: { data: InsightsData }) {
  const [sort, setSort] = useState<SortKey>('revenue');
  const [cat, setCat] = useState('');
  const [all, setAll] = useState(false);
  const abc = useMemo(() => abcClasses(data.products), [data.products]);
  const rows = useMemo(() => {
    const val = (p: InsightProduct): number => {
      const rev = toCents(p.revenue);
      const cost = toCents(p.cost);
      switch (sort) {
        case 'revenue':
          return rev;
        case 'quantity':
          return Number(p.quantity);
        case 'profit':
          return p.hasRecipe ? rev - cost : -Infinity;
        case 'margin':
          return p.hasRecipe && rev ? (rev - cost) / rev : -Infinity;
        case 'trend':
          return change(Number(p.quantity), Number(p.prevQuantity)) ?? -Infinity;
      }
    };
    return data.products
      .filter((p) => Number(p.quantity) > 0 && (!cat || (p.category ?? '') === cat))
      .sort((a, b) => val(b) - val(a));
  }, [data.products, sort, cat]);
  const cats = [...new Set(data.products.map((p) => p.category ?? ''))].filter(Boolean).sort();
  const shown = all ? rows : rows.slice(0, 15);
  const th = (k: SortKey, label: string) => (
    <th className="cm-num" aria-sort={sort === k ? 'descending' : undefined}>
      <button
        type="button"
        className="rp-sort"
        data-on={sort === k || undefined}
        onClick={() => setSort(k)}
      >
        {label}
        {sort === k && <ChevronDown size={13} aria-hidden />}
      </button>
    </th>
  );
  return (
    <Card
      title="Produtos"
      bodyless
      actions={
        <>
          <div className="rp-cat-filter rp-sort-mobile">
            <SelectField
              label="Ordenar por"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="revenue">Mais vendas</option>
              <option value="quantity">Mais unidades</option>
              <option value="profit">Mais lucro</option>
              <option value="margin">Maior margem</option>
              <option value="trend">Maior alta</option>
            </SelectField>
          </div>
          {cats.length > 1 && (
            <div className="rp-cat-filter">
              <SelectField label="Categoria" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">Todas</option>
                {cats.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </SelectField>
            </div>
          )}
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState title="Sem vendas" />
      ) : (
        <>
          <div className="rp-scroll">
            <table className="cm-table rp-table rp-ptable">
              <thead>
                <tr>
                  <th>Produto</th>
                  {th('quantity', 'Qtd.')}
                  {th('revenue', 'Vendas')}
                  {th('profit', 'Lucro')}
                  {th('margin', 'Margem')}
                  {th('trend', 'Tendência')}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const rev = toCents(p.revenue);
                  const cost = toCents(p.cost);
                  const margin = rev ? ((rev - cost) / rev) * 100 : 0;
                  const g = change(Number(p.quantity), Number(p.prevQuantity));
                  const cls = abc.get(p.productId);
                  return (
                    <tr key={p.productId}>
                      <td>
                        <div className="rp-pname">
                          <span className="rp-abc" data-c={cls} title={`Curva ${cls}`}>
                            {cls}
                          </span>
                          <div>
                            <strong>{p.name}</strong>
                            <small>
                              {p.category ?? 'Sem categoria'}
                              {!p.hasRecipe && ' · sem ficha'}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="cm-num">{qty(p.quantity)}</td>
                      <td className="cm-num">
                        <strong>{brl(p.revenue)}</strong>
                      </td>
                      <td className="cm-num">{p.hasRecipe ? money(rev - cost) : '–'}</td>
                      <td className="cm-num">
                        {p.hasRecipe ? (
                          <span
                            className="rp-margin"
                            data-level={margin >= 60 ? 'good' : margin >= 35 ? 'ok' : 'low'}
                          >
                            {margin.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
                          </span>
                        ) : (
                          '–'
                        )}
                      </td>
                      <td className="cm-num">
                        {g === null ? (
                          <span className="rp-muted">novo</span>
                        ) : (
                          <span
                            className="rp-trend"
                            data-tone={g >= 5 ? 'up' : g <= -5 ? 'down' : undefined}
                          >
                            {g >= 0 ? '+' : '−'}
                            {fmtPct(Math.abs(g), 0)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rp-table-foot">
            <span className="cm-hint">
              Curva ABC: <strong>A</strong> = itens que fazem 80% das vendas, <strong>B</strong> =
              os próximos 15%, <strong>C</strong> = o resto. Tendência = quantidade vs. período
              anterior.
            </span>
            {rows.length > 15 && (
              <Button
                variant="ghost"
                size="sm"
                className="rp-noprint"
                onClick={() => setAll((a) => !a)}
              >
                {all ? 'Mostrar 15' : `Ver todos (${rows.length})`}
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/* ---------- Barras horizontais genéricas ---------- */

export function HBars({
  rows,
}: {
  rows: { key: string; label: ReactNode; value: number; right: ReactNode; sub?: ReactNode }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="rp-hbars">
      {rows.map((r, i) => (
        <li key={r.key} data-top={i === 0 || undefined}>
          <div className="rp-hbars__head">
            <span className="rp-ellipsis">{r.label}</span>
            <span className="rp-hbars__right">{r.right}</span>
          </div>
          <span className="rp-bar__track">
            <span
              className="rp-bar__fill"
              style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }}
            />
          </span>
          {r.sub && <small className="rp-hbars__sub">{r.sub}</small>}
        </li>
      ))}
    </ul>
  );
}

function CategoriesCard({ data }: { data: InsightsData }) {
  const cats = new Map<string, { rev: number; cost: number; prev: number; recipe: boolean }>();
  for (const p of data.products) {
    const k = p.category ?? 'Sem categoria';
    const c = cats.get(k) ?? { rev: 0, cost: 0, prev: 0, recipe: true };
    c.rev += toCents(p.revenue);
    c.cost += toCents(p.cost);
    c.prev += toCents(p.prevRevenue);
    c.recipe &&= p.hasRecipe || Number(p.quantity) === 0;
    cats.set(k, c);
  }
  const rows = [...cats.entries()].filter(([, c]) => c.rev > 0).sort((a, b) => b[1].rev - a[1].rev);
  const total = rows.reduce((n, [, c]) => n + c.rev, 0);
  return (
    <Card title="Categorias">
      {rows.length === 0 ? (
        <p className="cm-hint">Sem vendas no período.</p>
      ) : (
        <HBars
          rows={rows.slice(0, 10).map(([name, c]) => {
            const g = change(c.rev, c.prev);
            return {
              key: name,
              label: name,
              value: c.rev,
              right: (
                <>
                  <strong>{money(c.rev)}</strong>{' '}
                  <span className="rp-muted">{fmtPct((c.rev / total) * 100, 0)}</span>
                </>
              ),
              sub: (
                <>
                  {c.recipe
                    ? `Margem ${fmtPct(((c.rev - c.cost) / c.rev) * 100, 0)}`
                    : 'Margem incompleta (itens sem ficha)'}
                  {g !== null && (
                    <span
                      className="rp-trend"
                      data-tone={g >= 5 ? 'up' : g <= -5 ? 'down' : undefined}
                    >
                      {' · '}
                      {g >= 0 ? '+' : '−'}
                      {fmtPct(Math.abs(g), 0)} vs. anterior
                    </span>
                  )}
                </>
              ),
            };
          })}
        />
      )}
    </Card>
  );
}

function ChannelsCard({ data }: { data: InsightsData }) {
  const total = data.channels.reduce((n, c) => n + toCents(c.revenue), 0);
  const rows = data.channels.filter((c) => c.orders > 0);
  return (
    <Card title="Canais de venda">
      {rows.length === 0 ? (
        <p className="cm-hint">Sem vendas no período.</p>
      ) : (
        <HBars
          rows={rows.map((c) => {
            const rev = toCents(c.revenue);
            const g = change(rev, toCents(c.prevRevenue));
            return {
              key: c.channel,
              label: CHANNEL_LABELS[c.channel],
              value: rev,
              right: (
                <>
                  <strong>{money(rev)}</strong>{' '}
                  <span className="rp-muted">{fmtPct((rev / total) * 100, 0)}</span>
                </>
              ),
              sub: (
                <>
                  {c.orders} pedidos · ticket {money(Math.round(rev / c.orders))}
                  {g !== null && (
                    <span
                      className="rp-trend"
                      data-tone={g >= 5 ? 'up' : g <= -5 ? 'down' : undefined}
                    >
                      {' · '}
                      {g >= 0 ? '+' : '−'}
                      {fmtPct(Math.abs(g), 0)}
                    </span>
                  )}
                </>
              ),
            };
          })}
        />
      )}
    </Card>
  );
}

function CustomersCard({ data }: { data: InsightsData }) {
  const c = data.customers;
  const returning = c.identified - c.new;
  return (
    <Card title="Clientes">
      {c.identified === 0 ? (
        <p className="cm-hint">
          Nenhum pedido com cliente identificado (conta ou telefone) no período. Peça o telefone no
          delivery e no balcão para acompanhar quem volta.
        </p>
      ) : (
        <>
          <div className="rp-stats">
            <div>
              <strong>{c.identified}</strong>
              <span>identificados</span>
            </div>
            <div>
              <strong>{c.new}</strong>
              <span>novos</span>
            </div>
            <div>
              <strong>{returning}</strong>
              <span>já eram clientes</span>
            </div>
            <div>
              <strong>{fmtPct((c.repeat / c.identified) * 100, 0)}</strong>
              <span>pediram 2+ vezes</span>
            </div>
          </div>
          {c.top.length > 0 && (
            <>
              <h3 className="rp-subhead">Quem mais comprou</h3>
              <ol className="rp-rank">
                {c.top.map((t, i) => (
                  <li key={i}>
                    <span className="rp-ellipsis">{t.name}</span>
                    <span className="rp-muted">{t.orders} ped.</span>
                    <strong>{brl(t.revenue)}</strong>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function StaffCard({ data }: { data: InsightsData }) {
  return (
    <Card title="Equipe">
      {data.staff.length === 0 ? (
        <p className="cm-hint">Nenhum pedido lançado pela equipe no período (só pedidos online).</p>
      ) : (
        <HBars
          rows={data.staff.map((s) => ({
            key: s.id,
            label: s.name,
            value: toCents(s.revenue),
            right: <strong>{brl(s.revenue)}</strong>,
            sub: `${s.orders} pedidos · ticket ${brl(s.ticket)}`,
          }))}
        />
      )}
    </Card>
  );
}

function OperationCard({ data }: { data: InsightsData }) {
  const t = data.totals;
  const all = t.orders + t.cancelled;
  const k = data.kitchen;
  return (
    <Card title="Operação">
      <div className="rp-stats">
        <div>
          <strong>{k.avg ? `${Number(k.avg).toLocaleString('pt-BR')} min` : '–'}</strong>
          <span>preparo médio</span>
        </div>
        <div>
          <strong>{k.p90 ? `${Math.round(Number(k.p90))} min` : '–'}</strong>
          <span>9 em 10 itens saem até</span>
        </div>
        <div>
          <strong>{all ? fmtPct((t.cancelled / all) * 100) : '–'}</strong>
          <span>cancelados</span>
        </div>
      </div>
      {data.cancellations.length > 0 ? (
        <>
          <h3 className="rp-subhead">Motivos de cancelamento</h3>
          <ol className="rp-rank">
            {data.cancellations.map((c) => (
              <li key={c.reason}>
                <span className="rp-ellipsis">{c.reason}</span>
                <span className="rp-muted">{c.count}×</span>
                <strong>{brl(c.value)}</strong>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="cm-hint">Nenhum cancelamento no período.</p>
      )}
    </Card>
  );
}

function PaymentsCard({ data }: { data: InsightsData }) {
  const rows = data.payments.filter((p) => toCents(p.net) !== 0);
  const total = rows.reduce((n, p) => n + toCents(p.net), 0);
  return (
    <Card title="Recebimentos">
      {rows.length === 0 ? (
        <p className="cm-hint">Nenhum recebimento no caixa no período.</p>
      ) : (
        <HBars
          rows={rows.map((p) => ({
            key: p.method,
            label: PAYMENT_METHOD_LABELS[p.method],
            value: Math.max(0, toCents(p.net)),
            right: (
              <>
                <strong>{brl(p.net)}</strong>{' '}
                <span className="rp-muted">
                  {total ? fmtPct((toCents(p.net) / total) * 100, 0) : ''}
                </span>
              </>
            ),
            sub: `${p.count} pagamentos`,
          }))}
        />
      )}
    </Card>
  );
}

function IdleCard({ data }: { data: InsightsData }) {
  return (
    <Card title="Produtos parados">
      {data.idle.length === 0 ? (
        <p className="cm-hint">Todo produto ativo vendeu pelo menos uma vez.</p>
      ) : (
        <>
          <p className="rp-lead">
            Ativos no cardápio e sem nenhuma venda no período. Reveja foto, preço ou se vale manter.
          </p>
          <ul className="rp-idle">
            {data.idle.slice(0, 12).map((p) => (
              <li key={p.productId}>
                <span className="rp-ellipsis">
                  <strong>{p.name}</strong>
                  <small>{p.category}</small>
                </span>
                <span>{brl(p.price)}</span>
              </li>
            ))}
          </ul>
          {data.idle.length > 12 && <p className="cm-hint">e mais {data.idle.length - 12}.</p>}
        </>
      )}
    </Card>
  );
}

/* ---------- Personalizar ---------- */

function CustomizeModal({
  open,
  layout,
  onClose,
  onSave,
}: {
  open: boolean;
  layout: Layout;
  onClose(): void;
  onSave(l: Layout): void;
}) {
  const [draft, setDraft] = useState(layout);
  useEffect(() => {
    if (open) setDraft(layout);
  }, [open, layout]);
  const move = (i: number, d: number) =>
    setDraft((l) => {
      const order = [...l.order];
      const j = i + d;
      if (j < 0 || j >= order.length) return l;
      [order[i], order[j]] = [order[j]!, order[i]!];
      return { ...l, order };
    });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Personalizar relatório"
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft({ order: DEFAULT_ORDER, hidden: [] })}>
            Restaurar padrão
          </Button>
          <Button variant="primary" onClick={() => onSave(draft)}>
            Salvar
          </Button>
        </>
      }
    >
      <p className="cm-hint cm-form__block">
        Escolha o que aparece e em que ordem. Fica salvo neste aparelho.
      </p>
      <ul className="rp-custom cm-form__block">
        {draft.order.map((id, i) => {
          const b = BLOCKS.find((x) => x.id === id)!;
          return (
            <li key={id}>
              <CheckField
                label={b.label}
                description={b.hint}
                checked={!draft.hidden.includes(id)}
                onChange={(on) =>
                  setDraft((l) => ({
                    ...l,
                    hidden: on ? l.hidden.filter((h) => h !== id) : [...l.hidden, id],
                  }))
                }
              />
              <div className="rp-custom__move">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Subir ${b.label}`}
                  icon={<ChevronUp size={16} />}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Descer ${b.label}`}
                  icon={<ChevronDown size={16} />}
                  disabled={i === draft.order.length - 1}
                  onClick={() => move(i, 1)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
