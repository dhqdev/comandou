import type { TourEnds, TourStop } from './GuidedTour';

/**
 * Roteiros dos tours. Cada parada aponta a tela (caminho do menu), o que enquadrar e, quando
 * precisa, a aba que o tour toca antes. Parada de tela que a pessoa não pode abrir é pulada.
 *
 * `text` diz o que é e para que serve; `steps` diz o que fazer, na ordem, com o nome exato dos
 * botões. Cada parada responde "o que eu faço aqui?".
 */

const HELP_TIP = (
  <>
    Em cada campo tem um <b>?</b>: toque nele para ver o que é, para que serve e ir direto para a
    tela ligada.
  </>
);

const REVIEW = (
  <>
    Para rever, toque em <b>Tutorial</b> no topo da tela.
  </>
);

/* ------------------------------------------------------------------ Primeiro acesso */

export const WELCOME_STOPS: TourStop[] = [
  {
    path: '/loja-online',
    title: '1. Deixe a loja com a sua cara',
    text: 'É o que o cliente vê quando pede pelo celular. Comece por aqui para o cardápio online já sair bonito.',
    steps: [
      <>
        Em <b>Aparência</b>, envie o logo e a capa e escolha a cor.
      </>,
      <>
        Em <b>Funcionamento</b>, marque os horários e toque em <b>Salvar horário</b>.
      </>,
      <>A prévia mostra o que o cliente vê no celular.</>,
    ],
    targets: [{ css: '[aria-label="Seções da loja online"]' }],
  },
  {
    path: '/cardapio',
    title: '2. Cadastre o cardápio',
    text: 'Sem cardápio não há o que vender: o PDV, o garçom e a loja online usam estes itens.',
    steps: [
      <>
        Em <b>Categorias</b>, toque em <b>Nova</b> e crie as seções (Lanches, Bebidas…).
      </>,
      <>
        Toque em <b>Adicionar item</b> e preencha foto, nome, preço e categoria.
      </>,
      <>
        Toque em <b>Salvar</b>. O botão <b>Tutorial</b> desta tela explica campo por campo.
      </>,
    ],
    targets: [{ button: 'Adicionar item' }],
  },
  {
    path: '/cardapio/complementos',
    title: '3. Adicionais, tamanhos e sabores',
    text: 'São as escolhas do item: tamanho P/M/G, adicional pago, sabores da pizza, "sem cebola". Crie uma vez e use em vários itens.',
    steps: [
      <>
        Toque em <b>Novo grupo</b>, dê um nome (ex.: "Adicionais") e cadastre as opções com preço.
      </>,
      <>Diga quantas escolhas o cliente pode fazer (mínimo e máximo).</>,
      <>
        Abra o item no cardápio e, em <b>Complementos</b>, ligue o grupo.
      </>,
    ],
    targets: [{ button: 'Novo grupo' }],
  },
  {
    path: '/configuracoes',
    title: '4. Cozinhas, mesas e caixas',
    text: 'Os cadastros que o dia a dia usa. Sem eles, o pedido não sabe para qual cozinha ir nem em qual caixa entra o dinheiro.',
    steps: [
      <>
        Em <b>Setores de produção</b>, crie Cozinha, Bar… (cada item do cardápio vai para um).
      </>,
      <>
        Em <b>Mesas do salão</b>, crie as mesas.
      </>,
      <>
        Em <b>Terminais de caixa</b>, crie um terminal (ex.: "Caixa 1").
      </>,
    ],
    targets: [{ css: '[data-search-id="secao-setores"]' }],
  },
  {
    path: '/impressao',
    title: '5. Ligue a impressora',
    text: 'As comandas saem sozinhas na impressora térmica: USB, rede, Wi-Fi, Bluetooth ou serial.',
    steps: [
      <>
        No computador ligado à impressora, toque em <b>Baixar</b> e instale o aplicativo.
      </>,
      <>
        Toque em <b>Conectar computador</b> e depois em <b>Abrir no aplicativo</b>.
      </>,
      <>
        No aplicativo, toque em <b>Adicionar impressora</b> e siga os 3 passos.
      </>,
    ],
    targets: [{ css: '.print-hero' }],
  },
  {
    path: '/equipe',
    title: '6. Chame a sua equipe',
    text: 'Cada pessoa tem o próprio acesso e vê só o que precisa: o garçom vê o salão, a cozinha vê a fila.',
    steps: [
      <>
        Toque em <b>Adicionar pessoa</b>.
      </>,
      <>Informe nome, e-mail, uma senha inicial e o papel (Garçom, Cozinha, Caixa, Gerente).</>,
      <>Passe o e-mail e a senha para a pessoa entrar pelo celular ou pelo computador.</>,
    ],
    targets: [{ button: 'Adicionar pessoa' }],
  },
  {
    path: '/caixa',
    title: '7. Abra o caixa no começo do turno',
    text: 'Pagamento só entra com o caixa aberto. No fim do dia você confere o que entrou em cada forma de pagamento.',
    steps: [
      <>
        Toque em <b>Abrir caixa</b> e digite o troco que está na gaveta.
      </>,
      <>
        Durante o dia: <b>Sangria</b> para tirar dinheiro, <b>Suprimento</b> para colocar.
      </>,
      <>
        No fim: <b>Fechar caixa</b> e conte o que tem de cada forma.
      </>,
    ],
    targets: [
      { button: 'Abrir caixa' },
      { button: 'Fechar caixa' },
      { css: '.cm-empty', text: 'terminal' },
    ],
  },
  {
    path: '/',
    title: '8. Faça a primeira venda',
    text: 'Pedidos de balcão, retirada e telefone nascem aqui. Os da loja online e do salão também chegam, com aviso sonoro.',
    steps: [
      <>
        Toque em <b>Nova venda</b> (ou aperte <b>F2</b>).
      </>,
      <>
        Toque nos itens, escolha balcão, retirada ou entrega e toque em <b>Enviar pedido</b>.
      </>,
      <>
        Para cobrar, abra o pedido, toque em <b>Fechar conta</b> e escolha a forma de pagamento.
      </>,
    ],
    targets: [{ css: '.pdv__new' }],
  },
  {
    path: '/',
    title: 'Mesas e comandas no PDV',
    text: 'O bloco do Salão mostra as mesas livres, ocupadas e em pagamento.',
    steps: [
      <>Toque numa mesa livre para lançar o primeiro pedido dela.</>,
      <>Toque numa mesa ocupada para ver a comanda, pedir mais ou fechar a conta.</>,
    ],
    targets: [{ css: '.pdv-salon' }, { css: '.pdv-orders' }],
  },
  {
    path: '/mesas',
    title: 'Salão',
    text: 'O mapa completo das mesas e das comandas abertas. Daqui você transfere, junta, divide a conta e fecha a mesa.',
    steps: [
      <>
        Toque em <b>Personalizar mesas</b> para desenhar o salão.
      </>,
      <>
        Toque em <b>QR das mesas</b> para imprimir o QR Code que o cliente usa para pedir.
      </>,
    ],
    targets: [],
  },
  {
    path: '/pedidos',
    title: 'Pedidos em tempo real',
    text: 'Todo pedido cai aqui na hora, de onde vier.',
    steps: [
      <>Toque no pedido para aceitar, acompanhar, receber e imprimir.</>,
      <>Pedido da loja online fica esperando aceite, a não ser que o aceite seja automático.</>,
    ],
    targets: [],
  },
  {
    path: '/cozinha',
    title: 'Cozinha',
    text: 'Deixe esta tela aberta num tablet ou TV na cozinha. Cada item chega por ordem de chegada.',
    steps: [
      <>
        Toque em <b>Iniciar preparo</b> quando começar.
      </>,
      <>
        Toque em <b>Tudo pronto</b> quando terminar: o salão e o caixa ficam sabendo.
      </>,
    ],
    targets: [],
  },
  {
    path: '/fiscal/configuracao',
    title: 'Nota fiscal (quando for emitir)',
    text: 'Não precisa ser no primeiro dia. Para emitir NFC-e, siga os passos do resumo no topo: empresa, certificado e CSC.',
    steps: [
      <>Separe o certificado digital A1 (arquivo .pfx e senha) e o CSC da SEFAZ.</>,
      <>
        Toque em <b>Tutorial</b> nesta tela: ele mostra cada aba com calma.
      </>,
    ],
    targets: [{ css: '.fi-status' }],
  },
];

