import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatFallbacks, CHAT_FALLBACK_MODEL, CHAT_MODEL } from './ai-models';
import { IMAGE_FALLBACK_TOKENS, imageUsage, OpenRouterClient, servedModel } from './openrouter';

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

describe('OpenRouter: modelo de reserva', () => {
  // IA falsa que guarda o pedido e responde como se a reserva tivesse atendido.
  const bodies: Record<string, unknown>[] = [];
  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(body);
      const served = Array.isArray(body.models) ? String(body.models[1]) : String(body.model);
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ model: served, choices: [{ delta: { content: 'Oi' } }] })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ model: served, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.00001 } })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: served,
          choices: [{ message: { content: 'Oi' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.00001 },
        }),
      );
    });
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

  it('a conversa manda o modelo e a reserva; o uso fica com o que respondeu', async () => {
    const client = new OpenRouterClient(base, 'chave-de-teste');
    const r = await client.stream(CHAT_MODEL, [{ role: 'user', content: 'oi' }], () => undefined, {
      fallbacks: chatFallbacks(CHAT_MODEL),
    });
    expect(bodies.at(-1)!.models).toEqual([CHAT_MODEL, CHAT_FALLBACK_MODEL]);
    expect(r.model).toBe(CHAT_FALLBACK_MODEL);
    expect(r.text).toBe('Oi');
    const c = await client.complete(CHAT_MODEL, [{ role: 'user', content: 'oi' }], {
      fallbacks: chatFallbacks(CHAT_MODEL),
    });
    expect(c.model).toBe(CHAT_FALLBACK_MODEL);
  });

  it('sem reserva, não manda a lista (e a reserva não tem reserva de si mesma)', async () => {
    const client = new OpenRouterClient(base, 'chave-de-teste');
    await client.complete(CHAT_FALLBACK_MODEL, [{ role: 'user', content: 'oi' }], {
      fallbacks: chatFallbacks(CHAT_FALLBACK_MODEL),
    });
    expect(bodies.at(-1)!.models).toBeUndefined();
    expect(bodies.at(-1)!.model).toBe(CHAT_FALLBACK_MODEL);
  });

  it('pedido rápido: sem raciocínio e nos provedores mais rápidos', async () => {
    const client = new OpenRouterClient(base, 'chave-de-teste');
    const r = await client.complete(CHAT_MODEL, [{ role: 'user', content: 'oi' }], {
      reasoning: false,
      fast: true,
    });
    expect(bodies.at(-1)!.reasoning).toEqual({ enabled: false });
    expect(bodies.at(-1)!.provider).toEqual({ sort: 'throughput' });
    expect(r.text).toBe('Oi');
    await client.complete(CHAT_MODEL, [{ role: 'user', content: 'oi' }]);
    expect(bodies.at(-1)!.reasoning).toBeUndefined();
    expect(bodies.at(-1)!.provider).toBeUndefined();
  });

  it('nome do modelo servido: variação do mesmo modelo conta como ele; lixo não entra', () => {
    expect(servedModel('a/b', 'a/b-2026-11-01')).toBe('a/b');
    expect(servedModel('a/b', 'outro/modelo')).toBe('outro/modelo');
    expect(servedModel('a/b', '')).toBe('a/b');
    expect(servedModel('a/b', '<script>')).toBe('a/b');
  });
});

describe('OpenRouter: modelo que só responde pensando', () => {
  // Recusa o pedido com o raciocínio desligado (como um modelo que só pensa) e corta a resposta.
  const bodies: Record<string, unknown>[] = [];
  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(body);
      if (body.reasoning) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Reasoning is mandatory for this endpoint' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ finish_reason: 'length', message: { content: '{"resposta": "Pron' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
      );
    });
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

  it('pede de novo sem o campo e conta que a resposta veio cortada', async () => {
    const client = new OpenRouterClient(base, 'chave-de-teste');
    const r = await client.complete('outro/modelo', [{ role: 'user', content: 'oi' }], {
      reasoning: false,
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.reasoning).toEqual({ enabled: false });
    expect(bodies[1]!.reasoning).toBeUndefined();
    expect(r.finish).toBe('length');
  });
});
