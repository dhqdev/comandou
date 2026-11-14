import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Busca uma URL pública informada por quem usa o sistema (link do cardápio, logo, foto do item)
 * sem abrir porta para a rede interna: só http(s), portas 80/443, endereço que resolve para IP
 * público, redirecionamentos conferidos um a um e corpo com limite de tamanho.
 */

export class SafeFetchError extends Error {}

/** IPv4/IPv6 da rede interna, loopback, link-local, CGNAT, multicast e reservados. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    return (
      s === '::' ||
      s === '::1' ||
      s.startsWith('fc') ||
      s.startsWith('fd') ||
      s.startsWith('fe8') ||
      s.startsWith('fe9') ||
      s.startsWith('fea') ||
      s.startsWith('feb') ||
      s.startsWith('ff') ||
      s.startsWith('64:ff9b:') ||
      s.startsWith('2001:db8')
    );
  }
  return true;
}

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
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !isIP(host)) return null;
  if (/\.(local|internal|localhost|lan|home|corp)$/i.test(host)) return null;
  return u;
}

async function assertPublic(u: URL) {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new SafeFetchError('Não encontrei esse endereço. Confira o link.');
      });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address)))
    throw new SafeFetchError('Esse link não é de um site público');
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
    await assertPublic(u);
    let res: Response;
    try {
      res = await fetch(u, {
        redirect: 'manual',
        signal: deadline,
        headers: {
          'User-Agent': UA,
          Accept: opts.accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
      });
    } catch {
      throw new SafeFetchError('O site não respondeu. Confira o link ou mande fotos do cardápio.');
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      const next: URL | null = loc ? normalizeUrl(new URL(loc, u).toString()) : null;
      if (!next)
        throw new SafeFetchError('O site redirecionou para um endereço que não dá para abrir');
      u = next;
      continue;
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > opts.maxBytes && !opts.truncate) {
      await res.body?.cancel().catch(() => undefined);
      throw new SafeFetchError('A página é grande demais para ler');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read().catch(() => {
          throw new SafeFetchError('O site demorou demais para responder');
        });
        if (done) break;
        size += value.length;
        if (size > opts.maxBytes) {
          await reader.cancel().catch(() => undefined);
          if (!opts.truncate) throw new SafeFetchError('Arquivo grande demais');
          break; // página grande: o começo basta
        }
        chunks.push(Buffer.from(value));
      }
    }
    return {
      url: u.toString(),
      status: res.status,
      contentType: (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(),
      body: Buffer.concat(chunks),
    };
  }
  throw new SafeFetchError('O site redirecionou vezes demais');
}
