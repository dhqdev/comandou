import {
  allocateCents,
  FiscalIssue,
  fromCents,
  IBS_CBS_REDUCTIONS,
  icmsMatchesRegime,
  interstateCfop,
  isValidCnpj,
  isValidCpf,
  nfceCfopAllowed,
  nfceIcmsAllowed,
  PAYMENT_CODES,
  toCents,
} from '@comandou/shared';
import type { FiscalRule, RuleSource } from './fiscal-rules.service';

/** Formas que exigem o grupo de cartão: crédito, débito e Pix. */
const CARD_CODES = new Set(['03', '04', '17']);

/** Destinatário da nota (cliente). Na NFC-e é opcional, exceto no delivery. */
export interface Recipient {
  name?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  /** Inscrição estadual (só para contribuinte, indicador 1). */
  ie?: string | null;
  /** 1 contribuinte; 2 isento; 9 não contribuinte. */
  ieIndicator?: 1 | 2 | 9 | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}

/** Operação da NF-e (na NFC-e só guarda as linhas resolvidas). */
export interface Operation {
  nature?: string;
  /** Finalidade: 1 normal, 2 complementar, 3 ajuste, 4 devolução. */
  purpose?: '1' | '2' | '3' | '4';
  presence?: string;
  finalConsumer?: boolean;
  freight?: string;
  info?: string | null;
  /** Chave da nota referenciada (complementar, ajuste ou devolução). */
  referencedKey?: string | null;
  /** Padrão fiscal escolhido à mão por linha (id do item do pedido → padrão). */
  lineRules?: Record<string, string>;
  /** Como cada linha ficou (para a tela): padrão usado e de onde veio. */
  lines?: LineInfo[];
}

export interface LineInfo {
  itemId: string;
  productId: string;
  name: string;
  ncm: string | null;
  ruleId: string | null;
  ruleCode: string | null;
  ruleName: string | null;
  source: RuleSource | 'legacy' | null;
}

export interface ComposeItem {
  id: string;
  productId: string;
  name: string;
  quantity: string;
  totalCents: number;
  ncm: string | null;
  cest: string | null;
  unit: string | null;
  /** Campos antigos do produto (antes dos padrões fiscais). */
  legacyCfop: string | null;
  legacyCode: string | null;
  origin: number | null;
  rule: FiscalRule | null;
  source: RuleSource | null;
}

export interface ComposeInput {
  kind: 'nfce' | 'nfe';
  cnpj: string;
  /** UF e regime do emitente, quando conhecidos (cadastro guiado). */
  issuerUf: string | null;
  regime: number | null;
  order: {
    channel: string;
    source: string;
    subtotalCents: number;
    discountCents: number;
    surchargeCents: number;
    deliveryFeeCents: number;
    totalCents: number;
  };
  items: ComposeItem[];
  payments: { method: string; net: string }[];
  settings: {
    defaultCfop: string;
    defaultCode: string;
    defaultNcm: string | null;
    nature: string;
    additionalInfo: string | null;
    /** O restaurante já tem padrões fiscais? Então todo item precisa resolver um. */
    strictRules: boolean;
  };
  recipient: Recipient | null;
  operation: Operation;
  /**
   * Venda feita por aplicativo de delivery (marketplace): CNPJ do aplicativo e o código da loja
   * nele (idCadIntTran). Vai no grupo do intermediador (indIntermed = 1).
   */
  intermediary?: { cnpj: string; storeId: string } | null;
}

const pct = (cents: number, rate: string | null | undefined) =>
  rate ? Math.round((cents * Number(rate)) / 100) : 0;