export const welcomeEnds = (firstName: string, tenantName: string, phone: boolean): TourEnds => ({
  intro: {
    title: `Olá, ${firstName}!`,
    label: 'Boas-vindas',
    text: (
      <>
        Este é o painel de <b>{tenantName}</b>. Vamos montar tudo na ordem certa: loja, cardápio,
        cozinhas, impressora, equipe, caixa e a primeira venda. Em cada tela você vê{' '}
        <b>o que fazer</b>, passo a passo. Leva uns 3 minutos e dá para pular quando quiser.
      </>
    ),
  },
  outro: {
    title: 'Tudo pronto!',
    menuKey: 'conta',
    text: (
      <>
        Quando quiser rever, abra <b>{phone ? 'Mais › Conta' : 'Conta'} › Rever apresentação</b>. As
        telas principais têm um botão <b>Tutorial</b> no topo, e cada campo tem um <b>?</b> com a
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
      text: 'O que o cliente vê no cardápio online, no PDV e no app do garçom.',
      steps: [
        <>Toque na foto e envie uma imagem quadrada e bem iluminada.</>,
        <>Escreva um nome curto (ex.: "X-Burger da casa").</>,
        <>Na descrição, diga ingredientes, tamanho e o que acompanha.</>,
      ],
      targets: [{ css: '.mn-item-top' }],
    },
    {
      path,
      chapter,
      title: 'Venda',
      text: 'Onde o item aparece, quanto custa e para qual cozinha vai.',
      steps: [
        <>
          Escolha a <b>Categoria</b> e digite o <b>Preço</b>.
        </>,
        <>
          Em <b>Cozinha (KDS)</b>, escolha o setor que prepara (Cozinha, Bar…). É lá que a comanda
          imprime.
        </>,
        <>
          Vende no quilo? Ligue <b>Vendido por peso</b>. Acabou hoje? Marque <b>Esgotado</b>.
        </>,
      ],
      targets: [{ css: '.cm-form__section', text: 'Venda' }],
    },
    {
      path,
      chapter,
      title: 'Em quais cardápios e por qual preço',
      text: 'Principal vale no balcão e no salão; Delivery vale na entrega e no cardápio online.',
      steps: [
        <>Marque os cardápios em que o item aparece.</>,
        <>Deixe o preço vazio para usar o do item, ou digite outro (ex.: delivery mais caro).</>,
      ],
      targets: [{ css: '.mn-item-menus' }, { css: '.cm-form__section', text: 'Cardápios' }],
    },
    {
      path,
      chapter,
      title: 'Custo e margem',
      text: 'Mostra na hora quanto sobra de cada venda. Opcional, mas ajuda a acertar o preço.',
      steps: [
        <>
          Digite quanto custa fazer o item, ou deixe a <b>Ficha técnica</b> calcular pelos insumos.
        </>,
      ],
      targets: [{ css: '.st-preview' }, { css: '.cm-form__section', text: 'Custo' }],
    },
    {
      path,
      chapter,
      title: 'Fiscal e código de barras',
      text: 'NCM, CFOP e CST que vão na nota. Só importa se você emite nota fiscal.',
      steps: [
        <>
          O mais fácil: escolha um <b>Padrão fiscal</b> e deixe os outros campos vazios.
        </>,
        <>Tem código de barras na embalagem? Digite para o leitor achar o item no PDV.</>,
      ],
      targets: [{ css: '.cm-form__section', text: 'Fiscal' }],
    },
    {
      path,
      chapter,
      click: { button: 'Complementos' },
      title: 'Complementos do item',
      text: 'Os grupos de tamanhos, adicionais e sabores que o cliente escolhe ao pedir.',
      steps: [
        <>
          Toque em <b>Adicionar grupo</b> e escolha o grupo.
        </>,
        <>Use as setas para mudar a ordem em que as perguntas aparecem.</>,
      ],
      targets: [{ css: '.mn-linked' }],
    },
    {
      path,
      chapter,
      click: { button: 'Ficha técnica' },
      title: 'Ficha técnica',
      text: 'Quanto de cada insumo sai por unidade vendida. Com ela, a venda baixa o estoque sozinha.',
      steps: [
        <>Adicione cada insumo e a quantidade usada em uma unidade do item.</>,
        <>Sem ficha, o item vende normalmente, mas não mexe no estoque.</>,
      ],
      targets: [{ css: '.st-recipe' }, { css: '.cm-card', text: 'Ficha técnica' }],
    },
    {
      path,
      chapter,
      click: { button: 'Principal' },
      title: 'Salvar',
      text: 'Nada é gravado até você salvar. Depois, o item aparece na hora no PDV, no garçom e no cardápio online.',
      steps: [
        <>
          Toque em <b>Salvar</b>.
        </>,
      ],
      targets: [{ css: '.mn-crumbs button' }, { css: '.mn-crumbs' }],
    },
  ];
}

export const MENU_STOPS: TourStop[] = [
  {
    path: '/cardapio',
    title: 'Categorias',
    text: 'As seções do cardápio. A ordem delas é a ordem que o cliente vê.',
    steps: [
      <>
        Toque em <b>Nova</b> e dê um nome (Lanches, Bebidas, Sobremesas).
      </>,
      <>Crie na ordem em que quer que o cliente veja.</>,
    ],
    targets: [{ css: '.cm-card', text: 'Categorias' }],
  },
  {
    path: '/cardapio',
    title: 'Itens',
    text: 'Cada prato ou bebida é um item.',
    steps: [
      <>
        Toque em <b>Adicionar item</b> para abrir o cadastro completo.
      </>,
      <>Toque num item da lista para editar.</>,
    ],
    targets: [{ button: 'Adicionar item' }],
  },
  ...itemStops('/cardapio/itens/novo'),
  {
    path: '/cardapio/complementos',
    title: 'Grupos de complementos',
    text: 'Tamanhos, adicionais, sabores e "retirar ingrediente".',
    steps: [
      <>
        Toque em <b>Novo grupo</b> e cadastre as opções com o preço de cada uma.
      </>,
      <>
        Defina o mínimo e o máximo de escolhas e como cobra (somar, a mais cara ou a média, para
        pizza meio a meio).
      </>,
      <>Depois, ligue o grupo nos itens, na aba Complementos do item.</>,
    ],
    targets: [{ button: 'Novo grupo' }],
  },
  {
    path: '/cardapio/cardapios',
    title: 'Cardápios',
    text: 'Principal vale no balcão e no salão; Delivery vale na entrega e no cardápio online. Cada um tem os seus itens e preços.',
    steps: [
      <>Abra um cardápio para escolher os itens e preços dele.</>,
      <>
        Dentro dele, <b>Reajustar preços</b> muda todos de uma vez (ex.: +10% no delivery).
      </>,
    ],
    targets: [{ button: 'Novo cardápio' }],
  },
  {
    path: '/cardapio/familias',
    title: 'Famílias',
    text: 'Agrupam as vendas nos relatórios, mesmo com itens em categorias diferentes. O cliente não vê.',
    steps: [
      <>
        Opcional. Toque em <b>Nova família</b> (ex.: "Bebidas") e escolha a família no item.
      </>,
    ],
    targets: [{ button: 'Nova família' }],
  },
];

export const menuEnds: TourEnds = {
  intro: {
    title: 'Tutorial do Cardápio',
    text: (
      <>
        Vamos passar por tudo, na ordem de quem está começando: categorias, itens (campo por campo),
        complementos, cardápios e famílias. Nada é salvo durante o tutorial. {HELP_TIP}
      </>
    ),
  },
  outro: {
    title: 'Cardápio explicado!',
    targets: [{ css: '[data-tour-button]' }],
    text: (
      <>
        Ordem para começar: <b>categorias → itens → complementos</b>. {REVIEW} {HELP_TIP}
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
        ficha técnica. Só foto, nome, categoria e preço são obrigatórios. {HELP_TIP}
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
        faltam.
      </>
    ),
    steps: [<>Toque em cada passo pendente: ele leva direto à aba certa.</>],
    targets: [{ css: '.fi-status' }],
  },
  {
    path: '/fiscal/configuracao',
    click: { button: 'Empresa' },
    title: 'Empresa',
    text: 'A ligação com a Focus NFe (o serviço que fala com a SEFAZ), os dados da empresa e o certificado.',
    steps: [
      <>Confira CNPJ, inscrição estadual, regime tributário e endereço.</>,
      <>Envie o certificado digital A1 (arquivo .pfx) e digite a senha dele.</>,
      <>Tem conta própria na Focus? Basta o CNPJ e os tokens.</>,
    ],
    targets: [{ css: '.fi-tabbody' }],
  },
  {
    path: '/fiscal/configuracao',
    click: { button: 'NFC-e' },
    title: 'NFC-e (cupom do consumidor)',
    text: 'A nota de quem come ou leva. É a mais usada no restaurante.',
    steps: [
      <>Digite o CSC e o ID do CSC (você gera no site da SEFAZ do seu estado).</>,
      <>Ligue a emissão automática se quiser a nota a cada conta fechada.</>,
    ],
    targets: [{ css: '.fi-tabbody' }],
  },
  {
    path: '/fiscal/configuracao',
    click: { button: 'NF-e' },
    title: 'NF-e (nota completa)',
    text: 'Para empresas e para quem pede nota com endereço.',
    steps: [<>Só ligue se a empresa estiver habilitada para NF-e na SEFAZ.</>],
    targets: [{ css: '.fi-tabbody' }],
  },
  {
    path: '/fiscal/configuracao',
    click: { button: 'Geral' },
    title: 'Geral',
    text: 'E-mail da nota para o cliente, observação em todas as notas e os códigos de reserva usados enquanto não há padrão fiscal.',
    steps: [<>Peça à contabilidade os códigos de reserva (NCM, CFOP, CST) e preencha.</>],
    targets: [{ css: '.fi-tabbody' }],
  },
  {
    path: '/fiscal/configuracao',
    title: 'Ligar a emissão',
    text: 'Comece em homologação: as notas são de teste e não valem.',
    steps: [
      <>
        Com os passos completos, toque em <b>Ligar emissão</b>.
      </>,
      <>Feche uma conta de teste e veja a nota sair.</>,
      <>Deu certo? Mude para produção (só o dono pode).</>,
    ],
    targets: [
      { button: 'Ligar emissão' },
      { button: 'Desligar emissão' },
      { css: '.fi-status__actions' },
    ],
  },
  {
    path: '/fiscal/padroes',
    title: 'Padrões fiscais',
    text: 'Cada padrão junta CFOP, CST e alíquotas, para não preencher item por item.',
    steps: [
      <>
        Toque em <b>Novo padrão</b> e preencha com os códigos da contabilidade.
      </>,
      <>
        Em <b>Onde vale</b>, ligue a itens ou NCMs, ou marque como padrão da empresa.
      </>,
    ],
    targets: [{ button: 'Novo padrão' }],
  },
  {
    path: '/fiscal/nfce',
    title: 'NFC-e emitidas',
    text: 'Todas as notas de consumidor: emitidas, recusadas e canceladas.',
    steps: [
      <>Toque numa nota recusada para ver o motivo e onde corrigir, e depois reemitir.</>,
      <>Cancelar só dá até 30 minutos depois da emissão.</>,
    ],
    targets: [],
  },
  {
    path: '/fiscal/nfe',
    title: 'NF-e',
    text: 'Notas completas, com os dados do comprador.',
    steps: [<>Uma NF-e nasce de um pedido pago: abra o pedido e peça a NF-e.</>],
    targets: [],
  },
  {
    path: '/fiscal/recebidas',
    title: 'Notas recebidas',
    text: 'Notas que fornecedores emitiram para o seu CNPJ.',
    steps: [
      <>
        Toque em <b>Buscar notas novas</b>.
      </>,
      <>Dê ciência para baixar o XML e confirme quando a mercadoria chegar.</>,
    ],
    targets: [{ button: 'Buscar notas novas' }],
  },
  {
    path: '/fiscal/inutilizacao',
    title: 'Inutilização',
    text: 'Quando um número de nota é pulado, a SEFAZ precisa ser avisada.',
    steps: [<>Veja os buracos na numeração e inutilize a faixa.</>],
    targets: [],
  },
];

export const fiscalEnds: TourEnds = {
  intro: {
    title: 'Tutorial da Nota fiscal',
    text: (
      <>
        Vamos passar pela configuração (aba por aba), pelos padrões fiscais e pelas listas de notas.
        Tenha em mãos o certificado A1, a senha dele e o CSC. Nada é alterado durante o tutorial.{' '}
        {HELP_TIP}
      </>
    ),
  },
  outro: {
    title: 'Nota fiscal explicada!',
    targets: [{ css: '[data-tour-button]' }],
    text: (
      <>
        Ordem: <b>empresa e certificado → NFC-e (CSC) → ligar em homologação → produção</b>.{' '}
        {REVIEW} Erros de nota recusada mostram onde corrigir.
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
        cada item do cardápio gasta. A cada venda o sistema baixa os insumos sozinho.
      </>
    ),
    steps: [
      <>Cadastre os insumos.</>,
      <>Faça a ficha técnica dos itens.</>,
      <>Lance as compras no Recebimento.</>,
    ],
    targets: [{ css: '.st-kpis' }, { css: '.page-head' }],
  },
  {
    path: '/estoque',
    title: 'Insumos',
    text: 'Cada linha é um insumo, com saldo, mínimo, custo médio e quantos dias ainda dura.',
    steps: [
      <>
        Toque em <b>Novo insumo</b>: nome, unidade (kg, un, L), estoque mínimo e saldo atual.
      </>,
      <>
        Atalhos da linha: <b>Entrada</b> (chegou sem nota), <b>Perda</b> (estragou), <b>Contar</b>{' '}
        (conferir um só) e <b>Editar</b>.
      </>,
    ],
    targets: [{ button: 'Novo insumo' }],
  },
  {
    path: '/estoque/fichas',
    title: 'Fichas técnicas (o passo mais importante)',
    text: (
      <>
        A receita de cada item. Item sem ficha <b>não baixa estoque</b>.
      </>
    ),
    steps: [
      <>
        Toque em <b>Ficha de preparo</b> no item e adicione os insumos com a quantidade.
      </>,
      <>
        Atenção: se faltar insumo, a venda é recusada, a não ser que o insumo permita saldo negativo
        (em Editar).
      </>,
    ],
    targets: [{ button: 'Ficha de preparo' }, { css: '.page-head' }],
  },
  {
    path: '/estoque/recebimento',
    title: 'Recebimento',
    text: 'Quando a mercadoria chega do fornecedor.',
    steps: [
      <>
        Toque em <b>Novo recebimento</b> e lance a nota com vários itens de uma vez.
      </>,
      <>A quantidade entra no saldo e o custo médio é recalculado.</>,
    ],
    targets: [{ button: 'Novo recebimento' }],
  },
  {
    path: '/estoque/fatores',
    title: 'Fatores de conversão',
    text: 'Você compra em caixa ou fardo, mas controla em unidade ou kg.',
    steps: [
      <>
        Toque em <b>Novo fator</b> (ex.: CX = 12 un). No recebimento, é só escolher CX.
      </>,
    ],
    targets: [{ button: 'Novo fator' }, { css: '.page-head' }],
  },
  {
    path: '/estoque/producao',
    title: 'Produção',
    text: 'Para o que você prepara na cozinha (molho, massa, hambúrguer moldado).',
    steps: [<>Lance a produção: ela tira os ingredientes e põe o preparo pronto no estoque.</>],
    targets: [{ css: '.page-head' }],
  },
  {
    path: '/estoque/lotes',
    title: 'Lotes e validade',
    text: 'Opcional. Guarda fabricação e validade de cada leva, para usar primeiro o que vence antes.',
    steps: [
      <>
        Toque em <b>Novo lote</b> quando receber produto com validade.
      </>,
    ],
    targets: [{ button: 'Novo lote' }, { css: '.page-head' }],
  },
  {
    path: '/estoque/saida',
    title: 'Saída de estoque',
    text: 'O histórico de tudo que saiu e por quê: vendas, perdas, produção e retiradas.',
    steps: [
      <>
        Consumo da equipe ou retirada? Toque em <b>Nova saída avulsa</b>.
      </>,
    ],
    targets: [{ button: 'Nova saída avulsa' }, { css: '.page-head' }],
  },
  {
    path: '/estoque/inventario',
    title: 'Inventário',
    text: 'A conferência geral, uma vez por semana ou por mês.',
    steps: [
      <>Conte a prateleira e digite o que achou.</>,
      <>Conclua: o sistema ajusta os saldos e mostra a diferença em reais.</>,
    ],
    targets: [{ css: '.page-head' }],
  },
  {
    path: '/estoque/precificacao',
    title: 'Precificação',
    text: 'Com as fichas prontas, o custo de cada prato, o lucro e o preço sugerido.',
    steps: [<>Compare o preço atual com o sugerido. Nada muda o preço sozinho.</>],
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
        Ordem para começar: <b>insumos → fichas técnicas → recebimento</b>. {REVIEW}
      </>
    ),
  },
};

