import { Logger } from '@nestjs/common';

/**
 * Cliente HTTP da Merchant API do iFood (autenticação, merchant e catálogo v2).
 *
 * O que vale saber (documentação do iFood + testes de quem já homologou):
 * - Token: POST /authentication/v1.0/oauth/token (form-urlencoded, campos em camelCase:
 *   grantType, clientId, clientSecret…) → { accessToken, expiresIn (≈ 6 h), refreshToken? }.
 *   Pedir token a cada chamada é antipadrão: guardamos em memória e renovamos 5 min antes.
 * - 401 = token vencido (renova uma vez e repete); 403 = a loja revogou o acesso do app.
 * - Dinheiro vai em reais decimais (12.9), não em centavos.
 * - PUT /items é assíncrono: editar o mesmo item logo depois dá 400 "concurrently modified";
 *   repetimos com espera.
 * - Erros 5xx/rede: até 3 tentativas com espera exponencial; 4xx nunca se repete.
 */
export interface IfoodCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export class IfoodError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
  /** Ids que o iFood devolve num 409 (ex.: item que já existe com o mesmo código). */
  get conflictingIds(): string[] {
    const b = this.body as { conflictingResources?: unknown } | undefined;
    const list = Array.isArray(b?.conflictingResources) ? b.conflictingResources : [];
    return list
      .map((x) =>
        typeof x === 'string'
          ? x
          : ((x as { id?: string; resourceId?: string })?.id ??
            (x as { resourceId?: string })?.resourceId),
      )
      .filter((x): x is string => typeof x === 'string');
  }
}

export interface IfoodToken {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

export type Fetcher = typeof fetch;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mensagem legível de um erro do iFood ({ code, message, details }). */
export function ifoodMessage(status: number, body: unknown): string {
  const b = body as { message?: string; error?: { message?: string }; details?: unknown } | null;
  const msg = b?.message ?? b?.error?.message;
  if (status === 401) return 'O iFood recusou as credenciais do aplicativo';
  if (status === 403) return 'A loja do iFood não autorizou o Comandou (ou revogou o acesso)';
  if (status === 404) return msg ? `iFood: ${msg}` : 'Não encontrado no iFood';
  if (status === 429)
    return 'O iFood pediu para esperar (muitas chamadas). Tente de novo em instantes';
  return msg ? `iFood: ${String(msg).slice(0, 200)}` : `iFood respondeu ${status}`;
}

export class IfoodClient {
  private readonly logger = new Logger('iFood');

