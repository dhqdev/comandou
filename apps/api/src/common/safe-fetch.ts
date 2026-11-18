import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';

/**
 * Busca uma URL pública informada por quem usa o sistema (link do cardápio, logo, foto do item)
 * sem abrir porta para a rede interna: só http(s), portas 80/443, endereço que resolve para IP
 * público, redirecionamentos conferidos um a um e corpo com limite de tamanho.
 *
 * O IP é conferido NA HORA DE CONECTAR (lookup próprio no http/https), não numa consulta de DNS
 * separada antes: assim um DNS que responde um IP público na conferência e 127.0.0.1 na conexão
 * ("DNS rebinding") não chega na rede interna.
 */

export class SafeFetchError extends Error {}

/** IPv4 em 4 números, ou null. */
function v4Parts(ip: string): number[] | null {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  const n = p.map(Number);
  return n.every((x, i) => /^\d{1,3}$/.test(p[i]!) && x <= 255) ? n : null;
}

function privateV4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}

/** IPv6 em 8 grupos de 16 bits (aceita "::" e o final em IPv4), ou null. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const v4 = v4Parts(tail[1]!);
    if (!v4) return null;
    s =
      s.slice(0, -tail[1]!.length) +
      `${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array<string>(fill).fill('0'), ...rest];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/**
 * IPv4/IPv6 da rede interna, loopback, link-local, CGNAT, multicast, documentação e reservados.
 * IPv6 que carrega um IPv4 dentro (::ffff:7f00:1, ::127.0.0.1, NAT64, 6to4, Teredo) também
 * conta como interno: o Node escreve "[::ffff:127.0.0.1]" como "::ffff:7f00:1" e, com IPv6
 * ligado, isso conecta no 127.0.0.1.
 */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return privateV4(v4Parts(ip)!);
  if (v !== 6) return true;
  const g = v6Groups(ip);
  if (!g) return true;
  const [g0, g1] = g as [number, number];
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  return (
    zeros(5) || // ::, ::1, ::a.b.c.d e ::ffff:a.b.c.d (IPv4 dentro do IPv6)
    (zeros(4) && g[4] === 0xffff) || // ::ffff:0:a.b.c.d (traduzido)
    (g0 === 0x64 && g1 === 0xff9b) || // NAT64
    (g0 === 0x100 && g1 === 0 && g[2] === 0 && g[3] === 0) || // descarte
    (g0 === 0x2001 && g1 < 0x200) || // Teredo, ORCHID e reservados do IETF
    (g0 === 0x2001 && g1 === 0xdb8) || // documentação
    g0 === 0x2002 || // 6to4
    (g0 & 0xfe00) === 0xfc00 || // fc00::/7 (rede local)
    (g0 & 0xffc0) === 0xfe80 || // link-local
    (g0 & 0xffc0) === 0xfec0 || // site-local (antigo)
    (g0 & 0xff00) === 0xff00 // multicast
  );
}

/** Pontos de troca para os testes (DNS falso e porta do servidor local). */
export const safeFetchDeps = {
  lookup: (host: string) => lookup(host, { all: true }),
  isPrivate: isPrivateIp,
  allowPort: (port: string) => !port || port === '80' || port === '443',
};

/** "bellaserra.com.br/cardapio" → URL com https; o que não for site público vira null. */
export function normalizeUrl(raw: string): URL | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!safeFetchDeps.allowPort(u.port)) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !isIP(host)) return null;
  if (/\.(local|internal|localhost|lan|home|corp)$/i.test(host)) return null;
  return u;
}

const NOT_PUBLIC = 'Esse link não é de um site público';

/** IP literal no link: confere direto (o http não consulta o DNS para IP). */
function assertLiteral(u: URL) {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && safeFetchDeps.isPrivate(host)) throw new SafeFetchError(NOT_PUBLIC);
}

/**
 * Lookup usado pelo próprio socket: resolve, recusa se QUALQUER endereço for interno e entrega
 * só os endereços conferidos. Não existe uma segunda consulta de DNS depois desta.
 */
