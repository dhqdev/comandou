import { PDFDocument, PDFPage, rgb } from 'pdf-lib';
import {
  fonts,
  Fonts,
  INK,
  LINE,
  MARGIN,
  MUTED,
  pdfSafe,
  Writer,
  WIDTH,
} from '../platform/contracts/contract-pdf';
import { AgentMenuCategory, brl } from './ai-agent-prompt';

/**
 * PDFs que a IA manda no WhatsApp do restaurante: o cardápio liberado para ela e o calendário de
 * reservas (dias e horários livres). A4, fontes padrão do PDF, laranja do Comandou nos destaques.
 */

const BRAND = rgb(0.886, 0.227, 0);
const SOFT = rgb(0.995, 0.93, 0.89);
const PAPER = rgb(0.965, 0.965, 0.97);
const GREY = rgb(0.7, 0.7, 0.73);

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

/** "2026-11-20" → "20/11". */
export const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
/** "2026-11-20" → "sex 20/11". */
export const dayLabel = (date: string) =>
  `${WEEK[new Date(`${date}T12:00:00Z`).getUTCDay()]!.toLowerCase()} ${ddmm(date)}`;

/** Nome de arquivo seguro para o WhatsApp ("Cardápio - Casa do Lanche.pdf"). */
export function pdfFileName(kind: string, tenantName: string): string {
  const clean = tenantName
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  return `${kind}${clean ? ` - ${clean}` : ''}.pdf`;
}

function header(w: Writer, title: string, tenantName: string, sub: string) {
  w.text(tenantName, { font: w.f.bold, size: 10, color: BRAND, gap: 2 });
  w.text(title, { font: w.f.bold, size: 22, gap: 2 });
  w.text(sub, { size: 9.5, color: MUTED, gap: 6 });
  w.rule(6);
}

function footer(doc: PDFDocument, f: Fonts, left: string) {
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const size = 7.5;
    p.drawLine({
      start: { x: MARGIN, y: 44 },
      end: { x: MARGIN + WIDTH, y: 44 },
      thickness: 0.4,
      color: LINE,
    });
    p.drawText(pdfSafe(left).slice(0, 110), {
      x: MARGIN,
      y: 32,
      size,
      font: f.regular,
      color: MUTED,
    });
    const right = `Página ${i + 1} de ${pages.length}`;
    p.drawText(pdfSafe(right), {
      x: MARGIN + WIDTH - f.regular.widthOfTextAtSize(pdfSafe(right), size),
      y: 32,
      size,
      font: f.regular,
      color: MUTED,
    });
  });
}

// ------------------------------------------------------------------ cardápio

export async function renderMenuPdf(o: {
  tenantName: string;
  menu: AgentMenuCategory[];
  showPrices: boolean;
  storeUrl: string | null;
  now: Date;
  timezone: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Cardápio - ${o.tenantName}`));
  doc.setProducer('Comandou');
  const f = await fonts(doc);
  const w = new Writer(doc, f);
  const today = o.now.toLocaleDateString('pt-BR', { timeZone: o.timezone });
  header(w, 'Cardápio', o.tenantName, `Atualizado em ${today}. Itens e preços podem mudar.`);

  for (const c of o.menu) {
    if (!c.products.length) continue;
    w.ensure(60);
    w.y -= 4;
    w.text(c.name.toUpperCase(), { font: f.bold, size: 11, color: BRAND, gap: 6 });
    for (const p of c.products) {
      const price = o.showPrices
        ? `${brl(p.price)}${p.soldByWeight ? ' o kg' : ''}`
        : p.soldByWeight
          ? 'por peso'
          : '';
      const size = 10.5;
      w.ensure(size * 3);
      const priceW = price ? f.bold.widthOfTextAtSize(pdfSafe(price), size) : 0;
      const nameLines = w.wrap(
        p.soldOut ? `${p.name} (esgotado hoje)` : p.name,
        f.bold,
        size,
        WIDTH - priceW - 16,
      );
      nameLines.forEach((l, i) => {
        w.page.drawText(l, {
          x: MARGIN,
          y: w.y - size,
          size,
          font: f.bold,
          color: p.soldOut ? MUTED : INK,
        });
        if (i === 0 && price)
          w.page.drawText(pdfSafe(price), {
            x: MARGIN + WIDTH - priceW,
            y: w.y - size,
            size,
            font: f.bold,
            color: p.soldOut ? MUTED : INK,
          });
        w.y -= size * 1.4;
      });
      if (p.description)
        w.text(p.description.replace(/\s+/g, ' ').slice(0, 300), {
          size: 9,
          color: MUTED,
          gap: 1,
        });
      for (const g of p.optionGroups) {
        if (!g.options.length) continue;
        const opts = g.options
          .slice(0, 30)
          .map((x) =>
            o.showPrices && Number(x.priceDelta) > 0 ? `${x.name} (+${brl(x.priceDelta)})` : x.name,
          )
          .join(', ');
        w.text(`${g.name}: ${opts}`, { size: 8.5, color: MUTED, indent: 10, gap: 1 });
      }
      w.y -= 7;
    }
  }
  if (!o.menu.some((c) => c.products.length))
    w.text('O cardápio está sendo atualizado. Fale com a gente pelo WhatsApp.', { color: MUTED });

  footer(doc, f, o.storeUrl ? `Peça pelo cardápio online: ${o.storeUrl}` : o.tenantName);
  return doc.save();
}

// ------------------------------------------------------------------ calendário de reservas

export interface CalendarDay {
  date: string;
  weekday: number;
  open: boolean;
  free: string[];
  full: boolean;
}

export async function renderCalendarPdf(o: {
  tenantName: string;
  days: CalendarDay[];
  maxParty: number;
  minAdvanceMinutes: number;
  note: string | null;
  now: Date;
  timezone: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Calendário de reservas - ${o.tenantName}`));
  doc.setProducer('Comandou');
  const f = await fonts(doc);
  const w = new Writer(doc, f);
  const first = o.days[0]?.date;
  const last = o.days[o.days.length - 1]?.date;
  const when = o.now.toLocaleString('pt-BR', {
    timeZone: o.timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  });
  header(
    w,
    'Calendário de reservas',
    o.tenantName,
    first && last
      ? `Dias e horários livres de ${ddmm(first)} a ${ddmm(last)}. Atualizado em ${when}; os lugares mudam a todo momento.`
      : `Atualizado em ${when}.`,
  );

  // Um quadro de mês para cada mês do período.
  const byMonth = new Map<string, CalendarDay[]>();
  for (const d of o.days) {
    const k = d.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), d]);
  }
  for (const [month, days] of byMonth) monthGrid(w, f, month, days);
  legend(w, f);

  // Lista dos horários livres de cada dia.
  w.ensure(40);
  w.y -= 6;
  w.text('HORÁRIOS LIVRES', { font: f.bold, size: 11, color: BRAND, gap: 6 });
  const open = o.days.filter((d) => d.open);
  if (!open.length) w.text('Nenhum dia aberto para reserva no momento.', { color: MUTED });
  for (const d of open) w.labeled(`${dayLabel(d.date)}:`, d.full ? 'lotado' : d.free.join('  ·  '));

  w.y -= 8;
  w.text('COMO RESERVAR', { font: f.bold, size: 11, color: BRAND, gap: 6 });
  const tips = [
    'Responda no WhatsApp com o dia, o horário e quantas pessoas vêm. A gente confere e pede a sua confirmação.',
    `Até ${o.maxParty} pessoas por reserva; para grupos maiores, fale com a gente.`,
    o.minAdvanceMinutes > 0
      ? `Reserve com pelo menos ${advanceText(o.minAdvanceMinutes)} de antecedência.`
      : null,
    o.note?.trim() || null,
  ].filter((t): t is string => !!t);
  for (const t of tips) w.labeled('•', t);

  footer(doc, f, `${o.tenantName} · calendário de reservas`);
  return doc.save();
}

