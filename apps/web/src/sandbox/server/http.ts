/**
 * O "servidor" do exemplo do site (comandou.com/experimente): responde as chamadas da API dentro
 * do próprio navegador, com os dados de exemplo da Fumaça Burger. Nada sai para a rede, nada é
 * gravado de verdade e recarregar a página volta tudo ao começo.
 */

export interface SandboxReq {
  method: string;
  /** Caminho depois de /api/v1, sem a busca (ex.: /orders/123/status). */
  path: string;
  query: URLSearchParams;
  /** Corpo em JSON já lido (ou o FormData/Blob como veio). */
  body: unknown;
  params: Record<string, string>;
}

/** Resposta com situação própria (erro, 204). Sem isto, o que a rota devolve vira 200 em JSON. */
export class Reply {
  constructor(
    public status: number,
    public body: unknown = null,
  ) {}
}

/** Erro de negócio com a mesma cara da API (o app mostra a mensagem). */
export const fail = (status: number, message: string) =>
  new Reply(status, { statusCode: status, message });

/** O que o exemplo não faz: o app mostra a frase no aviso de sempre. */
export const notHere = () =>
  fail(403, 'No exemplo do site isto fica de fora. No teste grátis funciona de verdade.');

type Handler = (req: SandboxReq) => unknown;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

/** Registra uma rota: `:id` vira parâmetro; o método pode ser '*'. */
export function on(method: string, pattern: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z]+)/g, (_m, k: string) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '/?$',
  );
  routes.push({ method: method.toUpperCase(), re, keys, handler });
}

/** Chamadas que o exemplo não conhece (o teste do site confere que as telas não esbarram nelas). */
export const unknownCalls: string[] = [];

export async function serve(
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  for (const r of routes) {
    if (r.method !== '*' && r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
    try {
      const out = await r.handler({ method, path, query, body, params });
      if (out instanceof Reply) return { status: out.status, body: out.body };
      return { status: 200, body: out ?? {} };
    } catch (e) {
      console.error('[exemplo]', method, path, e);
      return { status: 500, body: { statusCode: 500, message: 'Algo deu errado no exemplo' } };
    }
  }
  unknownCalls.push(`${method} ${path}`);
  if (method === 'GET')
    return { status: 404, body: { statusCode: 404, message: 'Disponível no teste grátis' } };
  return { status: 403, body: notHere().body };
}

async function readBody(init: RequestInit | undefined, req: Request | null): Promise<unknown> {
  const raw = init?.body ?? (req && req.method !== 'GET' ? await req.clone().text() : null);
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Troca o fetch da página: o que vai para /api é respondido aqui, o resto segue normal. */
export function installServer() {
  // O teste do site lê daqui as chamadas que nenhuma rota atendeu.
  (window as Window & { __cmSandbox?: { unknown: string[] } }).__cmSandbox = {
    unknown: unknownCalls,
  };
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.href,
    );
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/'))
      return real(input, init);
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '') || '/';
    const body = await readBody(init, req);
    // Um respiro de rede, para as telas mostrarem o carregamento como no sistema.
    await new Promise((r) => setTimeout(r, method === 'GET' ? 40 : 120));
    const res = await serve(method, path, url.searchParams, body);
    if (res.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
