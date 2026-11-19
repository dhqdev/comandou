/**
 * Tabelas fiscais (NFC-e modelo 65 e NF-e modelo 55) e a tradução das recusas da SEFAZ para
 * palavras simples. Usadas pela API (validação e montagem da nota) e pelas telas (listas de
 * escolha e explicações). Os códigos seguem o Manual de Orientação do Contribuinte e as notas
 * técnicas da reforma tributária (IBS/CBS); confirme sempre com a contabilidade.
 */

export type FiscalKind = 'nfce' | 'nfe';
export type CodeList = readonly (readonly [code: string, label: string])[];

/** Regime tributário do emitente (CRT). */
export const FISCAL_REGIMES: CodeList = [
  ['1', 'Simples Nacional'],
  ['2', 'Simples Nacional, excesso de sublimite'],
  ['3', 'Regime normal (Lucro Presumido ou Real)'],
  ['4', 'MEI'],
];

/** CSOSN: situação do ICMS para quem é do Simples Nacional (CRT 1, 2 e 4). */
export const CSOSN: CodeList = [
  ['101', '101 · Tributada com permissão de crédito'],
  ['102', '102 · Tributada sem permissão de crédito'],
  ['103', '103 · Isenção do ICMS para faixa de receita bruta'],
  ['201', '201 · Com permissão de crédito e com ICMS-ST'],
  ['202', '202 · Sem permissão de crédito e com ICMS-ST'],
  ['203', '203 · Isenção para faixa de receita e com ICMS-ST'],
  ['300', '300 · Imune'],
  ['400', '400 · Não tributada'],
  ['500', '500 · ICMS cobrado antes por substituição tributária'],
  ['900', '900 · Outros'],
];

/** CST do ICMS para o regime normal (CRT 3). */
export const CST_ICMS: CodeList = [
  ['00', '00 · Tributada integralmente'],
  ['10', '10 · Tributada e com cobrança do ICMS-ST'],
  ['20', '20 · Com redução de base de cálculo'],
  ['30', '30 · Isenta ou não tributada e com ICMS-ST'],
  ['40', '40 · Isenta'],
  ['41', '41 · Não tributada'],
  ['50', '50 · Suspensão'],
  ['51', '51 · Diferimento'],
  ['60', '60 · ICMS cobrado anteriormente por substituição tributária'],
  ['61', '61 · Tributação monofásica sobre combustíveis cobrada anteriormente'],
  ['70', '70 · Com redução de base e cobrança do ICMS-ST'],
  ['90', '90 · Outras'],
];

/** Origem da mercadoria. */
export const ICMS_ORIGINS: CodeList = [
  ['0', '0 · Nacional'],
  ['1', '1 · Estrangeira, importação direta'],
  ['2', '2 · Estrangeira, adquirida no mercado interno'],
  ['3', '3 · Nacional com mais de 40% de conteúdo importado'],
  ['4', '4 · Nacional, processos produtivos básicos'],
  ['5', '5 · Nacional com até 40% de conteúdo importado'],
  ['6', '6 · Estrangeira, importação direta sem similar nacional'],
  ['7', '7 · Estrangeira, mercado interno, sem similar nacional'],
  ['8', '8 · Nacional com mais de 70% de conteúdo importado'],
];

/** CST de PIS e de COFINS (saídas). */
export const CST_PIS_COFINS: CodeList = [
  ['01', '01 · Tributável, alíquota básica'],
  ['02', '02 · Tributável, alíquota diferenciada'],
  ['03', '03 · Tributável, alíquota por unidade'],
  ['04', '04 · Monofásica, revenda a alíquota zero'],
  ['05', '05 · Substituição tributária'],
  ['06', '06 · Alíquota zero'],
  ['07', '07 · Isenta'],
  ['08', '08 · Sem incidência'],
  ['09', '09 · Com suspensão'],
  ['49', '49 · Outras operações de saída'],
  ['99', '99 · Outras operações'],
];

/** CST do IPI (saídas). Restaurante quase nunca destaca IPI. */
export const CST_IPI: CodeList = [
  ['50', '50 · Saída tributada'],
  ['51', '51 · Saída tributável com alíquota zero'],
  ['52', '52 · Saída isenta'],
  ['53', '53 · Saída não tributada'],
  ['54', '54 · Saída imune'],
  ['55', '55 · Saída com suspensão'],
  ['99', '99 · Outras saídas'],
];