/* ------------------------------------------------------------------ Impressão */

export const PRINT_STOPS: TourStop[] = [
  {
    path: '/impressao',
    title: 'Baixe o aplicativo',
    text: 'O navegador não consegue imprimir sozinho numa térmica. O aplicativo Comandou Impressão faz essa ponte e roda em segundo plano, perto do relógio.',
    steps: [
      <>
        No computador que fica ligado à impressora (normalmente o do caixa), toque em <b>Baixar</b>.
      </>,
      <>
        Abra o arquivo baixado e instale. No Windows, se aparecer o aviso azul, toque em{' '}
        <b>Mais informações › Executar assim mesmo</b>.
      </>,
    ],
    targets: [{ css: '.print-hero__actions' }, { css: '.print-hero' }],
  },
  {
    path: '/impressao',
    title: 'Conecte o computador',
    text: 'Liga o aplicativo a este restaurante. O código aparece uma vez só.',
    steps: [
      <>
        Toque em <b>Conectar computador</b>, dê um nome (ex.: "PC do caixa") e toque em{' '}
        <b>Gerar código</b>.
      </>,
      <>
        Toque em <b>Abrir no aplicativo</b>. Se não abrir, toque em <b>Copiar</b> e cole no
        aplicativo.
      </>,
    ],
    targets: [{ button: 'Conectar computador' }],
  },
  {
    path: '/impressao',
    title: 'Ligue a impressora no aplicativo',
    text: 'O aplicativo aceita impressora USB, de rede (cabo ou Wi-Fi), Bluetooth e serial.',
    steps: [
      <>
        No aplicativo, toque em <b>Adicionar impressora</b>.
      </>,
      <>Diga como ela está ligada, escolha na lista e toque em Imprimir teste.</>,
      <>
        Saiu certinho? <b>Salvar</b>. O botão <b>Ajuda</b> do aplicativo tem o passo a passo de cada
        tipo.
      </>,
    ],
    targets: [{ css: '[data-search-id="secao-ligacao"]' }, { css: '.print-steps' }],
  },
  {
    path: '/impressao',
    title: 'Computadores conectados',
    text: 'Mostra se o aplicativo está online. Offline = o computador está desligado, sem internet ou o aplicativo foi fechado.',
    steps: [
      <>
        Perdeu o código ou trocou de computador? Toque em <b>gerar novo código</b> (o anterior para
        na hora).
      </>,
      <>
        Computador que não usa mais: <b>desativar</b>.
      </>,
    ],
    targets: [{ css: '[data-search-id="secao-agentes"]' }],
  },
  {
    path: '/impressao',
    title: 'Fila de impressão',
    text: 'Tudo o que foi mandado para imprimir e se saiu. Se falhar, o motivo aparece embaixo.',
    steps: [
      <>
        Toque em <b>Imprimir teste</b> para conferir se está tudo ligado.
      </>,
      <>
        Falhou? Resolva o motivo e toque em <b>Tentar de novo</b>.
      </>,
    ],
    targets: [{ css: '[data-search-id="secao-fila"]' }],
  },
  {
    path: '/impressao',
    title: 'Modelos de impressão',
    text: 'O que sai em cada papel: comanda da cozinha, conferência de conta e cupom.',
    steps: [<>Escolha o que mostrar e veja a prévia ao lado antes de salvar.</>],
    targets: [{ css: '[data-search-id="secao-modelos"]' }],
  },
];

