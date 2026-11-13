import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushPixel,
  resetPixelForTests,
  SESSION_IDLE_MS,
  sourceOf,
  startPixel,
  track,
} from './pixel';

const P = '11111111-1111-4111-8111-111111111111';

function bodies(f: ReturnType<typeof vi.fn>) {
  return f.mock.calls.map(
    (c) =>
      JSON.parse((c[1] as RequestInit).body as string) as {
        sid: string;
        vid: string;
        ctx?: { source?: string; table?: boolean };
        events: { type: string; productId?: string; term?: string; value?: number }[];
      },
  );
}

describe('pixel do cardápio', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    resetPixelForTests();
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('origem: utm do link, site que mandou ou direto', () => {
    expect(sourceOf('?utm_source=Insta&utm_campaign=Promo', '', 'loja.com').source).toBe('insta');
    expect(sourceOf('', 'https://l.instagram.com/?u=x', 'loja.com').source).toBe('instagram');
    expect(sourceOf('', 'https://wa.me/55', 'loja.com').source).toBe('whatsapp');
    expect(sourceOf('', 'https://www.google.com.br/', 'loja.com').source).toBe('google');
    expect(sourceOf('', 'https://loja.com/pedir', 'loja.com').source).toBeUndefined();
    expect(sourceOf('', '', 'loja.com')).toEqual({
      source: undefined,
      medium: undefined,
      campaign: undefined,
    });
  });

  it('nada vai antes de o cardápio abrir', () => {
    track('view_item', { productId: P });
    flushPixel();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('visita primeiro, eventos em lote e dados inválidos fora', () => {
    startPixel({ table: true });
    track('view_item', { productId: P });
    track('click_category', { targetId: 'destaques' });
    track('search', { term: '  PIZZA  ', quantity: 0 });
    flushPixel();
    const [b] = bodies(fetchMock);
    expect(b!.ctx?.table).toBe(true);
    expect(b!.events).toEqual([
      { type: 'visit' },
      { type: 'view_item', productId: P },
      { type: 'click_category' },
      { type: 'search', term: 'pizza', quantity: 0 },
    ]);
  });

  it('recarregar a página não conta outra visita; parado 30 min conta', () => {
    vi.useFakeTimers();
    startPixel({ table: false });
    flushPixel();
    resetPixelForTests();
    startPixel({ table: false });
    track('view_cart');
    flushPixel();
    let all = bodies(fetchMock);
    expect(all[1]!.events.map((e) => e.type)).toEqual(['view_cart']);
    expect(all[1]!.sid).toBe(all[0]!.sid);

    vi.setSystemTime(Date.now() + SESSION_IDLE_MS + 1000);
    track('view_cart');
    flushPixel();
    all = bodies(fetchMock);
    expect(all[2]!.events.map((e) => e.type)).toEqual(['visit', 'view_cart']);
    expect(all[2]!.sid).not.toBe(all[0]!.sid);
    expect(all[2]!.vid).toBe(all[0]!.vid);
  });
});
