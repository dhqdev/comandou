import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Registry } from 'prom-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Metrics } from '../../health/metrics';
import { ChannelHttpError } from './channel-adapter';
import { ChannelHttp, RateGate } from './channel-http';
import { ChannelMetrics } from './channel-metrics';

/**
 * O tempo limite das chamadas aos aplicativos vale até o fim da leitura do corpo: um aplicativo
 * que manda o cabeçalho e segura o corpo não prende a rodada de polling (auditoria A6).
 */
describe('ChannelHttp: tempo limite', () => {
  let server: Server;
  let base = '';
  const open = new Set<import('node:http').ServerResponse>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      open.add(res);
      res.on('close', () => open.delete(res));
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (req.url === '/stall-ok') {
        // Cabeçalho na hora, corpo que nunca termina.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"ok":');
        return;
      }
      if (req.url === '/stall-error') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.write('{"message":');
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const res of open) res.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const http = (timeoutMs: number) =>
    new ChannelHttp(
      'teste',
      base,
      new ChannelMetrics({ registry: new Registry() } as unknown as Metrics),
      new RateGate(),
      () => fetch,
      timeoutMs,
    );

  it('lê a resposta normal', async () => {
    const r = await http(2000).request<{ ok: boolean }>({
      endpoint: 'ok',
      method: 'GET',
      path: '/ok',
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it('corpo 2xx que não termina não segura a chamada além do tempo limite', async () => {
    const t0 = Date.now();
    const r = await http(300).request({ endpoint: 'stall', method: 'GET', path: '/stall-ok' });
    expect(Date.now() - t0).toBeLessThan(3000);
    // Sem corpo legível: segue como antes (corpo vazio), sem travar.
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
  });

  it('corpo de erro que não termina também respeita o tempo limite', async () => {
    const t0 = Date.now();
    const err = await http(300)
      .request({ endpoint: 'stall', method: 'GET', path: '/stall-error', retries: 0 })
      .catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(err).toBeInstanceOf(ChannelHttpError);
    expect((err as ChannelHttpError).status).toBe(400);
  });
});