export function advanceText(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} dia${min === 1440 ? '' : 's'}`;
  if (min % 60 === 0) return `${min / 60} hora${min === 60 ? '' : 's'}`;
  return `${min} minutos`;
}

function monthGrid(w: Writer, f: Fonts, month: string, days: CalendarDay[]) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rows = Math.ceil((firstDow + total) / 7);
  const cellW = WIDTH / 7;
  const cellH = 40;
  const need = 24 + 16 + rows * cellH + 12;
  w.ensure(need);

  w.text(`${MONTHS[m - 1]} de ${y}`, { font: f.bold, size: 13, gap: 6 });
  const page: PDFPage = w.page;
  // Cabeçalho dos dias da semana.
  WEEK.forEach((d, i) => {
    const t = pdfSafe(d);
    page.drawText(t, {
      x: MARGIN + i * cellW + (cellW - f.bold.widthOfTextAtSize(t, 8.5)) / 2,
      y: w.y - 10,
      size: 8.5,
      font: f.bold,
      color: MUTED,
    });
  });
  w.y -= 16;
  const top = w.y;
  const info = new Map(days.map((d) => [Number(d.date.slice(8, 10)), d]));
  for (let n = 1; n <= total; n++) {
    const idx = firstDow + n - 1;
    const col = idx % 7;
    const row = Math.floor(idx / 7);
    const x = MARGIN + col * cellW;
    const yTop = top - row * cellH;
    const d = info.get(n);
    const fill = d?.open ? (d.full ? PAPER : SOFT) : undefined;
    page.drawRectangle({
      x: x + 1.5,
      y: yTop - cellH + 1.5,
      width: cellW - 3,
      height: cellH - 3,
      color: fill,
      borderColor: d?.open && !d.full ? BRAND : LINE,
      borderWidth: d?.open && !d.full ? 0.8 : 0.4,
    });
    page.drawText(String(n), {
      x: x + 6,
      y: yTop - 13,
      size: 9.5,
      font: d?.open ? f.bold : f.regular,
      color: d ? (d.open ? INK : GREY) : GREY,
    });
    if (d?.open) {
      const label = d.full ? 'lotado' : `${d.free.length} horário${d.free.length === 1 ? '' : 's'}`;
      page.drawText(pdfSafe(label), {
        x: x + 6,
        y: yTop - cellH + 9,
        size: 7.5,
        font: f.regular,
        color: d.full ? MUTED : BRAND,
      });
    }
  }
  w.y = top - rows * cellH - 10;
}

function legend(w: Writer, f: Fonts) {
  w.ensure(20);
  const items: [string, ReturnType<typeof rgb> | undefined, ReturnType<typeof rgb>][] = [
    ['com horário livre', SOFT, BRAND],
    ['lotado', PAPER, LINE],
    ['sem reserva', undefined, LINE],
  ];
  let x = MARGIN;
  for (const [label, fill, border] of items) {
    w.page.drawRectangle({
      x,
      y: w.y - 10,
      width: 10,
      height: 10,
      color: fill,
      borderColor: border,
      borderWidth: 0.6,
    });
    const t = pdfSafe(label);
    w.page.drawText(t, { x: x + 14, y: w.y - 8.5, size: 8.5, font: f.regular, color: MUTED });
    x += 14 + f.regular.widthOfTextAtSize(t, 8.5) + 18;
  }
  w.y -= 22;
}
