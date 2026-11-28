import { describe, expect, it } from 'vitest';
import { readOrderJson } from './ai-agent.service';
import { type FlowDeps, type FlowStore, WaFlowEngine } from './wa-flow-engine';
import { mirrorLines, webKey } from './wa-order.service';
import {
  amount,
  badgeEmoji,
  catEmoji,
  choice,
  choices,
  type CartLine,
  type Flow,
  type FlowCategory,
  type FlowLoyalty,
  type FlowSettings,
  itemsText,
  money,
  num,
  parseAddress,
  quantity,
  readOrderText,
} from './wa-flow';

const MENU: FlowCategory[] = [
  {
    name: 'Lanches',
    items: [
      {
        id: 'p-smash',
        name: 'Smash duplo',
        description: 'Dois smash 90g com cheddar',
        price: '36.90',
        soldOut: false,
        soldByWeight: false,
        groups: [
          {
            id: 'g-ponto',
            name: 'Ponto da carne',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { id: 'o-ponto', name: 'Ao ponto', priceDelta: '0' },
              { id: 'o-bem', name: 'Bem passado', priceDelta: '2.00' },
            ],
          },
        ],
      },
      {
        id: 'p-bacon',
        name: 'X-Bacon',
        description: null,
        price: '29.90',
        soldOut: false,
        soldByWeight: false,
        groups: [],
        imageId: 'img-bacon',
        badge: 'Novo',
        rating: { average: 4.6, count: 24 },
      },
      {
        id: 'p-tudo',
        name: 'X-Tudo',
        description: null,
        price: '39.90',
        soldOut: true,
        soldByWeight: false,
        groups: [],
      },
    ],
  },
  {
    name: 'Bebidas',
    items: [
      {
        id: 'p-coca',
        name: 'Coca-Cola lata',
        description: null,
        price: '7.00',
        soldOut: false,
        soldByWeight: false,
        groups: [],
      },
    ],
  },
];

const SETTINGS: FlowSettings = {
  takeOrders: true,
  orderStatus: true,
  offerSignup: true,
  guestOrders: true,
  orderDelivery: true,
  orderPickup: true,
  payMethods: ['pix', 'cash', 'credit', 'debit'],
  understandText: true,
  itemNotes: true,
  sendTracking: false,
  freeChat: true,
  showInfo: true,
  takeReservations: false,
  sendPdfs: false,
  showPrices: true,
  suggestItems: true,
};

const STORE: FlowStore = {
  open: true,
  closedNote: null,
  acceptsDelivery: true,
  acceptsPickup: true,
  deliveryFee: 600,
  minOrder: 0,
  eta: '30 a 45 min',
  address: 'Rua da Loja, 10',
  hours: 'seg 18:00–23:00',
  reservations: false,
  menuFiles: 0,
};

function fake(over: Partial<FlowDeps> = {}) {
  const placed: Flow[] = [];
  const saved: string[] = [];
  let customer: { id: string; name: string } | null = null;
  const deps: FlowDeps = {
    settings: SETTINGS,
    agentName: 'Fumacinha',
    storeName: 'Fumaça Burger',
    greeting: null,
    pushName: 'Maria',
    timezone: 'America/Sao_Paulo',
    menu: async () => MENU,
    store: async () => STORE,
    customer: async () => customer,
    signup: async (name) => (customer = { id: 'c1', name }),
    addresses: async () => [],
    quote: async () => ({ ok: true, fee: 600, minOrder: null, lat: -22.9, lng: -47.06 }),
    saveAddress: async (_id, a) => void saved.push(a.street),
    place: async (f) => {
      placed.push(f);
      return { number: 18622, status: 'awaiting', total: '90.80', trackUrl: null };
    },
    orders: async () => [],
    ...over,
  };
  return { deps, placed, saved };
}

/** Conversa: manda cada mensagem e devolve o último texto e o estado. */
async function talk(engine: WaFlowEngine, msgs: string[], start: Flow | null = null) {
  let flow = start;
  let last = '';
  for (const m of msgs) {
    const out = await engine.handle(flow, m);
    flow = out.flow;
    last = out.text ?? '';
  }
  return { flow, last };
}

