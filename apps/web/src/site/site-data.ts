/** Textos do site público (comandou.com). Tudo aqui descreve o que o sistema já faz hoje. */

export interface TourTab {
  key: string;
  label: string;
  title: string;
  text: string;
}

/** Telas de verdade do sistema (public/site/<key>-light|dark.webp), tiradas da demonstração. */
export const TOUR: TourTab[] = [
  {
    key: 'pdv',
    label: 'PDV',
    title: 'O balcão inteiro numa tela',
    text: 'Mesas em cima, pedidos andando por coluna embaixo. Pedido do cardápio online cai aqui na hora.',
  },
  {
    key: 'mesas',
    label: 'Salão',
    title: 'O mapa do seu salão',
    text: 'Mesas por área, comandas, QR Code em cada mesa e o garçom lançando pelo celular.',
  },
  {
    key: 'cozinha',
    label: 'Cozinha',
    title: 'A fila da cozinha, sem papel',
    text: 'A fazer, preparando e pronto, por setor, com o tempo de cada pedido e aviso de cancelamento.',
  },
  {
    key: 'caixa',
    label: 'Caixa',
    title: 'Caixa que fecha batendo',
    text: 'Abertura por terminal, sangria, suprimento e fechamento conferido por forma de pagamento.',
  },
  {
    key: 'cardapio',
    label: 'Cardápio',
    title: 'Um cardápio só, em todo lugar',
    text: 'Categorias, complementos, fotos e preço. Mudou aqui, mudou no PDV, no garçom e na loja online.',
  },
  {
    key: 'entregas',
    label: 'Entregas',
    title: 'Delivery com rastreio',
    text: 'Pedidos prontos para sair, entregadores no mapa e o cliente acompanhando pelo link.',
  },
  {
    key: 'estoque',
    label: 'Estoque',
    title: 'Estoque que avisa antes de faltar',
    text: 'Insumos, ficha técnica, custo médio e quantos dias cada item ainda dura.',
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    title: 'O mês inteiro numa página',
    text: 'Contas a pagar e a receber, resumo do mês e o que entrou por forma de pagamento.',
  },
  {
    key: 'relatorios',
    label: 'Relatórios',
    title: 'Números que respondem perguntas',
    text: 'Vendas, perdas, itens mais pedidos, equipe e delivery, do dia ou do ano.',
  },
];

export const STEPS: { title: string; text: string }[] = [
  { title: 'Cole o link', text: 'Do site, do Google Maps ou a lista do que você vende.' },
  { title: 'Ganhe o seu site', text: 'Cardápio online, PDV, cozinha e caixa prontos.' },
  { title: 'Venda', text: 'Confira, ajuste as cores e receba o primeiro pedido.' },
];

/** Os módulos do sistema (grade "Tudo o que o restaurante usa"). O ícone fica em SiteApp.tsx. */
export interface Module {
  key: string;
  title: string;
  text: string;
}
export const MODULES: Module[] = [
  { key: 'pdv', title: 'PDV', text: 'Balcão, mesa, retirada e delivery numa tela, com atalhos.' },
  {
    key: 'salao',
    title: 'Salão e garçom',
    text: 'Mapa das mesas, comandas e o garçom lançando pelo celular.',
  },
  {
    key: 'mesa',
    title: 'Mesa pelo QR Code',
    text: 'O cliente pede, chama o garçom e paga a conta pelo Pix.',
  },
  {
    key: 'cozinha',
    title: 'Cozinha sem papel',
    text: 'Fila por setor, tempo de cada pedido e aviso de atraso.',
  },
  {
    key: 'caixa',
    title: 'Caixa',
    text: 'Abertura, sangria, troco e fechamento que bate com a gaveta.',
  },
  {
    key: 'loja',
    title: 'Cardápio online',
    text: 'Loja própria com a sua marca, conta do cliente e fidelidade.',
  },
  {
    key: 'entregas',
    title: 'Entregas',
    text: 'Áreas no mapa, app do entregador, rastreio e acerto.',
  },
  {
    key: 'apps',
    title: 'iFood e outros apps',
    text: 'Pedidos dos aplicativos na mesma fila da cozinha.',
  },
  {
    key: 'estoque',
    title: 'Estoque e ficha técnica',
    text: 'Custo médio, baixa na venda e quantos dias cada item dura.',
  },
  {
    key: 'financeiro',
    title: 'Financeiro',
    text: 'Contas, conciliação bancária, DRE e o repasse das maquininhas.',
  },
  { key: 'fiscal', title: 'Nota fiscal', text: 'NFC-e direto do caixa, sem outro programa.' },
  {
    key: 'whatsapp',
    title: 'WhatsApp com IA',
    text: 'Responde, mostra o cardápio e faz reservas sozinho.',
  },
  {
    key: 'reservas',
    title: 'Reservas',
    text: 'Calendário de dia, semana e mês, com arrastar para remarcar.',
  },
  {
    key: 'equipe',
    title: 'Equipe e pagamentos',
    text: 'Acesso por função, dias trabalhados, comissão e salário.',
  },
  {
    key: 'impressao',
    title: 'Impressão',
    text: 'App para Windows que acha a impressora sozinho, até sem driver.',
  },
  {
    key: 'relatorios',
    title: 'Relatórios',
    text: 'Vendas, perdas, cardápio e equipe, com exportação para Excel.',
  },
];

