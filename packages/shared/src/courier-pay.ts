import { fromCents, multiplyCents, toCents } from './money';

/**
 * Ganhos do entregador (motoboy): quanto ele ganha por corrida, a diária e os impostos que a
 * loja retém ou paga quando faz o repasse. Usado pela API (grava o valor de cada corrida ao
 * encerrar e fecha o repasse) e pela tela (exemplo ao vivo da regra e a central do motoboy).
 *
 * Dinheiro em strings decimais ("7.50"); percentuais em número (0 a 100, até 2 casas).
 */

/**
 * - fixed: valor fixo por entrega.
 * - per_km: valor por km rodado (ida da loja até o cliente).
 * - fee_percent: uma parte da taxa de entrega que o cliente pagou (100% = toda a taxa).
 * - fixed_plus_km: fixo que já cobre os primeiros km + valor por km que passar disso.
 */
export type CourierPayMode = 'fixed' | 'per_km' | 'fee_percent' | 'fixed_plus_km';

export const COURIER_PAY_MODES: readonly CourierPayMode[] = [
  'fixed',
  'per_km',
  'fee_percent',
  'fixed_plus_km',
];

export const COURIER_PAY_MODE_LABELS: Record<CourierPayMode, string> = {
  fixed: 'Valor fixo por entrega',
  per_km: 'Valor por km',
  fee_percent: 'Parte da taxa de entrega',
  fixed_plus_km: 'Fixo + km adicional',
};

export interface CourierPayRule {
  mode: CourierPayMode;
  /** Valor fixo por entrega (fixed e fixed_plus_km). */
  fixed: string;
  /** Valor por km (per_km e o adicional do fixed_plus_km). */
  perKm: string;
  /** Km já cobertos pelo fixo (fixed_plus_km). */
  kmIncluded: number;
  /** % da taxa de entrega que vai para o entregador (fee_percent). */
  feePercent: number;
  /** Mínimo garantido por entrega concluída ("0" = sem mínimo). */
  minPerDelivery: string;
  /** % do valor pago quando a entrega não foi realizada (o motoboy rodou do mesmo jeito). */
  failedPercent: number;
  /** Diária: valor fixo por dia em que fez ao menos uma entrega ("0" = sem diária). */
  dailyRate: string;
}

/** Padrão: o motoboy fica com toda a taxa de entrega (o que a maioria das lojas já faz). */
export const DEFAULT_COURIER_PAY_RULE: CourierPayRule = {
  mode: 'fee_percent',
  fixed: '0.00',
  perKm: '0.00',
  kmIncluded: 0,
  feePercent: 100,
  minPerDelivery: '0.00',
  failedPercent: 0,
  dailyRate: '0.00',
};

/**
 * - mei: o motoboy é MEI e emite nota. Não há retenção: ele recolhe o próprio DAS.
 * - autonomo: pessoa física sem CNPJ (RPA). A loja retém INSS (11%), IRRF (tabela mensal) e,
 *   se a prefeitura exigir, ISS; e paga a contribuição patronal se não for do Simples.
 * - clt: funcionário registrado. O salário e os encargos vão pela folha (contador); aqui
 *   o valor serve só de controle de comissão por entrega.
 */
export type CourierTaxRegime = 'mei' | 'autonomo' | 'clt';

export const COURIER_TAX_REGIMES: readonly CourierTaxRegime[] = ['mei', 'autonomo', 'clt'];

export const COURIER_TAX_REGIME_LABELS: Record<CourierTaxRegime, string> = {
  mei: 'MEI (com CNPJ)',
  autonomo: 'Autônomo (RPA, sem CNPJ)',
  clt: 'Funcionário CLT',
};