describe('leitura das respostas', () => {
  it('número de opção', () => {
    expect(choice('2')).toBe(2);
    expect(choice('2️⃣')).toBe(2);
    expect(choice('opção 3')).toBe(3);
    expect(choice('dois')).toBe(2);
    expect(choice('quero 2 lanches')).toBeNull();
    expect(choices('1, 3 e 4')).toEqual([1, 3, 4]);
    expect(choices('1 batata')).toBeNull();
  });

  it('quantidade e valor', () => {
    expect(quantity('2')).toBe(2);
    expect(quantity('duas')).toBe(2);
    expect(quantity('0')).toBeNull();
    expect(amount('R$ 100,00')).toBe(10000);
    expect(amount('troco pra 50')).toBe(5000);
  });

  it('endereço numa linha', () => {
    expect(parseAddress('Rua das Flores, 120, Centro, apto 12')).toEqual({
      street: 'Rua das Flores',
      number: '120',
      district: 'Centro',
      complement: 'apto 12',
    });
    expect(parseAddress('Av. Brasil 455, Jardim Nova Europa, CEP 13040-702')).toMatchObject({
      street: 'Av. Brasil',
      number: '455',
      district: 'Jardim Nova Europa',
      cep: '13040702',
    });
    expect(parseAddress('perto da padaria')).toBeNull();
  });

  it('pedido escrito sem IA', () => {
    expect(readOrderText('quero 2 smash duplo e uma coca sem gelo', MENU)).toEqual([
      { productId: 'p-smash', qty: 2 },
      { productId: 'p-coca', qty: 1, notes: 'sem gelo' },
    ]);
    // Item esgotado não entra; texto que não é pedido não casa.
    expect(readOrderText('quero um x-tudo', MENU)).toBeNull();
    expect(readOrderText('vocês abrem domingo?', MENU)).toBeNull();
  });

  it('JSON da IA só com códigos da lista', () => {
    const ids = new Map([
      ['P1', 'p-smash'],
      ['P2', 'p-coca'],
    ]);
    expect(
      readOrderJson(
        '{"items":[{"id":"P1","qty":2,"obs":"sem *cebola*"},{"id":"P9","qty":1}]}',
        ids,
      ),
    ).toEqual([{ productId: 'p-smash', qty: 2, notes: 'sem cebola' }]);
    expect(readOrderJson('nada', ids)).toBeNull();
  });

  it('formatação', () => {
    expect(money(9080)).toBe('R$ 90,80');
    expect(money('1234.5')).toBe('R$ 1.234,50');
    expect(num(3)).toBe('3️⃣');
    expect(num(12)).toBe('*12.*');
  });
});

