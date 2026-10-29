import { describe, expect, it } from 'vitest';
import { cleanOutfit, MASCOT_ITEMS, MASCOT_LOOKS } from './mascot';

describe('roupinha do panda', () => {
  it('guarda só peças que existem e no lugar certo', () => {
    expect(cleanOutfit({ head: 'chef', neck: 'bandana' })).toEqual({
      head: 'chef',
      neck: 'bandana',
    });
    expect(cleanOutfit({ head: 'bowtie', neck: 'chef' })).toEqual({});
    expect(cleanOutfit({ head: 'coroa', hat: 'chef' })).toEqual({});
    expect(cleanOutfit(null)).toEqual({});
    expect(cleanOutfit('chef')).toEqual({});
  });

  it('os prontos usam peças que existem', () => {
    for (const look of MASCOT_LOOKS) expect(cleanOutfit(look.outfit)).toEqual(look.outfit);
    expect(new Set(MASCOT_ITEMS.map((i) => i.id)).size).toBe(MASCOT_ITEMS.length);
  });
});