const money = (cents: number) => fromCents(cents);
const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/** Preço unitário com até 10 casas: total / quantidade, sem ponto flutuante. */
export function unitPrice(totalCents: number, quantity: string): string {
  const [i, f = ''] = quantity.split('.');
  const milli = BigInt(i) * 1000n + BigInt(f.padEnd(3, '0').slice(0, 3));
  if (milli <= 0n) throw new Error('quantidade inválida');
  // reais * 1e10 = cents * 1e8 ; dividido pela quantidade (em milésimos) => * 1000
  const scaled = (BigInt(totalCents) * 100_000_000n * 1000n * 2n + milli) / (milli * 2n);
  const s = scaled.toString().padStart(11, '0');
  const int = s.slice(0, -10);
  const frac = s.slice(-10).replace(/0+$/, '').padEnd(2, '0');
  return `${int}.${frac}`;
}

/** Endereço completo do destinatário (exigido na entrega a domicílio e na NF-e)? */
function missingAddress(r: Recipient | null, needCep: boolean) {
  const need: [keyof Recipient, string][] = [
    ['street', 'logradouro'],
    ['number', 'número'],
    ['district', 'bairro'],
    ['city', 'município'],
    ['state', 'UF'],
  ];
  if (needCep) need.push(['cep', 'CEP']);
  return need.filter(([k]) => !String(r?.[k] ?? '').trim()).map(([, l]) => l);
}

/** Problemas do destinatário em palavras simples. */
export function recipientIssues(
  kind: 'nfce' | 'nfe',
  r: Recipient | null,
  delivery: boolean,
): FiscalIssue[] {
  const out: FiscalIssue[] = [];
  const cpf = digits(r?.cpf);
  const cnpj = digits(r?.cnpj);
  if (cpf && !isValidCpf(cpf))
    out.push({
      title: 'CPF do cliente inválido',
      detail: `O CPF ${cpf} não confere (dígitos verificadores). Corrija no destinatário.`,
      fix: 'recipient',
    });
  if (cnpj && !isValidCnpj(cnpj))
    out.push({
      title: 'CNPJ do cliente inválido',
      detail: `O CNPJ ${cnpj} não confere (dígitos verificadores). Corrija no destinatário.`,
      fix: 'recipient',
    });
  if (kind === 'nfe') {
    if (!cpf && !cnpj)
      out.push({
        title: 'Falta o CPF ou CNPJ do cliente',
        detail:
          'A NF-e sempre identifica o destinatário. Escolha o cliente ou preencha o CPF/CNPJ.',
        fix: 'recipient',
      });
    if (!r?.name?.trim())
      out.push({
        title: 'Falta o nome do cliente',
        detail: 'Informe o nome ou a razão social do destinatário.',
        fix: 'recipient',
      });
    const miss = missingAddress(r, true);
    if (miss.length)
      out.push({
        title: 'Endereço do cliente incompleto',
        detail: `A NF-e exige o endereço do destinatário. Falta: ${miss.join(', ')}.`,
        fix: 'recipient',
      });
    if (r?.ieIndicator === 1 && !digits(r.ie))
      out.push({
        title: 'Falta a inscrição estadual do cliente',
        detail:
          'O cliente foi marcado como contribuinte de ICMS: informe a IE ou marque como não contribuinte.',
        fix: 'recipient',
      });
  } else if (delivery) {
    if (!cpf && !cnpj)
      out.push({
        title: 'Falta o CPF ou CNPJ do cliente',
        detail:
          'Venda de delivery é entrega a domicílio, e a SEFAZ exige a identificação do destinatário nesse caso (rejeição 787).',
        fix: 'recipient',
        code: '787',
      });
    const miss = missingAddress(r, false);
    if (miss.length)
      out.push({
        title: 'Endereço de entrega incompleto',
        detail: `Na entrega a domicílio a NFC-e leva o endereço do cliente. Falta: ${miss.join(', ')}.`,
        fix: 'recipient',
      });
  }
  return out;
}

