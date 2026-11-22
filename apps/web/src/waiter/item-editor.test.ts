import { describe, expect, it } from 'vitest';
import type { MenuGroup } from '../lib/types';
import { groupHint, groupMode, missingGroup, unitCents } from './item-editor';

const g = (over: Partial<MenuGroup>): MenuGroup => ({
  id: 'g',
  name: 'Grupo',
  minSelect: 0,
  maxSelect: 1,
  options: [],
  ...over,
});

describe('edição do item no garçom', () => {
  it('escolhe o jeito de cada grupo', () => {
    expect(groupMode(g({ kind: 'variation', minSelect: 1 }))).toBe('single');
    expect(groupMode(g({ kind: 'additional', maxSelect: 4 }))).toBe('add');
    expect(groupMode(g({ maxSelect: 4 }))).toBe('add');
    expect(groupMode(g({ kind: 'flavor', maxSelect: 2 }))).toBe('multi');
    expect(groupMode(g({ kind: 'remove', maxSelect: 1 }))).toBe('remove');
  });

  it('frase de cada grupo', () => {
    expect(groupHint(g({ minSelect: 1 }))).toBe('Escolha 1 opção');
    expect(groupHint(g({}))).toBe('Opcional, escolha 1');
    expect(groupHint(g({ kind: 'additional', maxSelect: 4 }))).toBe('Escolha até 4');
    expect(groupHint(g({ kind: 'flavor', minSelect: 2, maxSelect: 2 }))).toBe('Escolha 2');
    expect(groupHint(g({ kind: 'flavor', minSelect: 1, maxSelect: 3 }))).toBe('Escolha de 1 a 3');
    expect(groupHint(g({ kind: 'remove', maxSelect: 10 }))).toBe('Toque no que o cliente não quer');
  });

  it('acha o primeiro grupo obrigatório sem escolha', () => {
    const a = g({ id: 'a', minSelect: 0, maxSelect: 4 });
    const b = g({ id: 'b', minSelect: 1 });
    const c = g({ id: 'c', minSelect: 1 });
    expect(missingGroup([a, b, c], {})?.id).toBe('b');
    expect(missingGroup([a, b, c], { b: ['x'] })?.id).toBe('c');
    expect(missingGroup([a, b, c], { b: ['x'], c: ['y'] })).toBeNull();
  });

  it('soma o preço das opções', () => {
    const p = {
      price: '34.90',
      optionGroups: [
        g({
          id: 'add',
          kind: 'additional',
          maxSelect: 4,
          options: [
            { id: 'bacon', name: 'Bacon', priceDelta: '5.00' },
            { id: 'ovo', name: 'Ovo', priceDelta: '3.00' },
          ],
        }),
      ],
    };
    expect(unitCents(p, [])).toBe(3490);
    expect(unitCents(p, ['bacon', 'ovo'])).toBe(4290);
  });
});
