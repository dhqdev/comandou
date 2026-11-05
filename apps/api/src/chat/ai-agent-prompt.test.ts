import { describe, expect, it } from 'vitest';
import {
  AGENT_DEFAULTS,
  AgentMenuCategory,
  AgentStore,
  customerPrompt,
  HANDOFF_TAG,
  hoursText,
  menuText,
  parseReply,
} from './ai-agent-prompt';
import { typingMs } from './ai-agent.service';

const menu: AgentMenuCategory[] = [
  {
    name: 'Lanches',
    products: [
      {
        name: 'X-Burger',
        description: 'Pão, carne 150 g e queijo',
        price: '25.90',
        soldOut: false,
        optionGroups: [
          {
            name: 'Adicionais',
            minSelect: 0,
            maxSelect: 3,
            options: [
              { name: 'Bacon', priceDelta: '4.00' },
              { name: 'Cebola', priceDelta: '0.00' },
            ],
          },
        ],
      },
      { name: 'X-Salada', description: null, price: '22.00', soldOut: true, optionGroups: [] },
    ],
  },
];

const store: AgentStore = {
  storeUrl: 'https://casa.comandou.com/pedir',
  openNow: true,
  acceptsDelivery: true,
  acceptsPickup: false,
  deliveryFee: '5.00',
  minOrder: '0.00',
  etaMin: 30,
  etaMax: 50,
  address: 'Rua A, 10',
  hours: null,
};

const base = {
  settings: AGENT_DEFAULTS,
  fallbackName: 'Comandinho',
  tenantName: 'Casa do Lanche',
  menu,
  store,
  now: new Date('2026-11-03T15:00:00Z'),
};

describe('menuText', () => {
  it('lista itens, preços, esgotados e complementos', () => {
    const t = menuText(menu, true);
    expect(t).toContain('## Lanches');
    expect(t).toContain('X-Burger — R$ 25,90');
    expect(t).toContain('X-Salada — R$ 22,00 (ESGOTADO hoje)');
    expect(t).toContain('Adicionais (até 3): Bacon (+R$ 4,00), Cebola');
  });

  it('sem preços quando o gerente desliga', () => {
    const t = menuText(menu, false);
    expect(t).not.toContain('R$');
    expect(t).toContain('- X-Burger: Pão');
  });
});

describe('customerPrompt', () => {
  it('usa o nome padrão, o link da loja e o cardápio liberado', () => {
    const p = customerPrompt(base);
    expect(p).toContain('Você é Comandinho');
    expect(p).toContain('"Casa do Lanche"');
    expect(p).toContain('https://casa.comandou.com/pedir');
    expect(p).toContain('X-Burger');
    expect(p).toContain('ABERTA agora');
    expect(p).toContain('Atende por: entrega.');
    expect(p).toContain(HANDOFF_TAG);
  });

  it('aplica o que o gerente configurou', () => {
    const p = customerPrompt({
      ...base,
      settings: {
        ...AGENT_DEFAULTS,
        agentName: 'Lu',
        tone: 'formal',
        greeting: 'Olá! Bem-vindo à Casa do Lanche.',
        about: 'Estacionamento grátis.',
        rules: 'Não falar de concorrentes.',
        handoffMessage: 'Já chamo o gerente.',
        sendStoreLink: false,
        suggestItems: false,
        showPrices: false,
      },
    });
    expect(p).toContain('Você é Lu');
    expect(p).toContain('senhor');
    expect(p).toContain('Olá! Bem-vindo à Casa do Lanche.');
    expect(p).toContain('Estacionamento grátis.');
    expect(p).toContain('Não falar de concorrentes.');
    expect(p).toContain('"Já chamo o gerente."');
    expect(p).not.toContain('https://casa.comandou.com/pedir');
    expect(p).not.toContain('Sugerir itens');
    expect(p).not.toContain('R$ 25,90');
  });

  it('avisa quando nenhum item está liberado', () => {
    const p = customerPrompt({ ...base, menu: [] });
    expect(p).toContain('nenhum item liberado');
  });
});

describe('parseReply', () => {
  it('tira a marca de atendente', () => {
    expect(parseReply(`Já chamo alguém. ${HANDOFF_TAG}`)).toEqual({
      text: 'Já chamo alguém.',
      handoff: true,
    });
    expect(parseReply('Temos sim!')).toEqual({ text: 'Temos sim!', handoff: false });
  });
});

describe('hoursText e typingMs', () => {
  it('formata o horário por dia', () => {
    expect(
      hoursText([
        { day: 2, open: '18:00', close: '23:00' },
        { day: 1, open: '18:00', close: '23:00' },
      ]),
    ).toBe('seg 18:00–23:00; ter 18:00–23:00');
    expect(hoursText([])).toBeNull();
  });

  it('digitando entre 1,2 s e 6 s', () => {
    expect(typingMs('oi')).toBe(1200);
    expect(typingMs('x'.repeat(1000))).toBe(6000);
  });
});

describe('venda por peso', () => {
  const kilo: AgentMenuCategory[] = [
    {
      name: 'Sorvetes',
      products: [
        {
          name: 'Sorvete self-service',
          description: null,
          price: '69.90',
          soldOut: false,
          soldByWeight: true,
          optionGroups: [],
        },
      ],
    },
  ];

  it('mostra o preço do kg e ensina a conta', () => {
    expect(menuText(kilo, true)).toContain('Sorvete self-service — R$ 69,90 o kg (POR PESO)');
    const p = customerPrompt({ ...base, menu: kilo });
    expect(p).toContain('vendidos no quilo');
    expect(p).toContain('o valor certo é o da balança');
  });

  it('sem preço liberado, marca o item mas não faz conta', () => {
    expect(menuText(kilo, false)).toContain('Sorvete self-service (POR PESO)');
    const p = customerPrompt({
      ...base,
      menu: kilo,
      settings: { ...AGENT_DEFAULTS, showPrices: false },
    });
    expect(p).toContain('vendidos no quilo');
    expect(p).not.toContain('faça a conta');
  });

  it('cardápio sem item por peso não ganha a regra', () => {
    expect(customerPrompt(base)).not.toContain('POR PESO');
  });
});
