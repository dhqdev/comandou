import { useSyncExternalStore } from 'react';
import { newIdempotencyKey } from './idempotency';
import { offlineStore } from './offline-store';

/**
 * Modo offline do painel, do garçom, da cozinha e do entregador.
 *
 * Leitura: cada resposta GET da API fica guardada no aparelho. Sem internet, a mesma leitura
 * devolve a última resposta guardada, então as telas abrem mesmo depois de fechar ou recarregar.
 *
 * Gravação: o que a pessoa salva sem internet vai para uma fila no aparelho (IndexedDB) e sobe
 * para a nuvem, na ordem, quando a conexão volta. Cada item leva a chave `X-Comandou-Op`: se a
 * rede cair depois do servidor gravar, o reenvio devolve a mesma resposta em vez de duplicar.
 *
 * O que precisa do servidor na hora (pagamento, caixa, nota fiscal, WhatsApp, login, fotos,
 * impressão, painel da plataforma) não entra na fila: mostra que precisa de internet.
 *
 * Só liga com um funcionário logado (enableOffline): o cardápio do cliente e os links públicos
 * continuam falando direto com o servidor.
 */

/** Cabeçalho que o servidor usa para não repetir uma gravação reenviada pela fila. */
export const OP_HEADER = 'X-Comandou-Op';

export interface QueuedOp {
  /** Chave na fila: ordena pela hora em que foi salva. */
  id: string;
  /** Chave única do envio (cabeçalho X-Comandou-Op). */
  opKey: string;
  userId: string;
  host: string;
  method: string;
  path: string;
  json?: unknown;
  headers: Record<string, string>;
  label: string;
  createdAt: number;
  attempts: number;
  status: 'pending' | 'failed';
  error?: string;
  /** Recusada sem enviar: depende do registro provisório (offline-…) que não subiu. */
  blockedBy?: string;
}

interface CacheEntry {
  at: number;
  body: unknown;
}

export interface OfflineSnapshot {
  enabled: boolean;
  /** Tem rede e o servidor responde. */
  online: boolean;
  /** Rede ligada (Wi-Fi/dados), mas o servidor não responde. */
  serverDown: boolean;
  /** Alterações do usuário atual ainda no aparelho. */
  pending: QueuedOp[];
  /** Recusadas pelo servidor ao sincronizar: precisam de revisão. */
  failed: QueuedOp[];
  syncing: boolean;
  /** Alguma tela está mostrando dados guardados (sem internet). */
  fromCache: boolean;
  /** Hora dos dados guardados mais antigos que estão na tela. */
  cachedAt: number | null;
  lastSyncAt: number | null;
}

// ---------------------------------------------------------------------------------------------
// O que pode ser feito sem internet.

/** Gravações que só fazem sentido com o servidor respondendo na hora. */
const NEEDS_SERVER: { re: RegExp; why: string }[] = [
  { re: /^\/(auth|platform|support|suporte)(\/|$)/, why: 'Entrar e sair precisam de internet.' },
  { re: /^\/subscription(\/|$)/, why: 'A assinatura precisa de internet.' },
  { re: /\/(payments|refunds)(\/|$|\?)/, why: 'Pagamentos precisam de internet.' },
  { re: /\/pix-receipts(\/|$|\?)/, why: 'Conferir o Pix precisa de internet.' },
  { re: /^\/(cash|cash-registers)(\/|$)/, why: 'O caixa precisa de internet.' },
  { re: /^\/tabs\/[^/]+\/(close|pay)/, why: 'Fechar a conta precisa de internet.' },
  {
    re: /^\/(deliveries\/collections|courier-pay)(\/|$)/,
    why: 'Acertos de dinheiro precisam de internet.',
  },
  { re: /^\/fiscal(\/|$)|\/(nfce|nfe)(\/|$|\?)/, why: 'A nota fiscal precisa de internet.' },
  { re: /^\/deliveries\/[^/]+\/(settle|location|tracking-link)/, why: 'Isto precisa de internet.' },
  { re: /^\/(messaging|whatsapp)(\/|$)/, why: 'O WhatsApp precisa de internet.' },
  { re: /^\/(ai-agent|chat\/ai|help\/chat)(\/|$)/, why: 'O assistente precisa de internet.' },
  { re: /^\/ifood(\/|$)/, why: 'O iFood precisa de internet.' },
  { re: /^\/(media|chat\/media)(\/|$)/, why: 'Enviar fotos e arquivos precisa de internet.' },
  { re: /^\/printing(\/|$)|\/print(\/|$|\?)/, why: 'Imprimir precisa de internet.' },
  {
    re: /\/(test|sync|connect|authorize|confirm|send|token)(\/|$|\?)/,
    why: 'Isto precisa de internet.',
  },
  {
    re: /^\/store\/(account|orders|chat|loyalty|delivery-quote)(\/|$)/,
    why: 'Isto precisa de internet.',
  },
];

