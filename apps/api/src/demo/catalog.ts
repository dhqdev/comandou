/**
 * Conteúdo do restaurante de demonstração "Casa Brasa" (hambúrgueres e pizzas em Pinheiros, SP).
 * Só dados: a gravação fica em seed.ts. Imagens em db/demo/images (geradas por
 * tools/demo-images/generate.mjs).
 */

export const DEMO_NAME = 'Casa Brasa';
export const DEMO_PASSWORD = 'comandou123';
export const DEMO_CUSTOMER_PASSWORD = 'cliente123';

/** Rua dos Pinheiros, 870 (Pinheiros, São Paulo). */
export const STORE_LOCATION = { lat: -23.5654, lng: -46.683 };

export interface DemoUser {
  key: string;
  email: string;
  name: string;
  role:
    | 'owner'
    | 'manager'
    | 'cashier'
    | 'waiter'
    | 'kitchen'
    | 'driver'
    | 'attendant'
    | 'stock'
    | 'finance'
    | 'fiscal';
}

export const USERS: DemoUser[] = [
  { key: 'owner', email: 'dono', name: 'Ana Ribeiro', role: 'owner' },
  { key: 'manager', email: 'gerente', name: 'Carlos Mendes', role: 'manager' },
  { key: 'cashier', email: 'caixa', name: 'Juliana Costa', role: 'cashier' },
  { key: 'waiter', email: 'garcom', name: 'Pedro Alves', role: 'waiter' },
  { key: 'waiter2', email: 'garcom2', name: 'Larissa Souza', role: 'waiter' },
  { key: 'kitchen', email: 'cozinha', name: 'Roberto Lima', role: 'kitchen' },
  { key: 'driver', email: 'entregador', name: 'Lucas Ferreira', role: 'driver' },
  { key: 'driver2', email: 'entregador2', name: 'Bruna Martins', role: 'driver' },
  { key: 'attendant', email: 'atendente', name: 'Fernanda Rocha', role: 'attendant' },
  { key: 'stock', email: 'estoque', name: 'Diego Santos', role: 'stock' },
  { key: 'finance', email: 'financeiro', name: 'Patrícia Gomes', role: 'finance' },
  { key: 'fiscal', email: 'fiscal', name: 'Rodrigo Nunes', role: 'fiscal' },
];

export const SECTORS = [
  {
    key: 'chapa',
    name: 'Chapa',
    channels: ['counter', 'table', 'delivery', 'pickup'],
    warn: 12,
    late: 20,
  },
  {
    key: 'forno',
    name: 'Forno',
    channels: ['counter', 'table', 'delivery', 'pickup'],
    warn: 15,
    late: 25,
  },
  {
    key: 'bar',
    name: 'Bar',
    channels: ['counter', 'table', 'delivery', 'pickup'],
    warn: 5,
    late: 10,
  },
] as const;
export type SectorKey = (typeof SECTORS)[number]['key'];

export const CATEGORIES = [
  { key: 'combos', name: 'Combos', image: 'combo-brasa' },
  { key: 'burgers', name: 'Hambúrgueres', image: 'burger-cheddar-bacon' },
  { key: 'pizzas', name: 'Pizzas', image: 'pizza-pepperoni' },
  { key: 'porcoes', name: 'Porções', image: 'porcao-batata-cheddar' },
  { key: 'saladas', name: 'Saladas', image: 'salada-caesar' },
  { key: 'bebidas', name: 'Bebidas', image: 'bebida-suco-laranja' },
  { key: 'sobremesas', name: 'Sobremesas', image: 'sobremesa-brownie' },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]['key'];

