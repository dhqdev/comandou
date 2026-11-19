import { formatBRL, toCents } from '@comandou/shared';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { CHANNEL_LABELS, PAYMENT_METHOD_LABELS } from '../../features/format';
import type { CustomerDetail } from '../../lib/types';

/*
 * Gráficos da ficha do cliente, feitos à mão em HTML (sem biblioteca), no jeito do Financeiro:
 * trilho cinza, laranja só no destaque (o que ele mais pede, o mês atual, o dia e a hora em que
 * mais pede), números tabulares e a dica ao passar o mouse/dedo. Cores só pelos tokens.
 */

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthShort = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const monthLong = (ym: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const money = (v: string | number) => formatBRL(typeof v === 'number' ? v : toCents(v));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
const channelLabel = (c: string) => CHANNEL_LABELS[c as keyof typeof CHANNEL_LABELS] ?? c;
const methodLabel = (m: string) =>
  m === 'app'
    ? 'Pago no aplicativo'
    : (PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] ?? m);
/** Faixa de horas legível: 19 → "19h às 20h". */
const hourRange = (h: number) => `${h}h às ${(h + 1) % 24}h`;
const DAY_MS = 86_400_000;

/** Tons em degraus do laranja da loja para fatias em ordem (maior primeiro); o resto em cinza. */
const SHARE_TONES = [
  'var(--cm-brand-500)',
  'color-mix(in oklab, var(--cm-brand-500) 62%, var(--cm-surface))',
  'color-mix(in oklab, var(--cm-brand-500) 36%, var(--cm-surface))',
  'color-mix(in oklab, var(--cm-text-muted) 45%, var(--cm-surface))',
  'color-mix(in oklab, var(--cm-text-muted) 25%, var(--cm-surface))',
];

