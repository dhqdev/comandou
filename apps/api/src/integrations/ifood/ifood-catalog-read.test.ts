import { describe, expect, it } from 'vitest';
import { categoryItems, menuDrift } from './ifood-catalog-read';
import { offerHashOf } from './ifood-sync';

const body = {
  items: [
    {
      id: 'i1',
      categoryId: 'c1',
      status: 'AVAILABLE',
      price: { value: 25.9 },
      externalCode: 'IT-000001',
      productId: 'p1',
    },
    { id: 'i2', status: 'UNAVAILABLE', price: { value: 0.1 + 0.2 }, productId: 'p2' },
    { id: 'sem-nome', productId: 'nada' },
  ],
  products: [
    { id: 'p1', name: 'X-Burguer', optionGroups: [{ id: 'g1', min: 3, max: 2 }] },
    { id: 'p2', name: 'Suco', description: 'Natural' },
    { id: 'po1', name: 'Bacon' },
  ],
  optionGroups: [{ id: 'g1', name: 'Adicionais', status: 'AVAILABLE', optionIds: ['o1', 'x'] }],
  options: [{ id: 'o1', productId: 'po1', status: 'AVAILABLE', price: { value: 4 } }],
};

describe('cardápio que está no iFood', () => {
  it('itens da categoria no formato do Comandou, com complementos e preço sem float', () => {
    const list = categoryItems({ id: 'c1', name: 'Lanches' }, body);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: 'i1',
      name: 'X-Burguer',
      categoryName: 'Lanches',
      price: '25.90',
      externalCode: 'IT-000001',
      available: true,
      groups: [
        {
          id: 'g1',
          name: 'Adicionais',
          min: 2,
          max: 2,
          options: [{ id: 'o1', name: 'Bacon', price: '4.00' }],
        },
      ],
    });
    expect(list[1]).toMatchObject({ price: '0.30', available: false, description: 'Natural' });
    expect(categoryItems({ id: 'c', name: 'x' }, null)).toEqual([]);
  });

  it('acha preço, disponibilidade e nome mudados no portal, item apagado e o que só existe lá', () => {
    const remote = categoryItems({ id: 'c1', name: 'Lanches' }, body);
    const d = menuDrift(
      remote,
      [
        {
          localId: 'l1',
          remoteId: 'i1',
          name: 'X-Burguer',
          price: '25.90',
          offerHash: offerHashOf(25.9),
          available: true,
        },
        {
          localId: 'l2',
          remoteId: 'i2',
          name: 'Suco de laranja',
          price: '9.00',
          offerHash: offerHashOf(9),
          available: true,
        },
        {
          localId: 'l3',
          remoteId: 'apagado',
          name: 'Água',
          price: '3.00',
          offerHash: null,
          available: true,
        },
        {
          localId: 'l4',
          remoteId: 'tirado',
          name: 'Velho',
          price: '3.00',
          offerHash: null,
          available: false,
        },
      ],
      offerHashOf,
      new Set(),
    );
    expect(d.changed).toEqual([
      {
        localId: 'l2',
        name: 'Suco de laranja',
        changes: [
          { field: 'price', remote: '0.30', local: '9.00' },
          { field: 'status', remote: 'unavailable', local: 'available' },
          { field: 'name', remote: 'Suco', local: 'Suco de laranja' },
        ],
      },
      { localId: 'l3', name: 'Água', changes: [{ field: 'missing', remote: null, local: 'Água' }] },
    ]);
    expect(d.onlyRemote).toEqual([]);
    // Sem nada enviado: tudo é "só no iFood", menos o que tem código do Comandou.
    const fresh = menuDrift(remote, [], offerHashOf, new Set(['IT-000001']));
    expect(fresh.onlyRemote.map((r) => r.id)).toEqual(['i2']);
  });
});