/** Grupos de adicionais. Opções: [nome, acréscimo, insumo da ficha técnica?, quantidade]. */
export const OPTION_GROUPS: {
  key: string;
  name: string;
  min: number;
  max: number;
  options: [string, string, string?, number?][];
}[] = [
  {
    key: 'ponto',
    name: 'Ponto da carne',
    min: 1,
    max: 1,
    options: [
      ['Mal passado', '0'],
      ['Ao ponto', '0'],
      ['Bem passado', '0'],
    ],
  },
  {
    key: 'extras',
    name: 'Turbine seu lanche',
    min: 0,
    max: 4,
    options: [
      ['Bacon extra', '5.00', 'bacon', 0.04],
      ['Cheddar extra', '4.00', 'cheddar', 0.03],
      ['Ovo', '3.00', 'ovo', 1],
      ['Cebola caramelizada', '3.50', 'cebola', 0.05],
      ['Blend extra 160 g', '12.00', 'blend', 1],
    ],
  },
  {
    key: 'tamanho',
    name: 'Tamanho',
    min: 1,
    max: 1,
    options: [
      ['Média (6 fatias)', '0'],
      ['Grande (8 fatias)', '14.00', 'massa', 0.3],
    ],
  },
  {
    key: 'borda',
    name: 'Borda recheada',
    min: 0,
    max: 1,
    options: [
      ['Borda de catupiry', '9.00', 'catupiry', 0.08],
      ['Borda de cheddar', '9.00', 'cheddar', 0.08],
      ['Borda de chocolate', '11.00', 'chocolate', 0.08],
    ],
  },
  {
    key: 'molhos',
    name: 'Molhos extras',
    min: 0,
    max: 3,
    options: [
      ['Maionese da casa', '2.00'],
      ['Barbecue', '2.00'],
      ['Mostarda e mel', '2.50'],
    ],
  },
  {
    key: 'sabor',
    name: 'Sabor',
    min: 1,
    max: 1,
    options: [
      ['Cola', '0'],
      ['Cola zero', '0'],
      ['Guaraná', '0'],
      ['Laranja', '0'],
    ],
  },
  {
    key: 'agua',
    name: 'Tipo',
    min: 1,
    max: 1,
    options: [
      ['Sem gás', '0'],
      ['Com gás', '0.50'],
    ],
  },
  {
    key: 'acai',
    name: 'Complementos',
    min: 0,
    max: 4,
    options: [
      ['Banana', '0', 'banana', 0.1],
      ['Granola', '0', 'granola', 0.03],
      ['Leite condensado', '2.50'],
      ['Morango', '3.50', 'morango', 0.06],
    ],
  },
];

export interface DemoProduct {
  key: string;
  category: CategoryKey;
  sector: SectorKey;
  name: string;
  description: string;
  price: string;
  image: string;
  groups?: string[];
  featured?: boolean;
  badge?: string;
  soldOut?: boolean;
  /** Peso na escolha dos pedidos do histórico (mais pedidos = maior). */
  weight: number;
  /** Ficha técnica: insumo → quantidade por unidade vendida. */
  recipe?: Record<string, number>;
  ncm?: string;
}

const BURGER_BASE = { pao: 1, embalagem: 0.5 };

