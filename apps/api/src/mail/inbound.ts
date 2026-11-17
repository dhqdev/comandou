import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * O que chega: o Worker da Cloudflare (Email Routing) entrega cada e-mail em
 * POST /api/v1/platform/mail/inbound com o corpo cru (message/rfc822) e uma assinatura. Aqui
 * ficam a conferência da assinatura e as regras do que fazer com a mensagem.
 */

/** Maior e-mail aceito (o mesmo teto do Email Routing da Cloudflare). */
export const INBOUND_MAX_BYTES = 25 * 1024 * 1024;
/** Assinatura mais velha (ou adiantada) que isto é recusada: evita repetir um envio capturado. */
export const INBOUND_MAX_SKEW_MS = 5 * 60_000;

/**
 * HMAC-SHA256 de `v1\n<timestamp>\n<de>\n<para>\n<sha256 do corpo em hex>`. O Worker em
 * infrastructure/cloudflare/email-worker assina exatamente assim.
 */
export function inboundSignature(
  secret: string,
  timestamp: string,
  from: string,
  to: string,
  raw: Buffer,
): string {
  const bodyHash = createHash('sha256').update(raw).digest('hex');
  return createHmac('sha256', secret)
    .update(`v1\n${timestamp}\n${from}\n${to}\n${bodyHash}`)
    .digest('hex');
}

export function verifyInbound(
  secret: string,
  h: { timestamp?: string; from?: string; to?: string; signature?: string },
  raw: Buffer,
  now = Date.now(),
): boolean {
  if (!secret || !h.timestamp || !h.signature || h.from === undefined || !h.to) return false;
  if (!/^\d{9,12}$/.test(h.timestamp) || !/^[0-9a-f]{64}$/.test(h.signature)) return false;
  if (Math.abs(now - Number(h.timestamp) * 1000) > INBOUND_MAX_SKEW_MS) return false;
  const expected = Buffer.from(inboundSignature(secret, h.timestamp, h.from, h.to, raw), 'hex');
  const got = Buffer.from(h.signature, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export type RuleAction = 'archive' | 'spam' | 'trash' | 'star' | 'read' | 'reject';

export interface Rule {
  mailbox_id: string | null;
  field: 'from' | 'to' | 'subject';
  op: 'contains' | 'equals' | 'ends_with';
  value: string;
  action: RuleAction;
}

export interface RuleTarget {
  from: string;
  to: string[];
  subject: string;
}

export function matchRule(r: Rule, m: RuleTarget): boolean {
  const needle = r.value.trim().toLowerCase();
  if (!needle) return false;
  const values = (r.field === 'from' ? [m.from] : r.field === 'to' ? m.to : [m.subject]).map((v) =>
    v.toLowerCase(),
  );
  return values.some((v) =>
    r.op === 'equals'
      ? v === needle
      : r.op === 'ends_with'
        ? v.endsWith(needle)
        : v.includes(needle),
  );
}

/** A primeira regra ligada (da caixa ou geral) que combinar. */
export function firstMatch<R extends Rule>(rules: R[], mailboxId: string, m: RuleTarget): R | null {
  return (
    rules.find((r) => (!r.mailbox_id || r.mailbox_id === mailboxId) && matchRule(r, m)) ?? null
  );
}

/**
 * Responder sozinho só a gente de verdade: nunca a listas, robôs, avisos de devolução ou a outra
 * resposta automática (dois sistemas respondendo um ao outro não param mais).
 */
export function shouldAutoReply(headers: Map<string, string>, from: string): boolean {
  const local = from.slice(0, from.lastIndexOf('@')).toLowerCase();
  if (!from.includes('@') || !local) return false;
  if (
    /^(no-?reply|nao-?responda|do-?not-?reply|mailer-daemon|postmaster|bounce|bounces)\b/.test(
      local,
    )
  )
    return false;
  const auto = (headers.get('auto-submitted') ?? '').toLowerCase();
  if (auto && auto !== 'no') return false;
  const precedence = (headers.get('precedence') ?? '').toLowerCase();
  if (/bulk|junk|list|auto_reply/.test(precedence)) return false;
  for (const h of ['list-id', 'list-unsubscribe', 'x-auto-response-suppress', 'x-autoreply'])
    if (headers.has(h)) return false;
  return true;
}

/** "spf=pass ... dkim=fail ... dmarc=pass" do cabeçalho Authentication-Results. */
export function authSummary(authResults: string): { spf: string; dkim: string; dmarc: string } {
  const pick = (k: string) =>
    new RegExp(`\\b${k}=([a-z]+)`, 'i').exec(authResults)?.[1]?.toLowerCase() ?? '';
  return { spf: pick('spf'), dkim: pick('dkim'), dmarc: pick('dmarc') };
}
