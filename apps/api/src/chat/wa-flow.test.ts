import { describe, expect, it } from 'vitest';
import { readOrderJson } from './ai-agent.service';
import { type FlowDeps, type FlowStore, WaFlowEngine } from './wa-flow-engine';
import {
  amount,
  choice,
  choices,
  type Flow,
  type FlowCategory,
  type FlowSettings,
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
    expect(r.last).toContain('Achei seu cadastro: *João*');
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