const guardedLookup: LookupFunction = (hostname, options, cb) => {
  safeFetchDeps.lookup(hostname).then(
    (addrs) => {
      if (!addrs.length || addrs.some((a) => safeFetchDeps.isPrivate(a.address)))
        return cb(new SafeFetchError(NOT_PUBLIC) as NodeJS.ErrnoException, '', 0);
      const wanted = options.family === 6 ? 6 : options.family === 4 ? 4 : 0;
      const list = wanted ? addrs.filter((a) => a.family === wanted) : addrs;
      if (!list.length) return cb(new SafeFetchError(NOT_PUBLIC) as NodeJS.ErrnoException, '', 0);
      if (options.all) return (cb as (e: null, a: typeof list) => void)(null, list);
      cb(null, list[0]!.address, list[0]!.family);
    },
    () =>
      cb(
        new SafeFetchError('Não encontrei esse endereço. Confira o link.') as NodeJS.ErrnoException,
        '',
        0,
      ),
  );
};

interface Raw {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Readable;
}

function request(u: URL, headers: Record<string, string>, signal: AbortSignal): Promise<Raw> {
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      { method: 'GET', headers, signal, lookup: guardedLookup, agent: false },
      (res) => {
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
        const body: Readable =
          enc === 'gzip' || enc === 'x-gzip'
            ? res.pipe(zlib.createGunzip())
            : enc === 'deflate'
              ? res.pipe(zlib.createInflate())
              : enc === 'br'
                ? res.pipe(zlib.createBrotliDecompress())
                : res;
        if (body !== res) res.on('error', (e) => body.destroy(e));
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Navegador comum: muitos cardápios digitais recusam quem não parece um. */
const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

export interface Fetched {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

export async function safeFetch(
  raw: string | URL,
  opts: {
    maxBytes: number;
    /** Página HTML: passou do limite, fica com o começo (em vez de recusar). */
    truncate?: boolean;
    accept?: string;
    timeoutMs?: number;
    maxRedirects?: number;
  },
): Promise<Fetched> {
  const first = typeof raw === 'string' ? normalizeUrl(raw) : raw;
  if (!first) throw new SafeFetchError('Link inválido');
  let u: URL = first;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 4); hop++) {
    assertLiteral(u);
    let res: Raw;
    try {
      res = await request(
        u,
        {
          'User-Agent': UA,
          Accept: opts.accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        deadline,
      );
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      throw new SafeFetchError('O site não respondeu. Confira o link ou mande fotos do cardápio.');
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.location;
      res.body.destroy();
      let next: URL | null = null;
      try {
        next = loc ? normalizeUrl(new URL(loc, u).toString()) : null;
      } catch {
        next = null;
      }
      if (!next)
        throw new SafeFetchError('O site redirecionou para um endereço que não dá para abrir');
      u = next;
      continue;
    }
    const len = Number(res.headers['content-length'] ?? 0);
    if (len > opts.maxBytes && !opts.truncate && !res.headers['content-encoding']) {
      res.body.destroy();
      throw new SafeFetchError('A página é grande demais para ler');
    }
    // Conta o tamanho DEPOIS de descompactar: um gzip pequeno que vira gigabytes para no limite.
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const value of res.body as AsyncIterable<Buffer>) {
        size += value.length;
        if (size > opts.maxBytes) {
          res.body.destroy();
          if (!opts.truncate) throw new SafeFetchError('Arquivo grande demais');
          chunks.push(value.subarray(0, value.length - (size - opts.maxBytes)));
          break; // página grande: o começo basta
        }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      throw new SafeFetchError('O site demorou demais para responder');
    }
    return {
      url: u.toString(),
      status: res.status,
      contentType: String(res.headers['content-type'] ?? '')
        .split(';')[0]!
        .trim()
        .toLowerCase(),
      body: Buffer.concat(chunks),
    };
  }
  throw new SafeFetchError('O site redirecionou vezes demais');
}
