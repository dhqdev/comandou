import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { formatBRL, toCents } from '@comandou/shared';
import { ContractContent, dateBR } from './contract-template';

/**
 * PDF do contrato (A4) com as fontes padrão do PDF (Helvetica/Times, codificação WinAnsi, que
 * cobre o português). O original é gerado uma vez e guardado; o assinado é o original com o
 * manifesto da assinatura acrescentado no fim.
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const WIDTH = A4[0] - MARGIN * 2;
const BOTTOM = 64;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const LINE = rgb(0.82, 0.82, 0.85);

// WinAnsi (cp1252): ASCII, Latin-1 e alguns sinais. O resto vira "?" (o PDF não quebra).
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function pdfSafe(s: string): string {
  return s
    .replace(/[‐-‒]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[\t\r]/g, ' ')
    .replace(/[^\x20-\x7e\xa1-\xff\n]/gu, (ch) => (CP1252_EXTRA.includes(ch) ? ch : '?'));
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  script: PDFFont;
}

interface TextOpts {
  font?: PDFFont;
  size?: number;
  indent?: number;
  color?: ReturnType<typeof rgb>;
  gap?: number;
  align?: 'left' | 'center';
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly f: Fonts,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
  }

  ensure(h: number) {
    if (this.y - h < BOTTOM) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of pdfSafe(text).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
        else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  }

  text(text: string, o: TextOpts = {}) {
    const font = o.font ?? this.f.regular;
    const size = o.size ?? 10;
    const indent = o.indent ?? 0;
    const lh = size * 1.42;
    const lines = this.wrap(text, font, size, WIDTH - indent);
    for (const l of lines) {
      this.ensure(lh);
      const w = font.widthOfTextAtSize(l, size);
      const x = o.align === 'center' ? MARGIN + (WIDTH - w) / 2 : MARGIN + indent;
      this.page.drawText(l, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= lh;
    }
    this.y -= o.gap ?? 4;
  }

  /** Parágrafo com rótulo pendurado ("4.2." ou "a)"), o texto alinha depois do rótulo. */
  labeled(label: string, text: string, indent = 0) {
    const size = 10;
    const lh = size * 1.42;
    const lw = this.f.bold.widthOfTextAtSize(`${label} `, size);
    const lines = this.wrap(text, this.f.regular, size, WIDTH - indent - lw);
    lines.forEach((l, i) => {
      this.ensure(lh);
      if (i === 0)
        this.page.drawText(label, {
          x: MARGIN + indent,
          y: this.y - size,
          size,
          font: this.f.bold,
          color: INK,
        });
      this.page.drawText(l, {
        x: MARGIN + indent + lw,
        y: this.y - size,
        size,
        font: this.f.regular,
        color: INK,
      });
      this.y -= lh;
    });
    this.y -= 3;
  }

  rule(gap = 8) {
    this.ensure(gap * 2);
    this.y -= gap;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + WIDTH, y: this.y },
      thickness: 0.6,
      color: LINE,
    });
    this.y -= gap;
  }

  /** Tabela de duas colunas (rótulo | valor). */
  table(rows: [string, string][], labelWidth = 150) {
    const size = 9.5;
    const lh = size * 1.4;
    for (const [k, v] of rows) {
      const lines = this.wrap(v || '—', this.f.regular, size, WIDTH - labelWidth - 8);
      const h = lines.length * lh + 6;
      this.ensure(h);
      this.page.drawText(pdfSafe(k), {
        x: MARGIN,
        y: this.y - size - 3,
        size,
        font: this.f.bold,
        color: MUTED,
      });
      lines.forEach((l, i) =>
        this.page.drawText(l, {
          x: MARGIN + labelWidth,
          y: this.y - size - 3 - i * lh,
          size,
          font: this.f.regular,
          color: INK,
        }),
      );
      this.y -= h;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: MARGIN + WIDTH, y: this.y },
        thickness: 0.4,
        color: LINE,
      });
    }
    this.y -= 8;
  }
}

async function fonts(doc: PDFDocument): Promise<Fonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    script: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
  };
}

