import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import { describe, expect, it } from 'vitest';
import { httpLogOptions, maskSecretsInUrl } from './log-redact';

describe('maskSecretsInUrl', () => {
  it('esconde o token do rastreio público', () => {
    expect(maskSecretsInUrl('/api/v1/track/abcDEF123_-x?x=1')).toBe('/api/v1/track/[oculto]?x=1');
  });
  it('esconde o token na URL do provider do Traefik', () => {
    expect(maskSecretsInUrl('/api/v1/internal/traefik?token=abc123&x=1')).toBe(
      '/api/v1/internal/traefik?token=[oculto]&x=1',
    );
  });
  it('esconde o link do entregador (API e manifesto do atalho)', () => {
    expect(maskSecretsInUrl('/api/v1/courier-app/abcDEF123_-x/earnings')).toBe(
      '/api/v1/courier-app/[oculto]/earnings',
    );
    expect(maskSecretsInUrl('/api/v1/store/manifest?start=%2Fentregador%2FabcDEF123_-x')).toBe(
      '/api/v1/store/manifest?start=%2Fentregador%2F[oculto]',
    );
  });
  it('não mexe nas outras rotas', () => {
    expect(maskSecretsInUrl('/api/v1/orders/123')).toBe('/api/v1/orders/123');
    expect(maskSecretsInUrl('/api/v1/store/orders/tok_ABC-123/pix-receipt')).toBe(
      '/api/v1/store/orders/[oculto]/pix-receipt',
    );
    expect(maskSecretsInUrl('/api/v1/store/reservations/tok123/cancel')).toBe(
      '/api/v1/store/reservations/[oculto]/cancel',
    );
    expect(maskSecretsInUrl('/api/v1/platform/sign/tok123')).toBe('/api/v1/platform/sign/[oculto]');
    expect(maskSecretsInUrl('/api/v1/public/site/trials/tok123')).toBe(
      '/api/v1/public/site/trials/[oculto]',
    );
    expect(maskSecretsInUrl('/api/v1/store/account/orders/123')).toBe(
      '/api/v1/store/account/orders/123',
    );
    expect(maskSecretsInUrl(undefined)).toBeUndefined();
  });
});

describe('log das requisições (configuração do AppModule)', () => {
  /** Faz uma requisição de verdade pelo pino-http com a configuração da API e devolve o log. */
  async function logOf(path: string, headers: Record<string, string>) {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const log = pinoHttp({ ...httpLogOptions('info'), stream });
    const server = createServer((req, res) => {
      log(req, res);
      res.setHeader('Set-Cookie', 'cm_sid=segredo-do-cookie-de-volta');
      res.end('ok');
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const { port } = server.address() as AddressInfo;
    try {
      await new Promise<void>((ok, fail) => {
        const r = request({ host: '127.0.0.1', port, path, headers }, (res) => {
          res.resume();
          res.on('end', ok);
        });
        r.on('error', fail);
        r.end();
      });
      await new Promise((ok) => setImmediate(ok));
    } finally {
      await new Promise((ok) => server.close(ok));
    }
    return lines.join('');
  }

  it('não grava token da query, link do entregador nem cabeçalhos com segredo', async () => {
    const out = await logOf(
      '/api/v1/internal/traefik?token=segredo-traefik-1&x=1&start=/entregador/segredo-moto-2',
      {
        Cookie: 'cm_sid=segredo-cookie-3',
        Authorization: 'Bearer segredo-bearer-4',
        'asaas-access-token': 'segredo-asaas-5',
        'rappi-signature': 't=1,sign=segredo-rappi-6',
        'x-app-signature': 'segredo-keeta-7',
        'User-Agent': 'teste-do-log',
      },
    );
    expect(out).toContain('teste-do-log');
    expect(out).toContain('/api/v1/internal/traefik');
    expect(out).not.toMatch(/segredo/);
    const entry = JSON.parse(out.trim().split('\n')[0]) as { req: Record<string, unknown> };
    expect(entry.req).not.toHaveProperty('query');
    expect(entry.req).not.toHaveProperty('params');
  });
});
