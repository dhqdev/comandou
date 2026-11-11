import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import type {
  ReportChart,
  ReportColumn,
  ReportDoc,
  ReportFmt,
  ReportKpi,
  ReportPoint,
  ReportTable,
  ReportValue,
} from '@comandou/shared';
import { pdfSafe } from '../platform/contracts/contract-pdf';

/**
 * Relatório → PDF (A4) pronto para mandar ao contador ou ao sócio: cabeçalho com o restaurante
 * e o período, indicadores em cartões com a variação, gráficos desenhados em barras e as
 * tabelas completas, com cabeçalho repetido em cada página, total e número de página.
 * Fontes padrão do PDF (Helvetica, WinAnsi): cobre o português sem embutir fonte.
 */

type Color = ReturnType<typeof rgb>;
const hex = (h: string): Color =>
  rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
const BRAND = hex('E23A00');
const BRAND_SOFT = hex('FFF2EC');
const INK = hex('18181B');
const MUTED = hex('6B6B73');
const SUBTLE = hex('9A9AA2');
const LINE = hex('E4E4E7');
const SOFT = hex('F6F6F7');
const GOOD = hex('2B8A3E');
const BAD = hex('D0312D');
const PREV = hex('C9C9CE');
const WHITE = rgb(1, 1, 1);

const MARGIN = 40;
const FOOTER = 34;