/** Rodapé de todas as páginas: número do contrato, página e o hash do texto. */
function footers(doc: PDFDocument, f: Fonts, number: string, hash: string, from = 0) {
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    if (i < from) return;
    const size = 7.5;
    p.drawLine({
      start: { x: MARGIN, y: 44 },
      end: { x: MARGIN + WIDTH, y: 44 },
      thickness: 0.4,
      color: LINE,
    });
    p.drawText(pdfSafe(`Contrato nº ${number}`), {
      x: MARGIN,
      y: 32,
      size,
      font: f.bold,
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
    p.drawText(`Integridade do texto (SHA-256): ${hash}`, {
      x: MARGIN,
      y: 22,
      size: 6.5,
      font: f.regular,
      color: MUTED,
    });
  });
}

export function contractSummary(c: ContractContent): [string, string][] {
  const t = c.terms;
  return [
    ['Contratante', c.parties.customer.name],
    ['CPF/CNPJ', c.parties.customer.document ?? '—'],
    ['Loja', `${t.storeName} (${t.systemAddress})`],
    ['Plano', t.planName],
    ['Mensalidade', `${formatBRL(toCents(t.priceMonthly))}, vencimento todo dia ${t.dueDay}`],
    [
      'Implantação',
      Number(t.setupFee) > 0 ? formatBRL(toCents(t.setupFee)) : 'sem taxa de implantação',
    ],
    [
      'Vigência',
      `${t.termMonths} ${t.termMonths === 1 ? 'mês' : 'meses'} a partir de ${dateBR(t.startDate)}, com renovação automática`,
    ],
    ['Disponibilidade', `${t.slaPercent.replace('.', ',')}% ao mês`],
    ['Contratada', c.parties.provider.name || '—'],
  ];
}

