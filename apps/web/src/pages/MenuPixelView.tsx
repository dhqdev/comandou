import { toCents } from '@comandou/shared';
import { MousePointerClick } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DateInput, EmptyState, Skeleton } from '../design-system';
import { qty } from '../features/format';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { Delta, HBars, KpiBox } from './ReportsInsights';
import { addDays, fmtPct, type Preset, presetRange } from './reports-insights';
import './menu-pixel.css';

/* Pixel do cardápio online: o que os clientes fazem no cardápio (GET /reports/menu-pixel). */

interface Totals {
  visits: number;
  visitors: number;
  itemViews: number;
  adds: number;
  searches: number;
  buyerSessions: number;
  orders: number;
  revenue: string;
}
interface Group {
  key: string | null;
  visits: number;
  buyers: number;
}
export interface MenuPixelData {
  from: string;
  to: string;
  today: string;
  days: number;
  totals: Totals;
  previous: Totals;
  funnel: { step: string; sessions: number }[];
  daily: { day: string; visits: number; itemViews: number; adds: number; orders: number }[];
  byHour: { hour: number; visits: number }[];
  products: {
    productId: string;
    name: string | null;
    category: string | null;
    views: number;
    viewSessions: number;
    adds: number;
    addSessions: number;
    favorites: number;
    sold: string;
  }[];
  searches: { term: string; count: number; noResults: number }[];
  sources: Group[];
  devices: Group[];
  campaigns: Group[];
  categories: { id: string; name: string | null; clicks: number }[];
  banners: { id: string; name: string | null; clicks: number }[];
}

const STEP_LABEL: Record<string, string> = {
  visit: 'Abriram o cardápio',
  view_item: 'Clicaram num item',
  add_to_cart: 'Puseram na sacola',
  view_cart: 'Abriram a sacola',
  begin_checkout: 'Foram finalizar',
  purchase: 'Fizeram o pedido',
};
const SOURCE_LABEL: Record<string, string> = {
  direto: 'Direto (link ou app)',
  mesa: 'QR Code da mesa',
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  google: 'Google',
  tiktok: 'TikTok',
  ifood: 'iFood',
};
const DEVICE_LABEL: Record<string, string> = {
  phone: 'Celular',
  tablet: 'Tablet',
  desktop: 'Computador',
};
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'lastMonth', label: 'Mês passado' },
  { value: 'custom', label: 'Escolher datas' },
];

const n = (v: number) => v.toLocaleString('pt-BR');
const rate = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const pctOf = (part: number, whole: number) => (whole ? fmtPct(rate(part, whole)) : '–');
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabel = (
  d: string,
  opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' },
) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', opts);

