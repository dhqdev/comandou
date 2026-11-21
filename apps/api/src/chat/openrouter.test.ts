import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenRouterClient } from './openrouter';

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