const clean = (s: string) => pdfSafe(s.replace(/[  ]/g, ' ').replace(/\n/g, ' '));
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o);
const MONEY = nf({ style: 'currency', currency: 'BRL' });
const INT = nf({ maximumFractionDigits: 0 });
const NUM = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ONE = nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dmy = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const DATETIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatReportValue(v: ReportValue, fmt: ReportFmt): string {
  if (v === null || v === undefined || v === '') return '-';
  if (fmt === 'text') return clean(String(v));
  if (fmt === 'date')
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? dmy(v) : clean(String(v));
  if (fmt === 'datetime') {
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? clean(String(v)) : clean(DATETIME.format(d));
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return clean(String(v));
  if (fmt === 'money') return clean(MONEY.format(n));
  if (fmt === 'int') return INT.format(n);
  if (fmt === 'pct') return `${ONE.format(n)}%`;
  if (fmt === 'min') return `${ONE.format(n)} min`;
  return NUM.format(n);
}

const isText = (f: ReportFmt) => f === 'text' || f === 'date' || f === 'datetime';
const period = (from: string, to: string) =>
  from === to ? dmy(from) : `${dmy(from)} a ${dmy(to)}`;

class Sheet {
  page!: PDFPage;
  y = 0;
  readonly w: number;
  readonly h: number;
  constructor(
    readonly pdf: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    landscape: boolean,
    /** Chamado em toda página nova (menos a primeira): repete o cabeçalho da tabela. */
    public onBreak: (() => void) | null = null,
  ) {
    [this.w, this.h] = landscape ? [841.89, 595.28] : [595.28, 841.89];
    this.add();
  }
  get width() {
    return this.w - MARGIN * 2;
  }
  private add() {
    this.page = this.pdf.addPage([this.w, this.h]);
    this.page.drawRectangle({ x: 0, y: this.h - 5, width: this.w, height: 5, color: BRAND });
    this.y = this.h - MARGIN;
  }
  /** Garante `need` pontos de altura; se não couber, abre outra página. */
  room(need: number) {
    if (this.y - need >= MARGIN + FOOTER) return false;
    this.add();
    this.onBreak?.();
    return true;
  }
  fit(text: string, font: PDFFont, size: number, max: number) {
    let t = clean(text);
    if (font.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > max) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  }
  wrap(text: string, font: PDFFont, size: number, max: number) {
    const out: string[] = [];
    let line = '';
    for (const word of clean(text).split(/ +/)) {
      const next = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(next, size) <= max) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
    return out.map((l) => this.fit(l, font, size, max));
  }
  text(
    s: string,
    x: number,
    y: number,
    o: { font?: PDFFont; size?: number; color?: Color; right?: boolean; max?: number } = {},
  ) {
    const font = o.font ?? this.regular;
    const size = o.size ?? 9;
    const t = o.max ? this.fit(s, font, size, o.max) : clean(s);
    const dx = o.right ? -font.widthOfTextAtSize(t, size) : 0;
    this.page.drawText(t, { x: x + dx, y, font, size, color: o.color ?? INK });
  }
  /** Parágrafo quebrado na largura útil, a partir do y atual. */
  para(s: string, size: number, color: Color, font = this.regular, gap = 3) {
    for (const l of this.wrap(s, font, size, this.width)) {
      this.room(size + gap);
      this.y -= size;
      this.text(l, MARGIN, this.y, { font, size, color });
      this.y -= gap;
    }
  }
  heading(s: string, hint?: string) {
    this.room(46);
    this.y -= 18;
    this.text(s, MARGIN, this.y, { font: this.bold, size: 12, max: this.width });
    this.y -= 6;
    if (hint) this.para(hint, 8, MUTED);
    this.y -= 4;
  }
}

function drawKpis(s: Sheet, kpis: ReportKpi[]) {
  if (!kpis.length) return;
  const perRow = s.w > 700 ? 5 : 4;
  const gap = 8;
  const cw = (s.width - gap * (perRow - 1)) / perRow;
  const ch = 58;
  for (let i = 0; i < kpis.length; i += perRow) {
    s.room(ch + gap);
    const top = s.y;
    kpis.slice(i, i + perRow).forEach((k, j) => {
      const x = MARGIN + j * (cw + gap);
      s.page.drawRectangle({
        x,
        y: top - ch,
        width: cw,
        height: ch,
        color: k.main ? BRAND_SOFT : WHITE,
        borderColor: k.main ? BRAND_SOFT : LINE,
        borderWidth: 0.8,
      });
      s.text(k.label, x + 9, top - 15, { size: 7.5, color: MUTED, max: cw - 18 });
      const tone = k.tone === 'good' ? GOOD : k.tone === 'bad' ? BAD : INK;
      s.text(formatReportValue(k.value, k.fmt), x + 9, top - 33, {
        font: s.bold,
        size: 13,
        color: tone,
        max: cw - 18,
      });
      const cur = typeof k.value === 'number' ? k.value : Number(k.value);
      if (k.prev !== undefined && k.prev !== null && Number.isFinite(cur) && k.prev !== 0) {
        const d = ((cur - k.prev) / Math.abs(k.prev)) * 100;
        const up = d >= 0;
        const good = k.invert ? !up : up;
        s.text(`${up ? '+' : ''}${ONE.format(d)}% vs. anterior`, x + 9, top - 47, {
          size: 7.5,
          color: Math.abs(d) < 0.05 ? MUTED : good ? GOOD : BAD,
          max: cw - 18,
        });
      } else if (k.hint) {
        s.text(k.hint, x + 9, top - 47, { size: 7.5, color: SUBTLE, max: cw - 18 });
      }
    });
    s.y = top - ch - gap;
  }
  s.y -= 4;
}

/** Barras deitadas: um ponto por linha (nome, barra, valor). Serve para barras e rosca. */
function drawBars(s: Sheet, points: ReportPoint[], fmt: ReportFmt, share: boolean) {
  const list = points.slice(0, 15);
  const max = Math.max(...list.map((p) => Math.abs(p.value)), 0) || 1;
  const total = points.reduce((a, p) => a + p.value, 0) || 1;
  const labelW = Math.min(170, s.width * 0.3);
  const valueW = share ? 120 : 80;
  const barW = s.width - labelW - valueW - 16;
  for (const p of list) {
    s.room(16);
    s.y -= 12;
    s.text(p.label, MARGIN, s.y, { size: 8.5, max: labelW });
    s.page.drawRectangle({
      x: MARGIN + labelW + 8,
      y: s.y - 2,
      width: barW,
      height: 8,
      color: SOFT,
    });
    s.page.drawRectangle({
      x: MARGIN + labelW + 8,
      y: s.y - 2,
      width: Math.max(1, (Math.abs(p.value) / max) * barW),
      height: 8,
      color: BRAND,
    });
    const v = formatReportValue(p.value, fmt);
    s.text(share ? `${v}  (${ONE.format((p.value / total) * 100)}%)` : v, MARGIN + s.width, s.y, {
      font: s.bold,
      size: 8.5,
      right: true,
    });
    s.y -= 4;
  }
  if (points.length > list.length)
    s.para(`e mais ${points.length - list.length} na tabela`, 7.5, SUBTLE);
}

/** Colunas em pé para séries no tempo (linha e colunas), com a comparação em cinza atrás. */
function drawColumns(s: Sheet, points: ReportPoint[], fmt: ReportFmt, series?: [string, string?]) {
  const H = 110;
  s.room(H + 40);
  const top = s.y - 6;
  const base = top - H;
  const max = Math.max(...points.flatMap((p) => [p.value, p.prev ?? 0]), 0) || 1;
  const n = points.length || 1;
  const slot = s.width / n;
  const bw = Math.max(1.5, Math.min(22, slot * 0.62));
  for (let g = 0; g <= 2; g++) {
    const gy = base + (H * g) / 2;
    s.page.drawLine({
      start: { x: MARGIN, y: gy },
      end: { x: MARGIN + s.width, y: gy },
      thickness: 0.5,
      color: LINE,
    });
    if (g > 0)
      s.text(formatReportValue((max * g) / 2, fmt), MARGIN, gy + 2, { size: 6.5, color: SUBTLE });
  }
  const every = Math.ceil(n / (s.width / 46));
  points.forEach((p, i) => {
    const cx = MARGIN + slot * i + slot / 2;
    if (p.prev)
      s.page.drawRectangle({
        x: cx - bw / 2 - bw * 0.22,
        y: base,
        width: bw,
        height: (Math.max(0, p.prev) / max) * H,
        color: PREV,
      });
    s.page.drawRectangle({
      x: cx - bw / 2 + (p.prev ? bw * 0.22 : 0),
      y: base,
      width: bw,
      height: Math.max(0.5, (Math.max(0, p.value) / max) * H),
      color: BRAND,
    });
    if (i % every === 0) {
      const t = s.fit(p.label, s.regular, 6.5, Math.max(slot * every - 4, 20));
      s.text(t, cx - s.regular.widthOfTextAtSize(t, 6.5) / 2, base - 10, {
        size: 6.5,
        color: MUTED,
      });
    }
  });
  s.y = base - 16;
  if (series?.[1] && points.some((p) => p.prev)) {
    s.y -= 8;
    s.page.drawRectangle({ x: MARGIN, y: s.y, width: 7, height: 7, color: BRAND });
    s.text(series[0], MARGIN + 11, s.y + 1, { size: 7.5, color: MUTED });
    const x2 = MARGIN + 22 + s.regular.widthOfTextAtSize(clean(series[0]), 7.5);
    s.page.drawRectangle({ x: x2, y: s.y, width: 7, height: 7, color: PREV });
    s.text(series[1], x2 + 11, s.y + 1, { size: 7.5, color: MUTED });
    s.y -= 4;
  }
}

function drawHeat(s: Sheet, ch: Extract<ReportChart, { kind: 'heat' }>) {
  const labelW = 62;
  const cw = (s.width - labelW) / (ch.cols.length || 1);
  const rh = 13;
  const max = Math.max(...ch.values.flat(), 0) || 1;
  s.room(rh * (ch.rows.length + 1) + 8);
  s.y -= 10;
  ch.cols.forEach((c, j) => {
    const t = s.fit(c, s.regular, 6.5, cw);
    s.text(t, MARGIN + labelW + j * cw + (cw - s.regular.widthOfTextAtSize(t, 6.5)) / 2, s.y, {
      size: 6.5,
      color: MUTED,
    });
  });
  s.y -= 4;
  ch.rows.forEach((r, i) => {
    s.y -= rh;
    s.text(r, MARGIN, s.y + 3.5, { size: 7.5, color: MUTED, max: labelW - 4 });
    ch.cols.forEach((_, j) => {
      const v = ch.values[i]?.[j] ?? 0;
      const k = v / max;
      s.page.drawRectangle({
        x: MARGIN + labelW + j * cw + 0.5,
        y: s.y + 0.5,
        width: cw - 1,
        height: rh - 1,
        color: v > 0 ? rgb(1 - 0.114 * k, 1 - 0.773 * k, 1 - k) : SOFT,
      });
    });
  });
  s.y -= 6;
}

function drawChart(s: Sheet, ch: ReportChart) {
  if (ch.kind === 'scatter') return; // os mesmos dados vêm na tabela do relatório
  if (ch.kind === 'heat') {
    if (!ch.rows.length) return;
    s.heading(ch.title);
    return drawHeat(s, ch);
  }
  if (!ch.points.length) return;
  s.heading(ch.title);
  if (ch.kind === 'bars' || ch.kind === 'donut')
    drawBars(s, ch.points, ch.fmt, ch.kind === 'donut');
  else drawColumns(s, ch.points, ch.fmt, ch.kind === 'line' ? ch.series : undefined);
}

function columnWidths(s: Sheet, t: ReportTable) {
  const pad = 10;
  const natural = t.columns.map((c) => {
    const head = s.bold.widthOfTextAtSize(clean(c.label), 7.5);
    const body = Math.max(
      0,
      ...t.rows
        .slice(0, 60)
        .map((r) => s.regular.widthOfTextAtSize(formatReportValue(r[c.key] ?? null, c.fmt), 8)),
    );
    return Math.min(Math.max(head, body) + pad, isText(c.fmt) ? 240 : 110);
  });
  const sum = natural.reduce((a, b) => a + b, 0);
  if (sum <= s.width) {
    // Sobra espaço: vai para as colunas de texto (ou para todas, se não houver).
    const flex = t.columns.map((c) => (c.fmt === 'text' ? 1 : 0));
    const parts = flex.reduce((a: number, b) => a + b, 0) || t.columns.length;
    const extra = (s.width - sum) / parts;
    return natural.map((w, i) => w + (flex[i] || parts === t.columns.length ? extra : 0));
  }
  return natural.map((w) => (w / sum) * s.width);
}

function drawTable(s: Sheet, t: ReportTable) {
  if (!t.columns.length) return;
  s.heading(t.title, t.hint);
  const widths = columnWidths(s, t);
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const rh = 15;
  const cell = (c: ReportColumn, i: number, v: string, y: number, font: PDFFont, color: Color) => {
    const max = widths[i]! - 8;
    if (isText(c.fmt)) s.text(v, xs[i]! + 4, y, { font, size: 8, color, max });
    else s.text(v, xs[i]! + widths[i]! - 4, y, { font, size: 8, color, max, right: true });
  };
  const head = () => {
    s.page.drawRectangle({ x: MARGIN, y: s.y - rh, width: s.width, height: rh, color: SOFT });
    t.columns.forEach((c, i) => {
      const max = widths[i]! - 8;
      if (isText(c.fmt))
        s.text(c.label, xs[i]! + 4, s.y - 10.5, { font: s.bold, size: 7.5, color: MUTED, max });
      else
        s.text(c.label, xs[i]! + widths[i]! - 4, s.y - 10.5, {
          font: s.bold,
          size: 7.5,
          color: MUTED,
          max,
          right: true,
        });
    });
    s.y -= rh;
  };
  s.room(rh * 3);
  head();
  s.onBreak = head;
  if (!t.rows.length) {
    s.y -= 14;
    s.text('Sem dados no período.', MARGIN + 4, s.y, { size: 8, color: SUBTLE });
    s.y -= 4;
  }
  for (const row of t.rows) {
    s.room(rh);
    t.columns.forEach((c, i) =>
      cell(c, i, formatReportValue(row[c.key] ?? null, c.fmt), s.y - 10.5, s.regular, INK),
    );
    s.y -= rh;
    s.page.drawLine({
      start: { x: MARGIN, y: s.y },
      end: { x: MARGIN + s.width, y: s.y },
      thickness: 0.4,
      color: LINE,
    });
  }
  if (t.total) {
    s.room(rh + 2);
    s.page.drawRectangle({ x: MARGIN, y: s.y - rh, width: s.width, height: rh, color: BRAND_SOFT });
    t.columns.forEach((c, i) => {
      const v = t.total![c.key];
      if (i === 0 && (v === undefined || v === null))
        return s.text('Total', xs[0]! + 4, s.y - 10.5, { font: s.bold, size: 8 });
      if (v === undefined || v === null) return;
      cell(c, i, formatReportValue(v, c.fmt), s.y - 10.5, s.bold, INK);
    });
    s.y -= rh;
  }
  s.onBreak = null;
  if (t.truncated) {
    s.y -= 2;
    s.para('Há mais linhas além das mostradas. Baixe o Excel para ver todas.', 7.5, SUBTLE);
  }
  s.y -= 6;
}

export function reportPdfFileName(doc: ReportDoc): string {
  const slug = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  return `${slug(doc.title) || 'relatorio'}-${doc.from}${doc.from === doc.to ? '' : `-a-${doc.to}`}.pdf`;
}

export async function reportToPdf(doc: ReportDoc): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.title} - ${doc.restaurant}`);
  pdf.setCreator('Comandou');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Tabela larga (mais de 7 colunas) pede a folha deitada.
  const landscape = doc.tables.some((t) => t.columns.length > 7);
  const s = new Sheet(pdf, regular, bold, landscape);

  // Cabeçalho
  s.y -= 8;
  s.text(doc.restaurant.toUpperCase(), MARGIN, s.y, {
    font: bold,
    size: 8,
    color: BRAND,
    max: s.width,
  });
  s.y -= 24;
  s.text(doc.title, MARGIN, s.y, { font: bold, size: 20, max: s.width });
  s.y -= 16;
  s.text(
    `Período: ${period(doc.from, doc.to)}   ·   Comparado com: ${period(doc.prevFrom, doc.prevTo)}`,
    MARGIN,
    s.y,
    { size: 9, color: MUTED, max: s.width },
  );
  s.y -= 6;
  if (doc.description) s.para(doc.description, 8.5, MUTED);
  s.y -= 8;
  s.page.drawLine({
    start: { x: MARGIN, y: s.y },
    end: { x: MARGIN + s.width, y: s.y },
    thickness: 0.8,
    color: LINE,
  });
  s.y -= 14;

  drawKpis(s, doc.kpis);
  for (const ch of doc.charts) drawChart(s, ch);
  for (const t of doc.tables) drawTable(s, t);
  if (doc.notes.length) {
    s.heading('Observações');
    for (const n of doc.notes) s.para(`- ${n}`, 8.5, MUTED);
  }

  // Rodapé com a data e o número de cada página.
  const pages = pdf.getPages();
  const when = clean(DATETIME.format(new Date(doc.generatedAt)));
  pages.forEach((p, i) => {
    const { width } = p.getSize();
    p.drawLine({
      start: { x: MARGIN, y: MARGIN + 12 },
      end: { x: width - MARGIN, y: MARGIN + 12 },
      thickness: 0.5,
      color: LINE,
    });
    p.drawText(clean(`${doc.restaurant} · ${doc.title} · gerado em ${when} pelo Comandou`), {
      x: MARGIN,
      y: MARGIN,
      font: regular,
      size: 7,
      color: SUBTLE,
    });
    const n = `Página ${i + 1} de ${pages.length}`;
    p.drawText(n, {
      x: width - MARGIN - regular.widthOfTextAtSize(n, 7),
      y: MARGIN,
      font: regular,
      size: 7,
      color: SUBTLE,
    });
  });
  return Buffer.from(await pdf.save());
}