export const printEnds: TourEnds = {
  intro: {
    title: 'Tutorial da Impressão',
    text: (
      <>
        Em 3 passos as comandas passam a sair sozinhas: <b>instalar o aplicativo</b>,{' '}
        <b>conectar o computador</b> e <b>escolher a impressora</b>. Faça com o computador do caixa
        ligado à impressora.
      </>
    ),
  },
  outro: {
    title: 'Impressão explicada!',
    targets: [{ css: '[data-tour-button]' }],
    text: (
      <>
        Para cada cozinha (bar, chapa) ter a sua impressora, escolha uma por setor no aplicativo. Os
        setores vêm de <b>Ajustes</b>. {REVIEW}
      </>
    ),
  },
};

/* ------------------------------------------------------------------ Ajustes */

export const SETTINGS_STOPS: TourStop[] = [
  {
    path: '/configuracoes',
    title: 'Setores de produção',
    text: 'Para onde cada item vai quando é pedido: cada setor tem a sua fila na Cozinha e pode ter a sua impressora.',
    steps: [
      <>
        Digite o nome (Cozinha, Bar, Chapa) e toque em <b>Adicionar</b>.
      </>,
      <>Depois, no cadastro de cada item, escolha o setor em "Cozinha (KDS)".</>,
    ],
    targets: [{ css: '[data-search-id="secao-setores"]' }],
  },
  {
    path: '/configuracoes',
    title: 'Mesas do salão',
    text: 'As mesas, os lugares e as áreas (varanda, mezanino), num editor visual.',
    steps: [
      <>Toque no cartão para abrir o editor do salão e criar várias mesas de uma vez.</>,
      <>Cobra taxa de serviço? Digite a porcentagem e salve.</>,
    ],
    targets: [{ css: '[data-search-id="secao-mesas"]' }],
  },
  {
    path: '/configuracoes',
    title: 'Terminais de caixa',
    text: 'Cada ponto que recebe dinheiro (Caixa 1, Caixa do bar). Cada um abre e fecha o próprio caixa.',
    steps: [
      <>
        Digite o nome e toque em <b>Adicionar</b>.
      </>,
    ],
    targets: [{ css: '[data-search-id="secao-caixas"]' }],
  },
];