describe('pedido pelo menu do WhatsApp', () => {
  it('menu principal no primeiro "oi", com as opções ligadas', async () => {
    const { deps } = fake();
    const out = await new WaFlowEngine(deps).handle(null, 'oi');
    expect(out.text).toContain('*Fumacinha*');
    expect(out.text).toContain('1️⃣ 🛵 Fazer um pedido');
    expect(out.text).toContain('2️⃣ 📦 Acompanhar meu pedido');
    expect(out.text).not.toContain('Reservar');
    expect(out.flow?.at).toBe('home');
  });

  it('do "oi" ao pedido feito: cadastro, entrega, endereço, complemento, troco', async () => {
    const { deps, placed, saved } = fake();
    const engine = new WaFlowEngine(deps);
    let r = await talk(engine, ['oi', '1']);
    expect(r.last).toContain('Não achei cadastro');
    r = await talk(engine, ['1', 'maria silva'], r.flow);
    expect(r.last).toContain('Cadastro feito, *Maria*');
    expect(r.last).toContain('Como você prefere receber?');
    r = await talk(engine, ['1', 'Rua das Flores, 120, Centro'], r.flow);
    expect(r.last).toContain('Taxa de entrega: *R$ 6,00*');
    r = await talk(engine, ['1'], r.flow);
    expect(saved).toEqual(['Rua das Flores']);
    expect(r.last).toContain('Escolha uma categoria');
    r = await talk(engine, ['1', '1', '2'], r.flow);
    expect(r.last).toContain('Ponto da carne');
    r = await talk(engine, ['2', 'sem cebola'], r.flow);
    expect(r.last).toContain('✅ Adicionei *2× Smash duplo*');
    expect(r.last).toContain('R$ 77,80');
    // Sugestão de bebida na sacola: 4 adiciona.
    expect(r.last).toContain('*Coca-Cola lata*');
    r = await talk(engine, ['4', '2'], r.flow);
    expect(r.last).toContain('Como vai pagar?');
    r = await talk(engine, ['2', '100'], r.flow);
    expect(r.last).toContain('Confira seu pedido');
    expect(r.last).toContain('*Total: R$ 90,80*');
    expect(r.last).toContain('troco para R$ 100,00');
    r = await talk(engine, ['1'], r.flow);
    expect(r.last).toContain('*Pedido #18622 recebido!*');
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({
      mode: 'delivery',
      customerId: 'c1',
      name: 'Maria Silva',
      pay: 'cash',
      changeFor: 10000,
      fee: 600,
    });
    expect(placed[0]!.cart.map((l) => [l.productId, l.qty, l.optionIds, l.notes])).toEqual([
      ['p-smash', 2, ['o-bem'], 'sem cebola'],
      ['p-coca', 1, [], undefined],
    ]);
    // Depois do pedido, volta ao começo lembrando quem é.
    expect(r.flow).toMatchObject({ at: 'home', customerId: 'c1', cart: [] });
  });

  it('pedido escrito direto já monta a sacola e pergunta o que falta', async () => {
    const { deps } = fake({ customer: async () => ({ id: 'c9', name: 'João' }) });
    const engine = new WaFlowEngine(deps);
    let r = await talk(engine, ['2 x-bacon e 1 coca']);
    expect(r.last).toContain('Este número está no cadastro de *João*');
    r = await talk(engine, ['1', '2'], r.flow);
    expect(r.last).toContain('🛒 *Sua sacola*');
    expect(r.last).toContain('2× X-Bacon');
    expect(r.last).toContain('1× Coca-Cola lata');
  });

  it('sem entender o pedido, a IA entra (só quando o dono deixa)', async () => {
    let asked = 0;
    const { deps } = fake({
      parseOrder: async () => {
        asked++;
        return [{ productId: 'p-bacon', qty: 1 }];
      },
    });
    const engine = new WaFlowEngine(deps);
    const out = await engine.handle(
      { at: 'cats', cart: [], name: 'Ana', customerId: null, mode: 'pickup' },
      'me vê aquele com bacon',
    );
    expect(asked).toBe(1);
    expect(out.text).toContain('Adicionei *1× X-Bacon*');
    // Pergunta solta no menu principal vai para a IA (conversa livre), sem ler pedido.
    const q = await engine.handle({ at: 'home', cart: [] }, 'vocês abrem domingo?');
    expect(q.ai).toBe(true);
    expect(asked).toBe(1);
  });

  it('endereço fora da área oferece retirar na loja', async () => {
    const { deps } = fake({ quote: async () => ({ ok: false, reason: 'not_covered' }) });
    const engine = new WaFlowEngine(deps);
    const f: Flow = {
      at: 'address_new',
      cart: [],
      name: 'Ana',
      customerId: null,
      mode: 'delivery',
    };
    let r = await talk(engine, ['Rua Longe, 5, Distante'], f);
    expect(r.last).toContain('Ainda não entregamos');
    r = await talk(engine, ['2'], r.flow);
    expect(r.flow?.mode).toBe('pickup');
    expect(r.last).toContain('Escolha uma categoria');
  });

  it('loja fechada não deixa começar o pedido', async () => {
    const { deps } = fake({ store: async () => ({ ...STORE, open: false }) });
    const out = await new WaFlowEngine(deps).handle({ at: 'home', cart: [] }, '1');
    expect(out.text).toContain('Estamos fechados agora');
  });

  it('pedido mínimo segura o fechamento', async () => {
    const { deps } = fake({ store: async () => ({ ...STORE, minOrder: 5000 }) });
    const f: Flow = {
      at: 'cart',
      cart: [
        {
          productId: 'p-coca',
          name: 'Coca-Cola lata',
          qty: 1,
          unit: 700,
          optionIds: [],
          optionNames: [],
        },
      ],
      name: 'Ana',
      customerId: null,
      mode: 'pickup',
    };
    const out = await new WaFlowEngine(deps).handle(f, '2');
    expect(out.text).toContain('O pedido mínimo é *R$ 50,00*');
  });

  it('"menu" volta ao começo de qualquer tela; "cancelar" esvazia', async () => {
    const { deps } = fake();
    const engine = new WaFlowEngine(deps);
    const f: Flow = {
      at: 'qty',
      cart: [],
      draft: { productId: 'p-bacon', qty: 1, optionIds: [], group: -1 },
    };
    expect((await engine.handle(f, 'menu')).flow?.at).toBe('home');
    const c = await engine.handle(
      {
        ...f,
        cart: [
          {
            productId: 'p-bacon',
            name: 'X-Bacon',
            qty: 1,
            unit: 2990,
            optionIds: [],
            optionNames: [],
          },
        ],
      },
      'cancelar',
    );
    expect(c.text).toContain('cancelei o pedido');
    expect(c.flow?.cart).toEqual([]);
  });
});