export const PRODUCTS: DemoProduct[] = [
  {
    key: 'combo-brasa',
    category: 'combos',
    sector: 'chapa',
    name: 'Combo Brasa',
    description: 'Brasa Clássico + batata frita média + refrigerante lata. O mais pedido da casa.',
    price: '49.90',
    image: 'combo-brasa',
    groups: ['ponto', 'sabor'],
    featured: true,
    badge: 'Economize',
    weight: 9,
    recipe: {
      ...BURGER_BASE,
      blend: 1,
      prato: 0.02,
      alface: 0.02,
      tomate: 0.04,
      batata: 0.2,
      oleo: 0.02,
      lata: 1,
    },
  },
  {
    key: 'combo-casal',
    category: 'combos',
    sector: 'chapa',
    name: 'Combo Casal',
    description: '2 hambúrgueres (Clássico e Cheddar Bacon) + batata grande + 2 refrigerantes.',
    price: '94.90',
    image: 'combo-casal',
    groups: ['ponto'],
    weight: 4,
    recipe: {
      pao: 2,
      blend: 2,
      prato: 0.02,
      cheddar: 0.03,
      bacon: 0.04,
      batata: 0.35,
      oleo: 0.03,
      lata: 2,
      embalagem: 1,
    },
  },
  {
    key: 'classico',
    category: 'burgers',
    sector: 'chapa',
    name: 'Brasa Clássico',
    description:
      'Blend bovino 160 g na brasa, queijo prato, alface, tomate e maionese da casa no pão brioche.',
    price: '32.90',
    image: 'burger-classico',
    groups: ['ponto', 'extras'],
    featured: true,
    badge: 'Mais pedido',
    weight: 12,
    recipe: { ...BURGER_BASE, blend: 1, prato: 0.02, alface: 0.02, tomate: 0.04 },
    ncm: '16025000',
  },
  {
    key: 'cheddar-bacon',
    category: 'burgers',
    sector: 'chapa',
    name: 'Cheddar Bacon',
    description: 'Blend 160 g, cheddar cremoso, bacon crocante e cebola caramelizada.',
    price: '38.90',
    image: 'burger-cheddar-bacon',
    groups: ['ponto', 'extras'],
    featured: true,
    badge: 'Favorito',
    weight: 10,
    recipe: { ...BURGER_BASE, blend: 1, cheddar: 0.03, bacon: 0.04, cebola: 0.04 },
    ncm: '16025000',
  },
  {
    key: 'duplo-smash',
    category: 'burgers',
    sector: 'chapa',
    name: 'Duplo Smash',
    description: 'Dois smash de 90 g, queijo americano em dobro, picles e molho especial.',
    price: '41.90',
    image: 'burger-duplo-smash',
    groups: ['extras'],
    badge: 'Novo',
    featured: true,
    weight: 7,
    recipe: { ...BURGER_BASE, blend: 1.2, prato: 0.04 },
    ncm: '16025000',
  },
  {
    key: 'salada',
    category: 'burgers',
    sector: 'chapa',
    name: 'Brasa Salada',
    description: 'Blend 160 g, queijo, cebola roxa, tomate e alface americana em dobro.',
    price: '34.90',
    image: 'burger-salada',
    groups: ['ponto', 'extras'],
    weight: 5,
    recipe: { ...BURGER_BASE, blend: 1, prato: 0.02, alface: 0.04, tomate: 0.05, cebola: 0.03 },
  },
  {
    key: 'chicken',
    category: 'burgers',
    sector: 'chapa',
    name: 'Chicken Crispy',
    description: 'Sobrecoxa empanada crocante, alface e maionese de ervas.',
    price: '33.90',
    image: 'burger-chicken',
    groups: ['extras'],
    weight: 5,
    recipe: { ...BURGER_BASE, frango: 0.16, alface: 0.02, oleo: 0.02 },
  },
  {
    key: 'veggie',
    category: 'burgers',
    sector: 'chapa',
    name: 'Veggie de Grão-de-Bico',
    description:
      'Hambúrguer de grão-de-bico e cogumelos, tomate, cebola roxa e alface. Sem ingredientes de origem animal.',
    price: '35.90',
    image: 'burger-veggie',
    badge: 'Vegano',
    weight: 3,
    recipe: { pao: 1, alface: 0.02, tomate: 0.04, cebola: 0.03, embalagem: 0.5 },
  },
  {
    key: 'kids',
    category: 'burgers',
    sector: 'chapa',
    name: 'Kids Burger',
    description: 'Mini hambúrguer 90 g com queijo + suco de caixinha. Para os pequenos.',
    price: '24.90',
    image: 'burger-kids',
    weight: 2,
    recipe: { pao: 1, blend: 0.6, prato: 0.02, embalagem: 0.5 },
  },
  {
    key: 'margherita',
    category: 'pizzas',
    sector: 'forno',
    name: 'Margherita',
    description: 'Molho de tomate italiano, muçarela, tomate e manjericão fresco.',
    price: '54.90',
    image: 'pizza-margherita',
    groups: ['tamanho', 'borda'],
    weight: 5,
    recipe: { massa: 1, molho: 0.15, mucarela: 0.25, tomate: 0.08, caixa: 1 },
  },
  {
    key: 'calabresa',
    category: 'pizzas',
    sector: 'forno',
    name: 'Calabresa',
    description: 'Calabresa artesanal fatiada, cebola, azeitonas e muçarela.',
    price: '52.90',
    image: 'pizza-calabresa',
    groups: ['tamanho', 'borda'],
    featured: true,
    weight: 7,
    recipe: { massa: 1, molho: 0.15, mucarela: 0.2, calabresa: 0.15, cebola: 0.05, caixa: 1 },
  },
  {
    key: 'portuguesa',
    category: 'pizzas',
    sector: 'forno',
    name: 'Portuguesa',
    description: 'Presunto, ovos, cebola, azeitonas e muçarela.',
    price: '58.90',
    image: 'pizza-portuguesa',
    groups: ['tamanho', 'borda'],
    weight: 4,
    recipe: {
      massa: 1,
      molho: 0.15,
      mucarela: 0.2,
      presunto: 0.12,
      ovo: 2,
      cebola: 0.04,
      caixa: 1,
    },
  },
  {
    key: 'quatro-queijos',
    category: 'pizzas',
    sector: 'forno',
    name: 'Quatro Queijos',
    description: 'Muçarela, gorgonzola, parmesão e catupiry.',
    price: '59.90',
    image: 'pizza-quatro-queijos',
    groups: ['tamanho', 'borda'],
    weight: 4,
    recipe: { massa: 1, molho: 0.12, mucarela: 0.2, catupiry: 0.08, caixa: 1 },
  },
  {
    key: 'frango-catupiry',
    category: 'pizzas',
    sector: 'forno',
    name: 'Frango com Catupiry',
    description: 'Frango desfiado temperado, catupiry original e milho.',
    price: '57.90',
    image: 'pizza-frango-catupiry',
    groups: ['tamanho', 'borda'],
    weight: 5,
    recipe: { massa: 1, molho: 0.12, mucarela: 0.15, frango: 0.15, catupiry: 0.1, caixa: 1 },
  },
  {
    key: 'pepperoni',
    category: 'pizzas',
    sector: 'forno',
    name: 'Pepperoni',
    description: 'Pepperoni levemente picante sobre muçarela e orégano.',
    price: '62.90',
    image: 'pizza-pepperoni',
    groups: ['tamanho', 'borda'],
    badge: 'Picante',
    featured: true,
    weight: 6,
    recipe: { massa: 1, molho: 0.15, mucarela: 0.22, calabresa: 0.1, caixa: 1 },
  },
  {
    key: 'chocolate-morango',
    category: 'pizzas',
    sector: 'forno',
    name: 'Chocolate com Morango',
    description: 'Pizza doce de chocolate ao leite com morangos frescos.',
    price: '56.90',
    image: 'pizza-chocolate-morango',
    groups: ['tamanho'],
    weight: 2,
    recipe: { massa: 1, chocolate: 0.2, morango: 0.15, caixa: 1 },
  },
  {
    key: 'batata',
    category: 'porcoes',
    sector: 'chapa',
    name: 'Batata Frita',
    description: 'Porção de 400 g, crocante por fora e macia por dentro, com sal e alecrim.',
    price: '24.90',
    image: 'porcao-batata',
    groups: ['molhos'],
    weight: 9,
    recipe: { batata: 0.4, oleo: 0.04, embalagem: 0.5 },
  },
  {
    key: 'batata-cheddar',
    category: 'porcoes',
    sector: 'chapa',
    name: 'Batata com Cheddar e Bacon',
    description: 'Batata frita coberta com cheddar cremoso e bacon em cubos.',
    price: '34.90',
    image: 'porcao-batata-cheddar',
    featured: true,
    weight: 7,
    recipe: { batata: 0.4, oleo: 0.04, cheddar: 0.08, bacon: 0.06, embalagem: 0.5 },
  },
  {
    key: 'aneis',
    category: 'porcoes',
    sector: 'chapa',
    name: 'Anéis de Cebola',
    description: 'Anéis de cebola empanados na cerveja com molho barbecue.',
    price: '27.90',
    image: 'porcao-aneis-cebola',
    groups: ['molhos'],
    weight: 4,
    recipe: { cebola: 0.25, oleo: 0.04, embalagem: 0.5 },
  },
  {
    key: 'isca',
    category: 'porcoes',
    sector: 'chapa',
    name: 'Isca de Frango',
    description: 'Tirinhas de frango empanadas com maionese de ervas.',
    price: '36.90',
    image: 'porcao-isca-frango',
    groups: ['molhos'],
    weight: 4,
    recipe: { frango: 0.35, oleo: 0.05, embalagem: 0.5 },
  },
  {
    key: 'mandioca',
    category: 'porcoes',
    sector: 'chapa',
    name: 'Mandioca Frita',
    description: 'Mandioca cozida e frita, com manteiga de garrafa.',
    price: '26.90',
    image: 'porcao-mandioca',
    weight: 2,
    recipe: { oleo: 0.04, embalagem: 0.5 },
  },
  {
    key: 'caesar',
    category: 'saladas',
    sector: 'chapa',
    name: 'Salada Caesar',
    description: 'Alface romana, tomate-cereja, croutons, parmesão e molho caesar.',
    price: '32.90',
    image: 'salada-caesar',
    weight: 2,
    recipe: { alface: 0.15, tomate: 0.06, embalagem: 0.5 },
  },
  {
    key: 'refri',
    category: 'bebidas',
    sector: 'bar',
    name: 'Refrigerante Lata 350 ml',
    description: 'Gelado, na lata.',
    price: '7.00',
    image: 'bebida-refrigerante',
    groups: ['sabor'],
    weight: 14,
    recipe: { lata: 1 },
    ncm: '22021000',
  },
  {
    key: 'suco',
    category: 'bebidas',
    sector: 'bar',
    name: 'Suco Natural de Laranja 500 ml',
    description: 'Espremido na hora, sem açúcar.',
    price: '12.90',
    image: 'bebida-suco-laranja',
    weight: 6,
    recipe: { laranja: 0.5 },
  },
  {
    key: 'limonada',
    category: 'bebidas',
    sector: 'bar',
    name: 'Limonada Suíça 500 ml',
    description: 'Limão batido com leite condensado e gelo.',
    price: '13.90',
    image: 'bebida-limonada',
    badge: 'Refrescante',
    weight: 5,
    recipe: { limao: 0.2 },
  },
  {
    key: 'cerveja',
    category: 'bebidas',
    sector: 'bar',
    name: 'Cerveja Long Neck 355 ml',
    description: 'Cerveja lager gelada. Venda proibida para menores de 18 anos.',
    price: '11.90',
    image: 'bebida-cerveja',
    weight: 7,
    recipe: { longneck: 1 },
    ncm: '22030000',
  },
  {
    key: 'agua',
    category: 'bebidas',
    sector: 'bar',
    name: 'Água Mineral 500 ml',
    description: 'Com ou sem gás.',
    price: '5.00',
    image: 'bebida-agua',
    groups: ['agua'],
    weight: 4,
    recipe: { agua: 1 },
  },
  {
    key: 'milkshake',
    category: 'bebidas',
    sector: 'bar',
    name: 'Milkshake de Chocolate 400 ml',
    description: 'Sorvete de baunilha batido com chocolate belga e chantilly.',
    price: '21.90',
    image: 'bebida-milkshake',
    weight: 4,
    recipe: { sorvete: 0.3, chocolate: 0.04 },
  },
  {
    key: 'caipirinha',
    category: 'bebidas',
    sector: 'bar',
    name: 'Caipirinha de Limão',
    description: 'Cachaça artesanal, limão-taiti e açúcar. Para maiores de 18 anos.',
    price: '22.90',
    image: 'bebida-caipirinha',
    weight: 3,
    recipe: { limao: 0.15 },
  },
  {
    key: 'brownie',
    category: 'sobremesas',
    sector: 'bar',
    name: 'Brownie com Sorvete',
    description: 'Brownie de chocolate meio amargo, quentinho, com uma bola de sorvete de creme.',
    price: '22.90',
    image: 'sobremesa-brownie',
    featured: true,
    weight: 4,
    recipe: { sorvete: 0.08, chocolate: 0.05 },
  },
  {
    key: 'petit-gateau',
    category: 'sobremesas',
    sector: 'bar',
    name: 'Petit Gâteau',
    description: 'Bolinho de chocolate com recheio cremoso e sorvete de creme.',
    price: '24.90',
    image: 'sobremesa-petit-gateau',
    soldOut: true,
    weight: 2,
    recipe: { sorvete: 0.08, chocolate: 0.06 },
  },
  {
    key: 'pudim',
    category: 'sobremesas',
    sector: 'bar',
    name: 'Pudim de Leite',
    description: 'Receita da vó, com calda de caramelo.',
    price: '14.90',
    image: 'sobremesa-pudim',
    weight: 3,
  },
  {
    key: 'acai',
    category: 'sobremesas',
    sector: 'bar',
    name: 'Açaí 500 ml',
    description: 'Açaí cremoso com até 4 complementos.',
    price: '23.90',
    image: 'sobremesa-acai',
    groups: ['acai'],
    badge: 'Novo',
    weight: 4,
    recipe: { acai: 0.5 },
  },
];

