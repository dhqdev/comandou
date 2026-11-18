import { PDFDocument, rgb } from 'pdf-lib';
import {
  fiscalExtraText,
  fiscalPackageText,
  formatBRL,
  formatUnitBRL,
  toCents,
} from '@comandou/shared';
import { fonts, INK, LINE, MARGIN, MUTED, pdfSafe, Writer, WIDTH } from '../contracts/contract-pdf';
import { dateBR, dateLong, extenso, formatDocument } from '../contracts/contract-template';
import { implementationSteps, type QuoteContent } from './quote-content';

/** Laranja do Comandou, só nos títulos, números das seções e valores de destaque. */
const BRAND = rgb(0.886, 0.227, 0);
const SOFT = rgb(0.985, 0.955, 0.94);
const PAPER = rgb(0.975, 0.975, 0.98);

const brl = (v: string) => formatBRL(toCents(v));
/** "15 (quinze) dias" */
const qty = (n: number, one: string, many: string) =>
  `${n} (${extenso(n)}) ${n === 1 ? one : many}`;
const DAY = 86_400_000;

/** Prazos do orçamento; os antigos (versão 1) não têm e caem nos valores da época. */
function termsOf(q: QuoteContent) {
  const t = q.terms;
  return {
    validityDays:
      t?.validityDays ??
      Math.max(1, Math.round((Date.parse(q.validUntil) - Date.parse(q.issuedAt)) / DAY)),
    trialDays: t?.trialDays ?? q.plan.trialDays,
    termMonths: t?.termMonths ?? 12,
    implementationDays: t?.implementationDays ?? 5,
  };
}

