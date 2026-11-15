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
  {
    title: 'Cole o link ou descreva',
    text: 'O site que você já tem, o link do Google Maps ou uma lista do que você vende.',
  },
  {
    title: 'O Comandou monta tudo',
    text: 'Endereço próprio, cardápio online, PDV, cozinha e caixa. O login chega no seu e-mail.',
  },
  {
    title: 'Confira e comece a vender',
    text: 'Complete o cardápio com o PDF ou fotos, ajuste as cores e faça o primeiro pedido.',
  },
];

export const SITE_FAQ: { q: string; a: string }[] = [
  {
    q: 'O que acontece depois dos dias de teste?',
    a: 'Se você fechar com a gente, o restaurante continua no ar com tudo o que cadastrou. Se não fechar, ele sai do ar sozinho e nada é cobrado.',
  },
  {
    q: 'Preciso de cartão para testar?',
    a: 'Não. Você só informa o nome do restaurante, o seu nome e um e-mail para receber o login.',
  },
  {
    q: 'Como o Comandou monta o meu cardápio?',
    a: 'Você manda o link do seu site, o PDF ou fotos do cardápio. A inteligência artificial lê os itens, os preços e as fotos, e você confere tudo antes de publicar.',
  },
  {
    q: 'Funciona no celular e no tablet?',
    a: 'Sim. O sistema instala como aplicativo no celular, no tablet e no computador. O garçom lança pelo celular e a cozinha acompanha numa tela.',
  },
  {
    q: 'E se a internet cair?',
    a: 'O sistema continua vendendo. O que foi feito sem internet sobe sozinho quando a conexão volta.',
  },
  {
    q: 'Emite nota fiscal?',
    a: 'Sim, NFC-e direto do caixa. O custo da emissão das notas é cobrado à parte da mensalidade.',
  },
  {
    q: 'Posso usar o meu próprio domínio?',
    a: 'Pode. Todo restaurante ganha um endereço no comandou.com e pode ligar o próprio domínio quando quiser.',
  },
  {
    q: 'Meus dados ficam misturados com os de outros restaurantes?',
    a: 'Não. Cada restaurante tem o próprio banco de dados, e os dados de um nunca aparecem para outro.',
  },
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