export const settingsEnds: TourEnds = {
  intro: {
    title: 'Tutorial dos Ajustes',
    text: 'Aqui ficam os cadastros que o dia a dia usa: cozinhas, mesas e caixas. Faça antes da primeira venda.',
  },
  outro: {
    title: 'Ajustes explicados!',
    targets: [{ css: '[data-tour-button]' }],
    text: (
      <>
        Próximo passo: ligue a impressora em <b>Sistema › Impressão</b>. {REVIEW}
      </>
    ),
  },
};

/* ------------------------------------------------------------------ Caixa */

export const CASH_STOPS: TourStop[] = [
  {
    path: '/caixa',
    title: 'Abrir o caixa',
    text: 'Pagamento só entra com o caixa aberto. Abra no começo de cada turno.',
    steps: [
      <>
        Toque em <b>Abrir caixa</b>.
      </>,
      <>Conte o dinheiro da gaveta e digite como troco inicial.</>,
    ],
    targets: [{ button: 'Abrir caixa' }, { css: '.cash-head' }],
  },
  {
    path: '/caixa',
    title: 'Sangria e suprimento',
    text: 'Todo dinheiro que entra ou sai da gaveta sem ser venda precisa ser lançado, senão o fechamento não bate.',
    steps: [
      <>
        Tirou dinheiro (para o cofre, para pagar fornecedor)? <b>Sangria</b>.
      </>,
      <>
        Colocou troco? <b>Suprimento</b>.
      </>,
    ],
    targets: [{ button: 'Sangria' }, { button: 'Suprimento' }, { css: '.cash-head__actions' }],
  },
  {
    path: '/caixa',
    title: 'Fechar o caixa',
    text: 'No fim do turno, você confere o que o sistema espera em cada forma de pagamento.',
    steps: [
      <>
        Toque em <b>Fechar caixa</b>.
      </>,
      <>Conte o dinheiro e confira as maquininhas; digite o valor de cada forma.</>,
      <>Deu diferença? Escreva o motivo. O relatório fica guardado.</>,
    ],
    targets: [{ button: 'Fechar caixa' }, { css: '.cash-head__actions' }],
  },
  {
    path: '/caixa',
    title: 'Ver outros caixas',
    text: 'Com mais de um terminal, escolha qual ver ou veja todos juntos.',
    steps: [
      <>
        Use <b>Este terminal</b> / <b>Todos os caixas</b> e toque num fechamento antigo para ver o
        detalhe.
      </>,
    ],
    targets: [{ css: '[aria-label="Quais caixas mostrar"]' }, { css: '.cash-head' }],
  },
];