/** Pratos da demonstração com modelo 3D de verdade (public/site/3d/<key>.glb). */
export const DISHES: { key: string; name: string; price: string }[] = [
  { key: 'fumaca', name: 'Fumaça (o da casa)', price: '44,90' },
  { key: 'batata', name: 'Batata frita', price: '22,90' },
  { key: 'shake-chocolate', name: 'Milk-shake', price: '22,90' },
  { key: 'brownie-sorvete', name: 'Brownie', price: '26,90' },
];

export const SITE_FAQ: { q: string; a: string }[] = [
  {
    q: 'O que acontece depois dos dias de teste?',
    a: 'Fechou com a gente, tudo continua no ar. Não fechou, o restaurante sai do ar sozinho e nada é cobrado.',
  },
  {
    q: 'Preciso de cartão para testar?',
    a: 'Não. Só o nome do restaurante, o seu nome e um e-mail.',
  },
  {
    q: 'Como o meu cardápio entra?',
    a: 'Pelo link do seu site, pelo PDF ou por fotos. A inteligência artificial lê tudo e você confere antes de publicar.',
  },
  {
    q: 'E se a internet cair?',
    a: 'O caixa continua vendendo e tudo sobe sozinho quando a conexão volta.',
  },
  {
    q: 'Recebe os pedidos do iFood e dos outros aplicativos?',
    a: 'Sim. Você liga a loja do iFood, 99Food, Keeta, Rappi ou aiqfome e os pedidos entram direto na cozinha do Comandou. Outros aplicativos que usam o padrão Open Delivery também funcionam.',
  },
  {
    q: 'Emite nota fiscal?',
    a: 'Sim, NFC-e direto do caixa. A emissão das notas é cobrada à parte.',
  },
];

/** Aplicativos de delivery ligados ao Comandou (seção Aplicativos do site). */
export const DELIVERY_APPS = ['iFood', '99Food', 'Keeta', 'Rappi', 'aiqfome', 'Open Delivery'];

/** O que dá para fazer com os pedidos dos aplicativos sem abrir o portal de cada um. */
export const APP_FEATURES: { title: string; text: string }[] = [
  { title: 'Uma fila só', text: 'Salão, balcão, cardápio online e aplicativos na mesma cozinha.' },
  {
    title: 'Aceite, pronto e cancelamento',
    text: 'Você responde ao aplicativo daqui, com o motivo que ele pede.',
  },
  { title: 'Entregador na tela', text: 'Quem vai buscar e quando chega, sem abrir o portal.' },
  {
    title: 'Loja e cardápio em dia',
    text: 'Fechou a loja no Comandou, pausa nos aplicativos. Acabou no estoque, sai do iFood.',
  },
  {
    title: 'Repasse conferido',
    text: 'O que o aplicativo paga e a taxa que fica entram no financeiro.',
  },
];

/** Tom suave de cada canal (tokens `--cm-tint-*`): só a bolinha e um fundo bem fraco. */
export type Hue = 'rose' | 'amber' | 'green' | 'violet' | 'blue' | 'teal' | 'slate';
export const APP_HUE: Record<string, Hue> = {
  iFood: 'rose',
  '99Food': 'amber',
  Keeta: 'green',
  Rappi: 'violet',
  aiqfome: 'blue',
  'Open Delivery': 'slate',
};