/** PDF da proposta comercial (A4), com as fontes padrão do PDF como o contrato. */
export async function renderQuotePdf(q: QuoteContent): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const providerName = q.provider.name || 'Comandou';
  doc.setTitle(pdfSafe(`Proposta Comercial ${q.number} - ${q.client.name}`));
  doc.setAuthor(pdfSafe(providerName));
  doc.setSubject(pdfSafe(`Proposta comercial da plataforma Comandou para ${q.client.name}`));
  doc.setCreator('Comandou');
  doc.setProducer('Comandou');
  const f = await fonts(doc);
  const w = new Writer(doc, f);
  const t = termsOf(q);

  const drawRight = (s: string, y: number, size: number, bold = false, color = INK) => {
    const font = bold ? f.bold : f.regular;
    const txt = pdfSafe(s);
    w.page.drawText(txt, {
      x: MARGIN + WIDTH - font.widthOfTextAtSize(txt, size),
      y,
      size,
      font,
      color,
    });
  };

  // ------------------------------------------------------------------ cabeçalho
  const top = w.y;
  w.page.drawText(pdfSafe(providerName), {
    x: MARGIN,
    y: top - 15,
    size: 15,
    font: f.bold,
    color: INK,
  });
  const provLines = [
    [q.provider.document ? `CNPJ ${formatDocument(q.provider.document)}` : null, q.provider.email]
      .filter(Boolean)
      .join('  ·  '),
    q.provider.address ?? '',
  ].filter(Boolean);
  provLines.forEach((l, i) =>
    w.page.drawText(pdfSafe(l).slice(0, 80), {
      x: MARGIN,
      y: top - 29 - i * 11,
      size: 8,
      font: f.regular,
      color: MUTED,
    }),
  );
  drawRight('PROPOSTA COMERCIAL', top - 12, 9, true, BRAND);
  drawRight(`Nº ${q.number}`, top - 27, 11, true);
  drawRight(`Emissão: ${dateBR(q.issuedAt)}`, top - 40, 8.5, false, MUTED);
  drawRight(`Validade: ${dateBR(q.validUntil)}`, top - 51, 8.5, false, MUTED);
  w.y = top - 62;
  w.page.drawLine({
    start: { x: MARGIN, y: w.y },
    end: { x: MARGIN + WIDTH, y: w.y },
    thickness: 1.4,
    color: BRAND,
  });
  w.y -= 26;

  // ------------------------------------------------------------------ título
  w.text('Licenciamento de uso da plataforma Comandou', { font: f.bold, size: 17, gap: 2 });
  w.text(
    'Sistema integrado de gestão para estabelecimentos de alimentação, na modalidade software como serviço (SaaS)',
    { size: 9.5, color: MUTED, gap: 14 },
  );

  // Quatro números que o cliente procura primeiro.
  {
    const cards: [string, string, string][] = [
      ['MENSALIDADE', brl(q.plan.priceMonthly), 'valor fixo mensal'],
      [
        'IMPLANTAÇÃO',
        toCents(q.setupFee) > 0 ? brl(q.setupFee) : 'Sem custo',
        toCents(q.setupFee) > 0 ? 'pagamento único' : 'cortesia',
      ],
      [
        'AVALIAÇÃO GRATUITA',
        t.trialDays > 0 ? `${t.trialDays} ${t.trialDays === 1 ? 'dia' : 'dias'}` : 'Não se aplica',
        t.trialDays > 0 ? 'sem qualquer ônus' : 'cobrança desde o início',
      ],
      [
        'VALIDADE DA PROPOSTA',
        `${t.validityDays} ${t.validityDays === 1 ? 'dia' : 'dias'}`,
        `até ${dateBR(q.validUntil)}`,
      ],
    ];
    const gap = 8;
    const cw = (WIDTH - gap * 3) / 4;
    const h = 58;
    w.ensure(h + 10);
    cards.forEach(([label, value, sub], i) => {
      const x = MARGIN + i * (cw + gap);
      const first = i === 0;
      w.page.drawRectangle({
        x,
        y: w.y - h,
        width: cw,
        height: h,
        color: first ? SOFT : PAPER,
        borderColor: first ? BRAND : LINE,
        borderWidth: first ? 0.8 : 0.5,
      });
      w.page.drawText(pdfSafe(label), {
        x: x + 9,
        y: w.y - 15,
        size: 6.5,
        font: f.bold,
        color: MUTED,
      });
      let size = 14;
      const v = pdfSafe(value);
      while (size > 9 && f.bold.widthOfTextAtSize(v, size) > cw - 18) size -= 0.5;
      w.page.drawText(v, {
        x: x + 9,
        y: w.y - 34,
        size,
        font: f.bold,
        color: first ? BRAND : INK,
      });
      w.page.drawText(pdfSafe(sub), {
        x: x + 9,
        y: w.y - 48,
        size: 7.5,
        font: f.regular,
        color: MUTED,
      });
    });
    w.y -= h + 20;
  }

  // ------------------------------------------------------------------ seções numeradas
  let n = 0;
  const section = (title: string) => {
    n += 1;
    w.ensure(80);
    w.y -= 8;
    const num = `${n}.`;
    w.page.drawText(num, { x: MARGIN, y: w.y - 11, size: 11, font: f.bold, color: BRAND });
    w.page.drawText(pdfSafe(title.toUpperCase()), {
      x: MARGIN + 18,
      y: w.y - 11,
      size: 10.5,
      font: f.bold,
      color: INK,
    });
    w.y -= 17;
    w.page.drawLine({
      start: { x: MARGIN, y: w.y },
      end: { x: MARGIN + WIDTH, y: w.y },
      thickness: 0.5,
      color: LINE,
    });
    w.y -= 9;
  };
  const para = (s: string) => w.text(s, { size: 9.5, gap: 7 });
  const numbered = (items: string[]) => items.forEach((s, i) => w.labeled(`${n}.${i + 1}.`, s));
  const bullets = (items: string[]) => items.forEach((s) => w.labeled('•', s, 4));

  // ------------------------------------------------------------------ destinatário
  section('Destinatário');
  w.table(
    [
      ['Razão social / nome', q.client.name],
      [q.client.document?.length === 11 ? 'CPF' : 'CNPJ', formatDocument(q.client.document) ?? ''],
      ['A/C', q.client.contact ?? ''],
      ['Telefone', q.client.phone ?? ''],
      ['E-mail', q.client.email ?? ''],
      ['Localidade', q.client.city ?? ''],
    ].filter(([, v]) => v) as [string, string][],
    130,
  );

  // ------------------------------------------------------------------ apresentação
  section('Apresentação');
  para('Prezados(as) Senhores(as),');
  para(
    `Em atenção à solicitação de V. Sas., ${providerName}, doravante denominada CONTRATADA, tem a satisfação de submeter à vossa apreciação a presente proposta comercial para o licenciamento de uso da plataforma Comandou, na modalidade software como serviço (SaaS), destinada à gestão integrada das operações de ${q.client.name}, doravante denominada CONTRATANTE, abrangendo atendimento, produção, entregas, estoque, finanças e obrigações fiscais.`,
  );
  para(
    'A solução dispensa a aquisição de licenças perpétuas e de servidores locais: o ambiente é integralmente mantido pela CONTRATADA, que responde pela hospedagem, segurança, disponibilidade, atualização e suporte técnico durante toda a vigência contratual, sem cobrança por usuário, pedido, produto ou mesa.',
  );

  // ------------------------------------------------------------------ escopo
  section('Objeto e escopo da solução');
  para(
    `O licenciamento do plano ${q.plan.name} compreende, sem custo adicional, os seguintes módulos e serviços:`,
  );
  bullets(q.plan.included);
  w.y -= 4;

  // ------------------------------------------------------------------ investimento
  section('Investimento');
  {
    const h = 60;
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
    w.page.drawText(pdfSafe('TOTAL MENSAL ESTIMADO'), {
      x: MARGIN + 14,
      y: w.y - 18,
      size: 7.5,
      font: f.bold,
      color: MUTED,
    });
    const big = pdfSafe(formatBRL(q.totals.monthlyCents));
    w.page.drawText(big, { x: MARGIN + 14, y: w.y - 44, size: 22, font: f.bold, color: BRAND });
    w.page.drawText(pdfSafe('por mês'), {
      x: MARGIN + 20 + f.bold.widthOfTextAtSize(big, 22),
      y: w.y - 43,
      size: 9.5,
      font: f.regular,
      color: INK,
    });
    const sideLabel = pdfSafe('PRIMEIRO DESEMBOLSO');
    const sideValue = pdfSafe(formatBRL(q.totals.firstPaymentCents));
    const sideNote = pdfSafe(
      t.trialDays > 0 ? 'ao término da avaliação gratuita' : 'na liberação do acesso',
    );
    const sx = MARGIN + WIDTH - 14;
    w.page.drawText(sideLabel, {
      x: sx - f.bold.widthOfTextAtSize(sideLabel, 7.5),
      y: w.y - 18,
      size: 7.5,
      font: f.bold,
      color: MUTED,
    });
    w.page.drawText(sideValue, {
      x: sx - f.bold.widthOfTextAtSize(sideValue, 13),
      y: w.y - 36,
      size: 13,
      font: f.bold,
      color: INK,
    });
    w.page.drawText(sideNote, {
      x: sx - f.regular.widthOfTextAtSize(sideNote, 7.5),
      y: w.y - 49,
      size: 7.5,
      font: f.regular,
      color: MUTED,
    });
    w.y -= h + 12;
  }
  const rows: [string, string][] = [
    [`Licença de uso, plano ${q.plan.name}`, `${brl(q.plan.priceMonthly)} por mês, valor fixo`],
  ];
  if (q.fiscal.enabled)
    rows.push([
      'Documentos fiscais (estimativa)',
      q.fiscal.estimateCents > 0
        ? `${formatBRL(q.fiscal.estimateCents)} por mês, para ${q.fiscal.nfcePerMonth.toLocaleString('pt-BR')} NFC-e${q.fiscal.nfePerMonth ? ` e ${q.fiscal.nfePerMonth.toLocaleString('pt-BR')} NF-e` : ''}`
        : 'abrangidos pela mensalidade no volume informado',
    ]);
  rows.push(['Total mensal estimado', formatBRL(q.totals.monthlyCents)]);
  rows.push([
    'Implantação',
    toCents(q.setupFee) > 0 ? `${brl(q.setupFee)}, pagamento único` : 'sem custo',
  ]);
  rows.push([
    'Avaliação gratuita',
    t.trialDays > 0 ? `${qty(t.trialDays, 'dia', 'dias')}, sem ônus` : 'não se aplica',
  ]);
  rows.push([
    'Primeiro desembolso',
    `${formatBRL(q.totals.firstPaymentCents)}${t.trialDays > 0 ? ', ao término da avaliação gratuita' : ', na liberação do acesso'}`,
  ]);
  rows.push(['Vigência proposta', qty(t.termMonths, 'mês', 'meses')]);
  w.table(rows, 190);

  // ------------------------------------------------------------------ implantação
  section('Implantação');
  para(
    `A implantação será concluída em até ${qty(t.implementationDays, 'dia útil', 'dias úteis')} contados do aceite desta proposta e do recebimento das informações necessárias, e compreende as seguintes etapas:`,
  );
  numbered(q.implementation ?? implementationSteps(q.fiscal.enabled));
  w.y -= 4;

  // ------------------------------------------------------------------ nota fiscal
  if (q.fiscal.enabled) {
    const c = q.fiscal.costs;
    section('Documentos fiscais eletrônicos');
    para(
      'A emissão de documentos fiscais é realizada por intermédio da Focus NFe, provedora contratada diretamente pela CONTRATADA, sendo desnecessária a abertura de conta pela CONTRATANTE junto ao provedor. Compete à CONTRATANTE apenas fornecer o certificado digital A1 (e-CNPJ) e o Código de Segurança do Contribuinte (CSC) emitido pela SEFAZ.',
    );
    w.table(
      [
        [
          'Mensalidade do provedor',
          c.mode === 'included'
            ? 'abrangida pela mensalidade da plataforma'
            : `${formatUnitBRL(c.monthly)} por mês por CNPJ emissor, apenas nos meses com emissão ativa`,
        ],
        ['Franquia mensal', fiscalPackageText(c)],
        ['Documentos excedentes', fiscalExtraText(c)],
        [
          'Estimativa informada',
          `${q.fiscal.nfcePerMonth.toLocaleString('pt-BR')} NFC-e e ${q.fiscal.nfePerMonth.toLocaleString('pt-BR')} NF-e por mês = ${formatBRL(q.fiscal.estimateCents)}`,
        ],
      ],
      150,
    );
    w.text(q.fiscal.clause, { size: 8.5, color: MUTED, gap: 7 });
  }

  // ------------------------------------------------------------------ pagamento pelo app
  if (q.onlinePay) {
    section('Recebimentos online (facultativo)');
    const fixed = toCents(q.onlinePay.fixed) > 0 ? `, acrescida de ${brl(q.onlinePay.fixed)}` : '';
    para(
      `Facultativamente, a CONTRATANTE poderá receber pagamentos por cartão e Pix diretamente no cardápio digital, por meio de sua própria conta PagBank. Sobre cada transação aprovada incide a taxa de intermediação da CONTRATADA de ${q.onlinePay.percent.replace('.', ',')}%${fixed}, além da tarifa praticada pelo PagBank, inexistindo mensalidade para o recurso.`,
    );
  }

  // ------------------------------------------------------------------ terceiros
  if (q.extraCosts.length) {
    section('Custos de terceiros');
    para(
      'Os itens abaixo não integram o preço desta proposta e, quando aplicáveis, são contratados pela CONTRATANTE diretamente junto aos respectivos fornecedores:',
    );
    w.table(
      q.extraCosts.map((x) => [x.label, x.value]),
      170,
    );
  }

  // ------------------------------------------------------------------ condições
  section('Condições comerciais');
  numbered(q.conditions);
  w.y -= 4;

  if (q.service?.length) {
    section('Nível de serviço, suporte e segurança');
    numbered(q.service);
    w.y -= 4;
  }

  // ------------------------------------------------------------------ validade
  section('Validade da proposta');
  para(
    `A presente proposta é válida por ${qty(t.validityDays, 'dia', 'dias')} corridos a contar da data de sua emissão, isto é, até ${dateLong(q.validUntil)}. Decorrido esse prazo sem manifestação de aceite, os valores e as condições aqui descritos ficam sujeitos a revisão e a nova confirmação pela CONTRATADA.`,
  );

  if (q.notes.trim()) {
    section('Observações');
    para(q.notes.trim());
  }

  // ------------------------------------------------------------------ aceite
  section('Aceite');
  const rep = q.provider.representative
    ? ` Para tanto, colocamo-nos à disposição por intermédio de ${q.provider.representative}${q.provider.email ? ` (${q.provider.email})` : ''}.`
    : '';
  para(
    `O aceite desta proposta poderá ser manifestado por resposta escrita ou pela assinatura abaixo, e ensejará a emissão do contrato de licenciamento de uso, com os valores e as condições ora estabelecidos, a ser assinado eletronicamente pelas partes. Permanecemos à inteira disposição para quaisquer esclarecimentos que se façam necessários.${rep}`,
  );
  para('Atenciosamente,');
  {
    const h = 96;
    w.ensure(h);
    w.y -= 46;
    const colW = (WIDTH - 40) / 2;
    const sign = (x: string[], left: number) => {
      w.page.drawLine({
        start: { x: left, y: w.y },
        end: { x: left + colW, y: w.y },
        thickness: 0.6,
        color: INK,
      });
      x.forEach((s, i) => {
        const txt = pdfSafe(s);
        let size = i === 0 ? 9 : 8;
        const font = i === 0 ? f.bold : f.regular;
        while (size > 6 && font.widthOfTextAtSize(txt, size) > colW) size -= 0.5;
        w.page.drawText(txt, {
          x: left + (colW - font.widthOfTextAtSize(txt, size)) / 2,
          y: w.y - 12 - i * 11,
          size,
          font,
          color: i === 0 ? INK : MUTED,
        });
      });
    };
    sign(
      [
        providerName,
        `CONTRATADA${q.provider.representative ? ` · ${q.provider.representative}` : ''}`,
      ],
      MARGIN,
    );
    sign(
      [q.client.name, `CONTRATANTE${q.client.contact ? ` · ${q.client.contact}` : ''}`],
      MARGIN + colW + 40,
    );
    w.y -= 40;
    w.text('Local e data: ______________________________________________', {
      size: 8.5,
      color: MUTED,
      gap: 4,
    });
  }

  // ------------------------------------------------------------------ rodapés
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN, y: 44 },
      end: { x: MARGIN + WIDTH, y: 44 },
      thickness: 0.4,
      color: LINE,
    });
    p.drawText(pdfSafe(`Proposta Comercial nº ${q.number} · ${q.client.name}`).slice(0, 90), {
      x: MARGIN,
      y: 32,
      size: 7.5,
      font: f.regular,
      color: MUTED,
    });
    p.drawText(pdfSafe('Documento confidencial, destinado exclusivamente ao destinatário.'), {
      x: MARGIN,
      y: 22,
      size: 6.5,
      font: f.italic,
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