const LOYALTY: FlowLoyalty = {
  mode: 'points',
  balance: 120,
  pending: 30,
  expiresAt: null,
  level: 'Prata',
  nextLevel: { name: 'Ouro', missing: 80 },
  pin: '482913',
  rewards: [
    {
      id: 'r-batata',
      name: 'R$ 10 de desconto',
      cost: 100,
      kind: 'discount',
      amount: '10.00',
      productId: null,
    },
    {
      id: 'r-burger',
      name: 'Smash grátis',
      cost: 300,
      kind: 'product',
      amount: '36.90',
      productId: 'p-smash',
    },
  ],
};

const COCA: CartLine = {
  productId: 'p-coca',
  name: 'Coca-Cola lata',
  qty: 2,
  unit: 700,
  optionIds: [],
  optionNames: [],
};

describe('cliente pelo telefone ou pelo PIN (0.280)', () => {
  it('confirma o cadastro do número; não sendo, pede o PIN e conta as tentativas', async () => {
    const tries: string[] = [];
    let left = 3;
    const { deps } = fake({
      customer: async () => ({ id: 'c-dono', name: 'Carlos Dono' }),
      addresses: async () => [
        { savedId: 'a1', street: 'Rua do Carlos', number: '1', district: 'Centro' },
      ],
      byPin: async (pin) => {
        tries.push(pin);
        return pin === '482913'
          ? { ok: true, id: 'c-ana', name: 'Ana Souza' }
          : { ok: false, left: --left };
      },
    });
    const engine = new WaFlowEngine(deps);
    let r = await talk(engine, ['oi', '1']);
    expect(r.last).toContain('Este número está no cadastro de *Carlos Dono*');
    r = await talk(engine, ['2'], r.flow);
    expect(r.last).toContain('PIN de 6 números');
    expect(r.last).toContain('Continuar sem cadastro');
    r = await talk(engine, ['111111'], r.flow);
    expect(r.last).toContain('Esse PIN não confere');
    expect(r.last).toContain('mais 2 tentativas');
    r = await talk(engine, ['482 913'], r.flow);
    expect(tries).toEqual(['111111', '482913']);
    expect(r.flow).toMatchObject({ customerId: 'c-ana', name: 'Ana Souza', viaPin: true });
    expect(r.last).toContain('Achei a sua conta, *Ana*');
    // Pelo PIN, os endereços salvos da conta não aparecem (só para o dono do número).
    r = await talk(engine, ['1'], r.flow);
    expect(r.last).toContain('Mande o endereço de entrega');
    expect(r.last).not.toContain('Rua do Carlos');
  });

  it('sem tentativas sobrando, oferece seguir só com o nome', async () => {
    const { deps } = fake({ byPin: async () => ({ ok: false, left: 0 }) });
    const engine = new WaFlowEngine(deps);
    let r = await talk(engine, ['oi', '1']);
    expect(r.last).toContain('Já tenho cadastro');
    r = await talk(engine, ['2', '123456'], r.flow);
    expect(r.last).toContain('Muitas tentativas de PIN');
    r = await talk(engine, ['1', 'Bia'], r.flow);
    expect(r.flow).toMatchObject({ name: 'Bia', customerId: null });
  });
});