/** Números do topo: um quadro só, separado por linha fina. */
export function CustomerKpis({ c }: { c: CustomerDetail }) {
  const { stats } = c;
  const now = Date.now();
  const first = stats.firstOrderAt ? new Date(stats.firstOrderAt).getTime() : null;
  const last = stats.lastOrderAt ? new Date(stats.lastOrderAt).getTime() : null;
  const every =
    first !== null && last !== null && stats.orders > 1
      ? Math.max(1, Math.round((last - first) / DAY_MS / (stats.orders - 1)))
      : null;
  const since = last !== null ? Math.max(0, Math.floor((now - last) / DAY_MS)) : null;
  const items: { label: string; value: ReactNode; sub?: string; warn?: boolean }[] = [
    { label: 'Pedidos', value: stats.orders },
    { label: 'Total gasto', value: money(stats.spent) },
    { label: 'Ticket médio', value: money(stats.avgTicket) },
    {
      label: 'Pede a cada',
      value: every === null ? '—' : plural(every, 'dia', 'dias'),
      sub: every === null ? 'precisa de 2 pedidos' : 'em média',
    },
    {
      label: 'Último pedido',
      value: since === null ? '—' : since === 0 ? 'Hoje' : `há ${plural(since, 'dia', 'dias')}`,
      ...(since !== null && every !== null && since > every * 2 && since >= 14
        ? { sub: 'bem mais que o normal dele', warn: true }
        : {}),
    },
  ];
  return (
    <dl className="cl-kpis">
      {items.map((i) => (
        <div key={i.label}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
          {i.sub && (
            <dd className="cl-kpis__sub" data-warn={i.warn || undefined}>
              {i.sub}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/** Frases curtas tiradas dos números: o que a equipe precisa saber de relance. */
export function readings(c: CustomerDetail): string[] {
  const out: string[] = [];
  const ins = c.insights;
  const total = c.stats.orders;
  if (!total) return out;
  const top = c.favorites[0];
  if (top)
    out.push(
      `Mais pede ${top.name}: ${plural(top.quantity, 'vez', 'vezes')}, em ${pct(top.orders, total)}% dos pedidos.`,
    );
  const day = [...ins.weekdays].sort((a, b) => b.orders - a.orders)[0];
  const hour = [...ins.hours].sort((a, b) => b.orders - a.orders)[0];
  if (day && hour && total >= 3)
    out.push(
      `Costuma pedir ${day.day === 0 || day.day === 6 ? 'no' : 'na'} ${WEEKDAYS_LONG[day.day]}, das ${hourRange(hour.hour)}.`,
    );
  const ch = ins.channels[0];
  if (ch)
    out.push(
      ins.channels.length === 1
        ? `Sempre pede por ${channelLabel(ch.channel)}.`
        : `Prefere ${channelLabel(ch.channel)} (${pct(ch.orders, total)}% dos pedidos).`,
    );
  const pay = ins.payments[0];
  if (pay) {
    const sum = ins.payments.reduce((s, p) => s + toCents(p.amount), 0);
    out.push(
      `Paga mais com ${methodLabel(pay.method)} (${pct(toCents(pay.amount), sum)}% do valor).`,
    );
  }
  const months = ins.months;
  const cur = months.at(-1);
  const prev = months.at(-2);
  if (cur && prev && prev.orders > 0 && cur.orders > prev.orders)
    out.push(`Este mês já pediu mais que no mês passado (${cur.orders} contra ${prev.orders}).`);
  return out;
}

/** Barras deitadas: nome, barra proporcional ao maior e o valor; a primeira em laranja cheio. */
export function RankBars({
  rows,
  label,
}: {
  rows: { key: string; label: string; value: number; display: ReactNode; sub?: ReactNode }[];
  label: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="cl-rank" aria-label={label}>
      {rows.map((r, i) => (
        <li key={r.key} data-strong={i === 0 || undefined}>
          <span className="cl-rank__pos">{i + 1}</span>
          <div className="cl-rank__body">
            <div className="cl-rank__text">
              <span className="cl-rank__label">{r.label}</span>
              <span className="cl-rank__value">{r.display}</span>
            </div>
            <div className="cl-rank__track" aria-hidden>
              <span style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
            </div>
            {r.sub && <span className="cl-rank__sub">{r.sub}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Colunas em pé com dica; `strong` marca as que ganham laranja cheio. */
function Columns({
  items,
  label,
  height = 120,
}: {
  items: { key: string; label: string; value: number; tip: ReactNode; strong?: boolean }[];
  label: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.map((i) => i.value));
  const h = hover !== null ? items[hover] : null;
  return (
    <div className="cl-cols" style={{ '--h': `${height}px` } as CSSProperties}>
      <div className="cl-cols__plot" role="img" aria-label={label}>
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            className="cl-cols__col"
            data-strong={it.strong || undefined}
            data-dim={(hover !== null && hover !== i) || undefined}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${it.label}: ${typeof it.tip === 'string' ? it.tip : it.value}`}
          >
            <span
              className="cl-cols__bar"
              data-empty={it.value === 0 || undefined}
              style={{ height: `${it.value ? Math.max(4, (it.value / max) * 100) : 0}%` }}
            />
          </button>
        ))}
        {h && hover !== null && (
          <div
            className="cl-tip"
            style={{ left: `${((hover + 0.5) / items.length) * 100}%` }}
            data-edge={
              hover < items.length * 0.2 ? 'start' : hover > items.length * 0.8 ? 'end' : undefined
            }
          >
            <strong>{h.label}</strong>
            <span>{h.tip}</span>
          </div>
        )}
      </div>
      <div className="cl-cols__axis" aria-hidden>
        {/* Muitas colunas (horário): rótulo de duas em duas, para não encavalar. */}
        {items.map((it, i) => (
          <span key={it.key}>{items.length <= 12 || i % 2 === 0 ? it.label : ''}</span>
        ))}
      </div>
    </div>
  );
}

/** Barra única dividida em fatias + legenda com valor e porcentagem. */
function ShareBar({
  parts,
  label,
  format,
}: {
  parts: { key: string; label: string; value: number; display: string }[];
  label: string;
  /** Texto do valor somado em "Outros". */
  format?: (v: number) => string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return null;
  // Até 4 fatias; o resto vira "Outros".
  const shown = parts.length > 5 ? parts.slice(0, 4) : parts;
  const rest = parts.length > 5 ? parts.slice(4) : [];
  const all = rest.length
    ? [
        ...shown,
        {
          key: 'outros',
          label: 'Outros',
          value: rest.reduce((s, p) => s + p.value, 0),
          display: format ? format(rest.reduce((s, p) => s + p.value, 0)) : '',
        },
      ]
    : shown;
  return (
    <div className="cl-share">
      <div className="cl-share__bar" role="img" aria-label={label}>
        {all.map((p, i) => (
          <span
            key={p.key}
            style={{
              flexGrow: p.value,
              background: SHARE_TONES[Math.min(i, SHARE_TONES.length - 1)],
            }}
          />
        ))}
      </div>
      <ul className="cl-share__legend">
        {all.map((p, i) => (
          <li key={p.key}>
            <i style={{ background: SHARE_TONES[Math.min(i, SHARE_TONES.length - 1)] }} />
            <span className="cl-share__name">{p.label}</span>
            <span className="cl-share__val">
              {p.display && <>{p.display} · </>}
              <strong>{pct(p.value, total)}%</strong>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pedidos por mês (12 meses), dia da semana e hora. */
export function CustomerCharts({ c }: { c: CustomerDetail }) {
  const ins = c.insights;
  const months = ins.months;
  const bestMonth = months.reduce((b, m, i) => (m.orders > (months[b]?.orders ?? 0) ? i : b), 0);
  const days = WEEKDAYS.map((_, d) => ins.weekdays.find((w) => w.day === d)?.orders ?? 0);
  const bestDay = days.indexOf(Math.max(...days));
  // Horas em faixas de 2 h, só do intervalo em que ele pede (sem a madrugada vazia).
  const byHour = Array.from(
    { length: 24 },
    (_, h) => ins.hours.find((x) => x.hour === h)?.orders ?? 0,
  );
  const used = byHour.map((v, h) => (v ? h : -1)).filter((h) => h >= 0);
  const from = used.length ? Math.max(0, Math.min(...used) - 1) : 10;
  const to = used.length ? Math.min(23, Math.max(...used) + 1) : 23;
  const hours = byHour.slice(from, to + 1).map((v, i) => ({ hour: from + i, v }));
  const bestHour = hours.reduce((b, x, i) => (x.v > (hours[b]?.v ?? 0) ? i : b), 0);
  const monthsTotal = months.reduce((s, m) => s + m.orders, 0);
  return (
    <>
      <section className="cl-block">
        <header className="cl-block__head">
          <h3>Pedidos por mês</h3>
          <span>{plural(monthsTotal, 'pedido', 'pedidos')} nos últimos 12 meses</span>
        </header>
        <Columns
          label="Pedidos por mês nos últimos 12 meses"
          height={130}
          items={months.map((m, i) => ({
            key: m.month,
            label: monthShort(m.month),
            value: m.orders,
            strong: m.orders > 0 && i === bestMonth,
            tip: `${monthLong(m.month)}: ${plural(m.orders, 'pedido', 'pedidos')} · ${money(m.spent)}`,
          }))}
        />
      </section>
      <div className="cl-pair">
        <section className="cl-block">
          <header className="cl-block__head">
            <h3>Dia da semana</h3>
          </header>
          <Columns
            label="Pedidos por dia da semana"
            height={90}
            items={days.map((v, d) => ({
              key: String(d),
              label: WEEKDAYS[d]!,
              value: v,
              strong: v > 0 && d === bestDay,
              tip: plural(v, 'pedido', 'pedidos'),
            }))}
          />
        </section>
        <section className="cl-block">
          <header className="cl-block__head">
            <h3>Horário</h3>
          </header>
          <Columns
            label="Pedidos por hora do dia"
            height={90}
            items={hours.map((x, i) => ({
              key: String(x.hour),
              label: `${x.hour}h`,
              value: x.v,
              strong: x.v > 0 && i === bestHour,
              tip: `${hourRange(x.hour)}: ${plural(x.v, 'pedido', 'pedidos')}`,
            }))}
          />
        </section>
      </div>
    </>
  );
}

/** O que mais pede (itens), por categoria, canal e forma de pagamento. */
export function CustomerMix({ c }: { c: CustomerDetail }) {
  const ins = c.insights;
  const total = c.stats.orders;
  return (
    <>
      {c.favorites.length > 0 && (
        <section className="cl-block">
          <header className="cl-block__head">
            <h3>O que mais pede</h3>
            <span>do cardápio, por quantidade</span>
          </header>
          <RankBars
            label="Itens que o cliente mais pede"
            rows={c.favorites.map((f) => ({
              key: f.name,
              label: f.name,
              value: f.quantity,
              display: `${f.quantity}×`,
              sub: (
                <>
                  {f.category && <>{f.category} · </>}
                  em {pct(f.orders, total)}% dos pedidos · {money(f.spent)}
                </>
              ),
            }))}
          />
        </section>
      )}
      {ins.categories.length > 0 && (
        <section className="cl-block">
          <header className="cl-block__head">
            <h3>Por categoria</h3>
            <span>quanto gastou em cada uma</span>
          </header>
          <ShareBar
            label="Gasto por categoria do cardápio"
            format={money}
            parts={ins.categories.map((x) => ({
              key: x.name,
              label: x.name,
              value: toCents(x.spent),
              display: money(x.spent),
            }))}
          />
        </section>
      )}
      <div className="cl-pair">
        {ins.channels.length > 0 && (
          <section className="cl-block">
            <header className="cl-block__head">
              <h3>Como pede</h3>
            </header>
            <ShareBar
              label="Pedidos por canal"
              parts={ins.channels.map((x) => ({
                key: x.channel,
                label: channelLabel(x.channel),
                value: x.orders,
                display: plural(x.orders, 'pedido', 'pedidos'),
              }))}
            />
          </section>
        )}
        {ins.payments.length > 0 && (
          <section className="cl-block">
            <header className="cl-block__head">
              <h3>Como paga</h3>
            </header>
            <ShareBar
              label="Valor pago por forma de pagamento"
              parts={ins.payments.map((x) => ({
                key: x.method,
                label: methodLabel(x.method),
                value: toCents(x.amount),
                display: money(x.amount),
              }))}
            />
          </section>
        )}
      </div>
    </>
  );
}