/** null = pode ir para a fila; senão, o motivo para mostrar à pessoa. */
export function needsInternet(method: string, path: string, body?: unknown): string | null {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return null;
  if (body !== undefined && typeof body !== 'string')
    return 'Enviar fotos e arquivos precisa de internet.';
  for (const r of NEEDS_SERVER) if (r.re.test(path)) return r.why;
  return null;
}

/** Leituras que não ficam guardadas no aparelho. */
function cacheable(path: string): boolean {
  return !/^\/(auth|platform|support|media)(\/|$)/.test(path);
}

// ---------------------------------------------------------------------------------------------
// Estado (para a faixa de aviso e para os testes).

let enabledUser: string | null = null;
let syncing = false;
let fromCache = false;
let cachedAt: number | null = null;
let serverDown = false;
let lastSyncAt: number | null = null;
let ops: QueuedOp[] = [];
const listeners = new Set<() => void>();
let snapshot: OfflineSnapshot = build();

function host() {
  return typeof window === 'undefined' ? '' : window.location.host;
}

export function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/** Tem rede e o servidor respondeu da última vez. */
export function reachable(): boolean {
  return browserOnline() && !serverDown;
}

function mine(o: QueuedOp) {
  return o.userId === enabledUser && o.host === host();
}

function build(): OfflineSnapshot {
  const own = ops.filter(mine);
  return {
    enabled: enabledUser !== null,
    online: reachable(),
    serverDown: browserOnline() && serverDown,
    pending: own.filter((o) => o.status === 'pending'),
    failed: own.filter((o) => o.status === 'failed'),
    syncing,
    fromCache,
    cachedAt: fromCache ? cachedAt : null,
    lastSyncAt,
  };
}

