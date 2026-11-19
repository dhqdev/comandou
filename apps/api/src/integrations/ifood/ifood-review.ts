import type { ChannelReview, ChannelReviewSummary } from '../channels/channel-adapter';

/**
 * Tradução da Review API v2 do iFood (avaliações dos clientes). Do cliente só fica o primeiro
 * nome; a resposta da loja é escrita por uma pessoa (10 a 300 letras) e só cabe em avaliação
 * NOT_REPLIED.
 */
export const IFOOD_REVIEW_PATHS = {
  list: (m: string) => `/review/v2.0/merchants/${encodeURIComponent(m)}/reviews`,
  summary: (m: string) => `/review/v2.0/merchants/${encodeURIComponent(m)}/summary`,
  answer: (m: string, id: string) =>
    `/review/v2.0/merchants/${encodeURIComponent(m)}/reviews/${encodeURIComponent(id)}/answers`,
} as const;

/** Até 50 por página (acima disso o iFood devolve 400) e no máximo 10 páginas por leitura. */
export const IFOOD_REVIEW_PAGE_SIZE = 50;
export const IFOOD_REVIEW_MAX_PAGES = 10;
export const REVIEW_REPLY_MIN = 10;
export const REVIEW_REPLY_MAX = 300;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 100) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Só o primeiro nome ("Maria S." → "Maria"). */
export function firstName(v: unknown) {
  const s = str(v, 200);
  const first = s?.split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, '');
  return first ? first.slice(0, 40) : undefined;
}

function iso(v: unknown) {
  const s = str(v, 40);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : undefined;
}

/** Uma avaliação; sem id ou sem nota fica de fora. */
export function ifoodReview(raw: unknown): ChannelReview | null {
  const r = obj(raw);
  const externalId = str(r.id);
  const score = num(r.score);
  const createdAt = iso(r.createdAt);
  if (!externalId || score === undefined || score < 0 || score > 5 || !createdAt) return null;
  const order = obj(r.order);
  const status = str(r.status, 40)?.toUpperCase();
  // Resposta da loja: a última que veio do lado do restaurante.
  const mine = arr(r.replies)
    .map(obj)
    .filter((x) => !x.from || /MERCHANT/i.test(String(x.from)))
    .map((x) => ({ text: str(x.text, 300), at: iso(x.createdAt) }))
    .filter((x): x is { text: string; at: string | undefined } => !!x.text)
    .at(-1);
  return {
    externalId,
    score: Math.round(score * 10) / 10,
    comment: str(r.comment, 2000),
    customerName: firstName(r.customerName ?? obj(r.customer).name),
    status,
    createdAt,
    orderExternalId: str(order.id ?? r.orderId),
    orderCode: str(order.shortId ?? order.displayId, 40),
    reply: mine ? { text: mine.text, at: mine.at ?? createdAt } : undefined,
    canReply: status === 'NOT_REPLIED' && !mine,
  };
}

export function ifoodReviewPage(body: unknown): { reviews: ChannelReview[]; pageCount: number } {
  const b = obj(body);
  const reviews = arr(b.reviews)
    .map(ifoodReview)
    .filter((r): r is ChannelReview => !!r);
  const pageCount = num(b.pageCount);
  return { reviews, pageCount: pageCount && pageCount > 0 ? Math.floor(pageCount) : 1 };
}

export function ifoodReviewSummary(body: unknown): ChannelReviewSummary | null {
  const b = obj(body);
  const score = num(b.score ?? b.averageScore);
  const count = num(b.validReviewsCount ?? b.totalReviewsCount ?? b.total);
  if (score === undefined) return null;
  return {
    score: Math.min(5, Math.max(0, Math.round(score * 100) / 100)),
    count: count === undefined ? undefined : Math.max(0, Math.floor(count)),
  };
}