/** Campos do destinatário no formato da Focus. */
function recipientPayload(kind: 'nfce' | 'nfe', r: Recipient | null) {
  if (!r) return {};
  const cpf = digits(r.cpf);
  const cnpj = digits(r.cnpj);
  const hasAddress = !!(r.street && r.number && r.city && r.state);
  // A NFC-e só vai para não contribuinte (rejeição 789): indicador 9 e sem IE.
  const ind = kind === 'nfce' ? 9 : (r.ieIndicator ?? 9);
  const out: Record<string, unknown> = {
    ...(r.name ? { nome_destinatario: r.name.slice(0, 60) } : {}),
    ...(cnpj ? { cnpj_destinatario: cnpj } : cpf ? { cpf_destinatario: cpf } : {}),
  };
  if (!cpf && !cnpj && !r.name) return {};
  if (kind === 'nfe' || cpf || cnpj) out.indicador_inscricao_estadual_destinatario = String(ind);
  if (ind === 1 && r.ie) out.inscricao_estadual_destinatario = digits(r.ie);
  // Campos de endereço e e-mail têm até 60 caracteres no leiaute (xLgr, nro, xCpl, xBairro, xMun,
  // email); o endereço salvo pelo cliente no cardápio aceita mais e seria recusado pela SEFAZ.
  const cut = (v: string | null | undefined) => (v ?? '').trim().slice(0, 60);
  if (hasAddress) {
    Object.assign(out, {
      logradouro_destinatario: cut(r.street),
      numero_destinatario: cut(r.number),
      ...(cut(r.complement) ? { complemento_destinatario: cut(r.complement) } : {}),
      bairro_destinatario: r.district == null ? r.district : cut(r.district),
      municipio_destinatario: cut(r.city),
      uf_destinatario: (r.state ?? '').toUpperCase(),
      ...(digits(r.cep) ? { cep_destinatario: digits(r.cep) } : {}),
      ...(kind === 'nfe' ? { pais_destinatario: 'Brasil' } : {}),
    });
  }
  if (r.phone && kind === 'nfe') out.telefone_destinatario = digits(r.phone);
  if (r.email && kind === 'nfe' && r.email.trim().length <= 60)
    out.email_destinatario = r.email.trim();
  return out;
}

/** Alíquota depois da redução (pAliqEfet), com até 4 casas. */
function effectiveRate(rate: string | null, reduction: number | undefined): string {
  const r = Number(rate ?? 0);
  if (reduction === undefined) return rate ?? '0';
  return String(Math.round(r * (100 - reduction) * 100) / 10000);
}

/** CSTs do ICMS próprio que exigem alíquota (e base) na nota. */
const ICMS_NEEDS_RATE = new Set(['00', '10', '20', '70']);
/** ICMS com substituição tributária: o item precisa do CEST (rejeição 806). */
const ICMS_ST = new Set(['10', '30', '60', '70', '201', '202', '203', '500']);

/** O que falta no padrão fiscal para a nota passar na SEFAZ (alíquotas, CEST, CFOP). */
function ruleIssues(
  kind: 'nfce' | 'nfe',
  rule: FiscalRule,
  cfop: string,
  issuerUf: string | null,
): string[] {
  const out: string[] = [];
  if (kind === 'nfce' && !nfceCfopAllowed(cfop, issuerUf))
    out.push(`o CFOP ${cfop} não é aceito na NFC-e (use 5101, 5102 ou 5405, por exemplo)`);
  if (kind === 'nfce' && !nfceIcmsAllowed(rule.icmsCst))
    out.push(
      `o ${rule.icmsCst.length === 3 ? 'CSOSN' : 'CST'} ${rule.icmsCst} não é aceito na NFC-e`,
    );
  if (ICMS_NEEDS_RATE.has(rule.icmsCst) && !rule.icmsRate)
    out.push(`o CST ${rule.icmsCst} do ICMS precisa da alíquota`);
  if (['20', '70'].includes(rule.icmsCst) && !Number(rule.icmsBaseReduction ?? 0))
    out.push(`o CST ${rule.icmsCst} do ICMS precisa da redução da base`);
  if (['01', '02'].includes(rule.pisCst) && !rule.pisRate)
    out.push(`o CST ${rule.pisCst} do PIS precisa da alíquota`);
  if (['01', '02'].includes(rule.cofinsCst) && !rule.cofinsRate)
    out.push(`o CST ${rule.cofinsCst} da COFINS precisa da alíquota`);
  if (rule.ibsCbsCst && !rule.ibsCbsClass)
    out.push('o IBS/CBS precisa da classificação tributária');
  if (
    rule.ibsCbsCst === '200' &&
    rule.ibsCbsClass &&
    IBS_CBS_REDUCTIONS[rule.ibsCbsClass] === undefined
  )
    out.push(
      `a classificação ${rule.ibsCbsClass} não é de alíquota reduzida conhecida (use 200047 para bar e restaurante)`,
    );
  return out;
}