/** CST do IBS e da CBS (reforma tributária, LC 214/2025). */
export const CST_IBS_CBS: CodeList = [
  ['000', '000 · Tributação integral'],
  ['010', '010 · Tributação com alíquotas uniformes'],
  ['011', '011 · Alíquotas uniformes reduzidas'],
  ['200', '200 · Alíquota reduzida'],
  ['220', '220 · Alíquota fixa'],
  ['221', '221 · Alíquota fixa proporcional'],
  ['400', '400 · Isenção'],
  ['410', '410 · Imunidade e não incidência'],
  ['510', '510 · Diferimento'],
  ['550', '550 · Suspensão'],
  ['620', '620 · Tributação monofásica'],
  ['800', '800 · Transferência de crédito'],
  ['810', '810 · Ajustes'],
  ['820', '820 · Tributação em declaração de regime específico'],
];

/** Classificação tributária do IBS/CBS (cClassTrib) mais usada por bares e restaurantes. */
export const IBS_CBS_CLASSES: CodeList = [
  ['000001', '000001 · Situações tributadas integralmente pelo IBS e CBS'],
  ['200047', '200047 · Bares e restaurantes, alíquota reduzida em 40% (CST 200)'],
  ['200034', '200034 · Alimentos do Anexo VII, alíquota reduzida em 60% (CST 200)'],
  ['200003', '200003 · Cesta básica (Anexo I), alíquota reduzida em 100% (CST 200)'],
  ['410019', '410019 · Gorjeta fora da base no fornecimento de alimentação (CST 410)'],
  ['410999', '410999 · Operações não onerosas sem previsão de tributação'],
];

/**
 * Redução das alíquotas do IBS e da CBS (pRedAliq) de cada classificação com CST 200, conforme a
 * tabela oficial de cClassTrib. Com CST 200 a nota leva a redução e a alíquota efetiva.
 */
export const IBS_CBS_REDUCTIONS: Readonly<Record<string, number>> = {
  '200003': 100,
  '200014': 100,
  '200034': 60,
  '200036': 60,
  '200047': 40,
};

/** Alíquotas de teste de 2026 (sem recolhimento): CBS 0,9% e IBS estadual 0,1%. */
export const IBS_CBS_TEST_RATES = { cbs: '0.9', ibsUf: '0.1', ibsMun: '0' } as const;

/** CFOPs de saída comuns em bares e restaurantes. */
export const CFOPS: CodeList = [
  ['5101', '5101 · Venda de produção do estabelecimento'],
  ['5102', '5102 · Venda de mercadoria adquirida de terceiros'],
  ['5103', '5103 · Venda de produção, fora do estabelecimento'],
  ['5104', '5104 · Venda de mercadoria de terceiros, fora do estabelecimento'],
  ['5405', '5405 · Venda de mercadoria com ICMS-ST (contribuinte substituído)'],
  ['5401', '5401 · Venda de produção com ICMS-ST (contribuinte substituto)'],
  ['5929', '5929 · Lançamento de operação já registrada em cupom fiscal'],
  ['5202', '5202 · Devolução de compra para comercialização'],
  ['5411', '5411 · Devolução de compra com ICMS-ST'],
  ['5910', '5910 · Remessa em bonificação, doação ou brinde'],
  ['5949', '5949 · Outra saída de mercadoria não especificada'],
  ['6101', '6101 · Venda de produção para outro estado'],
  ['6102', '6102 · Venda de mercadoria de terceiros para outro estado'],
  ['6108', '6108 · Venda para não contribuinte de outro estado'],
  ['6404', '6404 · Venda com ICMS-ST já retido, para outro estado'],
];

