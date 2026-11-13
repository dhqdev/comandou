/**
 * Pixel do cardápio online (como o pixel da Meta, mas do Comandou): conta o que o cliente faz no
 * cardápio para os relatórios do restaurante (Relatórios › Cardápio online). Os eventos vão em
 * lotes para POST /store/pixel; ao sair da página o que falta vai com `keepalive`.
 *
 * Sem dado pessoal: a sessão (some depois de 30 min parado ou ao fechar a aba) e o visitante (o
 * navegador) são ids aleatórios. A primeira coisa de cada sessão é a visita, com o aparelho e de
 * onde o cliente veio (utm_* do link ou o site que mandou para cá).
 */

export type PixelEventType =
  | 'visit'
  | 'view_item'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'view_cart'
  | 'begin_checkout'
  | 'purchase'
  | 'search'
  | 'click_category'
  | 'click_banner'
  | 'favorite';

export interface PixelData {
  productId?: string;
  targetId?: string;
  /** Valor em reais (item na sacola, total do pedido). */
  value?: number;
  quantity?: number;
  term?: string;
}

interface PixelEvent extends PixelData {
  type: PixelEventType;
}

const SESSION_KEY = 'cm-px-session';
const VISITOR_KEY = 'cm-px-visitor';
/** Parado mais que isso (app instalado aberto de um dia para o outro): começa outra visita. */
export const SESSION_IDLE_MS = 30 * 60_000;
const FLUSH_MS = 1500;
const MAX_BATCH = 40;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Página fora de HTTPS (sem randomUUID): monta um v4 com getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function visitorId() {
  try {
    const v = localStorage.getItem(VISITOR_KEY);
    if (v && UUID_RE.test(v)) return v;
    const id = uuid();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return (memVisitor ??= uuid());
  }
}
let memVisitor: string | null = null;
let memSession: { id: string; at: number } | null = null;

/** Sessão desta aba; `fresh` quando acabou de começar (manda a visita). */
export function session(now = Date.now()): { id: string; fresh: boolean } {
  let s = memSession;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const st = raw ? (JSON.parse(raw) as { id?: string; at?: number }) : null;
    if (st && typeof st.id === 'string' && UUID_RE.test(st.id) && typeof st.at === 'number')
      s = { id: st.id, at: st.at };
  } catch {
    /* modo privado: fica na memória */
  }
  const fresh = !s || now - s.at > SESSION_IDLE_MS;
  const next = { id: fresh ? uuid() : s!.id, at: now };
  memSession = next;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    /* modo privado */
  }
  return { id: next.id, fresh };
}

/** De onde o cliente veio: utm_source do link ou o site que mandou para cá (null = direto). */
export function sourceOf(search: string, referrer: string, host: string) {
  const qs = new URLSearchParams(search);
  const clip = (v: string | null, n: number) => v?.trim().toLowerCase().slice(0, n) || undefined;
  const utm = clip(qs.get('utm_source'), 60);
  let source = utm;
  if (!source && referrer) {
    try {
      const h = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
      if (h && h !== host.replace(/^www\./, '').toLowerCase()) {
        source = /(^|\.)(instagram\.com|l\.instagram\.com)$/.test(h)
          ? 'instagram'
          : /(^|\.)(facebook\.com|fb\.com|fb\.me|m\.facebook\.com)$/.test(h)
            ? 'facebook'
            : /(^|\.)(whatsapp\.com|wa\.me)$/.test(h)
              ? 'whatsapp'
              : /(^|\.)google\./.test(h)
                ? 'google'
                : /(^|\.)(tiktok\.com)$/.test(h)
                  ? 'tiktok'
                  : h.slice(0, 60);
      }
    } catch {
      /* referrer estranho: direto */
    }
  }
  return {
    source,
    medium: clip(qs.get('utm_medium'), 60),
    campaign: clip(qs.get('utm_campaign'), 80),
  };
}

const deviceOf = (w: number): 'phone' | 'tablet' | 'desktop' =>
  w < 700 ? 'phone' : w < 1100 ? 'tablet' : 'desktop';

/** Contexto da visita: lido uma vez, quando o cardápio abre (o endereço ainda tem os utm_*). */
let ctx: {
  device: 'phone' | 'tablet' | 'desktop';
  source?: string;
  medium?: string;
  campaign?: string;
  table?: boolean;
} | null = null;