export function MenuPixelView() {
  const [preset, setPreset] = useState<Preset>('30d');
  const [range, setRange] = useState(() => presetRange('30d', isoToday()));
  const [data, setData] = useState<MenuPixelData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Hoje" vem do servidor no fuso do restaurante.
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
    api<MenuPixelData>(`/reports/menu-pixel?${qs}`)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [range.from, range.to]);

  const pick = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p, data?.today ?? isoToday()));
  };

  return (
    <div className="rp">
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
        {preset === 'custom' && (
          <div className="rp-filters__row">
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
          </div>
        )}
        {data && (
          <p className="rp-period">
            {data.from === data.to
              ? dayLabel(data.from, { weekday: 'long', day: '2-digit', month: 'long' })
              : `${dayLabel(data.from)} a ${dayLabel(data.to, { day: '2-digit', month: '2-digit', year: 'numeric' })}`}
            {' · '}comparado com {dayLabel(addDays(data.from, -data.days))} a{' '}
            {dayLabel(addDays(data.from, -1))}
          </p>
        )}
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? (
        !error && <Skeleton variant="cards" />
      ) : data.totals.visits === 0 && data.totals.itemViews === 0 ? (
        <Card>
          <EmptyState
            icon={<MousePointerClick size={28} />}
            title="Ainda sem visitas no cardápio online"
            description="O pixel do Comandou conta sozinho cada visita, clique em item, sacola e pedido feito pelo cardápio online. Compartilhe o link do cardápio e os números aparecem aqui."
          />
        </Card>
      ) : (
        <>
          <PixelKpis data={data} />
          <div className="rp-blocks">
            <div className="rp-block" data-wide>
              <FunnelCard data={data} />
            </div>
            <div className="rp-block" data-wide>
              <DailyCard data={data} />
            </div>
            <div className="rp-block" data-wide>
              <ItemsCard data={data} />
            </div>
            <div className="rp-block">
              <GroupCard
                title="De onde vieram"
                rows={data.sources}
                label={(k) => SOURCE_LABEL[k ?? ''] ?? k ?? 'Direto'}
                hint="Use links com ?utm_source=instagram&utm_campaign=promo para separar as campanhas."
              />
            </div>
            <div className="rp-block">
              <GroupCard
                title="Aparelho"
                rows={data.devices}
                label={(k) => DEVICE_LABEL[k ?? ''] ?? k ?? '–'}
              />
            </div>
            <div className="rp-block">
              <SearchCard data={data} />
            </div>
            <div className="rp-block">
              <HoursCard data={data} />
            </div>
            {data.categories.length > 0 && (
              <div className="rp-block">
                <ClicksCard title="Categorias tocadas" rows={data.categories} />
              </div>
            )}
            {data.banners.length > 0 && (
              <div className="rp-block">
                <ClicksCard title="Banners tocados" rows={data.banners} />
              </div>
            )}
            {data.campaigns.length > 0 && (
              <div className="rp-block">
                <GroupCard title="Campanhas" rows={data.campaigns} label={(k) => k ?? '–'} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PixelKpis({ data }: { data: MenuPixelData }) {
  const t = data.totals;
  const p = data.previous;
  const conv = rate(t.buyerSessions, t.visits);
  const prevConv = rate(p.buyerSessions, p.visits);
  return (
    <div className="rp-kpis">
      <KpiBox label="Visitas" value={n(t.visits)} main>
        <span className="rp-kpi__hint">{n(t.visitors)} pessoas diferentes</span>
        <Delta cur={t.visits} prev={p.visits} />
      </KpiBox>
      <KpiBox label="Cliques em itens" value={n(t.itemViews)}>
        <span className="rp-kpi__hint">
          {t.visits
            ? (t.itemViews / t.visits).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
            : '–'}{' '}
          por visita
        </span>
        <Delta cur={t.itemViews} prev={p.itemViews} />
      </KpiBox>
      <KpiBox label="Itens na sacola" value={n(t.adds)}>
        <Delta cur={t.adds} prev={p.adds} />
      </KpiBox>
      <KpiBox label="Pedidos online" value={n(t.orders)}>
        <span className="rp-kpi__hint">{brl(t.revenue)}</span>
        <Delta cur={t.orders} prev={p.orders} />
      </KpiBox>
      <KpiBox label="Conversão" value={t.visits ? fmtPct(conv) : '–'}>
        <span className="rp-kpi__hint">visitas que viraram pedido</span>
        <Delta cur={conv} prev={prevConv} />
      </KpiBox>
      <KpiBox
        label="Ticket médio online"
        value={t.orders ? brl((toCents(t.revenue) / t.orders / 100).toFixed(2)) : '–'}
      />
    </div>
  );
}

function FunnelCard({ data }: { data: MenuPixelData }) {
  const top = data.funnel[0]?.sessions || 0;
  // Onde mais gente desiste (maior queda de um passo para o seguinte).
  let worst = -1;
  let worstDrop = 0;
  data.funnel.forEach((s, i) => {
    if (!i) return;
    const prev = data.funnel[i - 1]!.sessions;
    const drop = prev ? 1 - s.sessions / prev : 0;
    if (prev >= 5 && drop > worstDrop) {
      worstDrop = drop;
      worst = i;
    }
  });
  return (
    <Card title="Funil do cardápio">
      <p className="rp-lead">
        Cada visita conta no passo mais adiante a que chegou.
        {worst > 0 &&
          ` A maior perda está entre "${STEP_LABEL[data.funnel[worst - 1]!.step]}" e "${STEP_LABEL[data.funnel[worst]!.step]}": ${fmtPct(worstDrop * 100, 0)} param aí.`}
      </p>
      <ol className="px-funnel">
        {data.funnel.map((s, i) => {
          const prev = i ? data.funnel[i - 1]!.sessions : s.sessions;
          return (
            <li key={s.step} data-worst={i === worst || undefined}>
              <span className="px-funnel__label">{STEP_LABEL[s.step] ?? s.step}</span>
              <span className="rp-bar__track px-funnel__track">
                <span
                  className="rp-bar__fill"
                  style={{ width: `${Math.max(top ? 1 : 0, rate(s.sessions, top))}%` }}
                />
              </span>
              <span className="px-funnel__value">
                <strong>{n(s.sessions)}</strong>
                <small>
                  {pctOf(s.sessions, top)}
                  {i > 0 && prev > 0 && ` · ${pctOf(s.sessions, prev)} do anterior`}
                </small>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function DailyCard({ data }: { data: MenuPixelData }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.daily.map((d) => d.visits));
  const h = hover !== null ? data.daily[hover] : null;
  const label = data.daily.length > 16 ? 7 : 1;
  return (
    <Card
      title="Visitas por dia"
      actions={
        <div className="rp-legend">
          <span>
            <i className="rp-swatch rp-swatch--cur" /> Visitas
          </span>
          <span>
            <i className="px-dot" /> Pedidos online
          </span>
        </div>
      }
    >
      <p className="rp-lead">
        {h
          ? `${dayLabel(h.day, { weekday: 'short', day: '2-digit', month: '2-digit' })}: ${n(h.visits)} visitas, ${n(h.itemViews)} cliques em itens, ${n(h.adds)} na sacola e ${n(h.orders)} pedidos.`
          : 'Toque numa barra para ver o dia.'}
      </p>
      <div className="px-cols" onPointerLeave={() => setHover(null)}>
        {data.daily.map((d, i) => (
          <button
            type="button"
            key={d.day}
            className="px-col"
            data-on={hover === i || undefined}
            onPointerEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
            aria-label={`${dayLabel(d.day)}: ${d.visits} visitas, ${d.orders} pedidos`}
          >
            <span className="px-col__bar" style={{ height: `${(d.visits / max) * 100}%` }} />
            {d.orders > 0 && (
              <span
                className="px-col__orders"
                style={{ bottom: `${Math.min(100, (d.orders / max) * 100)}%` }}
              />
            )}
            {(i % label === 0 || data.daily.length <= 16) && (
              <span className="px-col__day">{dayLabel(d.day, { day: '2-digit' })}</span>
            )}
          </button>
        ))}
      </div>
    </Card>
  );
}

type SortKey = 'views' | 'adds' | 'rate' | 'sold';

function ItemsCard({ data }: { data: MenuPixelData }) {
  const [sort, setSort] = useState<SortKey>('views');
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const r = data.products
      .filter((p) => p.name)
      .map((p) => ({ ...p, rate: rate(p.addSessions, p.viewSessions) }));
    const key = (p: (typeof r)[number]) =>
      sort === 'sold' ? Number(p.sold) : sort === 'rate' ? p.rate : p[sort];
    return r.sort((a, b) => key(b) - key(a));
  }, [data, sort]);
  const shown = all ? rows : rows.slice(0, 15);
  const th = (k: SortKey, label: string, title?: string) => (
    <th className="cm-num" title={title}>
      <button
        type="button"
        className="rp-sort"
        aria-pressed={sort === k}
        onClick={() => setSort(k)}
      >
        {label}
      </button>
    </th>
  );
  return (
    <Card title="Itens do cardápio">
      <p className="rp-lead">
        Muito clique e pouca sacola: foto, preço ou descrição podem estar afastando. Pouco clique: o
        item pode estar escondido no cardápio.
      </p>
      {rows.length === 0 ? (
        <p className="cm-hint">Nenhum item aberto no período.</p>
      ) : (
        <>
          <div className="rp-scroll">
            <table className="cm-table rp-table">
              <thead>
                <tr>
                  <th>Item</th>
                  {th('views', 'Cliques', 'Vezes que o item foi aberto')}
                  {th('adds', 'Na sacola', 'Vezes que o item foi posto na sacola')}
                  {th('rate', 'Taxa', 'De quem abriu o item, quantos puseram na sacola')}
                  {th('sold', 'Vendidos', 'Quantidade vendida em pedidos online')}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.productId}>
                    <td>
                      <div className="rp-pname">
                        <div>
                          <strong>{p.name}</strong>
                          <small>
                            {p.category ?? 'Sem categoria'}
                            {p.favorites > 0 &&
                              ` · ${n(p.favorites)} ${p.favorites === 1 ? 'favorito' : 'favoritos'}`}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td className="cm-num">
                      <strong>{n(p.views)}</strong>
                    </td>
                    <td className="cm-num">{n(p.adds)}</td>
                    <td className="cm-num">
                      {p.viewSessions ? (
                        <span
                          className="rp-margin"
                          data-level={p.rate >= 30 ? 'good' : p.rate >= 12 ? 'ok' : 'low'}
                        >
                          {fmtPct(p.rate, 0)}
                        </span>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="cm-num">{qty(p.sold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 15 && (
            <div className="rp-more">
              <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>
                {all ? 'Mostrar 15' : `Ver todos (${rows.length})`}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function GroupCard({
  title,
  rows,
  label,
  hint,
}: {
  title: string;
  rows: Group[];
  label(k: string | null): string;
  hint?: string;
}) {
  const total = rows.reduce((s, r) => s + r.visits, 0);
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="cm-hint">Sem visitas no período.</p>
      ) : (
        <HBars
          rows={rows.map((r) => ({
            key: r.key ?? '-',
            label: label(r.key),
            value: r.visits,
            right: `${n(r.visits)} · ${pctOf(r.visits, total)}`,
            sub: `${n(r.buyers)} ${r.buyers === 1 ? 'pedido' : 'pedidos'} · conversão ${pctOf(r.buyers, r.visits)}`,
          }))}
        />
      )}
      {hint && <p className="cm-hint px-hint">{hint}</p>}
    </Card>
  );
}

function SearchCard({ data }: { data: MenuPixelData }) {
  const empty = data.searches.filter((s) => s.noResults === s.count);
  return (
    <Card title="O que buscaram">
      {data.searches.length === 0 ? (
        <p className="cm-hint">Ninguém usou a busca no período.</p>
      ) : (
        <>
          {empty.length > 0 && (
            <p className="rp-lead">
              Buscaram e não acharam:{' '}
              {empty
                .slice(0, 5)
                .map((s) => `"${s.term}"`)
                .join(', ')}
              . Vale incluir no cardápio ou pôr a palavra na descrição do item.
            </p>
          )}
          <HBars
            rows={data.searches.map((s) => ({
              key: s.term,
              label: s.term,
              value: s.count,
              right: n(s.count),
              sub: s.noResults === s.count ? 'nada encontrado' : undefined,
            }))}
          />
        </>
      )}
    </Card>
  );
}

function HoursCard({ data }: { data: MenuPixelData }) {
  const by = new Map(data.byHour.map((h) => [h.hour, h.visits]));
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, v: by.get(h) ?? 0 }));
  const max = Math.max(1, ...hours.map((x) => x.v));
  const peak = hours.reduce((a, b) => (b.v > a.v ? b : a), hours[0]!);
  return (
    <Card title="Horário das visitas">
      <p className="rp-lead">
        {peak.v ? `Pico às ${peak.h}h, com ${n(peak.v)} visitas no período.` : 'Sem visitas.'}
      </p>
      <div className="px-hours" role="img" aria-label="Visitas por hora do dia">
        {hours.map((x) => (
          <span key={x.h} className="px-hours__col" title={`${x.h}h: ${n(x.v)} visitas`}>
            <span className="px-hours__bar" style={{ height: `${(x.v / max) * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="px-hours__axis" aria-hidden>
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
    </Card>
  );
}

function ClicksCard({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; name: string | null; clicks: number }[];
}) {
  return (
    <Card title={title}>
      <HBars
        rows={rows.map((r) => ({
          key: r.id,
          label: r.name ?? 'Removido',
          value: r.clicks,
          right: n(r.clicks),
        }))}
      />
    </Card>
  );
}