/** NCMs comuns no cardápio (o NCM descreve o produto; confirme com a contabilidade). */
export const COMMON_NCMS: CodeList = [
  ['21069090', '2106.90.90 · Preparações alimentícias (lanches, pratos prontos, porções)'],
  ['19059090', '1905.90.90 · Pães, salgados assados, pizzas e produtos de padaria'],
  ['19022000', '1902.20.00 · Massas recheadas (pastéis, ravióli)'],
  ['16010000', '1601.00.00 · Embutidos (linguiça, salsicha)'],
  ['16025000', '1602.50.00 · Preparações de carne bovina'],
  ['16023200', '1602.32.00 · Preparações de frango'],
  ['20052000', '2005.20.00 · Batata preparada (batata frita)'],
  ['21050010', '2105.00.10 · Sorvetes'],
  ['18069000', '1806.90.00 · Chocolates e doces com cacau'],
  ['17049020', '1704.90.20 · Bombons, balas e doces sem cacau'],
  ['22011000', '2201.10.00 · Água mineral'],
  ['22021000', '2202.10.00 · Refrigerantes e águas saborizadas'],
  ['22029900', '2202.99.00 · Outras bebidas não alcoólicas (chás, isotônicos)'],
  ['20098990', '2009.89.90 · Sucos de outras frutas'],
  ['22030000', '2203.00.00 · Cerveja'],
  ['22042100', '2204.21.00 · Vinhos'],
  ['22083020', '2208.30.20 · Uísque'],
  ['22084000', '2208.40.00 · Cachaça e rum'],
  ['22086000', '2208.60.00 · Vodca'],
  ['09012100', '0901.21.00 · Café torrado'],
];

/** Presença do comprador. A NFC-e só aceita 1 (presencial) e 4 (entrega a domicílio). */
export const PRESENCE: CodeList = [
  ['1', '1 · Presencial'],
  ['2', '2 · Não presencial, internet'],
  ['3', '3 · Não presencial, teleatendimento'],
  ['4', '4 · Entrega a domicílio'],
  ['5', '5 · Presencial, fora do estabelecimento'],
  ['9', '9 · Não presencial, outros'],
  ['0', '0 · Não se aplica'],
];

/** Finalidade da NF-e. */
export const NFE_PURPOSES: CodeList = [
  ['1', 'Normal'],
  ['2', 'Complementar'],
  ['3', 'Ajuste'],
  ['4', 'Devolução de mercadoria'],
];

/** Modalidade do frete. */
export const FREIGHT_MODES: CodeList = [
  ['9', 'Sem frete'],
  ['0', 'Por conta do emitente (CIF)'],
  ['1', 'Por conta do destinatário (FOB)'],
  ['2', 'Por conta de terceiros'],
  ['3', 'Transporte próprio do emitente'],
  ['4', 'Transporte próprio do destinatário'],
];

/** Indicador da inscrição estadual do destinatário. */
export const IE_INDICATORS: CodeList = [
  ['9', 'Não contribuinte'],
  ['1', 'Contribuinte de ICMS (tem IE)'],
  ['2', 'Contribuinte isento de IE'],
];

/** Meio de pagamento (tPag) a partir da forma do Comandou. */
export const PAYMENT_CODES: Record<string, string> = {
  cash: '01',
  credit: '03',
  debit: '04',
  voucher: '11',
  pix: '17',
  other: '99',
};

/** CSOSN são do Simples (CRT 1, 2 e 4); CST são do regime normal (CRT 3). */
export function icmsCodesFor(regime: number | null | undefined): CodeList {
  return regime === 3 ? CST_ICMS : CSOSN;
}

/** O CST/CSOSN combina com o regime? (rejeições 590 e 591). */
export function icmsMatchesRegime(code: string, regime: number | null | undefined): boolean {
  if (!regime) return true;
  return regime === 3 ? code.length === 2 : code.length === 3;
}

/**
 * CFOP interestadual equivalente (5xxx → 6xxx). O 5405 não tem 6405: vira 6404. Venda para
 * não contribuinte de outro estado usa 6107 (produção) e 6108 (mercadoria de terceiros).
 */
export function interstateCfop(cfop: string, nonContributor = false): string {
  if (nonContributor && cfop === '5101') return '6107';
  if (nonContributor && cfop === '5102') return '6108';
  if (cfop === '5405') return '6404';
  return cfop.startsWith('5') ? `6${cfop.slice(1)}` : cfop;
}

/** CFOPs que a NFC-e aceita (regra 725), mais as exceções de cada estado (NT 2023.003). */
const NFCE_CFOPS = new Set([
  '5101',
  '5102',
  '5103',
  '5104',
  '5115',
  '5405',
  '5656',
  '5667',
  '5933',
]);
const NFCE_CFOPS_UF: Record<string, string[]> = {
  '5949': ['RS', 'SP', 'ES', 'AM'],
  '5403': ['CE'],
};