describe('pontos e recompensas no WhatsApp (0.280)', () => {
  it('"Meus pontos" mostra saldo, nível, PIN e o que já dá para trocar', async () => {
    const { deps } = fake({
      customer: async () => ({ id: 'c1', name: 'Maria Silva' }),
      loyaltyOn: true,
      loyalty: async () => LOYALTY,
    });
    const engine = new WaFlowEngine(deps);
    const home = await engine.handle(null, 'oi');
    expect(home.text).toContain('4️⃣ ⭐ Meus pontos e recompensas');
    let r = await talk(engine, ['4'], home.flow);
    expect(r.last).toContain('Este número está no cadastro de *Maria Silva*');
    r = await talk(engine, ['1'], r.flow);
    expect(r.last).toContain('Saldo: *120 pontos*');
    expect(r.last).toContain('Nível: *Prata*');
    expect(r.last).toContain('Faltam 80 pontos para o nível Ouro');
    expect(r.last).toContain('✅ R$ 10 de desconto');
    expect(r.last).toContain('🔒 Smash grátis');
    expect(r.last).toContain('faltam 180');
    expect(r.last).toContain('`482913`');
    expect(r.flow?.at).toBe('points');
  });

  it('no fechamento, usa a recompensa e o total já sai com o desconto', async () => {
    const { deps, placed } = fake({ loyaltyOn: true, loyalty: async () => LOYALTY });
    const engine = new WaFlowEngine(deps);
    const f: Flow = {
      at: 'cart',
      cart: [{ ...COCA, qty: 3 }],
      name: 'Ana',
      customerId: 'c1',
      mode: 'pickup',
    };
    let r = await talk(engine, ['2', '1'], f);
    expect(r.last).toContain('Confira seu pedido');
    expect(r.last).toContain('3️⃣ 🎁 Usar meus pontos');
    r = await talk(engine, ['3'], r.flow);
    expect(r.last).toContain('Qual recompensa você quer usar?');
    expect(r.last).not.toContain('Smash grátis'); // o saldo não paga
    r = await talk(engine, ['1'], r.flow);
    expect(r.last).toContain('🎁 R$ 10 de desconto: -R$ 10,00');
    expect(r.last).toContain('*Total: R$ 11,00*');
    r = await talk(engine, ['1'], r.flow);
    expect(placed[0]).toMatchObject({ rewardId: 'r-batata', customerId: 'c1' });
  });
});

describe('cardápio no WhatsApp (0.280)', () => {
  it('categoria vem com o cartão de fotos e a lista curta, um item por linha', async () => {
    const { deps } = fake();
    const engine = new WaFlowEngine(deps);
    const out = await engine.handle({ at: 'cats', cart: [], name: 'Ana', mode: 'pickup' }, '1');
    expect(out.image).toEqual({ kind: 'category', index: 0 });
    expect(out.text).toContain('🍔 *Lanches*');
    expect(out.text).toContain('`1` Smash duplo · *R$ 36,90*');
    expect(out.text).toContain('`2` X-Bacon · *R$ 29,90* 🆕');
    expect(out.text).toContain('~X-Tudo~');
    // Sem a descrição na lista (ela vem na foto do item).
    expect(out.text).not.toContain('Dois smash');
    const item = await engine.handle(out.flow, '2');
    expect(item.image).toEqual({ kind: 'item', productId: 'p-bacon' });
    expect(item.text).toContain('⭐ 4,6');
    expect(item.text).toContain('🆕 Novo');
    expect(item.text).toContain('Quantos você quer?');
  });

  it('números iguais do 1 ao 99 (sem misturar 1️⃣ com "11.")', () => {
    const many: FlowCategory = {
      name: 'Burgers',
      items: Array.from({ length: 12 }, (_, k) => ({
        id: `b${k}`,
        name: `Burger ${k + 1}`,
        description: 'muito texto que não aparece na lista',
        price: '30.00',
        soldOut: false,
        soldByWeight: false,
        groups: [],
      })),
    };
    const t = itemsText(many, true);
    expect(t).toContain('`1` Burger 1');
    expect(t).toContain('`12` Burger 12');
    expect(t).not.toContain('1️⃣');
    expect(t).not.toContain('muito texto');
  });

  it('emoji da categoria e do selo', () => {
    expect(catEmoji('Burgers')).toBe('🍔');
    expect(catEmoji('Porções')).toBe('🍟');
    expect(catEmoji('Milk-shakes')).toBe('🍨');
    expect(catEmoji('Bebidas')).toBe('🥤');
    expect(catEmoji('Coisas da casa')).toBe('🍽️');
    expect(badgeEmoji('Vegetariano')).toBe('🌱');
    expect(badgeEmoji('Picante')).toBe('🌶️');
    expect(badgeEmoji(null)).toBeNull();
  });

  it('loja fechada: dá para olhar o cardápio e a foto, sem perguntar a quantidade', async () => {
    const { deps } = fake({ store: async () => ({ ...STORE, open: false }) });
    const engine = new WaFlowEngine(deps);
    let r = await talk(engine, ['oi', '3']);
    expect(r.last).toContain('Escolha uma categoria');
    expect(r.last).not.toContain('Ou escreva o pedido');
    const out = await engine.handle(r.flow, '1');
    const item = await engine.handle(out.flow, '2');
    expect(item.text).toContain('Estamos fechados agora');
    expect(item.text).not.toContain('Quantos você quer?');
    expect(item.flow?.at).toBe('items');
  });
});