/** Insumos: [nome, unidade, mínimo, custo médio, estoque alvo após cada compra]. */
export const STOCK_ITEMS: Record<string, [string, 'un' | 'kg' | 'l', number, string, number]> = {
  pao: ['Pão brioche', 'un', 60, '1.80', 260],
  blend: ['Blend bovino 160 g', 'un', 60, '6.90', 260],
  prato: ['Queijo prato fatiado', 'kg', 2, '42.00', 7],
  cheddar: ['Cheddar cremoso', 'kg', 3, '38.00', 9],
  bacon: ['Bacon fatiado', 'kg', 3, '44.00', 9],
  alface: ['Alface americana', 'kg', 2, '9.00', 7],
  tomate: ['Tomate', 'kg', 3, '7.50', 12],
  cebola: ['Cebola', 'kg', 3, '5.20', 14],
  frango: ['Sobrecoxa de frango', 'kg', 5, '19.00', 22],
  ovo: ['Ovos', 'un', 30, '0.70', 150],
  batata: ['Batata pré-frita congelada', 'kg', 15, '14.50', 60],
  oleo: ['Óleo de soja', 'l', 6, '8.90', 30],
  massa: ['Massa de pizza (disco)', 'un', 20, '3.40', 90],
  molho: ['Molho de tomate italiano', 'l', 3, '12.00', 14],
  mucarela: ['Muçarela', 'kg', 6, '36.00', 24],
  calabresa: ['Calabresa artesanal', 'kg', 3, '29.00', 10],
  presunto: ['Presunto', 'kg', 2, '32.00', 6],
  catupiry: ['Catupiry', 'kg', 2, '48.00', 7],
  chocolate: ['Chocolate ao leite', 'kg', 2, '52.00', 6],
  morango: ['Morango', 'kg', 1, '24.00', 4],
  lata: ['Refrigerante lata', 'un', 48, '3.10', 240],
  longneck: ['Cerveja long neck', 'un', 48, '4.60', 192],
  agua: ['Água mineral 500 ml', 'un', 24, '1.20', 96],
  laranja: ['Laranja pera', 'kg', 10, '4.80', 40],
  limao: ['Limão-taiti', 'kg', 3, '6.50', 12],
  sorvete: ['Sorvete de creme', 'l', 4, '18.00', 16],
  acai: ['Polpa de açaí', 'l', 5, '22.00', 20],
  banana: ['Banana', 'kg', 2, '5.90', 8],
  granola: ['Granola', 'kg', 1, '26.00', 4],
  embalagem: ['Embalagem kraft delivery', 'un', 80, '0.95', 400],
  caixa: ['Caixa de pizza', 'un', 40, '1.60', 160],
};