export interface CourierTaxSettings {
  /** INSS retido do autônomo (contribuinte individual): 11%. */
  inssRate: number;
  /** Teto do salário de contribuição do INSS no mês (2026: R$ 8.475,55). */
  inssCeiling: string;
  /** Retém IRRF do autônomo pela tabela mensal (com a redução da Lei 15.270/2025). */
  withholdIrrf: boolean;
  /** ISS retido pela loja, quando a prefeitura exige (0 = não retém). */
  issRate: number;
  /** Contribuição patronal sobre o pagamento ao autônomo: 20% fora do Simples, 0 no Simples. */
  employerRate: number;
}

export const DEFAULT_COURIER_TAX_SETTINGS: CourierTaxSettings = {
  inssRate: 11,
  inssCeiling: '8475.55',
  withholdIrrf: true,
  issRate: 0,
  employerRate: 0,
};

/** Fator de rota sobre a linha reta (as ruas nunca são retas). */
export const ROUTE_FACTOR = 1.3;

/** Distância de rota estimada, em metros, entre a loja e o cliente: linha reta × 1,3. */
export function routeDistanceM(
  a: { lat: number; lng: number } | null,
  b: { lat: number; lng: number } | null,
): number | null {
  if (!a || !b) return null;
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * ROUTE_FACTOR);
}

const pctOf = (cents: number, pct: number) => multiplyCents(cents, pct / 100, 1_000_000);

export interface DeliveryPayInput {
  /** Taxa de entrega cobrada do cliente. */
  fee: string;
  /** Distância de rota em metros (null = sem coordenadas da loja ou do cliente). */
  distanceM: number | null;
  status: 'delivered' | 'failed' | 'out';
}

export interface DeliveryPay {
  amount: string;
  /** A regra usa km e a corrida não tem distância: a parte por km ficou de fora. */
  missingDistance: boolean;
}

/** Quanto o entregador ganha numa corrida. "out" = estimativa se ele concluir. */
export function deliveryPay(rule: CourierPayRule, input: DeliveryPayInput): DeliveryPay {
  const km = input.distanceM == null ? null : input.distanceM / 1000;
  const usesKm = rule.mode === 'per_km' || rule.mode === 'fixed_plus_km';
  let cents = 0;
  switch (rule.mode) {
    case 'fixed':
      cents = toCents(rule.fixed);
      break;
    case 'per_km':
      cents = km == null ? 0 : multiplyCents(toCents(rule.perKm), km);
      break;
    case 'fee_percent':
      cents = pctOf(toCents(input.fee), rule.feePercent);
      break;
    case 'fixed_plus_km':
      cents =
        toCents(rule.fixed) +
        (km == null ? 0 : multiplyCents(toCents(rule.perKm), Math.max(0, km - rule.kmIncluded)));
      break;
  }
  cents = Math.max(cents, toCents(rule.minPerDelivery));
  if (input.status === 'failed') cents = pctOf(cents, rule.failedPercent);
  return { amount: fromCents(cents), missingDistance: usesKm && km == null };
}