let queue: PixelEvent[] = [];
let timer: number | undefined;
let started = false;
let last = { key: '', at: 0 };
const REPEAT_ONCE = new Set<PixelEventType>(['view_item', 'view_cart', 'begin_checkout']);

function clean(type: PixelEventType, d: PixelData = {}): PixelEvent {
  const e: PixelEvent = { type };
  if (d.productId && UUID_RE.test(d.productId)) e.productId = d.productId;
  if (d.targetId && UUID_RE.test(d.targetId)) e.targetId = d.targetId;
  if (typeof d.value === 'number' && Number.isFinite(d.value) && d.value >= 0)
    e.value = Math.min(1_000_000, Math.round(d.value * 100) / 100);
  if (typeof d.quantity === 'number' && Number.isFinite(d.quantity) && d.quantity >= 0)
    e.quantity = Math.min(10_000, Math.round(d.quantity * 1000) / 1000);
  const term = d.term?.trim().toLowerCase().slice(0, 60);
  if (term) e.term = term;
  return e;
}

function send(events: PixelEvent[], sid: string) {
  try {
    void fetch('/api/v1/store/pixel', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Comandou-Request': '1' },
      body: JSON.stringify({ sid, vid: visitorId(), ctx: ctx ?? undefined, events }),
    }).catch(() => undefined);
  } catch {
    /* sem rede: o pixel nunca atrapalha o pedido */
  }
}

/** Manda o que está na fila (agora). */
export function flushPixel() {
  window.clearTimeout(timer);
  timer = undefined;
  if (!queue.length) return;
  const sid = memSession?.id ?? session().id;
  while (queue.length) send(queue.splice(0, MAX_BATCH), sid);
}

/** Conta um evento do cardápio. Nunca lança erro. */
export function track(type: PixelEventType, data?: PixelData) {
  if (!started || typeof window === 'undefined') return;
  try {
    const prev = memSession?.id;
    const s = session();
    // Sessão nova (abriu agora ou voltou depois de muito tempo parado): visita primeiro.
    if (s.fresh || s.id !== prev) {
      if (queue.length && prev) {
        const old = queue.splice(0);
        send(old, prev);
      }
      if (type !== 'visit') queue.push({ type: 'visit' });
    }
    if (type === 'visit' && !s.fresh && s.id === prev) return;
    const e = clean(type, data);
    // A mesma tela contada duas vezes seguidas num instante (efeito repetido): conta uma.
    const key = `${e.type}:${e.productId ?? ''}`;
    const t = Date.now();
    if (REPEAT_ONCE.has(e.type) && key === last.key && t - last.at < 1000) return;
    last = { key, at: t };
    queue.push(e);
    if (queue.length >= MAX_BATCH) flushPixel();
    else if (timer === undefined) timer = window.setTimeout(flushPixel, FLUSH_MS);
  } catch {
    /* o pixel nunca atrapalha o cardápio */
  }
}

/**
 * Liga o pixel quando o cardápio abre (uma vez por página) e conta a visita se a sessão é nova.
 * Na mesa do QR Code a visita fica marcada como "mesa".
 */
export function startPixel(opts: { table: boolean }) {
  if (typeof window === 'undefined') return;
  ctx = {
    device: deviceOf(window.innerWidth),
    ...sourceOf(window.location.search, document.referrer, window.location.hostname),
    table: opts.table || undefined,
  };
  if (!started) {
    started = true;
    const bye = () => document.visibilityState === 'hidden' && flushPixel();
    document.addEventListener('visibilitychange', bye);
    window.addEventListener('pagehide', flushPixel);
  }
  // Sessão já aberta nesta aba (recarregou a página): não conta outra visita.
  let open = false;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const st = raw ? (JSON.parse(raw) as { at?: number }) : null;
    open = !!st && typeof st.at === 'number' && Date.now() - st.at <= SESSION_IDLE_MS;
  } catch {
    open = false;
  }
  if (open) {
    session();
    return;
  }
  memSession = null;
  track('visit');
}

/** Só para os testes. */
export function resetPixelForTests() {
  queue = [];
  window.clearTimeout(timer);
  timer = undefined;
  started = false;
  last = { key: '', at: 0 };
  ctx = null;
  memSession = null;
  memVisitor = null;
}