function notify() {
  snapshot = build();
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function offlineSnapshot(): OfflineSnapshot {
  return snapshot;
}

export function useOffline(): OfflineSnapshot {
  return useSyncExternalStore(subscribe, offlineSnapshot, offlineSnapshot);
}

/** Avisos para a tela (toast) e para quem quer recarregar depois de sincronizar. */
export const OFFLINE_QUEUED_EVENT = 'cm:offline-queued';
export const OFFLINE_SYNCED_EVENT = 'cm:offline-synced';

async function reloadOps() {
  ops = await offlineStore().all<QueuedOp>('outbox');
  notify();
}

// ---------------------------------------------------------------------------------------------
// Servidor alcançável. `navigator.onLine` só diz se há Wi-Fi ou dados: com a rede ligada e o
// servidor fora (internet do roteador caiu, servidor reiniciando), cada clique esperaria a
// requisição falhar. Depois de uma falha, as telas usam direto o que está no aparelho e um
// pedido leve (/health/live) confere a cada poucos segundos se o servidor voltou.

const PING_EVERY = 5_000;
let pingTimer: ReturnType<typeof setInterval> | null = null;

/** Falha de rede ou servidor fora (502/503/504) com o modo offline ligado. */
export function markServerDown(): void {
  if (!enabledUser || serverDown) return;
  serverDown = true;
  notify();
  if (typeof window !== 'undefined' && !pingTimer)
    pingTimer = setInterval(() => void ping(), PING_EVERY);
}

/** O servidor respondeu: volta ao normal e envia a fila. */
export function markServerUp(): void {
  if (!serverDown) return;
  serverDown = false;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  notify();
  void flushOutbox();
}

export async function ping(): Promise<boolean> {
  if (!browserOnline()) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch('/api/v1/health/live', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    if (res.status < 502) {
      markServerUp();
      return true;
    }
  } catch {
    /* continua fora */
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Outras abas do mesmo aparelho: quando uma envia ou guarda algo, as outras releem a fila.

let channel: BroadcastChannel | null = null;

function tellOtherTabs() {
  try {
    channel?.postMessage('outbox');
  } catch {
    /* aba fechando */
  }
}

/**
 * Pede ao navegador para não apagar o banco do aparelho quando faltar espaço (sem isso, a fila
 * pode sumir antes de subir). Só quando há algo na fila: no Firefox isso pergunta à pessoa.
 */
let askedPersist = false;
async function keepStorage() {
  if (askedPersist || typeof navigator === 'undefined') return;
  askedPersist = true;
  try {
    const st = navigator.storage;
    if (st?.persist && !(await st.persisted?.())) await st.persist();
  } catch {
    /* sem suporte: segue como antes */
  }
}

// ---------------------------------------------------------------------------------------------
// Liga/desliga (login e logout).

let timer: ReturnType<typeof setInterval> | null = null;
const onOnline = () => {
  notify();
  if (serverDown) void ping();
  else void flushOutbox();
};
const onOffline = () => notify();
const onVisible = () => {
  if (document.visibilityState === 'visible') void flushOutbox();
};

/** Chamado com o funcionário logado. Carrega a fila guardada e tenta enviar. */
export async function enableOffline(userId: string): Promise<void> {
  const first = enabledUser === null;
  enabledUser = userId;
  if (first && typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    // Rede "ligada" mas servidor fora (ou o evento online não veio): tenta de tempos em tempos.
    timer = setInterval(() => {
      if (snapshot.pending.length) void flushOutbox();
    }, 20_000);
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('comandou-outbox');
      channel.onmessage = () => void reloadOps();
    }
  }
  await reloadOps();
  if (ops.some(mine)) void keepStorage();
  await loadIdMap();
  void pruneCache();
  void flushOutbox();
}

/**
 * Logout: apaga os dados guardados no aparelho. A fila NÃO é apagada (é trabalho que ainda não
 * subiu); ela é do usuário que a fez e só é enviada quando ele entrar de novo.
 */
export async function disableOffline(): Promise<void> {
  enabledUser = null;
  fromCache = false;
  cachedAt = null;
  serverDown = false;
  if (timer) clearInterval(timer);
  timer = null;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  channel?.close();
  channel = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
  }
  await offlineStore().clear('cache');
  notify();
}

export function offlineEnabled(): boolean {
  return enabledUser !== null;
}

// ---------------------------------------------------------------------------------------------
// Leituras guardadas.

const CACHE_MAX_AGE = 14 * 24 * 3600_000;
const ME_KEY = 'me';

function cacheKey(path: string) {
  return `${host()}|${enabledUser}|${path}`;
}

export async function saveRead(path: string, body: unknown): Promise<void> {
  if (!enabledUser || !cacheable(path)) return;
  if (fromCache) {
    fromCache = false;
    cachedAt = null;
    notify();
  }
  await offlineStore()
    .put<CacheEntry>('cache', cacheKey(path), { at: Date.now(), body })
    .catch(() => undefined);
}

export async function cachedRead<T>(path: string): Promise<{ body: T } | null> {
  if (!enabledUser || !cacheable(path)) return null;
  const hit = await offlineStore()
    .get<CacheEntry>('cache', cacheKey(path))
    .catch(() => undefined);
  if (!hit) return null;
  if (!fromCache || cachedAt === null || hit.at < cachedAt) {
    fromCache = true;
    cachedAt = cachedAt === null ? hit.at : Math.min(cachedAt, hit.at);
    notify();
  }
  return { body: hit.body as T };
}

/** Sessão guardada: o app abre sem internet direto nas telas, sem pedir login. */
export async function saveMe(me: unknown): Promise<void> {
  await offlineStore()
    .put<CacheEntry>('cache', `${host()}|${ME_KEY}`, { at: Date.now(), body: me })
    .catch(() => undefined);
}

export async function cachedMe<T>(): Promise<T | null> {
  const hit = await offlineStore()
    .get<CacheEntry>('cache', `${host()}|${ME_KEY}`)
    .catch(() => undefined);
  return (hit?.body as T | undefined) ?? null;
}

export async function forgetMe(): Promise<void> {
  await offlineStore()
    .delete('cache', `${host()}|${ME_KEY}`)
    .catch(() => undefined);
}

/** Apaga leituras velhas (e as de consultas com data, que não se repetem). */
async function pruneCache() {
  const store = offlineStore();
  try {
    for (const key of await store.keys('cache')) {
      const e = await store.get<CacheEntry>('cache', key);
      if (e && Date.now() - e.at > CACHE_MAX_AGE) await store.delete('cache', key);
    }
  } catch {
    /* sem armazenamento: nada a limpar */
  }
}

// ---------------------------------------------------------------------------------------------
// Fila de gravações.

let seq = 0;

/** Nome curto do que foi salvo, para a lista de pendências. */
export function describeOp(method: string, path: string): string {
  const base = path.split('?')[0]!.split('/').filter(Boolean);
  const what: Record<string, string> = {
    orders: 'Pedido',
    tabs: 'Comanda',
    tables: 'Mesa',
    customers: 'Cliente',
    products: 'Item do cardápio',
    categories: 'Categoria',
    menus: 'Cardápio',
    'option-groups': 'Complementos',
    stock: 'Estoque',
    users: 'Equipe',
    reservations: 'Reserva',
    finance: 'Financeiro',
    deliveries: 'Entrega',
    kitchen: 'Cozinha',
    store: 'Loja online',
    loyalty: 'Fidelidade',
    chat: 'Chat da equipe',
    salon: 'Salão',
    sectors: 'Setor',
  };
  const name = what[base[0] ?? ''] ?? 'Alteração';
  const verb =
    method === 'DELETE' ? 'removido' : method === 'POST' && base.length === 1 ? 'novo' : 'alterado';
  return `${name} (${verb})`;
}

/** Resposta provisória de uma gravação que ficou na fila. */
export function offlineResult(op: QueuedOp): Record<string, unknown> {
  const body = op.json && typeof op.json === 'object' && !Array.isArray(op.json) ? op.json : {};
  return { ...(body as object), id: tempId(op), offline: true };
}

export function isOfflineResult(x: unknown): boolean {
  return !!x && typeof x === 'object' && (x as { offline?: unknown }).offline === true;
}

function tempId(op: QueuedOp) {
  return `offline-${op.opKey}`;
}

// ---------------------------------------------------------------------------------------------
// Registros criados sem internet (id provisório offline-…).

const TEMP_RE = /offline-[A-Za-z0-9_.:-]{8,100}/g;

/** Id provisório → id que o servidor deu (guardado: a tela aberta no id provisório continua). */
const idMap = new Map<string, string>();
const idMapKey = (tmp: string) => `${host()}|idmap|${tmp}`;

async function loadIdMap() {
  const store = offlineStore();
  try {
    const prefix = `${host()}|idmap|`;
    for (const key of await store.keys('cache')) {
      if (!key.startsWith(prefix)) continue;
      const e = await store.get<CacheEntry>('cache', key);
      if (typeof e?.body === 'string') idMap.set(key.slice(prefix.length), e.body);
    }
  } catch {
    /* sem armazenamento */
  }
}

async function rememberId(tmp: string, real: string) {
  idMap.set(tmp, real);
  await offlineStore()
    .put<CacheEntry>('cache', idMapKey(tmp), { at: Date.now(), body: real })
    .catch(() => undefined);
}

/** Troca ids provisórios que já subiram pelo id de verdade. */
export function resolveTempIds(text: string): string {
  if (!text.includes('offline-')) return text;
  return text.replace(TEMP_RE, (tmp) => idMap.get(tmp) ?? tmp);
}

/** O caminho fala de um registro que ainda não subiu (só existe neste aparelho). */
export function hasUnsyncedId(text: string): boolean {
  return text.includes('offline-') && [...text.matchAll(TEMP_RE)].some((m) => !idMap.has(m[0]));
}

/**
 * Leitura de um registro que só existe na fila: o próprio registro sai do que foi salvo (com as
 * alterações seguintes por cima); listas dentro dele ainda estão vazias no servidor.
 */
export function pendingRead(path: string): { body: unknown } | null {
  const clean = path.split('?')[0]!;
  const m = clean.match(TEMP_RE);
  if (!m) return null;
  const create = ops.find((o) => mine(o) && tempId(o) === m[0]);
  if (!create) return null;
  const parts = clean.split('/').filter(Boolean);
  if (parts.length !== 2 || parts[1] !== m[0]) return { body: [] };
  let body = offlineResult(create);
  for (const o of ops)
    if (mine(o) && o.path.split('?')[0] === clean && (o.method === 'PATCH' || o.method === 'PUT'))
      body = { ...body, ...(o.json && typeof o.json === 'object' ? o.json : {}) };
  return { body };
}

export async function enqueue(
  method: string,
  path: string,
  json: unknown,
  headers: Record<string, string>,
  opKey: string,
): Promise<QueuedOp> {
  const now = Date.now();
  const op: QueuedOp = {
    id: `${String(now).padStart(15, '0')}-${String(seq++).padStart(6, '0')}`,
    opKey,
    userId: enabledUser!,
    host: host(),
    method,
    path,
    json,
    headers: { ...headers, [OP_HEADER]: opKey },
    label: describeOp(method, path),
    createdAt: now,
    attempts: 0,
    status: 'pending',
  };
  await offlineStore().put('outbox', op.id, op);
  ops = [...ops, op];
  notify();
  tellOtherTabs();
  void keepStorage();
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(OFFLINE_QUEUED_EVENT, { detail: op }));
  return op;
}

