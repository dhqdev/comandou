import type { TourEnds, TourStop } from './GuidedTour';

/**
 * Roteiros dos tours. Cada parada aponta a tela (caminho do menu), o que enquadrar e, quando
 * precisa, a aba que o tour toca antes. Parada de tela que a pessoa não pode abrir é pulada.
 */

const HELP_TIP = (
  <>
    Em cada campo tem um <b>?</b>: toque nele para ver o que é, para que serve e ir direto para a
    tela ligada.
  </>
);

/* ------------------------------------------------------------------ Primeiro acesso */

export const WELCOME_STOPS: TourStop[] = [
  {
    path: '/loja-online',
    title: 'Deixe a loja com a sua cara',
    text: 'Coloque logo, capa e cores. Em Funcionamento você define os horários, e em Entrega as áreas e taxas. É isso que o cliente vê no cardápio online.',
    targets: [{ css: '[aria-label="Seções da loja online"]' }],
  },
  {
    path: '/cardapio',
    title: 'Cadastre o cardápio',
    text: (
      <>
        Crie as <b>categorias</b> (Lanches, Bebidas) e depois toque em <b>Adicionar item</b> para
        cada prato, com foto, preço e adicionais. O botão <b>Tutorial</b> no topo explica campo por
        campo.
      </>
    ),
    targets: [{ button: 'Adicionar item' }],
  },
  {
    path: '/cardapio/complementos',
    title: 'Adicionais, tamanhos e sabores',
    text: 'Grupos de complementos são as escolhas do item: tamanho P/M/G, adicionais pagos, sabores da pizza e "sem cebola". Crie uma vez e ligue em vários itens.',
    targets: [{ button: 'Novo grupo' }],
  },
  {
    path: '/configuracoes',
    title: 'Mesas, cozinhas e caixas',
    text: 'Em Ajustes você cadastra as mesas do salão, as cozinhas (para onde cada item vai) e os terminais de caixa.',
    targets: [],
  },
  {
    path: '/equipe',
    title: 'Chame a sua equipe',
    text: 'Em Adicionar pessoa você cria o acesso do garçom, da cozinha e do caixa. Cada um vê só o que precisa.',
    targets: [{ button: 'Adicionar pessoa' }],
  },
  {
    path: '/caixa',
    title: 'Abra o caixa no começo do turno',
    text: 'Informe o troco inicial em Abrir caixa. No fim do dia você fecha e confere o total de cada forma de pagamento. Ainda não tem terminal? Ele é criado em Sistema › Ajustes.',
    targets: [
      { button: 'Abrir caixa' },
      { button: 'Fechar caixa' },
      { css: '.cm-empty', text: 'terminal' },
    ],
  },
  {
    path: '/',
    title: 'Pronto para vender',
    text: 'Nova venda (atalho F2) lança pedidos de balcão, retirada e telefone. Os pedidos da loja online e do salão também chegam aqui, com aviso sonoro.',
    targets: [{ css: '.pdv__new' }],
  },
  {
    path: '/',
    title: 'Mesas e comandas no PDV',
    text: 'O bloco do Salão mostra as mesas livres, ocupadas e em pagamento. Toque numa mesa livre para lançar o pedido ou numa ocupada para abrir a comanda.',
    targets: [{ css: '.pdv-salon' }, { css: '.pdv-orders' }],
  },
  {
    path: '/mesas',
    title: 'Salão',
    text: 'O mapa completo das mesas e das comandas abertas. Daqui você transfere, junta, divide a conta e fecha a mesa.',
    targets: [],
  },
  {
    path: '/pedidos',
    title: 'Pedidos em tempo real',
    text: 'Todo pedido cai aqui na hora. Toque no pedido para aceitar, acompanhar, receber e imprimir.',
    targets: [],
  },
  {
    path: '/cozinha',
    title: 'Cozinha',
    text: 'Cada item chega por ordem de chegada. Marque em preparo e pronto, e o salão fica sabendo.',
    targets: [],
  },
  {
    path: '/fiscal/configuracao',
    title: 'Nota fiscal',
    text: (
      <>
        Para emitir NFC-e, siga os passos do resumo no topo: empresa, certificado e CSC. Use o botão{' '}
        <b>Tutorial</b> desta tela para ver cada parte com calma.
      </>
    ),
    targets: [{ css: '.fi-status' }],
  },
];