/** A fila de exemplo da seção Aplicativos. */
export const APP_ORDERS: {
  app: string;
  n: string;
  who: string;
  items: string;
  total: string;
  status: string;
  time: string;
  tone: 'new' | 'cook' | 'ready';
}[] = [
  {
    app: 'iFood',
    n: '7421',
    who: 'Isadora Q.',
    items: '2× Smash duplo, Batata',
    total: '71,80',
    status: 'Novo',
    time: 'agora',
    tone: 'new',
  },
  {
    app: '99Food',
    n: '3108',
    who: 'Bruno M.',
    items: 'Fumaça (o da casa)',
    total: '38,90',
    status: 'Novo',
    time: '1 min',
    tone: 'new',
  },
  {
    app: 'Keeta',
    n: '5530',
    who: 'Lívia S.',
    items: 'Combo Fumaça, Limonada',
    total: '54,90',
    status: 'Preparando',
    time: '6 min',
    tone: 'cook',
  },
  {
    app: 'Rappi',
    n: '9914',
    who: 'Caio R.',
    items: '3× Smash duplo',
    total: '98,70',
    status: 'Preparando',
    time: '9 min',
    tone: 'cook',
  },
  {
    app: 'aiqfome',
    n: '2276',
    who: 'Elisa F.',
    items: 'Batata frita',
    total: '18,00',
    status: 'Pronto',
    time: '14 min',
    tone: 'ready',
  },
];

/**
 * Pedidos que chegam no quadro do topo do site, um de cada canal, em roda: mesa, balcão,
 * cardápio online e aplicativos caindo no mesmo lugar.
 */
export const HERO_ORDERS: { ch: string; hue: Hue; n: string; items: string; total: number }[] = [
  { ch: 'iFood', hue: 'rose', n: '7421', items: '2× Smash duplo, Batata', total: 71.8 },
  { ch: 'Mesa 4', hue: 'blue', n: '128', items: 'Combo Clássico, Limonada', total: 54.9 },
  { ch: 'Cardápio online', hue: 'teal', n: '129', items: 'Fumaça (o da casa)', total: 38.9 },
  { ch: '99Food', hue: 'amber', n: '3108', items: '3× Smash duplo', total: 98.7 },
  { ch: 'Balcão', hue: 'slate', n: '130', items: 'Batata frita, Refri', total: 25 },
  { ch: 'Keeta', hue: 'green', n: '5530', items: 'Combo Fumaça', total: 49.9 },
  { ch: 'Mesa 7', hue: 'blue', n: '131', items: '2× Fumaça, 2× Limonada', total: 101.8 },
  { ch: 'Rappi', hue: 'violet', n: '9914', items: 'Smash duplo', total: 32.9 },
];

export interface MockItem {
  name: string;
  desc?: string;
  price?: string;
  photo?: string;
}

/** Cardápio de exemplo do celular do topo (antes de a pessoa digitar o dela). */
export const SAMPLE_ITEMS: MockItem[] = [
  {
    name: 'Fumaça (o da casa)',
    desc: 'Blend 160 g, cheddar, bacon e molho defumado',
    price: '38,90',
    photo: '/site/food-burger-fumaca.webp',
  },
  {
    name: 'Smash duplo',
    desc: 'Dois smash de 80 g, queijo prato e picles',
    price: '32,90',
    photo: '/site/food-burger-smash.webp',
  },
  {
    name: 'Batata frita',
    desc: 'Média, 250 g',
    price: '18,00',
    photo: '/site/food-porcao-batata.webp',
  },
  {
    name: 'Limonada suíça',
    desc: '400 ml',
    price: '12,00',
    photo: '/site/food-bebida-limonada.webp',
  },
];

/** "X-Burger 28,90" por linha vira item com preço (a prévia do celular enquanto a pessoa digita). */
export function parseItems(text: string): MockItem[] {
  return text
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1)
    .slice(0, 6)
    .map((l) => {
      const m = /^(.*?)[\s\-–:=.]*(?:R\$\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:reais)?$/i.exec(l);
      if (!m || !m[1]!.trim()) return { name: l.slice(0, 40) };
      const [int, dec = ''] = m[2]!.replace('.', ',').split(',');
      return { name: m[1]!.trim().slice(0, 40), price: `${int},${dec.padEnd(2, '0')}` };
    });
}

/** Parece um endereço de site? (aceita sem https://) */
export function looksLikeUrl(v: string): boolean {
  return /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v.trim());
}
