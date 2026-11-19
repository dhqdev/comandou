import { ChannelHttpError } from './channel-adapter';
import { ChannelMetrics } from './channel-metrics';

/**
 * Assinatura por chamada (Keeta: X-App-Signature). Recebe a URL sem a query, os parâmetros e o corpo
 * exatamente como vão; devolve os cabeçalhos a acrescentar.
 */
export type ChannelSigner = (r: {
  url: string;
  params: Record<string, string>;
  body: string | undefined;
}) => Record<string, string>;

/** Corpo JSON como vai pela rede (com assinatura, o canônico; sem, o JSON.stringify). */
export type JsonEncoder = (v: unknown) => string;

export type Fetcher = typeof fetch;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Janela de chamadas por endpoint, com folga: usa no máximo 80% do limite do canal. Se a janela
 * encheu, espera a vaga (o canal nunca vê a rajada). Vale por processo; com várias réplicas, o
 * polling já é de uma réplica só por credencial (trava no banco central).
 */
export class RateGate {
  private readonly hits = new Map<string, number[]>();

  /** Milissegundos até poder chamar (0 = pode agora; a chamada já fica contada). */
  take(key: string, perMinute: number, now = Date.now()): number {
    const limit = Math.max(1, Math.floor(perMinute * 0.8));
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (list.length < limit) {
      list.push(now);
      this.hits.set(key, list);
      return 0;
    }
    this.hits.set(key, list);
    return 60_000 - (now - list[0]!) + 5;
  }
}

export interface ChannelRequest {
  /** Nome fixo do endpoint para métricas e limite (ex.: 'events:polling'), nunca com ids. */
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Caminho a partir da base configurada do canal (nunca uma URL vinda de fora). */
  path: string;
  token?: string;
  json?: unknown;
  form?: Record<string, string>;
  headers?: Record<string, string>;
  /** Limite do canal para este endpoint (chamadas por minuto). */
  perMinute?: number;
  /** Repetições em rede/429/5xx (padrão 3). Ack e ações mandam 0 aqui e repetem pela fila. */
  retries?: number;
}

export interface ChannelResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * Chamadas HTTP aos aplicativos: só para a base configurada do canal, com tempo limite, repetição
 * com espera crescente em rede/429/5xx (respeitando o Retry-After), nunca em 4xx, e métrica por
 * endpoint. Nada do corpo vai para log.
 */
export class ChannelHttp {
  private readonly base: string;

  constructor(
    private readonly channel: string,
    baseUrl: string,
    private readonly metrics: ChannelMetrics,
    private readonly gate: RateGate,
    private readonly fetcher: () => Fetcher,
    private readonly timeoutMs = 10_000,
    private readonly signer?: ChannelSigner,
    private readonly encode: JsonEncoder = JSON.stringify,
  ) {
    this.base = baseUrl.replace(/\/$/, '');
  }

  async request<T = unknown>(r: ChannelRequest): Promise<ChannelResponse<T>> {
    if (!r.path.startsWith('/') || r.path.includes('://'))
      throw new Error('caminho inválido para o canal');
    const retries = r.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      if (r.perMinute) {
        const wait = this.gate.take(`${this.channel}:${r.endpoint}`, r.perMinute);
        if (wait > 0) await sleep(Math.min(wait, 60_000));
      }
      let status = 0;
      let retryAfter = 0;
      let res: Response | undefined;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const headers: Record<string, string> = { Accept: 'application/json', ...r.headers };
        if (r.token) headers.Authorization = `Bearer ${r.token}`;
        let body: string | undefined;
        if (r.form) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
          body = new URLSearchParams(r.form).toString();
        } else if (r.json !== undefined) {
          headers['Content-Type'] = 'application/json';
          body = this.encode(r.json);
        }
        if (this.signer) {
          const u = new URL(`${this.base}${r.path}`);
          const params: Record<string, string> = {};
          u.searchParams.forEach((v, k) => (params[k] = v));
          Object.assign(
            headers,
            this.signer({
              url: `${u.origin}${u.pathname}`,
              params,
              body: r.form ? undefined : body,
            }),
          );
        }
        res = await this.fetcher()(`${this.base}${r.path}`, {
          method: r.method,
          headers,
          body,
          signal: ctrl.signal,
          redirect: 'error',
        });
        status = res.status;
        retryAfter = Number(res.headers.get('retry-after')) || 0;
      } catch {
        status = 0;
      } finally {
        clearTimeout(timer);
      }
      const result = ChannelMetrics.resultOf(status);
      this.metrics.requests.inc({ channel: this.channel, endpoint: r.endpoint, result });
      this.metrics.record(this.channel, 'request', `${r.endpoint}|${result}`);
      if (res && status >= 200 && status < 300) {
        const text = await res.text().catch(() => '');
        let body: unknown = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        return { status, body: body as T, headers: res.headers };
      }
      const err = new ChannelHttpError(status, await messageOf(this.channel, status, res));
      if (!err.retryable || attempt >= retries) throw err;
      // Espera crescente com um pouco de sorteio; o Retry-After do canal manda (até 30 s).
      const backoff = Math.min(30_000, 500 * 2 ** attempt + Math.floor(Math.random() * 250));
      await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : backoff);
    }
  }
}

/** Mensagem curta do erro, para a tela (nada de dado pessoal: só a mensagem do canal). */
async function messageOf(channel: string, status: number, res?: Response): Promise<string> {
  if (status === 0) return 'Sem resposta do aplicativo (rede ou tempo esgotado)';
  let msg = '';
  try {
    const b = (await res!.json()) as {
      message?: unknown;
      title?: unknown;
      error?: { message?: unknown };
    };
    // problem+json (Open Delivery, Keeta) traz o motivo em `title`.
    const m = b?.message ?? b?.error?.message ?? b?.title;
    if (typeof m === 'string') msg = m.slice(0, 160);
  } catch {
    /* corpo sem JSON */
  }
  if (status === 401) return 'O aplicativo recusou a credencial';
  if (status === 403) return 'A loja não autorizou o Comandou (ou revogou o acesso)';
  if (status === 429) return 'O aplicativo pediu para esperar (muitas chamadas)';
  return msg ? `${channel}: ${msg}` : `O aplicativo respondeu ${status}`;
}
