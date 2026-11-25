/**
 * Lanchonete de demonstração do site (/demo): a Fumaça Burger & Co., a mesma loja de exemplo do
 * sistema (apps/api/src/demo/fumaca.ts), com os mesmos nomes, descrições, preços e fotos do
 * Unsplash (public/site/food, feitas por tools/site-images/build.py). Tudo roda no navegador: nada
 * aqui vai para o servidor nem vira pedido de verdade.
 */

export interface DemoOption {
  name: string;
  price: number;
  desc?: string;
}

export interface DemoGroup {
  key: string;
  name: string;
  min: number;
  max: number;
  options: DemoOption[];
}

export interface DemoItem {
  key: string;
  cat: string;
  name: string;
  desc: string;
  price: number;
  /** Foto em public/site/food/<img>.webp (e <img>-sm.webp, a pequena). */
  img: string;
  badge?: string;
  groups?: string[];
}

export const DEMO_STORE = {
  name: 'Fumaça Burger & Co.',
  headline: 'Burger na brasa, do jeito certo',
  place: 'Vila Mariana, São Paulo',
  eta: '35–50 min',
  fee: 6.9,
  minOrder: 30,
  logo: '/site/food/logo.webp',
  cover: '/site/food/capa.webp',
};

export const DEMO_CATEGORIES: { key: string; name: string }[] = [
  { key: 'combos', name: 'Combos' },
  { key: 'burgers', name: 'Burgers' },
  { key: 'porcoes', name: 'Porções' },
  { key: 'shakes', name: 'Milk-shakes' },
  { key: 'bebidas', name: 'Bebidas' },
  { key: 'sobremesas', name: 'Sobremesas' },
];

export const DEMO_GROUPS: Record<string, DemoGroup> = {
  ponto: {
    key: 'ponto',
    name: 'Ponto da carne',
    min: 1,
    max: 1,
    options: [
      { name: 'Mal passado', price: 0 },
      { name: 'Ao ponto', price: 0 },
      { name: 'Bem passado', price: 0 },
    ],
  },
  extras: {
    key: 'extras',
    name: 'Turbine seu burger',
    min: 0,
    max: 4,
    options: [
      { name: 'Bacon extra', price: 6, desc: 'Fatias crocantes defumadas na casa.' },
      { name: 'Cheddar extra', price: 5, desc: 'Mais uma fatia de cheddar inglês derretido.' },
      { name: 'Ovo', price: 4, desc: 'Ovo na chapa com a gema mole.' },
      { name: 'Carne extra (160 g)', price: 14, desc: 'Outro blend de 160 g na brasa.' },
      { name: 'Cebola caramelizada', price: 4, desc: 'Cozida devagar na manteiga até dourar.' },
    ],
  },
  molhos: {
    key: 'molhos',
    name: 'Molho extra',
    min: 0,
    max: 2,
    options: [
      { name: 'Maionese defumada', price: 3, desc: 'Pote de 40 g.' },
      { name: 'Barbecue da casa', price: 3, desc: 'Pote de 40 g.' },
      { name: 'Cheddar cremoso', price: 4, desc: 'Pote de 40 g, servido quente.' },
      { name: 'Mostarda e mel', price: 3, desc: 'Pote de 40 g.' },
    ],
  },
  tamanho: {
    key: 'tamanho',
    name: 'Tamanho',
    min: 1,
    max: 1,
    options: [
      { name: 'Média (250 g)', price: 0 },
      { name: 'Grande (400 g)', price: 10 },
    ],
  },
  'combo-bebida': {
    key: 'combo-bebida',
    name: 'Bebida do combo',
    min: 1,
    max: 1,
    options: [
      { name: 'Limonada da casa', price: 0, desc: 'Copo de 400 ml.' },
      { name: 'Água com gás', price: 0, desc: 'Garrafa de 500 ml.' },
      { name: 'Chopp pilsen', price: 4, desc: 'Caneca de 300 ml.' },
      { name: 'Milk-shake (troca)', price: 9, desc: 'Chocolate, 400 ml.' },
    ],
  },
};