export const welcomeEnds = (firstName: string, tenantName: string, phone: boolean): TourEnds => ({
  intro: {
    title: `Olá, ${firstName}!`,
    label: 'Boas-vindas',
    text: (
      <>
        Este é o painel de <b>{tenantName}</b>. Vamos passar pelas telas na ordem de quem está
        começando: loja, cardápio, equipe, caixa e venda. Leva uns 2 minutos e dá para pular quando
        quiser.
      </>
    ),
  },
  outro: {
    title: 'Tudo pronto!',
    menuKey: 'conta',
    text: (
      <>
        Quando quiser rever, abra <b>{phone ? 'Mais' : 'Conta'} › Rever apresentação</b>. Cardápio e
        Nota fiscal têm um botão <b>Tutorial</b> próprio, e cada campo tem um <b>?</b> com a
        explicação. Dica: {phone ? 'a lupa no topo' : <b>Ctrl + K</b>} acha qualquer tela, pedido ou
        produto.
      </>
    ),
  },
});

/* ------------------------------------------------------------------ Cardápio */

/** Paradas do cadastro do item (servem para item novo e para o item aberto). */
function itemStops(path: string): TourStop[] {
  const chapter = 'Cadastro do item';
  return [
    {
      path,
      chapter,
      click: { button: 'Principal' },
      title: 'Foto, nome e descrição',
      text: 'O básico que o cliente vê: foto quadrada, nome curto e uma descrição com ingredientes e tamanho. O código é opcional (o sistema cria um).',
      targets: [{ css: '.mn-item-top' }],
    },
    {
      path,
      chapter,
      title: 'Venda',
      text: 'Categoria (onde o item aparece), preço, unidade, família (para os relatórios) e a cozinha que recebe o pedido. Logo abaixo: vendido por peso, destaque, esgotado e pausado.',
      targets: [{ css: '.cm-form__section', text: 'Venda' }],
    },
    {
      path,
      chapter,
      title: 'Em quais cardápios e por qual preço',
      text: 'Marque em quais cardápios o item aparece. Preço vazio usa o preço do item; preencha para cobrar diferente no delivery, por exemplo.',
      targets: [{ css: '.mn-item-menus' }, { css: '.cm-form__section', text: 'Cardápios' }],
    },
    {
      path,
      chapter,
      title: 'Custo e margem',
      text: 'Informe quanto custa fazer o item e veja a margem na hora. Com ficha técnica, o custo é calculado pelos insumos do estoque.',
      targets: [{ css: '.st-preview' }, { css: '.cm-form__section', text: 'Custo' }],
    },
    {
      path,
      chapter,
      title: 'Fiscal e código de barras',
      text: 'NCM, CFOP e CST que vão na nota. O mais fácil é escolher um Padrão fiscal e deixar os outros vazios. O código de barras serve para o leitor no PDV.',
      targets: [{ css: '.cm-form__section', text: 'Fiscal' }],
    },
    {
      path,
      chapter,
      click: { button: 'Complementos' },
      title: 'Complementos do item',
      text: 'Ligue os grupos de tamanhos, adicionais e sabores. Eles aparecem nesta ordem quando alguém pede o item; use as setas para mudar.',
      targets: [{ css: '.mn-linked' }],
    },
    {
      path,
      chapter,
      click: { button: 'Ficha técnica' },
      title: 'Ficha técnica',
      text: 'Quanto de cada insumo sai por unidade vendida. A venda baixa o estoque sozinha e o custo entra nos relatórios.',
      targets: [{ css: '.st-recipe' }, { css: '.cm-card', text: 'Ficha técnica' }],
    },
    {
      path,
      chapter,
      click: { button: 'Principal' },
      title: 'Salvar',
      text: 'Nada é gravado até você tocar em Salvar. O item aparece na hora no PDV, no garçom e no cardápio online.',
      targets: [{ css: '.mn-crumbs button' }, { css: '.mn-crumbs' }],
    },
  ];
}

