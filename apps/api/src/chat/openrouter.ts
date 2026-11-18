/**
 * Cliente mínimo do OpenRouter (API compatível com a da OpenAI): conversa em streaming, saldo
 * da conta e lista de modelos. A chave vem do painel Super Admin (cifrada no banco).
 */
export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Pedaço de uma mensagem com anexo: texto, imagem (data URL) ou arquivo PDF (data URL). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  /** Custo em US$ informado pelo OpenRouter (0 se não vier). */
  costUsd: number;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

const num = (v: unknown) =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

function friendly(status: number, body: string): string {
  if (status === 401) return 'A chave do OpenRouter foi recusada';
  if (status === 402) return 'Sem saldo no OpenRouter';
  if (status === 429) return 'O OpenRouter pediu para esperar um pouco (muitas chamadas)';
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    if (j.error?.message) return `OpenRouter: ${j.error.message}`;
  } catch {
    /* corpo não é JSON */
  }
  return `OpenRouter respondeu ${status}`;
}

export class OpenRouterClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly referer = 'https://comandou.com',
  ) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': this.referer,
      'X-Title': 'Comandou',
    };
  }

  /**
   * Conversa em streaming: chama onDelta a cada pedaço de texto e devolve o uso no fim
   * (o OpenRouter manda o uso no último pedaço quando pedimos usage.include).
   */
  async stream(
    model: string,
    messages: ChatTurn[],
    onDelta: (text: string) => void,
    opts: { maxTokens?: number; signal?: AbortSignal } = {},
  ): Promise<{ text: string; usage: Usage }> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: opts.maxTokens ?? 900,
        temperature: 0.4,
        usage: { include: true },
      }),
      signal: opts.signal ?? AbortSignal.timeout(90_000),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new OpenRouterError(friendly(res.status, body), res.status);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let text = '';
    const usage: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        // Linhas que começam com ":" são só "estou vivo" do OpenRouter.
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j: {
          choices?: { delta?: { content?: string } }[];
          usage?: Record<string, unknown>;
          error?: { message?: string };
        };
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) throw new OpenRouterError(`OpenRouter: ${j.error.message ?? 'erro'}`);
        const d = j.choices?.[0]?.delta?.content;
        if (d) {
          text += d;
          onDelta(d);
        }
        if (j.usage) {
          usage.promptTokens = num(j.usage.prompt_tokens) ?? usage.promptTokens;
          usage.completionTokens = num(j.usage.completion_tokens) ?? usage.completionTokens;
          usage.costUsd = num(j.usage.cost) ?? usage.costUsd;
        }
      }
    }
    return { text, usage };
  }

  /**
   * Uma resposta só (sem streaming), com imagem ou PDF junto da pergunta. Usado para ler o
   * cardápio de uma foto ou de um PDF e devolver os itens em JSON.
   */
  async complete(
    model: string,
    messages: { role: ChatTurn['role']; content: string | ContentPart[] }[],
    opts: {
      maxTokens?: number;
      json?: boolean;
      signal?: AbortSignal;
      /** Pesquisa na internet antes de responder (plugin "web" do OpenRouter): quantos resultados. */
      web?: number;
    } = {},
  ): Promise<{ text: string; usage: Usage; citations: string[] }> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 4000,
        temperature: 0.1,
        usage: { include: true },
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        ...(opts.web ? { plugins: [{ id: 'web', max_results: opts.web }] } : {}),
      }),
      signal: opts.signal ?? AbortSignal.timeout(120_000),
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) throw new OpenRouterError(friendly(res.status, body), res.status);
    let j: {
      choices?: {
        message?: {
          content?: string | null;
          annotations?: { type?: string; url_citation?: { url?: string } }[];
        };
      }[];
      usage?: Record<string, unknown>;
      error?: { message?: string };
    };
    try {
      j = JSON.parse(body);
    } catch {
      throw new OpenRouterError('O OpenRouter devolveu uma resposta que não deu para ler');
    }
    if (j.error) throw new OpenRouterError(`OpenRouter: ${j.error.message ?? 'erro'}`);
    // Páginas que a pesquisa na internet usou (só com o plugin "web").
    const citations = (j.choices?.[0]?.message?.annotations ?? [])
      .map((a) => (a.type === 'url_citation' ? a.url_citation?.url : undefined))
      .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
    return {
      citations: [...new Set(citations)].slice(0, 20),
      text: j.choices?.[0]?.message?.content ?? '',
      usage: {
        promptTokens: num(j.usage?.prompt_tokens) ?? 0,
        completionTokens: num(j.usage?.completion_tokens) ?? 0,
        costUsd: num(j.usage?.cost) ?? 0,
      },
    };
  }

  /**
   * Gera uma imagem (modelos com saída de imagem, ex.: google/gemini-2.5-flash-image). Devolve o
   * primeiro arquivo da resposta (data URL em base64) já como bytes.
   */
  async image(
    model: string,
    prompt: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<{ mime: string; bytes: Buffer; usage: Usage }> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
        usage: { include: true },
      }),
      signal: opts.signal ?? AbortSignal.timeout(90_000),
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) throw new OpenRouterError(friendly(res.status, body), res.status);
    let j: {
      choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
      usage?: Record<string, unknown>;
      error?: { message?: string };
    };
    try {
      j = JSON.parse(body);
    } catch {
      throw new OpenRouterError('O OpenRouter devolveu uma resposta que não deu para ler');
    }
    if (j.error) throw new OpenRouterError(`OpenRouter: ${j.error.message ?? 'erro'}`);
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? '';
    const m = url.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (!m) throw new OpenRouterError('A IA não devolveu a imagem');
    return {
      mime: m[1]!,
      bytes: Buffer.from(m[2]!, 'base64'),
      usage: {
        promptTokens: num(j.usage?.prompt_tokens) ?? 0,
        completionTokens: num(j.usage?.completion_tokens) ?? 0,
        costUsd: num(j.usage?.cost) ?? 0,
      },
    };
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      throw new OpenRouterError(friendly(res.status, await res.text().catch(() => '')), res.status);
    return ((await res.json()) as { data?: Record<string, unknown> }).data ?? {};
  }

  /**
   * Créditos da conta inteira (comprados e gastos). O OpenRouter só responde com uma chave de
   * gerenciamento (Settings › Management Keys); a chave comum recebe 403.
   */
  async credits() {
    const c = await this.get('/credits');
    const totalUsd = num(c.total_credits);
    const usedUsd = num(c.total_usage);
    return {
      totalUsd,
      usedUsd,
      remainingUsd: totalUsd != null && usedUsd != null ? totalUsd - usedUsd : null,
    };
  }

  /**
   * Gasto e limite desta chave (/key, funciona com a chave comum). Dia e mês do OpenRouter
   * contam em UTC. Os créditos da conta (/credits) só vêm se esta chave for de gerenciamento.
   */
  async account() {
    const [credits, key] = await Promise.allSettled([this.credits(), this.get('/key')]);
    const out = {
      totalUsd: null as number | null,
      usedUsd: null as number | null,
      remainingUsd: null as number | null,
      keyLabel: null as string | null,
      keyLimitUsd: null as number | null,
      keyDayUsd: null as number | null,
      keyMonthUsd: null as number | null,
      keyTotalUsd: null as number | null,
      error: null as string | null,
    };
    if (credits.status === 'fulfilled') Object.assign(out, credits.value);
    if (key.status === 'fulfilled') {
      const k = key.value;
      out.keyLabel = typeof k.label === 'string' ? k.label : null;
      out.keyLimitUsd = num(k.limit);
      out.keyDayUsd = num(k.usage_daily);
      out.keyMonthUsd = num(k.usage_monthly);
      out.keyTotalUsd = num(k.usage);
      // Sem créditos da conta: o que sobra no limite da chave (ou no orçamento que vale para ela).
      const budget = k.effective_budget as Record<string, unknown> | null | undefined;
      if (out.remainingUsd == null)
        out.remainingUsd = num(k.limit_remaining) ?? num(budget?.remaining_usd);
    }
    if (credits.status === 'rejected' && key.status === 'rejected')
      out.error = (key.reason as Error).message || 'Não consegui consultar o OpenRouter';
    return out;
  }
}

export interface ModelInfo {
  id: string;
  name: string;
  /** US$ por 1 milhão de tokens. */
  promptPerM: number;
  completionPerM: number;
  context: number | null;
}

/** Modelos de texto do OpenRouter, do mais barato para o mais caro (sem chave). */
export async function listModels(baseUrl: string): Promise<ModelInfo[]> {
  const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new OpenRouterError(`OpenRouter respondeu ${res.status}`, res.status);
  const j = (await res.json()) as {
    data?: {
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
      architecture?: { output_modalities?: string[] };
    }[];
  };
  return (j.data ?? [])
    .filter(
      (m) =>
        !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'),
    )
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      promptPerM: (num(m.pricing?.prompt) ?? 0) * 1e6,
      completionPerM: (num(m.pricing?.completion) ?? 0) * 1e6,
      context: m.context_length ?? null,
    }))
    .filter((m) => m.promptPerM >= 0 && m.completionPerM >= 0)
    .sort((a, b) => a.promptPerM + a.completionPerM * 3 - (b.promptPerM + b.completionPerM * 3));
}