export const DEMO_ITEMS: DemoItem[] = [
  {
    key: 'combo-fumaca',
    cat: 'combos',
    name: 'Combo Fumaça',
    desc: 'Fumaça (o da casa) + batata frita média + bebida à escolha.',
    price: 62.9,
    img: 'combo-fumaca',
    badge: 'Economize',
    groups: ['ponto', 'combo-bebida'],
  },
  {
    key: 'combo-classico',
    cat: 'combos',
    name: 'Combo Clássico',
    desc: 'Clássico + batata frita média + bebida à escolha.',
    price: 49.9,
    img: 'combo-classico',
    groups: ['ponto', 'combo-bebida'],
  },
  {
    key: 'combo-smash',
    cat: 'combos',
    name: 'Combo Smash',
    desc: 'Smash duplo + batata frita média + bebida à escolha.',
    price: 52.9,
    img: 'combo-smash',
    groups: ['combo-bebida'],
  },
  {
    key: 'fumaca',
    cat: 'burgers',
    name: 'Fumaça (o da casa)',
    desc: 'Blend de 160 g na brasa, cheddar inglês, bacon crocante, cebola crispy e barbecue defumado da casa no brioche.',
    price: 44.9,
    img: 'burger-fumaca',
    badge: 'Mais pedido',
    groups: ['ponto', 'extras', 'molhos'],
  },
  {
    key: 'smash',
    cat: 'burgers',
    name: 'Smash duplo',
    desc: 'Dois smash de 90 g bem tostados, cheddar derretido, picles e cebola na chapa.',
    price: 36.9,
    img: 'burger-smash',
    groups: ['extras', 'molhos'],
  },
  {
    key: 'classico',
    cat: 'burgers',
    name: 'Clássico',
    desc: 'Blend de 160 g, queijo prato, alface americana, tomate e maionese da casa no brioche.',
    price: 34.9,
    img: 'burger-classico',
    groups: ['ponto', 'extras', 'molhos'],
  },
  {
    key: 'egg-bacon',
    cat: 'burgers',
    name: 'Egg bacon',
    desc: 'Blend de 160 g, queijo prato, bacon, ovo com gema mole, cebola roxa e alface.',
    price: 41.9,
    img: 'burger-egg',
    groups: ['ponto', 'extras'],
  },
  {
    key: 'picanha',
    cat: 'burgers',
    name: 'Picanha trufado',
    desc: 'Blend de picanha de 180 g, muçarela de búfala, rúcula e maionese trufada no brioche.',
    price: 54.9,
    img: 'burger-picanha',
    badge: 'Premium',
    groups: ['ponto', 'extras'],
  },
  {
    key: 'crispy',
    cat: 'burgers',
    name: 'Chicken crispy',
    desc: 'Sobrecoxa empanada e crocante, queijo prato, alface e maionese de alho.',
    price: 38.9,
    img: 'burger-crispy',
    groups: ['extras', 'molhos'],
  },
  {
    key: 'veggie',
    cat: 'burgers',
    name: 'Veggie de grão-de-bico',
    desc: 'Hambúrguer de grão-de-bico e cogumelos feito na casa, queijo prato, brotos e tomate.',
    price: 36.9,
    img: 'burger-veggie',
    badge: 'Vegetariano',
    groups: ['extras', 'molhos'],
  },
  {
    key: 'cheeseburger',
    cat: 'burgers',
    name: 'Cheeseburger',
    desc: 'O básico bem feito: blend de 160 g e duas fatias de cheddar no brioche.',
    price: 29.9,
    img: 'burger-cheese',
    groups: ['ponto', 'extras'],
  },
  {
    key: 'triplo',
    cat: 'burgers',
    name: 'Monstro triplo',
    desc: 'Três blends de 160 g, três fatias de cheddar e bacon. Para quem chegou com fome.',
    price: 59.9,
    img: 'burger-triplo',
    badge: 'Desafio',
    groups: ['ponto', 'molhos'],
  },
  {
    key: 'batata',
    cat: 'porcoes',
    name: 'Batata frita',
    desc: 'Batata palito sequinha com sal e páprica defumada. Acompanha maionese da casa.',
    price: 22.9,
    img: 'porcao-batata',
    groups: ['tamanho'],
  },
  {
    key: 'batata-cheddar',
    cat: 'porcoes',
    name: 'Batata com cheddar e bacon',
    desc: 'Batata frita coberta com cheddar cremoso e farofa de bacon.',
    price: 34.9,
    img: 'porcao-cheddar-bacon',
  },
  {
    key: 'onion-rings',
    cat: 'porcoes',
    name: 'Onion rings',
    desc: 'Anéis de cebola empanados na cerveja, com barbecue para molhar.',
    price: 29.9,
    img: 'porcao-onion',
  },
  {
    key: 'iscas',
    cat: 'porcoes',
    name: 'Iscas de frango crocantes',
    desc: 'Tiras de frango empanadas com molho de mostarda e mel.',
    price: 36.9,
    img: 'porcao-iscas',
  },
  {
    key: 'shake-chocolate',
    cat: 'shakes',
    name: 'Milk-shake de chocolate',
    desc: 'Sorvete de creme batido com chocolate belga. 400 ml.',
    price: 22.9,
    img: 'shake-chocolate',
  },
  {
    key: 'shake-morango',
    cat: 'shakes',
    name: 'Milk-shake de morango',
    desc: 'Sorvete de creme batido com morangos frescos. 400 ml.',
    price: 22.9,
    img: 'shake-morango',
  },
  {
    key: 'shake-doce-leite',
    cat: 'shakes',
    name: 'Milk-shake de doce de leite',
    desc: 'Com doce de leite mineiro, chantilly e calda por cima. 400 ml.',
    price: 24.9,
    img: 'shake-doce-leite',
    badge: 'Novo',
  },
  {
    key: 'limonada',
    cat: 'bebidas',
    name: 'Limonada da casa',
    desc: 'Limão-taiti espremido na hora, com gelo e hortelã. 500 ml.',
    price: 11.9,
    img: 'bebida-limonada',
  },
  {
    key: 'limonada-suica',
    cat: 'bebidas',
    name: 'Limonada suíça',
    desc: 'Limão batido com casca e leite condensado. 500 ml.',
    price: 13.9,
    img: 'bebida-limonada-suica',
  },
  {
    key: 'chopp',
    cat: 'bebidas',
    name: 'Chopp pilsen (400 ml)',
    desc: 'Chopp artesanal da cervejaria parceira, tirado na hora.',
    price: 14.9,
    img: 'bebida-chopp',
  },
  {
    key: 'agua-gas',
    cat: 'bebidas',
    name: 'Água com gás e limão',
    desc: 'Garrafa de 500 ml servida com gelo e rodelas de limão.',
    price: 6.9,
    img: 'bebida-agua-gas',
  },
  {
    key: 'brownie-sorvete',
    cat: 'sobremesas',
    name: 'Brownie com sorvete',
    desc: 'Brownie quentinho, bola de sorvete de creme e calda de chocolate.',
    price: 26.9,
    img: 'sobremesa-brownie-sorvete',
  },
  {
    key: 'sundae',
    cat: 'sobremesas',
    name: 'Sundae de caramelo',
    desc: 'Sorvete de creme, calda de caramelo, chantilly, farofa crocante e cereja.',
    price: 21.9,
    img: 'sobremesa-sundae',
  },
  {
    key: 'sundae-morango',
    cat: 'sobremesas',
    name: 'Sundae de morango',
    desc: 'Sorvete de creme, morangos frescos, calda de frutas vermelhas e chantilly.',
    price: 23.9,
    img: 'sobremesa-sundae-morango',
  },
];