/** A NFC-e aceita este CFOP no estado do restaurante? (UF desconhecida: aceita as exceções). */
export function nfceCfopAllowed(cfop: string, uf: string | null | undefined): boolean {
  if (NFCE_CFOPS.has(cfop)) return true;
  const ufs = NFCE_CFOPS_UF[cfop];
  return !!ufs && (!uf || ufs.includes(uf.toUpperCase()));
}

/**
 * CST/CSOSN aceitos na NFC-e (regras 382 e 386): venda ao consumidor final não leva ICMS-ST
 * retido na própria nota, diferimento nem crédito do Simples.
 */
const NFCE_ICMS = new Set([
  '00',
  '20',
  '40',
  '41',
  '60',
  '90',
  '102',
  '103',
  '300',
  '400',
  '500',
  '900',
]);
export function nfceIcmsAllowed(code: string): boolean {
  return NFCE_ICMS.has(code);
}

/** CPF válido (dígitos verificadores). */
export function isValidCpf(v: string): boolean {
  const d = v.replace(/\D/g, '');
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** CNPJ válido (dígitos verificadores). */
export function isValidCnpj(v: string): boolean {
  const d = v.replace(/\D/g, '');
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (n: number) => {
    const w =
      n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** CPF 000.000.000-00 ou CNPJ 00.000.000/0000-00. */
export function formatDocument(v: string | null | undefined): string {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v ?? '';
}

/** Um problema da nota explicado para quem está no caixa. */
export interface FiscalIssue {
  /** Título curto: "Falta o CPF ou CNPJ do cliente". */
  title: string;
  /** O que aconteceu e como resolver. */
  detail: string;
  /** Onde corrigir: destinatário, itens, padrões fiscais, configuração, pagamento ou SEFAZ. */
  fix?: 'recipient' | 'items' | 'rules' | 'settings' | 'payment' | 'certificate' | 'retry' | 'none';
  /** Código da rejeição da SEFAZ, quando veio de lá. */
  code?: string;
}

/** Rejeições conhecidas pelo código (cStat). */
const BY_CODE: Record<string, Omit<FiscalIssue, 'code'>> = {
  '204': {
    title: 'Nota já enviada antes',
    detail:
      'A SEFAZ já tem uma nota com este número (duplicidade). Use "Atualizar" para buscar a situação real antes de reenviar.',
    fix: 'retry',
  },
  '206': {
    title: 'Número inutilizado',
    detail:
      'Este número de nota foi inutilizado e não pode mais ser usado. Reemita para gerar com o próximo número.',
    fix: 'retry',
  },
  '213': {
    title: 'CNPJ do certificado diferente',
    detail:
      'O certificado digital é de outro CNPJ. Envie o certificado A1 da empresa emitente em Fiscal > Configuração.',
    fix: 'certificate',
  },
  '215': {
    title: 'Dados da nota fora do padrão',
    detail:
      'Algum campo foi enviado em formato que a SEFAZ não aceita. Confira os dados do cliente e dos itens e reemita.',
    fix: 'items',
  },
  '225': {
    title: 'Dados da nota fora do padrão',
    detail:
      'Algum campo foi enviado em formato que a SEFAZ não aceita. Confira os dados do cliente e dos itens e reemita.',
    fix: 'items',
  },
  '230': {
    title: 'Inscrição estadual da empresa não cadastrada',
    detail:
      'A SEFAZ não reconhece a inscrição estadual do restaurante. Confira a IE em Fiscal > Configuração.',
    fix: 'settings',
  },
  '232': {
    title: 'IE do cliente não cadastrada',
    detail:
      'A inscrição estadual informada para o cliente não existe na SEFAZ. Corrija a IE ou marque o cliente como não contribuinte.',
    fix: 'recipient',
  },
  '233': {
    title: 'IE do cliente não bate com o CNPJ',
    detail:
      'A inscrição estadual do cliente pertence a outro CNPJ. Confira o CNPJ e a IE do destinatário.',
    fix: 'recipient',
  },
  '280': {
    title: 'Certificado digital inválido',
    detail: 'Envie de novo o certificado A1 (.pfx) da empresa em Fiscal > Configuração.',
    fix: 'certificate',
  },
  '281': {
    title: 'Certificado digital vencido',
    detail:
      'O certificado A1 da empresa venceu. Compre ou renove o certificado e envie o novo arquivo em Fiscal > Configuração.',
    fix: 'certificate',
  },
  '301': {
    title: 'Uso denegado: situação do restaurante na SEFAZ',
    detail:
      'A SEFAZ negou a nota por irregularidade fiscal do emitente. Fale com a contabilidade: o número foi consumido e a nota não pode ser reemitida.',
    fix: 'none',
  },
  '302': {
    title: 'Uso denegado: situação do cliente na SEFAZ',
    detail:
      'A SEFAZ negou a nota por irregularidade do destinatário. Emita sem o CNPJ do cliente ou fale com a contabilidade.',
    fix: 'none',
  },
  '464': {
    title: 'CSC da NFC-e errado',
    detail:
      'O código de segurança (CSC) usado no QR Code não confere com o da SEFAZ. Confira o CSC e o identificador em Fiscal > Configuração.',
    fix: 'settings',
  },
  '539': {
    title: 'Nota já enviada com outros dados',
    detail:
      'Já existe uma nota com este número e dados diferentes. Use "Atualizar" para conferir; se precisar, inutilize o número.',
    fix: 'retry',
  },
  '590': {
    title: 'CST usado em empresa do Simples Nacional',
    detail:
      'Quem é do Simples usa CSOSN (3 dígitos, ex.: 102), não CST. Corrija o padrão fiscal dos itens.',
    fix: 'rules',
  },
  '591': {
    title: 'CSOSN usado em empresa fora do Simples',
    detail:
      'No regime normal o ICMS usa CST (2 dígitos, ex.: 00), não CSOSN. Corrija o padrão fiscal dos itens ou o regime em Fiscal > Configuração.',
    fix: 'rules',
  },
  '703': {
    title: 'Data de emissão no futuro',
    detail:
      'O relógio do servidor está adiantado em relação à SEFAZ. Aguarde alguns minutos e reemita.',
    fix: 'retry',
  },
  '704': {
    title: 'NFC-e com data de emissão atrasada',
    detail:
      'A NFC-e só pode ser enviada em até alguns minutos depois da emissão. Reemita: a nota sai com a hora atual.',
    fix: 'retry',
  },
  '778': {
    title: 'NCM inexistente',
    detail:
      'Um dos itens tem um NCM que não existe na tabela da Receita. Corrija o NCM do item no cadastro do cardápio.',
    fix: 'items',
  },
  '787': {
    title: 'Falta o CPF ou CNPJ do cliente',
    detail:
      'Venda de delivery é entrega a domicílio, e a SEFAZ exige a identificação do destinatário nesse caso.',
    fix: 'recipient',
  },
  '865': {
    title: 'Pagamentos menores que o total',
    detail:
      'A soma das formas de pagamento não fecha com o valor da nota. Confira os pagamentos do pedido.',
    fix: 'payment',
  },
  '869': {
    title: 'Troco calculado errado',
    detail: 'O troco informado não confere com os pagamentos. Confira os pagamentos do pedido.',
    fix: 'payment',
  },
};

/** Palavras da mensagem da SEFAZ que apontam o problema quando o código não é conhecido. */
const BY_TEXT: [RegExp, Omit<FiscalIssue, 'code'>][] = [
  [
    /ncm/i,
    {
      title: 'Problema no NCM de um item',
      detail: 'Confira o NCM dos itens no cadastro do cardápio (8 dígitos, da tabela da Receita).',
      fix: 'items',
    },
  ],
  [
    /cfop/i,
    {
      title: 'CFOP não aceito para esta nota',
      detail:
        'O CFOP do padrão fiscal não serve para esta operação (ex.: NFC-e só aceita CFOP 5xxx de venda). Corrija o padrão fiscal.',
      fix: 'rules',
    },
  ],
  [
    /csosn|\bcst\b|situa[cç][aã]o tribut/i,
    {
      title: 'Situação tributária incompatível',
      detail:
        'O CST/CSOSN do padrão fiscal não combina com o regime ou com o CFOP. Corrija o padrão fiscal.',
      fix: 'rules',
    },
  ],
  [
    /certificado/i,
    {
      title: 'Problema no certificado digital',
      detail:
        'Confira se o certificado A1 está válido e é da empresa emitente (Fiscal > Configuração).',
      fix: 'certificate',
    },
  ],
  [
    /csc|qr-?code/i,
    {
      title: 'Problema no CSC da NFC-e',
      detail: 'Confira o CSC e o identificador do ambiente em Fiscal > Configuração.',
      fix: 'settings',
    },
  ],
  [
    /destinat|cpf|cnpj do dest/i,
    {
      title: 'Dados do cliente recusados',
      detail: 'Confira CPF/CNPJ, nome, inscrição estadual e endereço do destinatário.',
      fix: 'recipient',
    },
  ],
  [
    /pagamento|troco/i,
    {
      title: 'Problema nos pagamentos',
      detail: 'Confira os pagamentos do pedido: a soma precisa bater com o total da nota.',
      fix: 'payment',
    },
  ],
  [
    /inscri[cç][aã]o estadual|\bie\b/i,
    {
      title: 'Problema na inscrição estadual',
      detail: 'Confira a IE do restaurante (Configuração) e a do cliente (Destinatário).',
      fix: 'settings',
    },
  ],
  [
    /data.*emiss|emiss.*data/i,
    {
      title: 'Data de emissão recusada',
      detail: 'Reemita a nota: ela sai com a data e hora atuais.',
      fix: 'retry',
    },
  ],
];

/**
 * Explica uma recusa da SEFAZ (ou um erro da Focus) em palavras simples.
 * Sem código nem palavra conhecida, devolve a mensagem original com uma orientação geral.
 */
export function explainFiscalError(
  code: string | null | undefined,
  message: string | null | undefined,
): FiscalIssue {
  const c = (code ?? '').trim();
  const msg = (message ?? '').trim();
  const known = BY_CODE[c];
  if (known) return { ...known, code: c || undefined };
  const hit = BY_TEXT.find(([re]) => re.test(msg));
  if (hit)
    return {
      ...hit[1],
      detail: `${hit[1].detail}${msg ? ` (SEFAZ: ${msg})` : ''}`,
      code: c || undefined,
    };
  return {
    title: 'A SEFAZ recusou a nota',
    detail: msg
      ? `${msg}. Corrija o que a mensagem pede e reemita; na dúvida, mostre esta mensagem para a contabilidade.`
      : 'Sem detalhe da SEFAZ. Tente "Atualizar"; se continuar, reemita.',
    fix: 'retry',
    code: c || undefined,
  };
}

/** Padrões fiscais sugeridos para começar, conforme o regime da empresa. */
export interface SuggestedRule {
  name: string;
  scope: 'all' | 'nfce' | 'nfe';
  cfop: string;
  icmsCst: string;
  pisCst: string;
  cofinsCst: string;
  isDefault?: boolean;
  notes: string;
}

export function suggestedRules(regime: number | null | undefined): SuggestedRule[] {
  if (regime === 3)
    return [
      {
        name: 'Venda de produção (comida)',
        scope: 'all',
        cfop: '5101',
        icmsCst: '00',
        pisCst: '01',
        cofinsCst: '01',
        isDefault: true,
        notes:
          'Lanches e pratos feitos na casa. Alíquotas de ICMS, PIS e COFINS: confirme com a contabilidade.',
      },
      {
        name: 'Bebidas com substituição tributária',
        scope: 'all',
        cfop: '5405',
        icmsCst: '60',
        pisCst: '04',
        cofinsCst: '04',
        notes:
          'Refrigerante, cerveja e água compradas com ICMS-ST já retido (informe o CEST no item).',
      },
    ];
  return [
    {
      name: 'Venda de produção (comida)',
      scope: 'all',
      cfop: '5101',
      icmsCst: '102',
      pisCst: '49',
      cofinsCst: '49',
      isDefault: true,
      notes: 'Simples Nacional: lanches e pratos feitos na casa.',
    },
    {
      name: 'Revenda de mercadoria',
      scope: 'all',
      cfop: '5102',
      icmsCst: '102',
      pisCst: '49',
      cofinsCst: '49',
      notes: 'Simples Nacional: itens comprados prontos e revendidos sem ICMS-ST.',
    },
    {
      name: 'Bebidas com substituição tributária',
      scope: 'all',
      cfop: '5405',
      icmsCst: '500',
      pisCst: '49',
      cofinsCst: '49',
      notes: 'Simples Nacional: bebidas compradas com ICMS-ST já retido (informe o CEST no item).',
    },
  ];
}