/** Impostos de um item conforme o padrão fiscal (alíquotas vazias não destacam valor). */
function taxFields(kind: 'nfce' | 'nfe', rule: FiscalRule, baseCents: number) {
  const out: Record<string, unknown> = {
    pis_situacao_tributaria: rule.pisCst,
    cofins_situacao_tributaria: rule.cofinsCst,
  };
  // ICMS próprio destacado (regime normal, CST 00/10/20/70/90 com alíquota).
  if (rule.icmsRate && ['00', '10', '20', '70', '90'].includes(rule.icmsCst)) {
    const red = Number(rule.icmsBaseReduction ?? 0);
    const base = Math.round(baseCents * (1 - red / 100));
    Object.assign(out, {
      icms_modalidade_base_calculo: '3',
      icms_base_calculo: money(base),
      icms_aliquota: rule.icmsRate,
      icms_valor: money(pct(base, rule.icmsRate)),
      ...(red ? { icms_reducao_base_calculo: rule.icmsBaseReduction } : {}),
    });
  }
  if (['01', '02'].includes(rule.pisCst) && rule.pisRate)
    Object.assign(out, {
      pis_base_calculo: money(baseCents),
      pis_aliquota_porcentual: rule.pisRate,
      pis_valor: money(pct(baseCents, rule.pisRate)),
    });
  if (['01', '02'].includes(rule.cofinsCst) && rule.cofinsRate)
    Object.assign(out, {
      cofins_base_calculo: money(baseCents),
      cofins_aliquota_porcentual: rule.cofinsRate,
      cofins_valor: money(pct(baseCents, rule.cofinsRate)),
    });
  if (kind === 'nfe' && rule.ipiCst) {
    out.ipi_situacao_tributaria = rule.ipiCst;
    out.ipi_codigo_enquadramento_legal = '999';
    if (rule.ipiCst === '50' && rule.ipiRate)
      Object.assign(out, {
        ipi_base_calculo: money(baseCents),
        ipi_aliquota: rule.ipiRate,
        ipi_valor: money(pct(baseCents, rule.ipiRate)),
      });
  }
  if (rule.ibsCbsCst) {
    // CST 200 (alíquota reduzida): a nota leva a redução e a alíquota efetiva, e o valor sai dela.
    const red = rule.ibsCbsCst === '200' ? IBS_CBS_REDUCTIONS[rule.ibsCbsClass ?? ''] : undefined;
    const eff = (rate: string | null) => effectiveRate(rate, red);
    const cbs = pct(baseCents, eff(rule.cbsRate));
    const uf = pct(baseCents, eff(rule.ibsUfRate));
    const mun = pct(baseCents, eff(rule.ibsMunRate));
    Object.assign(out, {
      ibs_cbs_situacao_tributaria: rule.ibsCbsCst,
      ...(rule.ibsCbsClass ? { ibs_cbs_classificacao_tributaria: rule.ibsCbsClass } : {}),
      ibs_cbs_base_calculo: money(baseCents),
      cbs_aliquota: rule.cbsRate ?? '0',
      cbs_valor: money(cbs),
      ibs_uf_aliquota: rule.ibsUfRate ?? '0',
      ibs_uf_valor: money(uf),
      ibs_mun_aliquota: rule.ibsMunRate ?? '0',
      ibs_mun_valor: money(mun),
      ibs_valor_total: money(uf + mun),
      ...(red !== undefined
        ? {
            cbs_percentual_reducao_aliquota: String(red),
            cbs_aliquota_efetiva: eff(rule.cbsRate),
            ibs_uf_percentual_reducao_aliquota: String(red),
            ibs_uf_aliquota_efetiva: eff(rule.ibsUfRate),
            ibs_mun_percentual_reducao_aliquota: String(red),
            ibs_mun_aliquota_efetiva: eff(rule.ibsMunRate),
          }
        : {}),
    });
  }
  if (rule.benefitCode) out.codigo_beneficio_fiscal = rule.benefitCode;
  if (rule.approxTaxRate) out.valor_total_tributos = money(pct(baseCents, rule.approxTaxRate));
  return out;
}

