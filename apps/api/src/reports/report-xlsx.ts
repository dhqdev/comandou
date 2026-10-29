import type { ReportChart, ReportDoc, ReportFmt, ReportTable, ReportValue } from '@comandou/shared';
import {
  buildWorkbook,
  type Cell,
  type ChartSpec,
  range,
  type SheetSpec,
  sheetName,
  Styles,
  XDate,
} from './xlsx';

/**
 * Relatório → planilha do Excel. Aba "Resumo" com cabeçalho, indicadores (com o período
 * anterior e a variação) e cada gráfico com seus dados ao lado de um gráfico nativo do Excel;
 * uma aba por tabela, com cabeçalho fixo, filtro, total e barras de dados.
 */

const BRAND = 'E23A00';
const BRAND_DARK = 'B02A00';
const BRAND_SOFT = 'FFF2EC';
const INK = '18181B';
const MUTED = '7D7D85';
const GOOD = '2B8A3E';
const BAD = 'D0312D';
const PREV = 'A2A2A9';
/** Paleta das fatias (rosca): laranja da marca primeiro, depois tons que se distinguem. */
const PALETTE = ['E23A00', '2463D1', 'F2B705', '2B8A3E', '8E44AD', '5D5D65', 'FF8A5C', '0E9AA7'];

const NUM_FMT: Record<ReportFmt, string | undefined> = {
  money: '"R$" #,##0.00;[Red]-"R$" #,##0.00',
  int: '#,##0',
  num: '#,##0.00',
  pct: '0.0%',
  min: '0.0 "min"',
  text: undefined,
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
};

function toCellValue(v: ReportValue, fmt: ReportFmt): string | number | XDate | null {
  if (v === null || v === undefined) return null;
  if (fmt === 'text') return String(v);
  if (fmt === 'date' || fmt === 'datetime')
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new XDate(v) : String(v);
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return fmt === 'pct' ? n / 100 : n;
}

const fmtPeriod = (from: string, to: string) => {
  const d = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  return from === to ? d(from) : `${d(from)} a ${d(to)}`;
};

export function reportFileName(doc: ReportDoc): string {
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return `${slug(doc.title)}_${slug(doc.restaurant).slice(0, 30) || 'restaurante'}_${doc.from}_a_${doc.to}.xlsx`;
}

