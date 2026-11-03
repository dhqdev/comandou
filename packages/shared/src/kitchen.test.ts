import { describe, expect, it } from 'vitest';
import { DEFAULT_KITCHEN_DISPLAY, KITCHEN_DISPLAY_INFO, normalizeKitchenDisplay } from './kitchen';

describe('normalizeKitchenDisplay', () => {
  it('sem nada salvo, vale o padrão', () => {
    expect(normalizeKitchenDisplay(null)).toEqual(DEFAULT_KITCHEN_DISPLAY);
    expect(normalizeKitchenDisplay('x')).toEqual(DEFAULT_KITCHEN_DISPLAY);
  });
  it('aplica só chaves conhecidas com valor booleano', () => {
    const d = normalizeKitchenDisplay({ photos: false, timer: 'no', other: true });
    expect(d.photos).toBe(false);
    expect(d.timer).toBe(true);
    expect('other' in d).toBe(false);
  });
  it('todo interruptor tem rótulo na tela do Super Admin', () => {
    expect(KITCHEN_DISPLAY_INFO.map((i) => i.key).sort()).toEqual(
      Object.keys(DEFAULT_KITCHEN_DISPLAY).sort(),
    );
  });
});
