import { PDFDocument, rgb } from 'pdf-lib';
import {
  fiscalExtraText,
  fiscalPackageText,
  formatBRL,
  formatUnitBRL,
  toCents,
} from '@comandou/shared';
import { fonts, INK, LINE, MARGIN, MUTED, pdfSafe, Writer, WIDTH } from '../contracts/contract-pdf';
import { dateBR, formatDocument } from '../contracts/contract-template';
import type { QuoteContent } from './quote-content';

/** Laranja do Comandou, só nos títulos e no valor principal. */
const BRAND = rgb(0.886, 0.227, 0);
const SOFT = rgb(0.985, 0.955, 0.94);

const brl = (v: string) => formatBRL(toCents(v));

/** PDF do orçamento (A4), com as fontes padrão do PDF como o contrato. */
export async function renderQuotePdf(q: QuoteContent): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Orçamento ${q.number} - ${q.client.name}`));
  doc.setAuthor(pdfSafe(q.provider.name || 'Comandou'));
  doc.setSubject(pdfSafe(`Orçamento do sistema Comandou para ${q.client.name}`));
  doc.setCreator('Comandou');
  doc.setProducer('Comandou');
  const f = await fonts(doc);
  const w = new Writer(doc, f);

  // ------------------------------------------------------------------ cabeçalho
  const top = w.y;
  w.page.drawText(pdfSafe(q.provider.name || 'Comandou'), {
    x: MARGIN,
    y: top - 16,
    size: 16,
    font: f.bold,
    color: INK,
  });
  const provLine = [formatDocument(q.provider.document), q.provider.email]
    .filter(Boolean)
    .join('  ·  ');
  if (provLine)
    w.page.drawText(pdfSafe(provLine), {
      x: MARGIN,
      y: top - 31,
      size: 8.5,
      font: f.regular,
      color: MUTED,
    });
  const right = (s: string, y: number, size: number, bold = false, color = INK) => {
    const font = bold ? f.bold : f.regular;
    const t = pdfSafe(s);
    w.page.drawText(t, {
      x: MARGIN + WIDTH - font.widthOfTextAtSize(t, size),
      y,
      size,
      font,
      color,
    });
  };
  right('Orçamento', top - 14, 14, true, BRAND);
  right(q.number, top - 29, 9.5, true);
  right(
    `Emitido em ${dateBR(q.issuedAt)} · válido até ${dateBR(q.validUntil)}`,
    top - 42,
    8.5,
    false,
    MUTED,
  );
  w.y = top - 56;
  w.page.drawLine({
    start: { x: MARGIN, y: w.y },
    end: { x: MARGIN + WIDTH, y: w.y },
    thickness: 1.2,
    color: BRAND,
  });
  w.y -= 18;

  const section = (title: string) => {
    w.ensure(70);
    w.y -= 6;
    w.text(title, { font: f.bold, size: 11.5, color: INK, gap: 6 });
  };
  const bullets = (items: string[]) => items.forEach((s) => w.labeled('•', s, 4));

  // ------------------------------------------------------------------ cliente
  section('Para');
  w.table(
    [
      ['Cliente', q.client.name],
      ['CPF/CNPJ', formatDocument(q.client.document) ?? ''],
      ['Responsável', q.client.contact ?? ''],
      ['Contato', [q.client.phone, q.client.email].filter(Boolean).join(' · ')],
      ['Cidade', q.client.city ?? ''],
    ].filter(([, v]) => v) as [string, string][],
    110,
  );

  // ------------------------------------------------------------------ investimento
  section('Investimento');
  {
    const h = 64;
    w.ensure(h + 10);
    w.page.drawRectangle({
      x: MARGIN,
      y: w.y - h,
      width: WIDTH,
      height: h,
      color: SOFT,
      borderColor: LINE,
      borderWidth: 0.6,
    });
    w.page.drawText(pdfSafe(`Plano ${q.plan.name}`), {
      x: MARGIN + 14,
      y: w.y - 20,
      size: 10,
      font: f.bold,
      color: MUTED,
    });
    const big = pdfSafe(brl(q.plan.priceMonthly));
    w.page.drawText(big, { x: MARGIN + 14, y: w.y - 46, size: 24, font: f.bold, color: BRAND });
    w.page.drawText(pdfSafe('por mês, valor fixo'), {
      x: MARGIN + 20 + f.bold.widthOfTextAtSize(big, 24),
      y: w.y - 45,
      size: 10,
      font: f.regular,
      color: INK,
    });
    const note = pdfSafe('Sem cobrança por pedido, usuário, produto ou mesa.');
    w.page.drawText(note, {
      x: MARGIN + WIDTH - 14 - f.regular.widthOfTextAtSize(note, 8.5),
      y: w.y - 20,
      size: 8.5,
      font: f.regular,
      color: MUTED,
    });
    w.y -= h + 12;
  }
  const rows: [string, string][] = [
    [`Mensalidade do plano ${q.plan.name}`, brl(q.plan.priceMonthly)],
  ];
  if (q.fiscal.enabled)
    rows.push([
      'Nota fiscal (Focus NFe), estimativa',
      q.fiscal.estimateCents > 0
        ? `${formatBRL(q.fiscal.estimateCents)} por mês com ${q.fiscal.nfcePerMonth.toLocaleString('pt-BR')} NFC-e${q.fiscal.nfePerMonth ? ` e ${q.fiscal.nfePerMonth.toLocaleString('pt-BR')} NF-e` : ''}`
        : 'incluída na mensalidade para o volume informado',
    ]);
  rows.push(['Total mensal estimado', formatBRL(q.totals.monthlyCents)]);
  rows.push([
    'Implantação',
    toCents(q.setupFee) > 0 ? `${brl(q.setupFee)}, uma vez só` : 'sem custo',
  ]);
  if (q.plan.trialDays > 0) rows.push(['Teste grátis', `${q.plan.trialDays} dias, sem cobrança`]);
  rows.push([
    'Primeiro pagamento',
    `${formatBRL(q.totals.firstPaymentCents)}${q.plan.trialDays > 0 ? ' ao fim do teste' : ''}`,
  ]);
  w.table(rows, 190);

  // ------------------------------------------------------------------ incluído
  section('O que está incluído');
  bullets(q.plan.included);

  // ------------------------------------------------------------------ nota fiscal
  if (q.fiscal.enabled) {
    const c = q.fiscal.costs;
    section('Nota fiscal (Focus NFe)');
    w.text(
      'As notas saem pela Focus NFe, contratada pelo Comandou: o restaurante não precisa ter conta lá. O restaurante só precisa do certificado digital A1 e do CSC da SEFAZ.',
      { size: 9.5, color: INK, gap: 6 },
    );
    w.table(
      [
        [
          'Mensalidade da nota',
          c.mode === 'included'
            ? 'incluída no plano'
            : `${formatUnitBRL(c.monthly)} por mês por CNPJ (só nos meses com emissão ligada)`,
        ],
        ['Notas no pacote', fiscalPackageText(c)],
        ['Acima do pacote', fiscalExtraText(c)],
        [
          'Estimativa',
          `${q.fiscal.nfcePerMonth.toLocaleString('pt-BR')} NFC-e e ${q.fiscal.nfePerMonth.toLocaleString('pt-BR')} NF-e por mês = ${formatBRL(q.fiscal.estimateCents)}`,
        ],
      ],
      150,
    );
    w.text(
      q.fiscal.clause
        .replace(/à CONTRATANTE/g, 'ao restaurante')
        .replace(/CONTRATANTE/g, 'o restaurante'),
      {
        size: 8.5,
        color: MUTED,
        gap: 6,
      },
    );
  }

  // ------------------------------------------------------------------ pagamento pelo app
  if (q.onlinePay) {
    section('Pagamento pelo app (opcional)');
    const fixed = toCents(q.onlinePay.fixed) > 0 ? ` + ${brl(q.onlinePay.fixed)}` : '';
    w.text(
      `Cartão e Pix pelo cardápio online, pela conta PagBank do próprio restaurante. Em cada pagamento aprovado, a taxa do Comandou é de ${q.onlinePay.percent.replace('.', ',')}%${fixed}, além da tarifa do PagBank. Sem mensalidade: só paga quem usar.`,
      { size: 9.5, gap: 6 },
    );
  }

  // ------------------------------------------------------------------ terceiros
  if (q.extraCosts.length) {
    section('Outros custos (de terceiros, fora do Comandou)');
    w.table(
      q.extraCosts.map((x) => [x.label, x.value]),
      170,
    );
  }

  // ------------------------------------------------------------------ condições
  section('Condições');
  bullets(q.conditions);

  if (q.notes.trim()) {
    section('Observações');
    w.text(q.notes.trim(), { size: 9.5, gap: 6 });
  }

  w.y -= 10;
  w.ensure(60);
  w.text(
    `Para aceitar, basta responder a este orçamento. O contrato sai com estes valores e é assinado eletronicamente pelas duas partes.${q.provider.representative ? ` Qualquer dúvida, fale com ${q.provider.representative}${q.provider.email ? ` (${q.provider.email})` : ''}.` : ''}`,
    { size: 9.5, color: INK, gap: 4 },
  );

  // ------------------------------------------------------------------ rodapés
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN, y: 44 },
      end: { x: MARGIN + WIDTH, y: 44 },
      thickness: 0.4,
      color: LINE,
    });
    p.drawText(pdfSafe(`Orçamento ${q.number} · ${q.client.name}`).slice(0, 90), {
      x: MARGIN,
      y: 32,
      size: 7.5,
      font: f.regular,
      color: MUTED,
    });
    const r = pdfSafe(`Página ${i + 1} de ${pages.length}`);
    p.drawText(r, {
      x: MARGIN + WIDTH - f.regular.widthOfTextAtSize(r, 7.5),
      y: 32,
      size: 7.5,
      font: f.regular,
      color: MUTED,
    });
  });
  return doc.save();
}