  constructor(
    private readonly creds: IfoodCredentials,
    private readonly getToken: () => Promise<string>,
    private readonly onUnauthorized: () => void,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  /** Uma chamada à API com token, repetição em 5xx/rede e renovação em 401. */
  async request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const token = await this.getToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    let res: Response;
    try {
      res = await this.fetcher(`${this.creds.baseUrl}${path}`, {
        method,
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      clearTimeout(timer);
      if (attempt < 2) {
        await sleep(1000 * 2 ** attempt);
        return this.request<T>(method, path, body, attempt + 1);
      }
      throw new IfoodError(503, `Sem resposta do iFood (${(e as Error).message})`);
    }
    clearTimeout(timer);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (res.ok) return data as T;
    if (res.status === 401 && attempt === 0) {
      this.onUnauthorized();
      return this.request<T>(method, path, body, attempt + 1);
    }
    const retryable =
      res.status >= 500 ||
      res.status === 429 ||
      (res.status === 400 && /concurrently modified/i.test(text));
    if (retryable && attempt < 3) {
      await sleep(1500 * 2 ** attempt);
      return this.request<T>(method, path, body, attempt + 1);
    }
    this.logger.warn(
      `${method} ${path.replace(/merchants\/[^/]+/, 'merchants/…')} → ${res.status}`,
    );
    throw new IfoodError(res.status, ifoodMessage(res.status, data), data);
  }

  // ---- merchant ----
  merchants() {
    return this.request<{ id: string; name: string; corporateName?: string }[]>(
      'GET',
      '/merchant/v1.0/merchants',
    );
  }
  merchant(merchantId: string) {
    return this.request<{ id: string; name: string; corporateName?: string }>(
      'GET',
      `/merchant/v1.0/merchants/${encodeURIComponent(merchantId)}`,
    );
  }

  // ---- catálogo v2 ----
  private m(merchantId: string) {
    return `/catalog/v2.0/merchants/${encodeURIComponent(merchantId)}`;
  }
  catalogs(merchantId: string) {
    return this.request<{ catalogId: string; context?: string[]; status?: string }[]>(
      'GET',
      `${this.m(merchantId)}/catalogs`,
    );
  }
  categories(merchantId: string, catalogId: string) {
    return this.request<
      { id: string; name: string; externalCode?: string; status?: string; index?: number }[]
    >('GET', `${this.m(merchantId)}/catalogs/${catalogId}/categories?includeItems=false`);
  }
  createCategory(
    merchantId: string,
    catalogId: string,
    body: { name: string; externalCode: string; status: string; index: number },
  ) {
    return this.request<{ id: string }>(
      'POST',
      `${this.m(merchantId)}/catalogs/${catalogId}/categories`,
      { ...body, template: 'DEFAULT' },
    );
  }
  updateCategory(
    merchantId: string,
    catalogId: string,
    categoryId: string,
    body: { name?: string; status?: string; index?: number },
  ) {
    return this.request<unknown>(
      'PATCH',
      `${this.m(merchantId)}/catalogs/${catalogId}/categories/${categoryId}`,
      body,
    );
  }
  /** Itens de uma categoria no formato normalizado (itens, produtos, grupos e opções). */
  categoryItems(merchantId: string, categoryId: string) {
    return this.request<unknown>(
      'GET',
      `${this.m(merchantId)}/categories/${encodeURIComponent(categoryId)}/items`,
    );
  }
  /** Cria ou atualiza o item inteiro: item + produtos + grupos + opções. */
  putItem(merchantId: string, payload: unknown) {
    return this.request<unknown>('PUT', `${this.m(merchantId)}/items`, payload);
  }
  itemPrice(merchantId: string, itemId: string, value: number) {
    return this.request<unknown>('PATCH', `${this.m(merchantId)}/items/price`, {
      itemId,
      price: { value },
    });
  }
  itemStatus(merchantId: string, itemId: string, status: 'AVAILABLE' | 'UNAVAILABLE') {
    return this.request<unknown>('PATCH', `${this.m(merchantId)}/items/status`, {
      itemId,
      status,
    });
  }
  /** Sobe uma foto (data URI JPG/PNG) e devolve o imagePath para usar no produto. */
  uploadImage(merchantId: string, dataUri: string) {
    return this.request<{ imagePath?: string; path?: string }>(
      'POST',
      `${this.m(merchantId)}/image/upload`,
      { image: dataUri },
    );
  }
}

// ---- autenticação ----

async function tokenRequest(
  creds: IfoodCredentials,
  form: Record<string, string>,
  fetcher: Fetcher,
): Promise<IfoodToken> {
  const res = await fetcher(`${creds.baseUrl}/authentication/v1.0/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      ...form,
    }).toString(),
  });
  const text = await res.text();
  let data: { accessToken?: string; expiresIn?: number; refreshToken?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok || !data?.accessToken)
    throw new IfoodError(res.status || 502, ifoodMessage(res.status, data), data);
  return {
    accessToken: data.accessToken,
    expiresAt: Date.now() + (Number(data.expiresIn) || 21600) * 1000,
    ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
  };
}

export const ifoodAuth = {
  clientCredentials: (c: IfoodCredentials, f: Fetcher = fetch) =>
    tokenRequest(c, { grantType: 'client_credentials' }, f),
  authorizationCode: (c: IfoodCredentials, code: string, verifier: string, f: Fetcher = fetch) =>
    tokenRequest(
      c,
      {
        grantType: 'authorization_code',
        authorizationCode: code,
        authorizationCodeVerifier: verifier,
      },
      f,
    ),
  refresh: (c: IfoodCredentials, refreshToken: string, f: Fetcher = fetch) =>
    tokenRequest(c, { grantType: 'refresh_token', refreshToken }, f),
  /** Modo distribuído: código que o lojista digita no Portal do Parceiro (vale ~10 min). */
  async userCode(c: IfoodCredentials, f: Fetcher = fetch) {
    const res = await f(`${c.baseUrl}/authentication/v1.0/oauth/userCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ clientId: c.clientId }).toString(),
    });
    const data = (await res.json().catch(() => null)) as {
      userCode?: string;
      authorizationCodeVerifier?: string;
      verificationUrl?: string;
      verificationUrlComplete?: string;
      expiresIn?: number;
    } | null;
    if (!res.ok || !data?.userCode || !data.authorizationCodeVerifier)
      throw new IfoodError(res.status || 502, ifoodMessage(res.status, data), data);
    return {
      userCode: data.userCode,
      verifier: data.authorizationCodeVerifier,
      verificationUrl:
        data.verificationUrlComplete ??
        data.verificationUrl ??
        'https://portal.ifood.com.br/apps/code',
      expiresIn: Number(data.expiresIn) || 600,
    };
  },
};