export function reportToXlsx(doc: ReportDoc): Buffer {
  const st = new Styles();
  const S = {
    band: st.style({ fill: BRAND, color: 'FFFFFF', bold: true, size: 9 }),
    bandRight: st.style({ fill: BRAND, color: 'FFFFFF', size: 9, align: 'right' }),
    title: st.style({ bold: true, size: 20, color: INK }),
    sub: st.style({ size: 10, color: MUTED }),
    section: st.style({
      bold: true,
      size: 11,
      color: BRAND_DARK,
      border: 'bottomStrong',
      borderColor: BRAND,
    }),
    head: st.style({
      bold: true,
      color: 'FFFFFF',
      fill: BRAND,
      valign: 'center',
      wrap: true,
      indent: 1,
    }),
    headNum: st.style({
      bold: true,
      color: 'FFFFFF',
      fill: BRAND,
      align: 'right',
      valign: 'center',
      wrap: true,
    }),
    headIndent: st.style({ bold: true, color: 'FFFFFF', fill: BRAND, valign: 'center', indent: 1 }),
    note: st.style({ italic: true, color: MUTED, size: 9, wrap: true, valign: 'top' }),
    kpiLabel: st.style({ color: INK, border: 'bottom', indent: 1 }),
    kpiPrev: (f: ReportFmt) =>
      st.style({ color: MUTED, numFmt: NUM_FMT[f], border: 'bottom', align: 'right' }),
    kpiVal: (f: ReportFmt, main?: boolean) =>
      st.style({
        bold: true,
        size: main ? 13 : 11,
        color: INK,
        numFmt: NUM_FMT[f],
        border: 'bottom',
        align: 'right',
      }),
    delta: (tone?: 'good' | 'bad') =>
      st.style({
        bold: true,
        color: tone === 'good' ? GOOD : tone === 'bad' ? BAD : MUTED,
        numFmt: '+0.0%;-0.0%;0.0%',
        border: 'bottom',
        align: 'right',
      }),
    kpiHint: st.style({ color: MUTED, size: 9, border: 'bottom', wrap: true, indent: 1 }),
    cell: (f: ReportFmt) =>
      st.style({
        numFmt: NUM_FMT[f],
        border: 'bottom',
        borderColor: 'EFEFF1',
        align: f === 'text' ? 'left' : 'right',
        wrap: f === 'text',
        indent: f === 'text' ? 1 : undefined,
        valign: 'top',
      }),
    total: (f: ReportFmt) =>
      st.style({
        bold: true,
        numFmt: NUM_FMT[f],
        fill: BRAND_SOFT,
        border: 'top',
        borderColor: BRAND,
        align: f === 'text' ? 'left' : 'right',
      }),
  };

  const used = new Set<string>();
  const subtitle = `${doc.restaurant} · ${fmtPeriod(doc.from, doc.to)} · comparado com ${fmtPeriod(doc.prevFrom, doc.prevTo)}`;
  const generated = `Gerado pelo Comandou em ${new Date(doc.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  /* ---------- Resumo ---------- */
  const rows: (Cell | null)[][] = [];
  const merges: string[] = [];
  const heights: Record<number, number> = {};
  const charts: ChartSpec[] = [];
  const dataBars: SheetSpec['dataBars'] = [];
  const colorScales: SheetSpec['colorScales'] = [];
  const put = (r: number, c: number, cell: Cell) => {
    while (rows.length <= r) rows.push([]);
    const row = rows[r]!;
    while (row.length <= c) row.push(null);
    row[c] = cell;
  };
  // Colunas: A margem | B rótulo | C valor | D anterior | E variação | F observação | G.. gráfico
  const WIDTH = 14; // colunas usadas (A..N)
  put(0, 1, { v: `COMANDOU · ${doc.group.toUpperCase()}`, s: S.band });
  for (let c = 0; c < WIDTH; c++) if (c !== 1) put(0, c, { v: null, s: S.band });
  put(0, WIDTH - 1, { v: 'Relatório gerencial', s: S.bandRight });
  heights[0] = 22;
  put(2, 1, { v: doc.title, s: S.title });
  heights[2] = 30;
  put(3, 1, { v: subtitle, s: S.sub });
  put(4, 1, { v: doc.description, s: S.sub });
  merges.push(range(1, 3, WIDTH - 1, 3), range(1, 4, WIDTH - 1, 4));
  let r = 6;

  if (doc.kpis.length) {
    put(r, 1, { v: 'Indicadores', s: S.section });
    for (let c = 2; c <= 6; c++) put(r, c, { v: null, s: S.section });
    r++;
    const hdr = ['Indicador', 'Período', 'Anterior', 'Variação', 'Observação'];
    hdr.forEach((h, i) =>
      put(r, 1 + i, { v: h, s: i === 0 ? S.head : i === 4 ? S.headIndent : S.headNum }),
    );
    merges.push(range(5, r, 6, r));
    put(r, 6, { v: null, s: S.head });
    heights[r] = 20;
    r++;
    for (const k of doc.kpis) {
      const val = toCellValue(k.value, k.fmt);
      const prev = k.prev ?? null;
      const cur = typeof val === 'number' ? (k.fmt === 'pct' ? val * 100 : val) : null;
      let delta: number | null = null;
      if (cur !== null && prev !== null && prev !== 0) delta = (cur - prev) / Math.abs(prev);
      const tone =
        delta === null || Math.abs(delta) < 0.005
          ? undefined
          : delta > 0 !== !!k.invert
            ? 'good'
            : 'bad';
      put(r, 1, { v: k.label, s: S.kpiLabel });
      put(r, 2, { v: val, s: S.kpiVal(k.fmt, k.main) });
      put(r, 3, { v: prev === null ? null : toCellValue(prev, k.fmt), s: S.kpiPrev(k.fmt) });
      put(r, 4, { v: delta, s: S.delta(tone) });
      put(r, 5, { v: k.hint ?? null, s: S.kpiHint });
      put(r, 6, { v: null, s: S.kpiHint });
      merges.push(range(5, r, 6, r));
      heights[r] = k.main ? 22 : 18;
      r++;
    }
    r += 1;
  }

  for (const ch of doc.charts) r = writeChart(ch, r);

  if (doc.notes.length) {
    put(r, 1, { v: 'Como ler', s: S.section });
    for (let c = 2; c < WIDTH; c++) put(r, c, { v: null, s: S.section });
    r++;
    for (const n of doc.notes) {
      put(r, 1, { v: n, s: S.note });
      merges.push(range(1, r, WIDTH - 1, r));
      heights[r] = n.length > 150 ? 30 : 16;
      r++;
    }
    r++;
  }
  put(r, 1, { v: generated, s: S.note });
  merges.push(range(1, r, WIDTH - 1, r));

  function writeChart(ch: ReportChart, start: number): number {
    let row = start;
    put(row, 1, { v: ch.title, s: S.section });
    for (let c = 2; c < WIDTH; c++) put(row, c, { v: null, s: S.section });
    row += 2;
    if (ch.kind === 'heat') {
      put(row, 1, { v: '', s: S.head });
      ch.cols.forEach((c, i) => put(row, 2 + i, { v: c, s: S.headNum }));
      const top = row + 1;
      ch.rows.forEach((label, i) => {
        put(top + i, 1, { v: label, s: S.cell('text') });
        ch.cols.forEach((_, j) =>
          put(top + i, 2 + j, { v: ch.values[i]?.[j] ?? 0, s: S.cell(ch.fmt) }),
        );
      });
      if (ch.rows.length && ch.cols.length)
        colorScales!.push({
          ref: range(2, top, 1 + ch.cols.length, top + ch.rows.length - 1),
          from: 'FFFFFF',
          to: 'FF8A5C',
        });
      return top + ch.rows.length + 2;
    }
    if (ch.kind === 'scatter') {
      ['Item', ch.x.label, ch.y.label, 'Classe'].forEach((h, i) =>
        put(row, 1 + i, { v: h, s: i === 0 || i === 3 ? S.head : S.headNum }),
      );
      const groups = new Map(ch.groups.map((g) => [g.id, g.label]));
      ch.points.forEach((p, i) => {
        put(row + 1 + i, 1, { v: p.label, s: S.cell('text') });
        put(row + 1 + i, 2, { v: toCellValue(p.x, ch.x.fmt), s: S.cell(ch.x.fmt) });
        put(row + 1 + i, 3, { v: toCellValue(p.y, ch.y.fmt), s: S.cell(ch.y.fmt) });
        put(row + 1 + i, 4, { v: groups.get(p.group) ?? p.group, s: S.cell('text') });
      });
      return row + ch.points.length + 3;
    }
    const pts = ch.points;
    const hasPrev = ch.kind === 'line' && pts.some((p) => p.prev !== undefined && p.prev !== null);
    const names =
      ch.kind === 'line'
        ? [ch.series[0], ch.series[1] ?? 'Anterior']
        : [ch.fmt === 'money' ? 'Valor' : 'Quantidade', ''];
    put(row, 1, { v: ch.kind === 'line' ? 'Data' : 'Item', s: S.head });
    put(row, 2, { v: names[0], s: S.headNum });
    if (hasPrev) put(row, 3, { v: names[1], s: S.headNum });
    if (ch.kind === 'donut') put(row, 3, { v: '%', s: S.headNum });
    const top = row + 1;
    const total = pts.reduce((n, p) => n + p.value, 0);
    pts.forEach((p, i) => {
      put(top + i, 1, { v: p.label, s: S.cell('text') });
      put(top + i, 2, { v: toCellValue(p.value, ch.fmt), s: S.cell(ch.fmt) });
      if (hasPrev)
        put(top + i, 3, {
          v: p.prev === undefined ? null : toCellValue(p.prev, ch.fmt),
          s: S.cell(ch.fmt),
        });
      if (ch.kind === 'donut')
        put(top + i, 3, { v: total ? p.value / total : 0, s: S.cell('pct') });
    });
    const last = top + Math.max(0, pts.length - 1);
    if (pts.length && ch.kind !== 'line')
      dataBars!.push({ ref: range(2, top, 2, last), color: 'FF8A5C' });
    if (pts.length) {
      const height = Math.max(16, Math.min(28, pts.length + 4));
      charts.push({
        kind:
          ch.kind === 'line'
            ? 'line'
            : ch.kind === 'columns'
              ? 'column'
              : ch.kind === 'donut'
                ? 'doughnut'
                : 'bar',
        title: ch.title,
        cats: { col: 1, from: top, to: last },
        series: [
          { name: String(names[0]), col: 2, color: BRAND },
          ...(hasPrev ? [{ name: String(names[1]), col: 3, color: PREV }] : []),
        ],
        numFmt: ch.fmt === 'pct' ? '0%' : ch.fmt === 'money' ? '"R$" #,##0' : '#,##0',
        at: { col: 6, row: row, toCol: WIDTH, toRow: row + height },
        palette: PALETTE,
      });
      return Math.max(last + 3, row + height + 2);
    }
    put(top, 1, { v: 'Sem dados no período.', s: S.note });
    return top + 2;
  }

  const summary: SheetSpec = {
    name: sheetName('Resumo', used),
    rows,
    cols: [2, 30, 16, 16, 14, 20, 12, 12, 12, 12, 12, 12, 12, 12],
    merges,
    rowHeights: heights,
    charts,
    dataBars,
    colorScales,
    showGrid: false,
    tabColor: BRAND,
    landscape: true,
  };

  /* ---------- uma aba por tabela ---------- */
  const tableSheets = doc.tables.map((t) => tableSheet(t));

  function tableSheet(t: ReportTable): SheetSpec {
    const out: (Cell | null)[][] = [];
    const n = t.columns.length;
    out.push([{ v: t.title, s: st.style({ bold: true, size: 14, color: INK }) }]);
    out.push([{ v: `${doc.title} · ${subtitle}`, s: S.sub }]);
    const head = 3;
    out.push(t.hint ? [{ v: t.hint, s: S.note }] : []);
    out.push(
      t.columns.map((c) => ({
        v: c.label,
        s: c.fmt === 'text' || c.fmt === 'date' || c.fmt === 'datetime' ? S.head : S.headNum,
      })),
    );
    for (const row of t.rows)
      out.push(
        t.columns.map((c) => ({ v: toCellValue(row[c.key] ?? null, c.fmt), s: S.cell(c.fmt) })),
      );
    const lastData = head + t.rows.length;
    if (!t.rows.length) out.push([{ v: 'Sem dados no período.', s: S.note }]);
    if (t.total && t.rows.length)
      out.push(
        t.columns.map((c, i) => ({
          v:
            i === 0 && (t.total![c.key] ?? null) === null
              ? 'Total'
              : toCellValue(t.total![c.key] ?? null, c.fmt),
          s: S.total(i === 0 ? 'text' : c.fmt),
        })),
      );
    if (t.truncated)
      out.push(
        [],
        [
          {
            v: 'A lista foi limitada às primeiras linhas; filtre um período menor para ver todas.',
            s: S.note,
          },
        ],
      );
    const barCol = t.bar ? t.columns.findIndex((c) => c.key === t.bar) : -1;
    return {
      name: sheetName(t.title, used),
      rows: out,
      cols: t.columns.map(
        (c) =>
          c.width ??
          (c.fmt === 'text'
            ? Math.min(
                46,
                Math.max(
                  12,
                  c.label.length + 2,
                  ...t.rows.slice(0, 200).map((r) => String(r[c.key] ?? '').length + 2),
                ),
              )
            : c.fmt === 'datetime'
              ? 17
              : Math.max(13, c.label.length + 3)),
      ),
      freeze: { row: head + 1, col: 1 },
      autoFilter: t.rows.length ? range(0, head, n - 1, lastData) : undefined,
      dataBars:
        barCol >= 0 && t.rows.length
          ? [{ ref: range(barCol, head + 1, barCol, lastData), color: 'FF8A5C' }]
          : [],
      rowHeights: { 0: 24, [head]: 30 },
      showGrid: false,
      landscape: n > 6,
    };
  }

  return buildWorkbook([summary, ...tableSheets], st, {
    title: `${doc.title} — ${doc.restaurant}`,
    created: new Date(doc.generatedAt),
  });
}