export const cashEnds: TourEnds = {
  intro: {
    title: 'Tutorial do Caixa',
    text: 'O ciclo de cada turno: abrir com o troco, lançar sangrias e suprimentos e fechar conferindo cada forma de pagamento.',
  },
  outro: {
    title: 'Caixa explicado!',
    targets: [{ css: '[data-tour-button]' }],
    text: (
      <>
        Não tem terminal ainda? Crie em <b>Sistema › Ajustes › Terminais de caixa</b>. {REVIEW}
      </>
    ),
  },
};

/* ------------------------------------------------------------------ Salão */

export const SALON_STOPS: TourStop[] = [
  {
    path: '/mesas',
    title: 'Mapa das mesas',
    text: 'Cada mesa mostra se está livre, ocupada ou pedindo a conta.',
    steps: [
      <>Toque numa mesa livre para abrir a comanda e lançar o pedido.</>,
      <>Toque numa mesa ocupada para pedir mais, transferir, dividir ou fechar a conta.</>,
    ],
    targets: [{ css: '.salon__tabs' }, { css: '.page-head' }],
  },
  {
    path: '/mesas',
    title: 'Monte o seu salão',
    text: 'Só gerentes veem estes botões.',
    steps: [
      <>
        <b>Personalizar mesas</b>: crie as mesas, mude formato, lugares e área.
      </>,
      <>
        <b>QR das mesas</b>: imprima e cole na mesa; o cliente pede pelo celular.
      </>,
      <>
        <b>Garçons</b>: o link para o garçom pedir pelo celular.
      </>,
    ],
    targets: [{ button: 'Personalizar mesas' }, { css: '.page-head .actions-row' }],
  },
  {
    path: '/mesas',
    title: 'Comandas, delivery e para levar',
    text: 'As outras abas mostram as comandas sem mesa (balcão, ficha) e os pedidos para entregar ou levar.',
    steps: [
      <>
        Cliente no balcão sem mesa? Aba <b>Comandas</b> › <b>Comanda avulsa</b>.
      </>,
    ],
    targets: [{ css: '.salon__tabs' }],
  },
];