/** "Os queridinhos da casa": os destaques do topo da loja. */
export const DEMO_FEATURED = ['fumaca', 'combo-fumaca', 'smash', 'shake-doce-leite'];

/** Pedidos que já estão na cozinha quando a pessoa entra (para o painel não começar vazio). */
export const DEMO_KITCHEN: {
  n: string;
  ch: string;
  hue: string;
  items: string;
  stage: 'new' | 'cook' | 'ready';
  min: number;
}[] = [
  {
    n: '7421',
    ch: 'iFood',
    hue: 'rose',
    items: '2× Smash duplo, Batata frita',
    stage: 'cook',
    min: 6,
  },
  { n: '128', ch: 'Mesa 4', hue: 'blue', items: 'Combo Clássico, Limonada', stage: 'cook', min: 9 },
  { n: '130', ch: 'Balcão', hue: 'slate', items: 'Milk-shake de morango', stage: 'ready', min: 3 },
];

/**
 * Situação do pedido, na ordem: o cliente acompanha no celular e a cozinha muda no painel. Cada
 * passo tem o botão que a equipe aperta para ir ao próximo.
 */
export const DEMO_STAGES = [
  { key: 'new', label: 'Recebido', action: 'Aceitar', text: 'A loja recebeu o seu pedido.' },
  { key: 'cook', label: 'Em preparo', action: 'Pronto', text: 'Na chapa. Cheiro de fumaça no ar.' },
  { key: 'ready', label: 'Pronto', action: 'Despachar', text: 'Embalado, esperando o entregador.' },
  {
    key: 'route',
    label: 'Saiu para entrega',
    action: 'Entregue',
    text: 'O Anderson está a caminho.',
  },
  { key: 'done', label: 'Entregue', action: '', text: 'Bom apetite! Avalie o pedido depois.' },
] as const;

export type DemoStage = (typeof DEMO_STAGES)[number]['key'];