describe('cliente na mesa não pede pelo WhatsApp (0.280)', () => {
  it('com a comanda aberta numa mesa, o pedido fica para o QR Code ou o garçom', async () => {
    const { deps } = fake({ atTable: async () => '7' });
    const engine = new WaFlowEngine(deps);
    const out = await engine.handle({ at: 'home', cart: [] }, '1');
    expect(out.text).toContain('*Mesa 7*');
    expect(out.text).toContain('QR Code da mesa');
    expect(out.flow?.at).toBe('home');
    const text = await engine.handle({ at: 'home', cart: [] }, '2 x-bacon');
    expect(text.text).toContain('*Mesa 7*');
  });
});

describe('sacola do WhatsApp no cardápio (0.280)', () => {
  it('soma o que entrou, tira o que saiu e não mexe no que veio do cardápio', () => {
    const web = [
      {
        key: 'p-smash::',
        productId: 'p-smash',
        name: 'Smash duplo',
        imageUrl: '/api/v1/media/x',
        unit: '36.90',
        optionIds: [],
        optionNames: [],
        quantity: 1,
        notes: '',
      },
    ];
    const added = mirrorLines(web, [], [COCA]);
    expect(added.map((l) => [l.key, l.quantity])).toEqual([
      ['p-smash::', 1],
      ['p-coca::', 2],
    ]);
    expect(added[1]).toMatchObject({ unit: '7.00', notes: '' });
    // Mais uma coca pelo WhatsApp e depois o pedido feito (sacola do WhatsApp vazia).
    const more = mirrorLines(added, [COCA], [{ ...COCA, qty: 3 }]);
    expect(more.find((l) => l.key === 'p-coca::')?.quantity).toBe(3);
    const done = mirrorLines(more, [{ ...COCA, qty: 3 }], []);
    expect(done.map((l) => l.key)).toEqual(['p-smash::']);
  });

  it('a chave é a mesma do cardápio (produto, opções em ordem e observação)', () => {
    expect(webKey({ productId: 'p', optionIds: ['b', 'a'], notes: ' sem gelo ' })).toBe(
      'p:a,b:sem gelo',
    );
  });

  it('manda o link do cardápio uma vez, só para o dono do número', async () => {
    let links = 0;
    const { deps } = fake({
      siteLink: async () => {
        links++;
        return 'https://loja.test/pedir?entrar=abc';
      },
    });
    const engine = new WaFlowEngine(deps);
    const f: Flow = { at: 'cats', cart: [], name: 'Ana', customerId: 'c1', mode: 'pickup' };
    let r = await talk(engine, ['2 x-bacon'], f);
    expect(r.last).toContain('https://loja.test/pedir?entrar=abc');
    expect(r.flow?.linkSent).toBe(true);
    r = await talk(engine, ['1', '1', '1'], r.flow);
    r = await talk(engine, ['1', '1'], r.flow);
    expect(links).toBe(1);
    // Pelo PIN (outro número), nunca.
    const pin = await engine.handle({ ...f, viaPin: true }, '1 coca');
    expect(pin.text).not.toContain('entrar=');
    expect(links).toBe(1);
  });
});
