import {
  browserOnline,
  cachedRead,
  enqueue,
  hasUnsyncedId,
  needsInternet,
  newOpKey,
  offlineEnabled,
  offlineResult,
  OP_HEADER,
  pendingRead,
  resolveTempIds,
  saveRead,
} from './offline';

/**
 * Cliente HTTP da API. A API é servida no MESMO domínio do restaurante sob /api
 * (sem CORS). O cookie de sessão é HttpOnly: o frontend nunca lê nem guarda o token.
 */
export const TENANT_SUSPENDED_EVENT = 'cm:tenant-suspended';

/** Resposta da API para restaurante suspenso pelo painel da plataforma. */
export const isSuspended = (body: unknown) =>
  (body as { code?: string } | undefined)?.code === 'tenant_suspended';

/** Restaurante que foi para outro servidor: o endereço novo vem na resposta (410). */
export const TENANT_MOVED_EVENT = 'cm:tenant-moved';
export const movedTo = (body: unknown): string | null => {
  const b = body as { code?: string; movedTo?: string | null } | undefined;
  return b?.code === 'tenant_moved' ? (b.movedTo ?? '') : null;
};

/** Leva para o mesmo caminho no endereço novo (só se for outro endereço, para não dar volta). */
export function followMove(url: string): boolean {
  try {
    const to = new URL(url);
    if (!/^https?:$/.test(to.protocol) || to.host === window.location.host) return false;
    const { pathname, search, hash } = window.location;
    window.location.replace(`${to.origin}${pathname}${search}${hash}`);
    return true;
  } catch {
    return false;
  }
}

/** Gravação recusada porque o restaurante está bloqueado pela cobrança. */
export const BILLING_BLOCKED_EVENT = 'cm:billing-blocked';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(
  rawPath: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json: rawJson, headers, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const reading = method === 'GET' || method === 'HEAD';
  // Modo offline (lib/offline.ts): leitura guardada sem internet; gravação vai para a fila.
  const offline = offlineEnabled();
  // Registro criado sem internet que já subiu: usa o id de verdade.
  const path = offline ? resolveTempIds(rawPath) : rawPath;
  const json =
    offline && rawJson !== undefined && JSON.stringify(rawJson).includes('offline-')
      ? (JSON.parse(resolveTempIds(JSON.stringify(rawJson))) as unknown)
      : rawJson;
  const queueable =
    offline &&
    !reading &&
    needsInternet(method, path, json === undefined ? rest.body : undefined) === null;
  const opKey = queueable ? (headerOf(headers, OP_HEADER) ?? newOpKey()) : undefined;

  const whenOffline = async (): Promise<T> => {
    if (offline && reading) {
      const hit = await cachedRead<T>(path);
      if (hit) return hit.body;
    }
    if (queueable) {
      const op = await enqueue(method, path, json, plainHeaders(headers ?? {}), opKey!);
      return offlineResult(op) as T;
    }
    const why =
      offline && !reading
        ? needsInternet(method, path, json === undefined ? rest.body : undefined)
        : null;
    throw new ApiError(0, why ? `Sem conexão. ${why}` : 'Sem conexão com o servidor');
  };

  // Registro que só existe neste aparelho: o servidor ainda não o conhece.
  if (offline && hasUnsyncedId(path)) {
    if (reading) {
      const local = pendingRead(path);
      if (local) return local.body as T;
    } else if (queueable) return whenOffline();
  }

  // Sem rede nenhuma: nem tenta (o fetch demoraria a falhar).
  if (offline && !browserOnline()) return whenOffline();

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      credentials: 'same-origin',
      ...rest,
      method,
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        // Exigido pela API em métodos que alteram estado (proteção CSRF).
        ...(!reading ? { 'X-Comandou-Request': '1' } : {}),
        // Se a resposta se perder e a gravação for para a fila, o reenvio não duplica.
        ...(opKey ? { [OP_HEADER]: opKey } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    return whenOffline();
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    // Servidor fora do ar (gateway) também conta como sem conexão para a fila.
    if (offline && (res.status === 502 || res.status === 503 || res.status === 504))
      return whenOffline();
    const msg = (body as { message?: string } | undefined)?.message ?? `Erro ${res.status}`;
    // Restaurante suspenso no meio do uso: o app troca para a tela de aviso.
    if (isSuspended(body)) window.dispatchEvent(new Event(TENANT_SUSPENDED_EVENT));
    // Mudou de servidor: o site antigo leva cada página para o mesmo lugar no endereço novo.
    const moved = movedTo(body);
    if (moved !== null && !followMove(moved))
      window.dispatchEvent(new CustomEvent(TENANT_MOVED_EVENT, { detail: moved }));
    if ((body as { code?: string } | undefined)?.code === 'billing_blocked')
      window.dispatchEvent(new Event(BILLING_BLOCKED_EVENT));
    throw new ApiError(res.status, msg, body);
  }
  if (offline && method === 'GET') void saveRead(path, body);
  return body as T;
}

function headerOf(h: HeadersInit | undefined, name: string): string | undefined {
  if (!h) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(plainHeaders(h))) if (k.toLowerCase() === lower) return v;
  return undefined;
}

function plainHeaders(h: HeadersInit): Record<string, string> {
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

export interface Me {
  user: { id: string; name: string; email: string; role: string; roleLabel: string };
  permissions: string[];
  tenant: { id: string; slug: string; name: string };
  /** Sessão aberta pelo suporte da plataforma. */
  support?: { adminName: string; adminHost?: string } | null;
}

export interface Category {
  id: string;
  name: string;
  position: number;
  active: boolean;
  imageId?: string | null;
  /** Emoji da categoria (aparece quando não há foto). */
  icon?: string | null;
  /** Cozinha (KDS) dos itens da categoria. */
  sectorId?: string | null;
}

/** Quanto dá para vender de um item com o estoque de hoje, pela ficha técnica (GET /stock/availability). */
export interface ProductAvailability {
  productId: string;
  /** Algum insumo não dá para mais uma unidade: o item não vende. */
  out: boolean;
  /** Unidades que ainda dá para vender; null = sem limite (por peso ou negativo liberado). */
  portions: number | null;
  missing: string[];
  lines: {
    stockItemId: string;
    name: string;
    unit: string;
    need: string;
    have: string;
    short: boolean;
  }[];
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: string;
  active: boolean;
  soldOut: boolean;
  sectorId: string | null;
  imageId?: string | null;
  /** Destaque e selo no cardápio online. */
  featured?: boolean;
  badge?: string | null;
  /** Dados fiscais da NFC-e; vazio usa o padrão de Ajustes > Nota fiscal. */
  ncm?: string | null;
  cfop?: string | null;
  fiscalCode?: string | null;
  fiscalOrigin?: number | null;
  fiscalUnit?: string | null;
  /** Padrão fiscal próprio do item (senão o do NCM ou o padrão da empresa) e CEST. */
  fiscalRuleId?: string | null;
  cest?: string | null;
  /** Código interno (IT-000001), família, custo informado e código de barras. */
  code?: string | null;
  familyId?: string | null;
  cost?: string | null;
  soldByWeight?: boolean;
  /** Tara em kg ("0.020"). */
  weightTare?: string;
  barcode?: string | null;
  barcodeType?: 'fixed' | 'weight' | 'value';
  position?: number;
}
