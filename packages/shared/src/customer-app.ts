/**
 * Regras do app do cliente (cardápio online) que a API e a tela precisam fazer igual: quando a
 * loja abre e fecha, o nível do cliente no programa de fidelidade, os pontos de cada item e o
 * desconto de cada cupom. Sem dependência de banco nem de navegador (testadas em
 * customer-app.test.ts).
 */
import { toCents } from './money';

// ---------------------------------------------------------------- horário da loja

export interface HourSlot {
  /** 0 = domingo. */
  day: number;
  /** "10:30" */
  open: string;
  /** "23:00" (menor que open = vira a noite; igual = 24 h). */
  close: string;
}

/** O que a faixa da loja diz: aberta até que horas, ou quando abre de novo. */
export interface StoreSchedule {
  /** Aberta agora: fecha às "HH:MM" (null = sem horário, ou 24 h). */
  closesAt: string | null;
  /** Fechada agora: próxima abertura. null = sem horário cadastrado. */
  opensAt: { day: number; time: string; when: 'today' | 'tomorrow' | 'later' } | null;
}

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Próxima abertura e o fechamento do turno de agora. `dow` e `hhmm` são a hora local da loja.
 * `openNow` é o que a API já decidiu (botão "aberta" + horário): com a loja aberta, procura o
 * turno que está valendo; fechada, a próxima abertura nos próximos 7 dias.
 */
export function storeSchedule(
  hours: HourSlot[],
  dow: number,
  hhmm: string,
  openNow: boolean,
): StoreSchedule {
  const now = mins(hhmm);
  if (!hours.length) return { closesAt: null, opensAt: null };
  if (openNow) {
    const yesterday = (dow + 6) % 7;
    const cur = hours.find((h) => {
      const o = mins(h.open);
      const c = mins(h.close);
      if (c > o) return h.day === dow && now >= o && now < c;
      if (o === c) return h.day === dow;
      return (h.day === dow && now >= o) || (h.day === yesterday && now < c);
    });
    return { closesAt: cur && cur.open !== cur.close ? cur.close : null, opensAt: null };
  }
  for (let add = 0; add < 8; add++) {
    const day = (dow + add) % 7;
    const slots = hours
      .filter((h) => h.day === day && (add > 0 || mins(h.open) > now))
      .sort((a, b) => mins(a.open) - mins(b.open));
    const first = slots[0];
    if (first)
      return {
        closesAt: null,
        opensAt: {
          day,
          time: first.open,
          when: add === 0 ? 'today' : add === 1 ? 'tomorrow' : 'later',
        },
      };
  }
  return { closesAt: null, opensAt: null };
}

const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "10:30" → "10h30"; "10:00" → "10h". */
export const hourText = (hhmm: string) => {
  const [h, m] = hhmm.split(':');
  return m && m !== '00' ? `${Number(h)}h${m}` : `${Number(h)}h`;
};

/** Frase da faixa da loja: "Aberta até 23h", "Fechada. Abre hoje às 10h30". */
export function scheduleText(isOpen: boolean, s: StoreSchedule | null | undefined): string {
  if (isOpen) return s?.closesAt ? `Aberta até ${hourText(s.closesAt)}` : 'Aberta agora';
  const o = s?.opensAt;
  if (!o) return 'Fechada agora';
  const when =
    o.when === 'today' ? 'hoje' : o.when === 'tomorrow' ? 'amanhã' : (WEEKDAY[o.day] ?? '');
  return `Fechada. Abre ${when} às ${hourText(o.time)}`;
}

// ---------------------------------------------------------------- níveis

export interface LoyaltyLevel {
  id: string;
  name: string;
  minPoints: number;
  perks: string | null;
  color: string | null;
}

