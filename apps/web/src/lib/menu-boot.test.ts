import { afterEach, describe, expect, it } from 'vitest';
import { cachedMenu, forgetMenus, isMenuPath, saveMenu, takeBootFetch } from './menu-boot';

afterEach(() => {
  localStorage.clear();
  window.__cmBootFetch = undefined;
});

describe('cardápio pedido pelo boot.js', () => {
  it('a resposta já pedida vale uma vez só, para o mesmo endereço', () => {
    const res = Promise.resolve(new Response('{}'));
    window.__cmBootFetch = { path: '/store', at: Date.now(), res };
    expect(takeBootFetch('/store?mesa=x')).toBeNull();
    expect(takeBootFetch('/store')).toBe(res);
    expect(takeBootFetch('/store')).toBeNull();
  });

  it('resposta antiga (página aberta há muito tempo) é pedida de novo', () => {
    const res = Promise.resolve(new Response('{}'));
    window.__cmBootFetch = { path: '/store', at: Date.now() - 60_000, res };
    expect(takeBootFetch('/store')).toBeNull();
    expect(window.__cmBootFetch).toBeUndefined();
  });
});

describe('último cardápio guardado no aparelho', () => {
  it('guarda e devolve por endereço (online e cada mesa à parte)', () => {
    saveMenu('/store', { name: 'online' });
    saveMenu('/store?mesa=1', { name: 'mesa' });
    expect(cachedMenu('/store')).toEqual({ name: 'online' });
    expect(cachedMenu('/store?mesa=1')).toEqual({ name: 'mesa' });
    expect(cachedMenu('/store?mesa=2')).toBeNull();
  });

  it('cardápio guardado há mais de duas semanas não aparece', () => {
    const at = Date.now() - 15 * 24 * 3_600_000;
    saveMenu('/store', { name: 'velho' }, at);
    expect(cachedMenu('/store')).toBeNull();
  });

  it('cardápio grande demais não ocupa o aparelho', () => {
    saveMenu('/store', { name: 'antigo' });
    saveMenu('/store', { blob: 'x'.repeat(1_600_000) });
    expect(cachedMenu('/store')).toBeNull();
  });

  it('limpar apaga só os cardápios', () => {
    localStorage.setItem('cm-theme', 'dark');
    saveMenu('/store', { a: 1 });
    saveMenu('/store?mesa=1', { a: 2 });
    forgetMenus();
    expect(cachedMenu('/store')).toBeNull();
    expect(cachedMenu('/store?mesa=1')).toBeNull();
    expect(localStorage.getItem('cm-theme')).toBe('dark');
  });

  it('só o /pedir é o cardápio', () => {
    expect(isMenuPath('/pedir')).toBe(true);
    expect(isMenuPath('/pedir/sacola')).toBe(true);
    expect(isMenuPath('/pedido/abc')).toBe(false);
    expect(isMenuPath('/pedidos')).toBe(false);
  });
});
