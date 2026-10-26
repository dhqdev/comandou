import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_BUILD } from './app-version';
import { clearAppCaches, reloadIfStale } from './fresh-reload';

const deleted: string[] = [];
const unregister = vi.fn(async () => true);
const reload = vi.fn();
let serverBuild = APP_BUILD;

beforeEach(() => {
  deleted.length = 0;
  unregister.mockClear();
  reload.mockClear();
  sessionStorage.clear();
  serverBuild = APP_BUILD;
  vi.stubGlobal('caches', {
    keys: async () => ['workbox-precache-v2', 'outro'],
    delete: async (k: string) => (deleted.push(k), true),
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistrations: async () => [{ unregister }] },
  });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ build: serverBuild }), { status: 200 })),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('fresh-reload', () => {
  it('apaga todos os caches e o service worker', async () => {
    await clearAppCaches();
    expect(deleted).toEqual(['workbox-precache-v2', 'outro']);
    expect(unregister).toHaveBeenCalledOnce();
  });

  it('mesma build no servidor: não mexe em nada', async () => {
    expect(await reloadIfStale()).toBe(false);
    expect(deleted).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('build nova no servidor: limpa e recarrega uma vez só', async () => {
    serverBuild = 'nova';
    expect(await reloadIfStale()).toBe(true);
    expect(deleted).toHaveLength(2);
    expect(reload).toHaveBeenCalledOnce();
    // Voltou e o servidor ainda manda a mesma build diferente: não entra em loop.
    expect(await reloadIfStale()).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
