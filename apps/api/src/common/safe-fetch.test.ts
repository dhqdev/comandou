import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isPrivateIp, normalizeUrl, safeFetch, SafeFetchError, safeFetchDeps } from './safe-fetch';

describe('isPrivateIp: endereços que escondem a rede interna', () => {
  it('IPv6 com IPv4 dentro, em qualquer grafia, conta como interno', () => {
    for (const ip of [
      '::ffff:7f00:1', // [::ffff:127.0.0.1] como o Node escreve
      '::ffff:a9fe:a9fe', // 169.254.169.254 (metadados da nuvem)
      '::ffff:a00:1',
      '::ffff:127.0.0.1',
      '0:0:0:0:0:ffff:7f00:1',
      '::127.0.0.1',
      '::7f00:1',
      '::ffff:0:7f00:1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::1',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      '100::1',
      'fec0::1',
      'FE80::1%eth0',
      '::',
      '0::1',
    ])
      expect(isPrivateIp(ip), ip).toBe(true);
  });

  it('IPv4 de documentação e relay também ficam de fora', () => {
    for (const ip of [
      '192.0.2.10',
      '198.51.100.7',
      '203.0.113.9',
      '192.88.99.1',
      '255.255.255.255',
    ])
      expect(isPrivateIp(ip), ip).toBe(true);
  });

  it('endereço público continua liberado', () => {
    for (const ip of [
      '8.8.8.8',
      '1.1.1.1',
      '2606:4700::6810:85e5',
      '2804:14c::1',
      '2001:4860::8888',
    ])
      expect(isPrivateIp(ip), ip).toBe(false);
  });

  it('o link com [::ffff:169.254.169.254] não passa', async () => {
    const u = normalizeUrl('http://[::ffff:169.254.169.254]/latest/meta-data');
    expect(u).not.toBeNull();
    await expect(safeFetch(u!, { maxBytes: 1000 })).rejects.toThrow(/não é de um site público/);
  });

  it('IPv4 escrito em hexadecimal ou decimal vira 127.0.0.1 e é recusado', async () => {
    for (const raw of ['http://0x7f.1/', 'http://2130706433/', 'http://017700000001/'])
      await expect(safeFetch(raw, { maxBytes: 1000 }), raw).rejects.toThrow(SafeFetchError);
  });
});

describe('safeFetch: conferência na hora de conectar', () => {
  let srv: Server;
  let port = 0;
  const original = { ...safeFetchDeps };
  const hits: string[] = [];

  beforeAll(async () => {
    srv = createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/gz') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        res.end(gzipSync(Buffer.from('<p>' + 'a'.repeat(200_000) + '</p>')));
        return;
      }
      if (req.url === '/redir') {
        res.writeHead(302, { location: 'http://interno.test/segredo' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>Cardápio</h1>');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    port = (srv.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => srv.close(() => r())));
  afterEach(() => {
    Object.assign(safeFetchDeps, original);
    hits.length = 0;
  });

  /** "publico.test" resolve para o servidor local, que finge ser público. */
  function fakeDns(map: Record<string, string>) {
    safeFetchDeps.allowPort = (p) => !p || p === String(port);
    safeFetchDeps.isPrivate = (ip) => ip !== '127.0.0.1' && isPrivateIp(ip);
    safeFetchDeps.lookup = async (host: string) => {
      const ip = map[host];
      if (!ip) throw new Error('ENOTFOUND');
      return [{ address: ip, family: ip.includes(':') ? 6 : 4 }];
    };
  }

  it('busca a página por um nome que resolve para IP público', async () => {
    fakeDns({ 'publico.test': '127.0.0.1' });
    const r = await safeFetch(`http://publico.test:${port}/`, { maxBytes: 10_000 });
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('text/html');
    expect(r.body.toString()).toContain('Cardápio');
  });

  it('DNS rebinding: o endereço conferido é o mesmo usado na conexão (uma consulta só)', async () => {
    let calls = 0;
    fakeDns({});
    // Primeira resposta "pública" (o servidor local, no teste), as seguintes apontariam para
    // dentro. Com conferência e conexão separadas, a segunda consulta levaria ao 10.0.0.5.
    safeFetchDeps.lookup = async () => {
      calls++;
      return [{ address: calls === 1 ? '127.0.0.1' : '10.0.0.5', family: 4 }];
    };
    const r = await safeFetch(`http://rebind.test:${port}/`, { maxBytes: 1000 });
    expect(r.status).toBe(200);
    expect(calls).toBe(1);
    expect(hits).toEqual(['/']);
  });

  it('nome que resolve para a rede interna é recusado no próprio socket', async () => {
    fakeDns({ 'interno.test': '10.0.0.5' });
    await expect(safeFetch(`http://interno.test:${port}/`, { maxBytes: 1000 })).rejects.toThrow(
      /não é de um site público/,
    );
    expect(hits).toEqual([]);
  });

  it('qualquer endereço interno na resposta do DNS recusa', async () => {
    fakeDns({});
    safeFetchDeps.lookup = async () => [
      { address: '127.0.0.1', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ];
    await expect(safeFetch(`http://misto.test:${port}/`, { maxBytes: 1000 })).rejects.toThrow(
      /não é de um site público/,
    );
    expect(hits).toEqual([]);
  });

  it('redirecionamento para a rede interna para no meio', async () => {
    fakeDns({ 'publico.test': '127.0.0.1', 'interno.test': '192.168.0.1' });
    await expect(
      safeFetch(`http://publico.test:${port}/redir`, { maxBytes: 1000 }),
    ).rejects.toThrow(SafeFetchError);
    expect(hits).toEqual(['/redir']);
  });

  it('gzip é medido depois de descompactar (bomba de compressão para no limite)', async () => {
    fakeDns({ 'publico.test': '127.0.0.1' });
    await expect(safeFetch(`http://publico.test:${port}/gz`, { maxBytes: 50_000 })).rejects.toThrow(
      /grande demais/,
    );
    const r = await safeFetch(`http://publico.test:${port}/gz`, {
      maxBytes: 50_000,
      truncate: true,
    });
    expect(r.body.length).toBe(50_000);
    expect(r.body.toString().startsWith('<p>aaa')).toBe(true);
  });
});