export const MENU_STOPS: TourStop[] = [
  {
    path: '/cardapio',
    title: 'Categorias',
    text: 'Comece pelas categorias (Lanches, Bebidas…). A ordem delas é a ordem que o cliente vê. Toque em Nova para criar.',
    targets: [{ css: '.cm-card', text: 'Categorias' }],
  },
  {
    path: '/cardapio',
    title: 'Itens',
    text: 'Cada prato ou bebida é um item. Toque em Adicionar item para abrir o cadastro completo, ou num item para editar.',
    targets: [{ button: 'Adicionar item' }],
  },
  ...itemStops('/cardapio/itens/novo'),
  {
    path: '/cardapio/complementos',
    title: 'Grupos de complementos',
    text: 'Tamanhos, adicionais, sabores e "retirar ingrediente". Você define o mínimo e o máximo de escolhas e como cobra (somar, mais cara ou média). Depois liga nos itens.',
    targets: [{ button: 'Novo grupo' }],
  },
  {
    path: '/cardapio/cardapios',
    title: 'Cardápios',
    text: 'Principal vale no balcão e no salão; Delivery vale na entrega e no cardápio online. Cada um tem os seus itens e preços; dentro dele, Reajustar preços muda todos de uma vez.',
    targets: [{ button: 'Novo cardápio' }],
  },
  {
    path: '/cardapio/familias',
    title: 'Famílias',
    text: 'Agrupam as vendas nos relatórios, mesmo com itens em categorias diferentes. O cliente não vê.',
    targets: [{ button: 'Nova família' }],
  },
];

export const menuEnds: TourEnds = {
  intro: {
    title: 'Tutorial do Cardápio',
    text: (
      <>
        Vamos passar por tudo: categorias, itens (campo por campo), complementos, famílias e
        cardápios. Nada é salvo durante o tutorial. {HELP_TIP}
      </>
    ),
  },
  outro: {
    title: 'Cardápio explicado!',
    targets: [{ css: '[data-tour-button]' }],
    text: (
      <>
        Para rever, toque em <b>Tutorial</b>. {HELP_TIP}
      </>
    ),
  },
};

export const itemTour = (path: string) => itemStops(path);

export const itemEnds: TourEnds = {
  intro: {
    title: 'Cadastro do item',
    text: (
      <>
        Vamos passar por cada parte do item: dados, venda, cardápios, custo, fiscal, complementos e
        ficha técnica. {HELP_TIP}
      </>
    ),
  },
  outro: menuEnds.outro,
};

/* ------------------------------------------------------------------ Nota fiscal */

