import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IMAGE_FALLBACK_TOKENS, imageUsage, OpenRouterClient } from './openrouter';

describe('OpenRouter: resposta em pedaços', () => {
  // IA que começa a responder e nunca termina.
  const srv = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Começo' } }] })}\n\n`);
  });
  let base = '';
  beforeAll(async () => {
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    srv.closeAllConnections();
    srv.close();
  });

  it('o prazo vale mesmo com o sinal de quem chamou (antes, ficava esperando para sempre)', async () => {
    const client = new OpenRouterClient(base, 'chave-de-teste');
    const deltas: string[] = [];
    const started = Date.now();
    const err = await client
      .stream('modelo', [{ role: 'user', content: 'oi' }], (d) => deltas.push(d), {
        signal: new AbortController().signal,
        timeoutMs: 300,
      })
      .catch((e: Error) => e);
    expect((err as Error).name).toBe('TimeoutError');
    expect(deltas).toEqual(['Começo']);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('OpenRouter: uso das imagens', () => {
  it('com tokens na resposta, vale o que veio', () => {
    expect(
      imageUsage({ prompt_tokens: 0, completion_tokens: 4175, total_tokens: 4175, cost: 0.04 }),
    ).toEqual({ promptTokens: 0, completionTokens: 4175, costUsd: 0.04 });
    expect(imageUsage({ input_tokens: 12, output_tokens: 1290, cost: 0.03 })).toEqual({
      promptTokens: 12,
      completionTokens: 1290,
      costUsd: 0.03,
    });
  });

  it('só com o custo, conta os tokens pelo custo (antes saía de graça)', () => {
    const u = imageUsage({ cost: 0.0123 });
    expect(u.costUsd).toBe(0.0123);
    expect(u.completionTokens).toBe(Math.ceil(0.0123 * (4175 / 0.04)));
    expect(u.completionTokens).toBeGreaterThan(0);
  });

  it('sem uso nenhum, conta como uma imagem', () => {
    expect(imageUsage(undefined)).toEqual({
      promptTokens: 0,
      completionTokens: IMAGE_FALLBACK_TOKENS,
      costUsd: 0,
    });
  });
});
