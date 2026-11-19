import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearAppCaches = vi.fn(async () => undefined);
vi.mock('./fresh-reload', () => ({ clearAppCaches: () => clearAppCaches() }));

const reload = vi.fn();

async function load() {
  vi.resetModules();
  const store = await import('./offline-store');
  return { ...(await import('./tenant-cache')), ...store };
}

beforeEach(() => {
  clearAppCaches.mockClear();
  reload.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

describe('limpar o cache do restaurante', () => {
  it('apaga as leituras guardadas e os arquivos do app, mantém a fila e recarrega', async () => {
    const { wipeTenantCache, memoryStore, setOfflineStore } = await load();
    const store = memoryStore();
    setOfflineStore(store);
    await store.put('cache', 'h|/menus', { at: 1, body: [] });
    await store.put('outbox', 'op1', { id: 'op1' });
    sessionStorage.setItem('cm:offline-warm', '{}');
    sessionStorage.setItem('pm.cashSession', 'x');
    await wipeTenantCache('2026-11-19T13:00:00.000Z');
    expect(clearAppCaches).toHaveBeenCalledOnce();
    expect(await store.keys('cache')).toEqual([]);
    expect(await store.keys('outbox')).toEqual(['op1']);
    expect(sessionStorage.getItem('cm:offline-warm')).toBeNull();
    expect(sessionStorage.getItem('pm.cashSession')).toBe('x');
    expect(localStorage.getItem('cm.cacheEpoch')).toBe('2026-11-19T13:00:00.000Z');
    expect(reload).toHaveBeenCalledOnce();
    setOfflineStore(null);
  });

  it('primeira conexão só guarda a data; limpeza nova feita com o aparelho fechado limpa', async () => {
    const { checkCacheEpoch } = await load();
    expect(checkCacheEpoch(null)).toBe(false);
    expect(localStorage.getItem('cm.cacheEpoch')).toBe('none');
    expect(checkCacheEpoch(null)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(checkCacheEpoch('2026-11-19T13:00:00.000Z')).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('depois de recarregar, a mesma data não limpa de novo (sem laço)', async () => {
    localStorage.setItem('cm.cacheEpoch', '2026-11-19T13:00:00.000Z');
    const { checkCacheEpoch } = await load();
    expect(checkCacheEpoch('2026-11-19T13:00:00.000Z')).toBe(false);
    expect(checkCacheEpoch(undefined)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