/**
 * Monta o conteúdo da nota (sem a data de emissão, que vai no envio) e lista, em palavras
 * simples, o que impede o envio. Função pura: não lê banco nem chama a Focus.
 */
export function composeNote(input: ComposeInput) {
  const { kind, order, items, settings, recipient, operation } = input;
  const issues: FiscalIssue[] = [];
  const delivery = order.channel === 'delivery';

  if (!items.length)
    issues.push({
      title: 'Pedido sem itens',
      detail: 'Não há itens cobrados para a nota.',
      fix: 'none',
    });
  const totals = items.map((i) => i.totalCents);
  const itemsSum = totals.reduce((a, b) => a + b, 0);
  if (items.length && itemsSum !== order.subtotalCents)
    issues.push({
      title: 'Itens não conferem com o subtotal',
      detail: 'A soma dos itens do pedido não bate com o subtotal. Confira o pedido.',
      fix: 'none',
    });
  if (items.length && order.discountCents >= itemsSum)
    issues.push({
      title: 'Desconto maior que os itens',
      detail: 'O desconto é igual ou maior que o valor dos itens e não cabe na nota.',
      fix: 'none',
    });

  const noNcm = [
    ...new Set(items.filter((i) => !i.ncm && !settings.defaultNcm).map((i) => i.name)),
  ];
  if (noNcm.length)
    issues.push({
      title: noNcm.length === 1 ? 'Item sem NCM' : 'Itens sem NCM',
      detail: `Informe o NCM no cadastro do item (ou um NCM padrão em Configuração): ${noNcm.join(', ')}.`,
      fix: 'items',
    });

  // Padrão fiscal de cada linha: o escolhido à mão, o resolvido (produto/NCM/padrão) ou os códigos antigos.
  const lines: LineInfo[] = [];
  const noRule: string[] = [];
  const wrongRegime = new Set<string>();
  const resolved = items.map((i) => {
    const rule = i.rule;
    if (!rule && settings.strictRules) noRule.push(i.name);
    if (rule && !icmsMatchesRegime(rule.icmsCst, input.regime)) wrongRegime.add(rule.code);
    lines.push({
      itemId: i.id,
      productId: i.productId,
      name: i.name,
      ncm: i.ncm ?? settings.defaultNcm,
      ruleId: rule?.id ?? null,
      ruleCode: rule?.code ?? null,
      ruleName: rule?.name ?? null,
      source: rule
        ? operation.lineRules?.[i.id] === rule.id
          ? 'line'
          : i.source
        : settings.strictRules
          ? null
          : 'legacy',
    });
    return rule;
  });
  if (noRule.length)
    issues.push({
      title: 'Item sem regra de tributação',
      detail: `Não foi possível emitir a ${kind === 'nfe' ? 'NF-e' : 'NFC-e'}: ${[...new Set(noRule)].map((n) => `'${n}'`).join(', ')} não tem Padrão Fiscal (nem ligado ao item, nem pelo NCM, nem o Padrão Fiscal padrão da empresa). Configure em Fiscal → Padrões fiscais ou marque um padrão como "padrão da empresa".`,
      fix: 'rules',
    });
  if (wrongRegime.size)
    issues.push({
      title:
        input.regime === 3
          ? 'CSOSN em empresa fora do Simples'
          : 'CST em empresa do Simples Nacional',
      detail: `${input.regime === 3 ? 'No regime normal o ICMS usa CST de 2 dígitos' : 'No Simples Nacional o ICMS usa CSOSN de 3 dígitos'}. Corrija o padrão fiscal ${[...wrongRegime].join(', ')}.`,
      fix: 'rules',
    });

  issues.push(...recipientIssues(kind, recipient, delivery));

  if (kind === 'nfe') {
    const p = operation.purpose ?? '1';
    if (p !== '1' && !/^[0-9]{44}$/.test(digits(operation.referencedKey)))
      issues.push({
        title: 'Falta a nota referenciada',
        detail:
          'NF-e complementar, de ajuste ou de devolução precisa da chave (44 dígitos) da nota original.',
        fix: 'items',
      });
  }

  const paid = input.payments.reduce((a, p) => a + toCents(p.net), 0);
  if (paid !== order.totalCents)
    issues.push({
      title: 'Pedido não está totalmente pago',
      detail: 'A nota só é emitida com o pedido pago por completo. Receba o restante no caixa.',
      fix: 'payment',
    });

  const ok = items.length > 0 && order.discountCents < itemsSum && itemsSum > 0;
  const discounts = ok ? allocateCents(order.discountCents, totals) : totals.map(() => 0);
  // NFC-e: taxa de serviço e entrega viram "outras despesas". NF-e: entrega vira frete.
  const freightCents = kind === 'nfe' ? order.deliveryFeeCents : 0;
  const otherCents = order.surchargeCents + (kind === 'nfe' ? 0 : order.deliveryFeeCents);
  const others = ok ? allocateCents(otherCents, totals) : totals.map(() => 0);
  const freights = ok ? allocateCents(freightCents, totals) : totals.map(() => 0);

  const nonContributor = (recipient?.ieIndicator ?? 9) === 9;
  const recipientUf = (recipient?.state ?? '').toUpperCase();
  const interstate =
    kind === 'nfe' &&
    !!input.issuerUf &&
    !!recipientUf &&
    recipientUf !== input.issuerUf.toUpperCase();

  const ruleProblems = new Set<string>();
  const legacyCfops = new Set<string>();
  const payloadItems = items.map((i, n) => {
    const rule = resolved[n];
    const base = totals[n] - discounts[n] + others[n] + freights[n];
    const cfopIn = rule?.cfop ?? i.legacyCfop ?? settings.defaultCfop;
    const cfop = interstate
      ? (rule?.cfopInterstate ?? interstateCfop(cfopIn, nonContributor))
      : cfopIn;
    if (rule)
      for (const p of ruleIssues(kind, rule, cfop, input.issuerUf))
        ruleProblems.add(`${rule.code}: ${p}`);
    else if (kind === 'nfce' && !nfceCfopAllowed(cfop, input.issuerUf)) legacyCfops.add(cfop);
    return {
      numero_item: String(n + 1),
      codigo_produto: i.productId,
      descricao: i.name.slice(0, 120),
      codigo_ncm: i.ncm ?? settings.defaultNcm,
      ...(i.cest ? { cest: i.cest } : {}),
      cfop,
      unidade_comercial: i.unit ?? 'UN',
      unidade_tributavel: i.unit ?? 'UN',
      quantidade_comercial: i.quantity,
      quantidade_tributavel: i.quantity,
      valor_unitario_comercial: unitPrice(totals[n] || 1, i.quantity),
      valor_unitario_tributavel: unitPrice(totals[n] || 1, i.quantity),
      valor_bruto: money(totals[n]),
      ...(discounts[n] ? { valor_desconto: money(discounts[n]) } : {}),
      ...(others[n] ? { valor_outras_despesas: money(others[n]) } : {}),
      ...(freights[n] ? { valor_frete: money(freights[n]) } : {}),
      ...(kind === 'nfe' ? { inclui_no_total: '1' } : {}),
      icms_origem: String(rule?.icmsOrigin ?? i.origin ?? 0),
      icms_situacao_tributaria: rule?.icmsCst ?? i.legacyCode ?? settings.defaultCode,
      ...(rule ? taxFields(kind, rule, base) : {}),
    };
  });

  if (ruleProblems.size)
    issues.push({
      title: 'Padrão fiscal incompleto',
      detail: `A SEFAZ recusaria a nota: ${[...ruleProblems].join('; ')}. Corrija em Fiscal → Padrões fiscais.`,
      fix: 'rules',
    });
  if (legacyCfops.size)
    issues.push({
      title: 'CFOP não aceito na NFC-e',
      detail: `A NFC-e não aceita o CFOP ${[...legacyCfops].join(', ')}. Corrija o CFOP padrão em Fiscal → Configuração.`,
      fix: 'settings',
    });
  const noCest = [
    ...new Set(
      items
        .filter((i, n) => !i.cest && ICMS_ST.has(resolved[n]?.icmsCst ?? i.legacyCode ?? ''))
        .map((i) => i.name),
    ),
  ];
  if (noCest.length)
    issues.push({
      title: noCest.length === 1 ? 'Item com ICMS-ST sem CEST' : 'Itens com ICMS-ST sem CEST',
      detail: `Item com substituição tributária precisa do CEST no cadastro (rejeição 806): ${noCest.join(', ')}.`,
      fix: 'items',
    });

  const info = [settings.additionalInfo, operation.info].filter((x) => x && x.trim()).join(' ');
  const payload: Record<string, unknown> = {
    cnpj_emitente: input.cnpj,
    natureza_operacao: (operation.nature || settings.nature).slice(0, 60),
    ...recipientPayload(kind, recipient),
    items: payloadItems,
    formas_pagamento: input.payments.map((p) => {
      const code = PAYMENT_CODES[p.method] ?? '99';
      return {
        forma_pagamento: code,
        valor_pagamento: p.net,
        // Cartão e Pix pedem o grupo do cartão; sem maquininha integrada vai "não integrado" (2).
        ...(CARD_CODES.has(code) ? { tipo_integracao: '2' } : {}),
        // "Outros" (99) exige a descrição do meio de pagamento.
        ...(code === '99' ? { descricao_pagamento: 'Outros' } : {}),
      };
    }),
    ...(info ? { informacoes_adicionais_contribuinte: info.slice(0, 2000) } : {}),
    // Pedido de aplicativo (iFood): a venda foi intermediada (rejeições 434 e 438 da NT 2020.006).
    ...(input.intermediary
      ? {
          indicador_intermediario: '1',
          cnpj_intermediario: input.intermediary.cnpj,
          id_intermediario: input.intermediary.storeId.slice(0, 60),
        }
      : {}),
  };
  if (kind === 'nfce') {
    Object.assign(payload, {
      presenca_comprador: delivery ? '4' : '1',
      modalidade_frete: '9',
      local_destino: '1',
    });
  } else {
    const purpose = operation.purpose ?? '1';
    Object.assign(payload, {
      tipo_documento: '1',
      finalidade_emissao: purpose,
      consumidor_final: operation.finalConsumer === false ? '0' : '1',
      // "4" (entrega a domicílio) é só da NFC-e: na NF-e a SEFAZ recusa (rejeição 794).
      presenca_comprador:
        operation.presence && operation.presence !== '4'
          ? operation.presence
          : order.source === 'online' || order.source === 'app'
            ? '2'
            : delivery || operation.presence === '4'
              ? '9'
              : '1',
      local_destino: interstate ? '2' : '1',
      modalidade_frete: operation.freight ?? (freightCents > 0 ? '0' : '9'),
      ...(purpose !== '1' && operation.referencedKey
        ? { notas_referenciadas: [{ chave_nfe: digits(operation.referencedKey) }] }
        : {}),
    });
  }
  return { payload, issues, lines };
}