export const salonEnds: TourEnds = {
  intro: {
    title: 'Tutorial do Salão',
    text: 'Como atender as mesas: abrir a comanda, lançar pedidos e fechar a conta. E como montar o salão e os QR Codes.',
  },
  outro: {
    title: 'Salão explicado!',
    targets: [{ css: '[data-tour-button]' }],
    text: (
      <>
        O garçom faz o mesmo pelo celular: ele escaneia o QR da mesa com <b>Escanear mesa</b>.{' '}
        {REVIEW}
      </>
    ),
  },
};

/* ------------------------------------------------------------------ Loja online */

export const STORE_STOPS: TourStop[] = [
  {
    path: '/loja-online',
    click: { button: 'Aparência' },
    title: 'Aparência',
    text: 'O visual do cardápio online.',
    steps: [
      <>
        Em <b>Capa e logo</b>, envie o logo (quadrado) e a capa (foto larga do ambiente ou do
        prato).
      </>,
      <>
        Em <b>Cores e identidade</b>, escolha a cor principal.
      </>,
      <>A prévia mostra como fica no celular do cliente.</>,
    ],
    targets: [{ css: '.os-panel' }],
  },
  {
    path: '/loja-online',
    click: { button: 'Banners' },
    title: 'Banners',
    text: 'As faixas de promoção no topo do cardápio.',
    steps: [
      <>
        Toque em <b>Novo banner</b>, escolha a imagem e para onde ele leva (um item ou categoria).
      </>,
      <>Use as setas para mudar a ordem.</>,
    ],
    targets: [{ css: '.os-panel' }],
  },
  {
    path: '/loja-online',
    click: { button: 'Destaques' },
    title: 'Destaques',
    text: 'Os itens que aparecem primeiro, em "Destaques da casa".',
    steps: [<>Marque os itens que você quer vender mais.</>],
    targets: [{ css: '.os-panel' }],
  },
  {
    path: '/loja-online',
    click: { button: 'Funcionamento' },
    title: 'Funcionamento',
    text: 'Quando a loja aceita pedidos, tempo de preparo e aceite.',
    steps: [
      <>
        Marque os horários de cada dia e toque em <b>Salvar horário</b>.
      </>,
      <>
        Quer que os pedidos entrem sem você tocar em aceitar? Ligue{' '}
        <b>Aceitar pedidos automaticamente</b>.
      </>,
    ],
    targets: [{ css: '.os-panel' }],
  },
  {
    path: '/loja-online',
    title: 'Divulgue o link',
    text: 'É por ele que o cliente pede.',
    steps: [
      <>
        Toque em <b>Copiar link</b> e coloque no Instagram, no WhatsApp e no Google.
      </>,
      <>
        <b>Abrir cardápio</b> mostra a loja como o cliente vê.
      </>,
    ],
    targets: [{ button: 'Copiar link' }],
  },
];