/** Nível atual e o próximo, pelos pontos ganhos na janela do programa. */
export function levelOf(levels: LoyaltyLevel[], earned: number) {
  const sorted = [...levels].sort((a, b) => a.minPoints - b.minPoints);
  let current: LoyaltyLevel | null = null;
  for (const l of sorted) if (earned >= l.minPoints) current = l;
  const next = sorted.find((l) => l.minPoints > earned) ?? null;
  const from = current?.minPoints ?? 0;
  const pct = next
    ? Math.max(0, Math.min(100, Math.round(((earned - from) / (next.minPoints - from)) * 100)))
    : 100;
  return { current, next, missing: next ? next.minPoints - earned : 0, pct };
}

// ---------------------------------------------------------------- pontos por item

export interface PointsRule {
  mode: 'points' | 'stamps';
  pointsPerReal: string;
}

/**
 * Pontos que um item rende (o que o cartão mostra): o número fixo do item ou o preço × pontos por
 * real, para baixo. No programa de carimbos não há pontos por item (null).
 */
export function itemPoints(
  rule: PointsRule,
  priceCents: number,
  fixed: number | null | undefined,
): number | null {
  if (rule.mode !== 'points') return null;
  if (fixed !== null && fixed !== undefined) return fixed;
  if (priceCents <= 0) return 0;
  return Math.floor((priceCents * toCents(rule.pointsPerReal)) / 10_000);
}

/**
 * Pontos de um pedido. Itens com número fixo rendem esse número × quantidade; o resto rende pela
 * regra sobre o que sobrou do valor (subtotal − desconto − itens fixos), para baixo. Assim o
 * desconto do pedido só diminui os pontos dos itens sem número fixo.
 */
export function orderPoints(
  rule: PointsRule & { stampMinOrder?: string },
  spentCents: number,
  lines: { totalCents: number; quantity: number; fixed: number | null; weight?: boolean }[],
): number {
  if (spentCents <= 0) return 0;
  if (rule.mode === 'stamps') return spentCents >= toCents(rule.stampMinOrder ?? '0') ? 1 : 0;
  let fixedPts = 0;
  let fixedCents = 0;
  for (const l of lines) {
    if (l.fixed === null) continue;
    fixedPts += l.fixed * (l.weight ? 1 : l.quantity);
    fixedCents += l.totalCents;
  }
  const rest = Math.max(0, spentCents - fixedCents);
  return fixedPts + Math.floor((rest * toCents(rule.pointsPerReal)) / 10_000);
}

// ---------------------------------------------------------------- cupons

export type CouponKind = 'percent' | 'fixed' | 'free_delivery';

export interface CouponRule {
  kind: CouponKind;
  /** percent: 1 a 100; fixed: reais. */
  value: string | null;
  maxDiscount: string | null;
  minOrder: string;
}

/**
 * Desconto do cupom (centavos) sobre o subtotal dos itens e a taxa de entrega. Entrega grátis
 * devolve a taxa (o pedido sai sem ela). Nunca passa do valor a que se aplica.
 */
export function couponDiscount(c: CouponRule, subtotalCents: number, deliveryFeeCents: number) {
  if (subtotalCents < toCents(c.minOrder)) return 0;
  if (c.kind === 'free_delivery') return Math.max(0, deliveryFeeCents);
  if (c.kind === 'fixed') return Math.min(toCents(c.value ?? '0'), subtotalCents);
  const pct = Number(c.value ?? '0');
  let d = Math.round((subtotalCents * pct) / 100);
  if (c.maxDiscount) d = Math.min(d, toCents(c.maxDiscount));
  return Math.min(d, subtotalCents);
}

/** Frase curta do cupom: "15% de desconto", "R$ 10 de desconto", "Entrega grátis". */
export function couponHeadline(c: Pick<CouponRule, 'kind' | 'value'>): string {
  if (c.kind === 'free_delivery') return 'Entrega grátis';
  if (c.kind === 'percent') return `${Number(c.value ?? 0).toLocaleString('pt-BR')}% de desconto`;
  const v = Number(c.value ?? 0);
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} de desconto`;
}

/** Código do cupom como a loja guarda: maiúsculas, sem espaço. */
export const normalizeCouponCode = (raw: string) =>
  raw.trim().toUpperCase().replace(/\s+/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