/** Insumos que ficam abaixo do mínimo no fim (para o alerta aparecer). */
export const LOW_STOCK = ['bacon', 'morango', 'catupiry'];

export const TABLES: { label: string; seats: number; area: string }[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    label: String(i + 1),
    seats: i % 3 === 0 ? 2 : 4,
    area: 'Salão',
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    label: String(i + 9),
    seats: i === 3 ? 8 : 4,
    area: 'Varanda',
  })),
  ...Array.from({ length: 2 }, (_, i) => ({ label: String(i + 13), seats: 6, area: 'Mezanino' })),
];

export const COURIERS = [
  { key: 'lucas', name: 'Lucas Ferreira', phone: '11987650101', user: 'driver' },
  { key: 'bruna', name: 'Bruna Martins', phone: '11987650202', user: 'driver2' },
  { key: 'marcos', name: 'Marcos Pereira (freelancer)', phone: '11987650303', user: null },
] as const;

/** Clientes do cardápio online com o endereço principal (coordenadas dentro das áreas). */
export const CUSTOMERS: {
  name: string;
  phone: string;
  street: string;
  number: string;
  district: string;
  lat: number;
  lng: number;
  notes?: string;
}[] = [
  {
    name: 'Mariana Oliveira',
    phone: '11988880000',
    street: 'Rua Cardeal Arcoverde',
    number: '1200',
    district: 'Pinheiros',
    lat: -23.5631,
    lng: -46.6857,
    notes: 'Cliente da demonstração: senha cliente123',
  },
  {
    name: 'Rafael Santos',
    phone: '11991230001',
    street: 'Rua Fradique Coutinho',
    number: '450',
    district: 'Pinheiros',
    lat: -23.5598,
    lng: -46.6884,
  },
  {
    name: 'Beatriz Lima',
    phone: '11991230002',
    street: 'Rua Harmonia',
    number: '88',
    district: 'Vila Madalena',
    lat: -23.5548,
    lng: -46.6902,
  },
  {
    name: 'Gustavo Pereira',
    phone: '11991230003',
    street: 'Rua Mourato Coelho',
    number: '930',
    district: 'Pinheiros',
    lat: -23.5607,
    lng: -46.6873,
  },
  {
    name: 'Camila Rodrigues',
    phone: '11991230004',
    street: 'Rua Teodoro Sampaio',
    number: '1510',
    district: 'Pinheiros',
    lat: -23.5632,
    lng: -46.6812,
  },
  {
    name: 'Thiago Almeida',
    phone: '11991230005',
    street: 'Rua Aspicuelta',
    number: '300',
    district: 'Vila Madalena',
    lat: -23.5552,
    lng: -46.6886,
    notes: 'Prefere sem cebola',
  },
  {
    name: 'Larissa Carvalho',
    phone: '11991230006',
    street: 'Rua Artur de Azevedo',
    number: '700',
    district: 'Pinheiros',
    lat: -23.5627,
    lng: -46.6766,
  },
  {
    name: 'Bruno Ribeiro',
    phone: '11991230007',
    street: 'Avenida Rebouças',
    number: '2400',
    district: 'Pinheiros',
    lat: -23.5664,
    lng: -46.6766,
  },
  {
    name: 'Juliana Martins',
    phone: '11991230008',
    street: 'Rua Wisard',
    number: '120',
    district: 'Vila Madalena',
    lat: -23.5561,
    lng: -46.6927,
  },
  {
    name: 'Felipe Costa',
    phone: '11991230009',
    street: 'Rua Simão Álvares',
    number: '600',
    district: 'Pinheiros',
    lat: -23.5612,
    lng: -46.6845,
  },
  {
    name: 'Aline Souza',
    phone: '11991230010',
    street: 'Rua Oscar Freire',
    number: '2100',
    district: 'Pinheiros',
    lat: -23.5577,
    lng: -46.6748,
  },
  {
    name: 'Diego Fernandes',
    phone: '11991230011',
    street: 'Rua Capote Valente',
    number: '400',
    district: 'Pinheiros',
    lat: -23.5585,
    lng: -46.6799,
  },
  {
    name: 'Patrícia Gomes',
    phone: '11991230012',
    street: 'Rua Fidalga',
    number: '550',
    district: 'Vila Madalena',
    lat: -23.5569,
    lng: -46.6913,
  },
  {
    name: 'Leonardo Araújo',
    phone: '11991230013',
    street: 'Rua Butantã',
    number: '480',
    district: 'Pinheiros',
    lat: -23.5672,
    lng: -46.6928,
  },
  {
    name: 'Vanessa Rocha',
    phone: '11991230014',
    street: 'Avenida Pedroso de Morais',
    number: '1400',
    district: 'Alto de Pinheiros',
    lat: -23.5531,
    lng: -46.7002,
  },
  {
    name: 'André Barbosa',
    phone: '11991230015',
    street: 'Rua Natingui',
    number: '800',
    district: 'Vila Madalena',
    lat: -23.5502,
    lng: -46.6969,
  },
  {
    name: 'Natália Dias',
    phone: '11991230016',
    street: 'Rua Augusta',
    number: '2600',
    district: 'Jardins',
    lat: -23.5617,
    lng: -46.6668,
  },
  {
    name: 'Ricardo Teixeira',
    phone: '11991230017',
    street: 'Rua Heitor Penteado',
    number: '1700',
    district: 'Sumarezinho',
    lat: -23.5464,
    lng: -46.6886,
  },
  {
    name: 'Fernanda Moreira',
    phone: '11991230018',
    street: 'Rua Alvarenga',
    number: '1300',
    district: 'Butantã',
    lat: -23.5716,
    lng: -46.7084,
  },
  {
    name: 'Eduardo Nunes',
    phone: '11991230019',
    street: 'Rua Haddock Lobo',
    number: '1100',
    district: 'Cerqueira César',
    lat: -23.5627,
    lng: -46.6633,
  },
  {
    name: 'Carolina Pinto',
    phone: '11991230020',
    street: 'Avenida Brigadeiro Faria Lima',
    number: '1900',
    district: 'Jardim Paulistano',
    lat: -23.5741,
    lng: -46.6895,
  },
  {
    name: 'Marcelo Freitas',
    phone: '11991230021',
    street: 'Rua Girassol',
    number: '320',
    district: 'Vila Madalena',
    lat: -23.5577,
    lng: -46.6931,
  },
  {
    name: 'Isabela Cardoso',
    phone: '11991230022',
    street: 'Avenida Sumaré',
    number: '900',
    district: 'Perdizes',
    lat: -23.5398,
    lng: -46.6795,
  },
  {
    name: 'Vinícius Lopes',
    phone: '11991230023',
    street: 'Rua Pais Leme',
    number: '200',
    district: 'Pinheiros',
    lat: -23.5672,
    lng: -46.6955,
  },
];

