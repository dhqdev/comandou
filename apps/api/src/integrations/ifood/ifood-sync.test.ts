import { describe, expect, it } from 'vitest';
import {
  fingerprints,
  itemIds,
  itemPayload,
  planItems,
  summaryText,
  emptySummary,
  type LocalItem,
  type MapRow,
} from './ifood-sync';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const burger: LocalItem = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  code: 'IT-000001',
  name: 'X-Burguer',
  description: 'Pão, carne e queijo',
  price: '25.90',
  categoryId: 'cat',
  available: true,
  imageId: null,
  position: 1,
  groups: [
    {
      id: 'bbbbbbbb-0000-4000-8000-000000000001',
      name: 'Adicionais',
      min: 0,
      max: 3,
      options: [{ id: 'cccccccc-0000-4000-8000-000000000001', name: 'Bacon', priceDelta: '4.00' }],
    },
    // Grupo sem opção ativa não vai (o iFood não aceita grupo vazio).
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Vazio', min: 1, max: 1, options: [] },
  ],
};

const payloadOf = (i: LocalItem, ids: ReturnType<typeof itemIds>, itemId: string) =>
  itemPayload(i, ids, itemId, 'remote-cat', null);

function sent(i: LocalItem): MapRow {
  const ids = itemIds(i, undefined, uuid);
  const fp = fingerprints(payloadOf(i, ids, 'item-1'));
  return {
    remoteId: 'item-1',
    extra: ids,
    shapeHash: fp.shape,
    offerHash: fp.offer,
    status: 'AVAILABLE',
  };
}

describe('ifood-sync', () => {
  it('monta o item com produto, grupo e opção (preço em reais)', () => {
    const ids = itemIds(burger, undefined, uuid);
    const p = payloadOf(burger, ids, 'item-1');
    expect(p.item).toMatchObject({
      id: 'item-1',
      categoryId: 'remote-cat',
      price: { value: 25.9 },
      externalCode: 'IT-000001',
    });
    expect(p.optionGroups).toHaveLength(1);
    expect(p.options[0]).toMatchObject({ price: { value: 4 } });
    expect(p.products).toHaveLength(2);
    expect((p.products[0] as { optionGroups: unknown[] }).optionGroups[0]).toMatchObject({
      min: 0,
      max: 3,
    });
  });

  it('planeja: novo, sem mudança, só preço, só status, estrutura e retirado', () => {
    const row = sent(burger);
    expect(planItems([burger], new Map(), payloadOf, uuid)[0]!.kind).toBe('create');
    expect(planItems([burger], new Map([[burger.id, row]]), payloadOf, uuid)[0]!.kind).toBe(
      'unchanged',
    );
    const price = planItems(
      [{ ...burger, price: '27.00' }],
      new Map([[burger.id, row]]),
      payloadOf,
      uuid,
    );
    expect(price[0]).toMatchObject({ kind: 'offer', price: true, status: null });
    const out = planItems(
      [{ ...burger, available: false }],
      new Map([[burger.id, row]]),
      payloadOf,
      uuid,
    );
    expect(out[0]).toMatchObject({ kind: 'offer', price: false, status: 'UNAVAILABLE' });
    expect(
      planItems([{ ...burger, name: 'X-Bacon' }], new Map([[burger.id, row]]), payloadOf, uuid)[0]!
        .kind,
    ).toBe('update');
    expect(planItems([], new Map([[burger.id, row]]), payloadOf, uuid)).toEqual([
      { kind: 'unavailable', localId: burger.id, itemId: 'item-1' },
    ]);
    // Já indisponível: não manda de novo.
    expect(
      planItems([], new Map([[burger.id, { ...row, status: 'UNAVAILABLE' }]]), payloadOf, uuid),
    ).toEqual([]);
  });

  it('reaproveita os ids já enviados', () => {
    const row = sent(burger);
    const again = itemIds(burger, row.extra, uuid);
    expect(again).toEqual(row.extra);
  });

  it('resumo no texto da tela', () => {
    expect(summaryText({ ...emptySummary(), updated: 1, unchanged: 59 })).toBe(
      '0 criado(s), 1 atualizado(s), 59 sem alteração, 0 deixado(s) indisponível(is) no iFood.',
    );
  });
});