export async function renderContractPdf(c: ContractContent, contentHash: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Contrato ${c.number} - ${c.parties.customer.name}`));
  doc.setAuthor(pdfSafe(c.parties.provider.name || 'Comandou'));
  doc.setSubject(pdfSafe(c.title));
  doc.setCreator('Comandou');
  doc.setProducer('Comandou');
  doc.setKeywords([`sha256:${contentHash}`]);
  const f = await fonts(doc);
  const w = new Writer(doc, f);

  w.text(c.title.toUpperCase(), { font: f.bold, size: 13, align: 'center', gap: 2 });
  w.text(`Contrato nº ${c.number}`, { size: 9.5, color: MUTED, align: 'center', gap: 14 });
  w.text('QUADRO-RESUMO', { font: f.bold, size: 9, color: MUTED, gap: 2 });
  w.table(contractSummary(c));
  w.text(c.preamble, { gap: 10 });

  c.clauses.forEach((cl, i) => {
    const n = i + 1;
    w.ensure(60);
    w.y -= 6;
    w.text(`CLÁUSULA ${n} - ${cl.title.toUpperCase()}`, { font: f.bold, size: 10.5, gap: 6 });
    let p = 0;
    for (const item of cl.items) {
      if (typeof item === 'string') w.labeled(`${n}.${++p}.`, item);
      else item.forEach((s, j) => w.labeled(`${String.fromCharCode(97 + j)})`, s, 18));
    }
  });

  w.y -= 8;
  w.text(c.closing, { gap: 24 });
  w.ensure(110);
  const sign = (role: string, name: string, note: string) => {
    w.page.drawLine({
      start: { x: MARGIN, y: w.y },
      end: { x: MARGIN + 260, y: w.y },
      thickness: 0.6,
      color: INK,
    });
    w.y -= 4;
    w.text(`${role}: ${name}`, { font: f.bold, size: 9.5, gap: 0 });
    w.text(note, { size: 8.5, color: MUTED, gap: 26 });
  };
  sign(
    'CONTRATADA',
    c.parties.provider.name || '—',
    'Concordância pelo envio eletrônico deste instrumento.',
  );
  sign(
    'CONTRATANTE',
    c.parties.customer.name,
    'Assinatura eletrônica registrada no manifesto anexo.',
  );

  footers(doc, f, c.number, contentHash);
  return doc.save();
}

export interface SignatureManifest {
  number: string;
  contentHash: string;
  originalPdfSha256: string;
  customerName: string;
  customerDocument: string | null;
  signerName: string;
  signerDocument: string;
  signerEmail: string;
  signedAt: Date;
  ip: string;
  userAgent: string;
  signature: { kind: 'drawn'; png: Uint8Array } | { kind: 'typed'; text: string };
  sentBy: string | null;
  events: { at: Date; label: string; ip?: string | null }[];
}

export const brTime = (d: Date) =>
  `${new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(d)} (horário de Brasília)`;

/** Original + manifesto da assinatura (página nova no fim, com o mesmo rodapé). */
export async function renderSignedPdf(original: Uint8Array, m: SignatureManifest) {
  const doc = await PDFDocument.load(original);
  const f = await fonts(doc);
  const from = doc.getPageCount();
  doc.setModificationDate(m.signedAt);
  doc.setKeywords([`sha256:${m.contentHash}`, `original:${m.originalPdfSha256}`, 'assinado']);
  const w = new Writer(doc, f);

  w.text('MANIFESTO DE ASSINATURA ELETRÔNICA', { font: f.bold, size: 13, gap: 2 });
  w.text(`Contrato nº ${m.number} · ${m.customerName}`, { size: 9.5, color: MUTED, gap: 14 });

  w.text('ASSINATURA', { font: f.bold, size: 9, color: MUTED, gap: 6 });
  w.ensure(110);
  const boxTop = w.y;
  const boxH = 84;
  w.page.drawRectangle({
    x: MARGIN,
    y: boxTop - boxH,
    width: 280,
    height: boxH,
    borderColor: LINE,
    borderWidth: 0.8,
  });
  if (m.signature.kind === 'drawn') {
    const img = await doc.embedPng(m.signature.png);
    const scale = Math.min(264 / img.width, (boxH - 16) / img.height, 1);
    w.page.drawImage(img, {
      x: MARGIN + 8,
      y: boxTop - boxH + 8 + (boxH - 16 - img.height * scale) / 2,
      width: img.width * scale,
      height: img.height * scale,
    });
  } else {
    let size = 28;
    const text = pdfSafe(m.signature.text);
    while (size > 12 && f.script.widthOfTextAtSize(text, size) > 264) size -= 1;
    w.page.drawText(text, {
      x: MARGIN + 12,
      y: boxTop - boxH / 2 - size / 3,
      size,
      font: f.script,
      color: rgb(0.08, 0.16, 0.4),
    });
  }
  w.y = boxTop - boxH - 14;

  w.table([
    ['Signatário', m.signerName],
    ['CPF do signatário', m.signerDocument.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')],
    ['E-mail', m.signerEmail],
    ['Em nome de', `${m.customerName}${m.customerDocument ? ` (${m.customerDocument})` : ''}`],
    ['Data e hora', `${brTime(m.signedAt)} · ${m.signedAt.toISOString()}`],
    ['Endereço IP', m.ip],
    ['Navegador', m.userAgent || '—'],
    [
      'Forma',
      m.signature.kind === 'drawn'
        ? 'Assinatura desenhada na tela'
        : 'Assinatura digitada (nome completo)',
    ],
    ['Hash do texto', m.contentHash],
    ['Hash do PDF original', m.originalPdfSha256],
    ['Enviado por', m.sentBy ?? '—'],
  ]);

  w.text('TRILHA DO DOCUMENTO', { font: f.bold, size: 9, color: MUTED, gap: 6 });
  w.table(
    m.events.map((e) => [
      brTime(e.at).replace(' (horário de Brasília)', ''),
      `${e.label}${e.ip ? ` · IP ${e.ip}` : ''}`,
    ]),
    170,
  );

  w.text(
    'O signatário abriu o contrato pelo link pessoal enviado ao seu e-mail, percorreu o texto até o fim, informou nome e CPF, declarou ter poderes para representar a CONTRATANTE e assinou. Esta é uma assinatura eletrônica, com validade entre as partes nos termos do artigo 10, § 2º, da MP nº 2.200-2/2001 e da Lei nº 14.063/2020. Qualquer alteração deste arquivo muda o seu código de integridade, que fica guardado pela CONTRATADA para conferência.',
    { size: 8.5, color: MUTED },
  );

  footers(doc, f, m.number, m.contentHash, from);
  return doc.save();
}