export const FISCAL_STOPS: TourStop[] = [
  {
    path: '/fiscal/configuracao',
    title: 'O que falta para emitir',
    text: (
      <>
        O resumo mostra o ambiente (<b>Homologação</b> = notas de teste, sem valor) e os passos que
        faltam. Cada passo pendente é um botão que leva à aba certa.
      </>
    ),
    targets: [{ css: '.fi-status' }],
  },
  {
    path: '/fiscal/configuracao',
    click: { button: 'Empresa' },
    title: 'Empresa',
    text: 'Como conectar à Focus NFe (o serviço que fala com a SEFAZ), os dados da empresa e o certificado digital A1. Com conta própria na Focus, basta o CNPJ e os tokens.',
    targets: [{ css: '.fi-tabbody' }],
  },
  {
    path: '/fiscal/configuracao',
    click: { button: 'NFC-e' },
    title: 'NFC-e (cupom do consumidor)',
    text: 'Ligue a emissão automática ao fechar a conta, defina a natureza da operação e informe o CSC (código da SEFAZ que gera o QR Code).',
    targets: [{ css: '.fi-tabbody' }],
  },
  {
    path: '/fiscal/configuracao',
    click: { button: 'NF-e' },
    title: 'NF-e (nota completa)',
    text: 'Para empresas e para quem pede nota com endereço. Só ligue se a empresa estiver habilitada para NF-e na SEFAZ.',
    targets: [{ css: '.fi-tabbody' }],
  },
  {
    path: '/fiscal/configuracao',
    click: { button: 'Geral' },
    title: 'Geral',
    text: 'E-mail da nota para o cliente, observação em todas as notas e os códigos de reserva usados enquanto não há padrão fiscal.',
    targets: [{ css: '.fi-tabbody' }],
  },
  {
    path: '/fiscal/configuracao',
    title: 'Ligar a emissão',
    text: 'Com os passos completos, toque em Ligar emissão e faça notas de teste. Deu certo? Mude para produção (só o dono pode).',
    targets: [
      { button: 'Ligar emissão' },
      { button: 'Desligar emissão' },
      { css: '.fi-status__actions' },
    ],
  },
  {
    path: '/fiscal/padroes',
    title: 'Padrões fiscais',
    text: 'Cada padrão junta CFOP, CST e alíquotas. Em "Onde vale" você liga a itens ou NCMs, e marca um como padrão da empresa. Peça os códigos à contabilidade.',
    targets: [{ button: 'Novo padrão' }],
  },
  {
    path: '/fiscal/nfce',
    title: 'NFC-e emitidas',
    text: 'Todas as notas de consumidor: emitidas, recusadas e canceladas. Toque numa nota para ver o motivo da recusa, reemitir, imprimir ou cancelar (até 30 minutos).',
    targets: [],
  },
  {
    path: '/fiscal/nfe',
    title: 'NF-e',
    text: 'Notas completas, com os dados do comprador. Uma NF-e nasce de um pedido pago: abra o pedido e peça a NF-e.',
    targets: [],
  },
  {
    path: '/fiscal/recebidas',
    title: 'Notas recebidas',
    text: 'Notas que fornecedores emitiram para o seu CNPJ. Dê ciência para baixar o XML e confirme quando a mercadoria chegar.',
    targets: [{ button: 'Buscar notas novas' }],
  },
  {
    path: '/fiscal/inutilizacao',
    title: 'Inutilização',
    text: 'Quando um número de nota é pulado, a SEFAZ precisa ser avisada. Aqui você vê os buracos na numeração e inutiliza a faixa.',
    targets: [],
  },
];

export const fiscalEnds: TourEnds = {
  intro: {
    title: 'Tutorial da Nota fiscal',
    text: (
      <>
        Vamos passar pela configuração (aba por aba), pelos padrões fiscais e pelas listas de notas.
        Nada é alterado durante o tutorial. {HELP_TIP}
      </>
    ),
  },
  outro: {
    title: 'Nota fiscal explicada!',
    targets: [{ css: '[data-tour-button]' }],
    text: (
      <>
        Para rever, toque em <b>Tutorial</b>. {HELP_TIP} Erros de nota recusada mostram onde
        corrigir.
      </>
    ),
  },
};

/* ------------------------------------------------------------------ Estoque */

