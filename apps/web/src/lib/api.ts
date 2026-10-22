/**
 * Cliente HTTP da API. A API é servida no MESMO domínio do restaurante sob /api
 * (sem CORS). O cookie de sessão é HttpOnly: o frontend nunca lê nem guarda o token.
 */
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
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
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
        ...(method !== 'GET' && method !== 'HEAD' ? { 'X-Comandou-Request': '1' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const msg = (body as { message?: string } | undefined)?.message ?? `Erro ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export interface Me {
  user: { id: string; name: string; email: string; role: string; roleLabel: string };
  permissions: string[];
  tenant: { id: string; slug: string; name: string };
  /** Sessão aberta pelo suporte da plataforma. */
  support?: { adminName: string } | null;
}

export interface Category {
  id: string;
  name: string;
  position: number;
  active: boolean;
  imageId?: string | null;
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
  /** Dados fiscais da NFC-e; vazio usa o padrão de Ajustes > Nota fiscal. */
  ncm?: string | null;
  cfop?: string | null;
  fiscalCode?: string | null;
  fiscalOrigin?: number | null;
  fiscalUnit?: string | null;
}
