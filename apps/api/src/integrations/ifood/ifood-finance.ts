import { createHash } from 'node:crypto';
import type { ChannelPayout, ChannelSaleFinance } from '../channels/channel-adapter';

/**
 * Tradução da API financeira do iFood (v3). Vendas: o que cada pedido rende (bruto, saldo da venda
 * e os descontos do iFood). Repasses (settlements → closingItems): quando e quanto cai na conta.
 * Os dados da conta bancária (accountDetails) nunca saem daqui.
 */

export const IFOOD_FINANCE_PATHS = {
  sales: (m: string) => `/financial/v3.0/merchants/${encodeURIComponent(m)}/sales`,
  settlements: (m: string) => `/financial/v3.0/merchants/${encodeURIComponent(m)}/settlements`,
} as const;

/** Janela máxima de vendas por chamada (o iFood aceita 8 dias) e páginas por leitura. */
export const IFOOD_SALES_MAX_DAYS = 8;
export const IFOOD_SALES_MAX_PAGES = 20;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 100) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** Número do iFood (número ou texto) em centavos; ausente ou inválido = null. */
function cents(v: unknown): number | null {
  if (typeof v === 'object' && v !== null) {
    const o = obj(v);
    return cents(o.value ?? o.amount ?? o.totalValue);
  }
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const money = (c: number) => (c / 100).toFixed(2);

/** Data "AAAA-MM-DD" do começo do texto (o iFood manda data ou data e hora). */
function day(v: unknown): string | undefined {
  const s = str(v, 40);
  const m = s?.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

/** Nomes curtos dos descontos mais comuns; o resto vai como veio (sem dado pessoal: só o tipo). */
const ENTRY_LABEL: Record<string, string> = {
  COMMISSION: 'Comissão do iFood',
  COMISSAO: 'Comissão do iFood',
  PAYMENT_FEE: 'Taxa de pagamento',
  PAYMENT_TRANSACTION_FEE: 'Taxa de pagamento',
  TRANSACTION_FEE: 'Taxa de pagamento',
  DELIVERY_FEE: 'Entrega do iFood',
  LOGISTIC_FEE: 'Entrega do iFood',
  DELIVERY: 'Entrega do iFood',
  PROMOTION: 'Promoção da loja',
  MERCHANT_PROMOTION: 'Promoção da loja',
  BENEFIT: 'Cupom',
  BENEFITS: 'Cupom',
  ANTICIPATION_FEE: 'Antecipação',
  SERVICE_FEE: 'Taxa de serviço',
  OCCURRENCE: 'Ocorrência',
  REFUND: 'Reembolso',
};

function entryLabel(e: Record<string, unknown>) {
  const code = str(e.type ?? e.name ?? e.entryType, 60);
  if (!code) return 'Outro';
  const key = code.toUpperCase().replace(/[^A-Z]+/g, '_');
  return ENTRY_LABEL[key] ?? str(e.description, 60) ?? code;
}

/**
 * Uma venda do iFood. Bruto = itens + entrega cobrada do cliente (a taxa de serviço é do iFood);
 * saldo = `billingSummary.saleBalance`, que vem 0 e sem lançamentos enquanto o iFood não fecha a
 * conta da venda (aí fica null: "ainda não fechado").
 */
export function ifoodSale(raw: unknown): ChannelSaleFinance | null {
  const s = obj(raw);
  const externalId = str(s.id ?? s.orderId);
  if (!externalId) return null;
  const g = obj(s.saleGrossValue);
  const gross = (cents(g.bag) ?? 0) + (cents(g.deliveryFee) ?? 0);
  const bill = obj(s.billingSummary);
  const rawEntries = arr(bill.billingEntries).map(obj);
  const balance = cents(bill.saleBalance);
  const closed = balance !== null && (balance !== 0 || rawEntries.length > 0);
  const entries = rawEntries
    .map((e) => ({ label: entryLabel(e), c: cents(e.value ?? e.amount ?? e.totalValue) }))
    .filter((e): e is { label: string; c: number } => e.c !== null && e.c !== 0)
    .slice(0, 20)
    .map((e) => ({ label: e.label, amount: money(e.c) }));
  return {
    externalId,
    gross: money(Math.max(0, gross)),
    net: closed ? money(balance) : null,
    fees: closed ? money(gross - balance) : null,
    entries,
  };
}

/** Lista de vendas de uma página (`{sales, pageCount}`); 204/sem corpo = nada. */
export function ifoodSalesPage(body: unknown): { sales: ChannelSaleFinance[]; pageCount: number } {
  const b = obj(body);
  const sales = arr(b.sales)
    .map(ifoodSale)
    .filter((s): s is ChannelSaleFinance => !!s);
  const pageCount = Number(b.pageCount);
  return { sales, pageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1 };
}

/** Situação do repasse no iFood → pago, agendado ou falhou. */
export function payoutStatus(raw: string | undefined): ChannelPayout['status'] {
  const s = (raw ?? '').toUpperCase();
  if (/FAIL|ERROR|REJECT|RETURN|CANCEL|BLOCK/.test(s)) return 'failed';
  if (/PAID|TRANSFERRED|SETTLED|CONCLUDED|DONE|EXECUTED|COMPLETED|PAGO/.test(s)) return 'paid';
  return 'scheduled';
}

/**
 * Repasses do período. Cada closingItem é um pagamento (repasse normal, antecipação, débito): cai
 * na data antecipada quando houve antecipação, senão na original. O id é um resumo estável do
 * período, tipo e data original (o iFood não dá um).
 */
export function ifoodPayouts(storeId: string, body: unknown): ChannelPayout[] {
  const out = new Map<string, ChannelPayout>();
  for (const st of arr(obj(body).settlements).map(obj)) {
    const periodStart = day(st.startDateCalculation);
    const periodEnd = day(st.endDateCalculation);
    for (const it of arr(st.closingItems).map(obj)) {
      const original = cents(it.originalPaymentAmount);
      const anticipated = cents(it.anticipatedPaymentAmount);
      const originalDate = day(it.originalPaymentDate);
      const anticipatedDate = day(it.anticipatedPaymentDate);
      const expectedDate = (anticipated !== null && anticipatedDate) || originalDate;
      const amount = anticipated !== null && anticipatedDate ? anticipated : original;
      if (!expectedDate || amount === null) continue;
      const kind = str(it.type, 60) ?? 'REPASSE';
      const externalId = createHash('sha256')
        .update([storeId, periodStart, periodEnd, kind, originalDate ?? expectedDate].join('|'))
        .digest('hex')
        .slice(0, 40);
      const fee = cents(it.feeAmount);
      const channelStatus = str(it.status, 60);
      out.set(externalId, {
        externalId,
        kind,
        periodStart,
        periodEnd,
        expectedDate,
        amount: money(amount),
        originalAmount: original === null ? undefined : money(original),
        originalDate,
        anticipationFee: fee === null ? undefined : money(Math.abs(fee)),
        status: payoutStatus(channelStatus),
        channelStatus,
      });
    }
  }
  return [...out.values()];
}

/** "AAAA-MM-DD" somando dias (UTC; só a data importa). */
export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