export const STOCK_STOPS: TourStop[] = [
  {
    path: '/estoque',
    title: 'Como o estoque funciona',
    text: (
      <>
        Você cadastra os <b>insumos</b> (pão, carne, queijo) e diz na <b>ficha técnica</b> quanto
        cada item do cardápio gasta. A cada venda o sistema baixa os insumos sozinho. As entradas
        vêm do <b>Recebimento</b>; o resto é conferência.
      </>
    ),
    targets: [{ css: '.st-kpis' }, { css: '.page-head' }],
  },
  {
    path: '/estoque',
    title: 'Insumos',
    text: (
      <>
        Cada linha é um insumo, com saldo, mínimo, custo médio e quantos dias ainda dura. Os botões
        da linha são atalhos: <b>Entrada</b> (chegou sem nota), <b>Perda</b> (estragou),{' '}
        <b>Contar</b> (conferir um só) e <b>Editar</b>. Comece em <b>Novo insumo</b>.
      </>
    ),
    targets: [{ button: 'Novo insumo' }],
  },
  {
    path: '/estoque/fichas',
    title: 'Fichas técnicas (o passo mais importante)',
    text: (
      <>
        A receita de cada item: quanto de cada insumo sai por unidade vendida. Item sem ficha{' '}
        <b>não baixa estoque</b>. Atenção: se faltar insumo, a venda é recusada (a não ser que o
        insumo permita saldo negativo, em Editar).
      </>
    ),
    targets: [{ button: 'Ficha de preparo' }, { css: '.page-head' }],
  },
  {
    path: '/estoque/recebimento',
    title: 'Recebimento',
    text: 'Quando a mercadoria chega do fornecedor: lance a nota com vários itens de uma vez. A quantidade entra no saldo e o custo médio é recalculado.',
    targets: [{ button: 'Novo recebimento' }],
  },
  {
    path: '/estoque/fatores',
    title: 'Fatores de conversão',
    text: 'Você compra em caixa ou fardo, mas controla em unidade ou kg. Ex.: CX = 12 un. Depois, no recebimento, é só escolher CX.',
    targets: [{ button: 'Novo fator' }, { css: '.page-head' }],
  },
  {
    path: '/estoque/producao',
    title: 'Produção',
    text: 'Para o que você prepara na cozinha (molho, massa, hambúrguer moldado): a produção tira os ingredientes e põe o preparo pronto no estoque.',
    targets: [{ css: '.page-head' }],
  },
  {
    path: '/estoque/lotes',
    title: 'Lotes e validade',
    text: 'Opcional. Guarda data de fabricação e validade de cada leva, para usar primeiro o que vence antes.',
    targets: [{ button: 'Novo lote' }, { css: '.page-head' }],
  },
  {
    path: '/estoque/saida',
    title: 'Saída de estoque',
    text: 'O histórico de tudo que saiu e por quê: vendas, perdas, produção e retiradas (ex.: consumo da equipe).',
    targets: [{ button: 'Nova saída avulsa' }, { css: '.page-head' }],
  },
  {
    path: '/estoque/inventario',
    title: 'Inventário',
    text: 'Uma vez por semana ou por mês, conte a prateleira, digite o que achou e conclua: o sistema ajusta os saldos e mostra a diferença em reais.',
    targets: [{ css: '.page-head' }],
  },
  {
    path: '/estoque/precificacao',
    title: 'Precificação',
    text: 'Com as fichas prontas, aqui você vê o custo de cada prato, o lucro e o preço sugerido. Nada muda o preço sozinho.',
    targets: [{ css: '.page-head' }],
  },
];

export const stockEnds: TourEnds = {
  intro: {
    title: 'Tutorial do Estoque',
    text: (
      <>
        Vamos passar por cada parte, na ordem de quem está começando: insumos, fichas técnicas,
        recebimento, fatores, produção, lotes, saídas, inventário e precificação. Nada é salvo
        durante o tutorial. {HELP_TIP}
      </>
    ),
  },
  outro: {
    title: 'Estoque explicado!',
    targets: [{ css: '[data-tour-button]' }],
    text: (
      <>
        Ordem para começar: <b>insumos → fichas técnicas → recebimento</b>. Para rever, toque em{' '}
        <b>Tutorial</b>.
      </>
    ),
  },
};
