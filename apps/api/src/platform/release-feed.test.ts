import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import { ReleaseFeed } from './server-agent.service';

const env = (extra: Partial<Env> = {}) =>
  ({
    UPDATE_RELEASES_REPO: 'dhqdev/comandou',
    UPDATE_IMAGE_PREFIX: 'ghcr.io/dhqdev/comandou-',
    ...extra,
  }) as Env;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** GitHub e GHCR de mentira: o repositório é privado (404) e as imagens são públicas. */
function fakeFetch(tags: Record<string, string[]>, releasesStatus = 404) {
  const seen: { url: string; auth?: string }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    seen.push({ url, auth });
    if (url.includes('api.github.com'))
      return releasesStatus === 200
        ? json(200, { tag_name: 'v0.70.0', html_url: 'https://gh/r', published_at: '2026' })
        : json(releasesStatus, { message: 'Not Found' });
    if (url.startsWith('https://ghcr.io/token')) return json(200, { token: 'anon' });
    const m = /\/v2\/dhqdev\/comandou-([\w-]+)\/tags\/list/.exec(url);
    if (m) return json(200, { name: m[1], tags: tags[m[1]!] ?? [] });
    return json(500, {});
  });
  vi.stubGlobal('fetch', fn);
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('ReleaseFeed', () => {
  it('com o repositório privado e sem token, usa a maior versão presente em todas as imagens', async () => {
    fakeFetch({
      api: ['latest', 'v0.9.0', 'v0.10.0', 'v0.62.0', 'v0.63.0'],
      web: ['v0.9.0', 'v0.10.0', 'v0.62.0', 'v0.63.0'],
      backup: ['v0.10.0', 'v0.62.0', 'v0.63.0'],
      'whatsapp-gateway': ['v0.10.0', 'v0.62.0'],
    });
    const r = await new ReleaseFeed(env()).latest();
    expect(r.error).toBeUndefined();
    expect(r.latest?.version).toBe('v0.62.0');
  });

  it('com token, manda o token para o GitHub e para o GHCR', async () => {
    const seen = fakeFetch({}, 200);
    const r = await new ReleaseFeed(env({ UPDATE_GITHUB_TOKEN: 'ghp_x' })).latest();
    expect(r.latest?.version).toBe('v0.70.0');
    expect(seen[0]!.auth).toBe('Bearer ghp_x');
  });

  it('sem releases nem imagens, explica o que configurar', async () => {
    fakeFetch({});
    const r = await new ReleaseFeed(env()).latest();
    expect(r.latest).toBeNull();
    expect(r.error).toMatch(/UPDATE_GITHUB_TOKEN/);
  });
});