/** Nomes usados nos pedidos de balcão, retirada e comandas avulsas. */
export const WALK_IN = [
  'João',
  'Maria',
  'Paulo',
  'Renata',
  'Sérgio',
  'Tatiane',
  'Fábio',
  'Lívia',
  'Henrique',
  'Sabrina',
  'Otávio',
  'Priscila',
  'Caio',
  'Daniela',
  'Murilo',
  'Elaine',
  'Igor',
  'Gabriela',
  'Rodrigo',
  'Bianca',
];

export const ITEM_NOTES = [
  'Sem cebola',
  'Sem tomate',
  'Bem caprichado',
  'Molho à parte',
  'Cortar ao meio',
  'Sem gelo',
];

/** Áreas de entrega. Raio em metros; polígono como [lat, lng]. */
export const ZONES = [
  {
    name: 'Pinheiros e Vila Madalena',
    color: '#16a34a',
    kind: 'radius' as const,
    radius: 2200,
    fee: '5.00',
    min: '25.00',
    eta: [25, 40],
  },
  {
    name: 'Jardins, Butantã e Perdizes',
    color: '#ea8a0b',
    kind: 'polygon' as const,
    polygon: [
      [-23.5355, -46.69],
      [-23.542, -46.665],
      [-23.558, -46.656],
      [-23.576, -46.664],
      [-23.583, -46.69],
      [-23.576, -46.716],
      [-23.556, -46.72],
      [-23.542, -46.708],
    ] as [number, number][],
    fee: '8.00',
    min: '40.00',
    eta: [35, 55],
  },
  {
    name: 'Até 7 km',
    color: '#dc2626',
    kind: 'radius' as const,
    radius: 7000,
    fee: '13.00',
    min: '60.00',
    eta: [45, 70],
  },
];