/** Frase curta da regra, para o motoboy e para o dono. */
export function describePayRule(rule: CourierPayRule): string {
  const brl = (v: string) => `R$ ${v.replace('.', ',')}`;
  const n = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const parts: string[] = [];
  switch (rule.mode) {
    case 'fixed':
      parts.push(`${brl(rule.fixed)} por entrega`);
      break;
    case 'per_km':
      parts.push(`${brl(rule.perKm)} por km`);
      break;
    case 'fee_percent':
      parts.push(
        rule.feePercent === 100
          ? 'toda a taxa de entrega'
          : `${n(rule.feePercent)}% da taxa de entrega`,
      );
      break;
    case 'fixed_plus_km':
      parts.push(
        `${brl(rule.fixed)} até ${n(rule.kmIncluded)} km + ${brl(rule.perKm)} por km a mais`,
      );
      break;
  }
  if (toCents(rule.minPerDelivery) > 0) parts.push(`mínimo de ${brl(rule.minPerDelivery)}`);
  if (toCents(rule.dailyRate) > 0) parts.push(`diária de ${brl(rule.dailyRate)}`);
  if (rule.failedPercent > 0) parts.push(`${n(rule.failedPercent)}% se não entregar`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------------------- impostos

/**
 * Tabela progressiva mensal do IRRF (Lei 15.191/2025, vigente em 2026), em centavos:
 * [até, alíquota %, parcela a deduzir].
 */
const IRRF_TABLE: readonly [number, number, number][] = [
  [242_880, 0, 0],
  [282_665, 7.5, 18_216],
  [375_105, 15, 39_416],
  [466_468, 22.5, 67_549],
  [Number.MAX_SAFE_INTEGER, 27.5, 90_873],
];
/** Desconto simplificado mensal, usado quando é melhor que deduzir o INSS. */
export const IRRF_SIMPLIFIED_DISCOUNT = '607.20';

/**
 * IRRF do mês sobre os rendimentos pagos a uma pessoa física (centavos).
 * Base = bruto − max(INSS retido, desconto simplificado). Depois aplica a redução da Lei
 * 15.270/2025: zera o imposto para rendimento bruto até R$ 5.000,00 e reduz em
 * R$ 978,62 − 0,133145 × bruto entre R$ 5.000,01 e R$ 7.350,00.
 */
export function irrfMonthCents(grossCents: number, inssCents: number): number {
  const base = Math.max(0, grossCents - Math.max(inssCents, toCents(IRRF_SIMPLIFIED_DISCOUNT)));
  const band = IRRF_TABLE.find(([upTo]) => base <= upTo)!;
  let tax = Math.max(0, pctOf(base, band[1]) - band[2]);
  if (grossCents <= 500_000) tax = 0;
  else if (grossCents <= 735_000)
    tax = Math.max(0, tax - Math.max(0, 97_862 - Math.round(grossCents * 0.133145)));
  return tax;
}

export interface CourierTaxes {
  gross: string;
  inss: string;
  irrf: string;
  iss: string;
  /** Total retido (INSS + IRRF + ISS): a loja recolhe ao governo. */
  withheld: string;
  /** O que o motoboy recebe na mão. */
  net: string;
  /** Contribuição patronal (custo da loja, não sai do motoboy). */
  employer: string;
  /** Custo total da loja: bruto + patronal. */
  cost: string;
}

/**
 * Impostos de um repasse. INSS e IRRF são mensais: `monthBefore` é o que já foi pago e retido
 * para o mesmo motoboy no mesmo mês, para respeitar o teto do INSS e a tabela do IRRF quando a
 * loja paga por semana ou por dia.
 */
export function courierTaxes(
  regime: CourierTaxRegime,
  gross: string,
  cfg: CourierTaxSettings,
  monthBefore: { gross: string; inss: string; irrf: string } = {
    gross: '0',
    inss: '0',
    irrf: '0',
  },
): CourierTaxes {
  const g = toCents(gross);
  let inss = 0;
  let irrf = 0;
  let iss = 0;
  let employer = 0;
  if (regime === 'autonomo' && g > 0) {
    const prevGross = toCents(monthBefore.gross);
    const prevInss = toCents(monthBefore.inss);
    const maxInss = pctOf(toCents(cfg.inssCeiling), cfg.inssRate);
    const monthInss = Math.min(pctOf(prevGross + g, cfg.inssRate), maxInss);
    inss = Math.max(0, monthInss - prevInss);
    if (cfg.withholdIrrf)
      irrf = Math.max(
        0,
        irrfMonthCents(prevGross + g, prevInss + inss) - toCents(monthBefore.irrf),
      );
    iss = pctOf(g, cfg.issRate);
    employer = pctOf(g, cfg.employerRate);
  }
  const withheld = inss + irrf + iss;
  return {
    gross: fromCents(g),
    inss: fromCents(inss),
    irrf: fromCents(irrf),
    iss: fromCents(iss),
    withheld: fromCents(withheld),
    net: fromCents(g - withheld),
    employer: fromCents(employer),
    cost: fromCents(g + employer),
  };
}