export function newOpKey(): string {
  return newIdempotencyKey();
}

export async function discardOp(id: string): Promise<void> {
  await offlineStore().delete('outbox', id);
  ops = ops.filter((o) => o.id !== id);
  notify();
  tellOtherTabs();
}

/** Tenta de novo a recusada e as que ficaram presas esperando por ela. */
export async function retryOp(id: string): Promise<void> {
  const op = ops.find((o) => o.id === id);
  if (!op) return;
  const again = new Set([id]);
  for (const o of ops) if (o.status === 'failed' && o.blockedBy === tempId(op)) again.add(o.id);
  for (const o of ops) {
    if (!again.has(o.id)) continue;
    const next: QueuedOp = { ...o, status: 'pending', error: undefined, blockedBy: undefined };
    await offlineStore().put('outbox', o.id, next);
    ops = ops.map((x) => (x.id === o.id ? next : x));
  }
  notify();
  tellOtherTabs();
  void flushOutbox();
}

/** Primeiro id provisório no envio que ainda não virou id do servidor. */
function unresolvedTemp(op: QueuedOp): string | null {
  const text = `${op.path} ${op.json === undefined ? '' : JSON.stringify(op.json)}`;
  if (!text.includes('offline-')) return null;
  for (const m of text.matchAll(TEMP_RE)) if (!idMap.has(m[0])) return m[0];
  return null;
}