export const BANNERS = [
  {
    title: 'Terça do burger em dobro',
    subtitle: 'Na compra de um Cheddar Bacon, o segundo sai pela metade do preço.',
    tag: 'Só às terças',
    cta: 'Quero o meu',
    image: 'banner-burger-dobro',
    product: 'cheddar-bacon',
  },
  {
    title: 'Pizza grande + refri',
    subtitle: 'Qualquer pizza grande com refrigerante lata de presente.',
    tag: 'Promoção',
    cta: 'Ver pizzas',
    image: 'banner-pizza-refri',
    category: 'pizzas',
  },
  {
    title: 'Sobremesa vale a pena',
    subtitle: 'Açaí, milkshake e brownie para fechar com chave de ouro.',
    tag: 'Novidade',
    cta: 'Ver doces',
    image: 'banner-sobremesa',
    category: 'sobremesas',
  },
] as const;

/** Contas a pagar/receber recorrentes por mês: [descrição, categoria, fornecedor, valor, dia do vencimento]. */
export const MONTHLY_BILLS: [string, string, string, string, number][] = [
  ['Aluguel do salão', 'Aluguel', 'Imobiliária Pinheiros', '9800.00', 5],
  ['Energia elétrica', 'Contas de consumo', 'Concessionária de energia', '2340.55', 12],
  ['Água e esgoto', 'Contas de consumo', 'Companhia de saneamento', '612.30', 15],
  ['Internet e telefone', 'Contas de consumo', 'Provedor de fibra', '219.90', 10],
  ['Folha de pagamento', 'Pessoal', 'Equipe Casa Brasa', '28450.00', 5],
  ['Contador', 'Serviços', 'Escritório contábil', '850.00', 20],
  ['Gás GLP', 'Insumos', 'Distribuidora de gás', '1280.00', 18],
];

/** Compras semanais de fornecedores (contas a pagar), em semanas alternadas. */
export const SUPPLIERS: [string, string, string][] = [
  ['Carnes e frios', 'Fornecedores', 'Frigorífico Boi Bom'],
  ['Hortifrúti da semana', 'Fornecedores', 'Hortifrúti Ceagesp'],
  ['Bebidas', 'Fornecedores', 'Distribuidora de Bebidas SP'],
  ['Embalagens', 'Fornecedores', 'Embalagens Kraft & Cia'],
];