export const storeEnds: TourEnds = {
  intro: {
    title: 'Tutorial da Loja online',
    text: 'Vamos deixar o cardápio online pronto para receber pedidos: aparência, banners, destaques, horários e o link para divulgar.',
  },
  outro: {
    title: 'Loja explicada!',
    targets: [{ css: '[data-tour-button]' }],
    text: (
      <>
        Entrega: as áreas e taxas ficam em <b>Entregas › Área de entrega</b>. {REVIEW}
      </>
    ),
  },
};

/* ------------------------------------------------------------------ Entregas */

export const DELIVERY_STOPS: TourStop[] = [
  {
    path: '/entregas',
    click: { button: 'Área de entrega' },
    title: 'Área de entrega (faça primeiro)',
    text: 'Onde você entrega, quanto cobra e o pedido mínimo. Fora da área, o cliente não consegue pedir entrega.',
    steps: [
      <>Desenhe no mapa por bairro ou por raio (km).</>,
      <>Dê a taxa e o pedido mínimo de cada área e salve.</>,
    ],
    targets: [{ css: '[aria-label="Seções de entregas"]' }],
  },
  {
    path: '/entregas',
    click: { button: 'Entregadores' },
    title: 'Entregadores',
    text: 'Quem leva os pedidos. Cada um acompanha as entregas pelo celular.',
    steps: [
      <>Cadastre o entregador com nome e telefone.</>,
      <>
        Toque em <b>Link do entregador</b> e mande no WhatsApp dele: ele abre no celular e vê as
        entregas.
      </>,
    ],
    targets: [{ css: '[aria-label="Seções de entregas"]' }],
  },
  {
    path: '/entregas',
    click: { button: 'Ao vivo' },
    title: 'Despachar os pedidos',
    text: 'Os pedidos prontos esperam aqui; no mapa você vê cada entregador na rua.',
    steps: [
      <>Toque no pedido pronto e escolha o entregador.</>,
      <>O cliente recebe o link para acompanhar a entrega.</>,
    ],
    targets: [{ css: '.dl-kpis' }, { css: '.dl-head' }],
  },
  {
    path: '/entregas',
    click: { button: 'Hoje' },
    title: 'Hoje, acerto e repasses',
    text: 'O resumo do dia e o acerto de contas com cada entregador.',
    steps: [
      <>
        Em <b>Acerto</b>, confira o dinheiro que cada entregador recebeu na rua.
      </>,
    ],
    targets: [{ css: '[aria-label="Seções de entregas"]' }],
  },
];

export const deliveryEnds: TourEnds = {
  intro: {
    title: 'Tutorial das Entregas',
    text: 'Na ordem: área de entrega, entregadores e o despacho do dia a dia.',
  },
  outro: {
    title: 'Entregas explicadas!',
    targets: [{ css: '[data-tour-button]' }],
    text: REVIEW,
  },
};

/* ------------------------------------------------------------------ Equipe */

export const TEAM_STOPS: TourStop[] = [
  {
    path: '/equipe',
    title: 'Adicionar pessoa',
    text: 'Cada pessoa entra com o próprio e-mail e senha, e vê só o que o papel dela permite.',
    steps: [
      <>
        Toque em <b>Adicionar pessoa</b>.
      </>,
      <>Digite nome, e-mail e uma senha inicial.</>,
      <>
        Escolha o papel: <b>Garçom</b> (salão), <b>Cozinha</b> (fila), <b>Caixa</b> (receber),{' '}
        <b>PDV (balcão)</b>, <b>Entregador</b> ou <b>Gerente</b>. Embaixo aparece o que cada um pode
        fazer.
      </>,
    ],
    targets: [{ button: 'Adicionar pessoa' }],
  },
  {
    path: '/equipe',
    title: 'A equipe',
    text: 'Quem acessa o sistema e o papel de cada um.',
    steps: [
      <>Mudou de função? Troque o papel.</>,
      <>Saiu da casa? Desative: o acesso acaba na hora.</>,
    ],
    targets: [{ css: '.cm-card' }],
  },
];

export const teamEnds: TourEnds = {
  intro: {
    title: 'Tutorial da Equipe',
    text: 'Dê a cada pessoa o próprio acesso. Não compartilhe a senha do dono.',
  },
  outro: {
    title: 'Equipe explicada!',
    targets: [{ css: '[data-tour-button]' }],
    text: REVIEW,
  },
};