/**
 * Ajusta um envio da fila com o que os anteriores criaram:
 *  - troca o id provisório (offline-…) pelo id que o servidor deu;
 *  - mudanças seguidas no mesmo registro (iniciar e depois marcar pronto, sem internet) levavam a
 *    versão de antes da primeira; passam a levar a versão que a anterior deixou.
 */
export function remap(
  op: QueuedOp,
  ids: Map<string, string>,
  versions: Map<string, number> = new Map(),
): QueuedOp {
  let path = op.path;
  let json = op.json === undefined ? undefined : JSON.stringify(op.json);
  for (const [tmp, real] of ids) {
    path = path.split(tmp).join(real);
    if (json) json = json.split(tmp).join(real);
  }
  let body = json === undefined ? undefined : (JSON.parse(json) as unknown);
  const target = path.split('?')[0]!.split('/')[2];
  const b = body as { expectedVersion?: unknown } | undefined;
  if (target && b && typeof b === 'object' && typeof b.expectedVersion === 'number') {
    const v = versions.get(target);
    if (v !== undefined && v > b.expectedVersion) body = { ...b, expectedVersion: v };
  }
  return { ...op, path, json: body };
}

export type Sender = (op: QueuedOp) => Promise<{ status: number; body: unknown }>;

let sender: Sender = async (op) => {
  const res = await fetch(`/api/v1${op.path}`, {
    method: op.method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(op.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-Comandou-Request': '1',
      ...op.headers,
    },
    body: op.json !== undefined ? JSON.stringify(op.json) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
};

/** Testes: troca o envio. */
export function setSender(s: Sender) {
  sender = s;
}

let flushing: Promise<void> | null = null;

/** Envia a fila do usuário atual, na ordem. Para no primeiro erro de rede. */
export function flushOutbox(): Promise<void> {
  if (!enabledUser || !browserOnline()) return Promise.resolve();
  flushing ??= withLock(runFlush).finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Duas abas abertas não podem enviar a mesma fila ao mesmo tempo. */
async function withLock(fn: () => Promise<void>) {
  const locks = (typeof navigator !== 'undefined' ? navigator.locks : undefined) as
    LockManager | undefined;
  if (!locks?.request) return fn();
  await locks.request('comandou-outbox', { ifAvailable: true }, async (lock) => {
    if (lock) await fn();
  });
}

async function runFlush() {
  // Outra aba pode ter enviado parte da fila: relê do aparelho antes.
  await reloadOps();
  const queue = ops.filter((o) => mine(o) && o.status === 'pending');
  if (!queue.length) return;
  syncing = true;
  notify();
  const versions = new Map<string, number>();
  let sent = 0;
  try {
    for (const original of queue) {
      const op = remap(original, idMap, versions);
      // Fala de um registro criado sem internet que foi recusado (ou descartado): o servidor não
      // o conhece, então nem envia; fica para revisão junto com ele.
      const orphan = unresolvedTemp(op);
      if (orphan) {
        const creator = ops.find((o) => mine(o) && tempId(o) === orphan);
        if (!creator || creator.status === 'failed') {
          const blocked: QueuedOp = {
            ...original,
            status: 'failed',
            blockedBy: orphan,
            error: creator
              ? `Depende de "${creator.label}", que foi recusado. Resolva aquele primeiro.`
              : 'Depende de um registro que não chegou ao servidor (descartado).',
          };
          await offlineStore().put('outbox', original.id, blocked);
          ops = ops.map((o) => (o.id === original.id ? blocked : o));
          notify();
          continue;
        }
      }
      let res: { status: number; body: unknown };
      try {
        res = await sender(op);
      } catch {
        markServerDown();
        break; // sem rede: tenta de novo quando voltar
      }
      if (res.status < 502) markServerUp();
      if (res.status >= 200 && res.status < 300) {
        const out = res.body as { id?: unknown; version?: unknown } | undefined;
        if (typeof out?.id === 'string') {
          await rememberId(tempId(original), out.id);
          if (typeof out.version === 'number') versions.set(out.id, out.version);
        }
        await offlineStore().delete('outbox', original.id);
        ops = ops.filter((o) => o.id !== original.id);
        sent++;
        notify();
        continue;
      }
      // Sessão vencida, servidor fora ou ocupado: mantém e tenta depois (na mesma ordem).
      if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) {
        if (res.status >= 502) markServerDown();
        break;
      }
      // Recusada (dado inválido, item apagado por outra pessoa…): separa para revisão.
      const reason =
        (res.body as { message?: string } | undefined)?.message ?? `Erro ${res.status}`;
      // 409: alguém mudou o mesmo registro antes (outro aparelho, com internet).
      const msg = res.status === 409 ? `Conflito: ${reason}` : reason;
      const failed: QueuedOp = {
        ...original,
        status: 'failed',
        attempts: original.attempts + 1,
        error: msg,
      };
      await offlineStore().put('outbox', original.id, failed);
      ops = ops.map((o) => (o.id === original.id ? failed : o));
      notify();
    }
  } finally {
    syncing = false;
    if (sent) lastSyncAt = Date.now();
    notify();
    tellOtherTabs();
    if (sent && typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent(OFFLINE_SYNCED_EVENT, { detail: { sent } }));
  }
}

/** Testes: volta ao estado inicial. */
export function resetOfflineForTests() {
  enabledUser = null;
  syncing = false;
  fromCache = false;
  cachedAt = null;
  serverDown = false;
  askedPersist = false;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  channel?.close();
  channel = null;
  lastSyncAt = null;
  ops = [];
  idMap.clear();
  flushing = null;
  if (timer) clearInterval(timer);
  timer = null;
  notify();
}
