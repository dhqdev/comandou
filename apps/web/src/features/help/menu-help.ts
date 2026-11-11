import type { HelpDict } from '../../design-system';
import { FISCAL_ITEM_HELP } from './fiscal-help';

/**
 * Ajuda dos campos do Cardápio ("?" ao lado de cada rótulo). Chave = rótulo do campo.
 * Rótulos repetidos com sentidos diferentes (Nome, Tipo) ficam em dicionários próprios.
 */
export const ITEM_HELP: HelpDict = {
  'Foto do item': {
    text: 'Imagem que aparece no cardápio online, no PDV e no app do garçom. Foto quadrada e bem iluminada vende mais.',
  },
  Código: {
    text: 'Código interno do item, usado na busca e nos relatórios. Se ficar vazio, o sistema cria um sozinho (IT-000001).',
    example: 'X-BURGER ou 1020',
  },
  'Nome do item': {
    text: 'Como o item aparece para o cliente, na comanda, na cozinha e na nota fiscal.',
    example: 'X-Burger da casa',
  },
  Descrição: {
    text: 'Texto curto que aparece embaixo do nome no cardápio online. Diga ingredientes, tamanho e o que acompanha.',
  },
  Categoria: {
    text: 'Seção do cardápio em que o item fica (Lanches, Bebidas…). A ordem das categorias é a ordem que o cliente vê.',
    link: { to: '/cardapio', label: 'Ver categorias' },
  },
  Preço: {
    text: 'Preço base do item. Os cardápios usam este valor, a não ser que você defina um preço próprio no cardápio (ex.: delivery mais caro).',
    link: { to: '/cardapio/cardapios', label: 'Abrir cardápios' },
  },
  'Unidade de medida': {
    text: 'Como o item é vendido: unidade, quilo, litro… Sai na nota fiscal como unidade comercial.',
  },
  Família: {
    text: 'Agrupa as vendas nos relatórios, independente da categoria. Ex.: "Bebidas" junta refrigerante, suco e cerveja mesmo que fiquem em categorias diferentes.',
    link: { to: '/cardapio/familias', label: 'Abrir famílias' },
  },
  'Cozinha (KDS)': {
    text: 'Para qual tela de cozinha (ou impressora) o item vai quando é pedido. Bebida pode ir para o bar e lanche para a chapa.',
    link: { to: '/configuracoes?foco=secao-setores', label: 'Criar ou editar cozinhas' },
  },
  'Selo no cardápio online': {
    text: 'Etiqueta pequena em cima da foto no cardápio online. Use poucas palavras.',
    example: 'Novo, Picante, Vegano',
  },
  'Vendido por peso': {
    text: 'Ligue para itens vendidos no quilo (sorveteria, self-service, açougue, frios). O preço passa a ser do quilo. No PDV, no salão e no app do garçom, ao tocar no item abre a pesagem: digite o que a balança mostra (0,350 · 350 g · 1,2 kg). No cardápio online o cliente escolhe o peso, de 100 g a 5 kg.',
    example: 'Sorvete R$ 60,00/kg: 350 g = R$ 21,00',
  },
  'Tara (g)': {
    text: 'Peso do pote, prato ou marmita. Na pesagem o sistema desconta a tara do que a balança mostra e cobra só o peso líquido.',
    example: 'Pote de 20 g: balança 370 g → cobra 350 g',
  },
  'Destaque no cardápio online': {
    text: 'Coloca o item na faixa de destaques, no topo do cardápio online.',
    link: { to: '/loja-online?aba=destaques', label: 'Ver os destaques da loja' },
  },
  Esgotado: {
    text: 'O item continua aparecendo, mas ninguém consegue pedir. Use quando acabar no dia; amanhã é só desmarcar.',
  },
  Pausado: {
    text: 'Tira o item de todos os cardápios (PDV, garçom e online) até você reativar. Use para item fora de época.',
  },
  Cardápios: {
    text: 'Em quais cardápios o item aparece e por qual preço. Principal vale no balcão e no salão; Delivery vale na entrega e no cardápio online. Preço vazio usa o preço do item.',
    link: { to: '/cardapio/cardapios', label: 'Abrir cardápios' },
  },
  Custo: {
    text: 'Quanto custa fazer o item. Serve para calcular margem e lucro nos relatórios. Com ficha técnica, o custo é calculado sozinho pelos insumos.',
    link: { to: '/estoque', label: 'Abrir estoque' },
  },
  'Tipo de código de barras': {
    text: 'Fixo: código de fábrica (EAN). Peso variável e valor variável: etiqueta da balança, que começa com 2 e já traz o peso ou o preço.',
  },
  'Código de barras (EAN)': {
    text: 'Número embaixo do código de barras da embalagem. Com ele, o leitor acha o item na hora no PDV.',
    example: '7891000000017',
  },
  'Adicionar grupo': {
    text: 'Liga ao item um grupo de complementos (tamanhos, adicionais, sabores). O cliente escolhe as opções quando pede o item.',
    link: { to: '/cardapio/complementos', label: 'Abrir grupos de complementos' },
  },
  'Quanto tem hoje': {
    text: 'Saldo do item agora, contado na prateleira. Cada venda baixa esse saldo; quando chegar a zero, o item sai do cardápio até a próxima entrada no Estoque.',
    example: '24 ou 12,5',
  },
  Unidade: {
    text: 'Como o item é contado: por unidade (lata, porção pronta), por quilo ou por litro.',
  },
  Insumo: {
    text: 'Ingrediente do estoque usado neste item. A cada venda, o sistema baixa a quantidade do estoque e soma o custo.',
    link: { to: '/estoque', label: 'Cadastrar insumos' },
  },
  ...FISCAL_ITEM_HELP,
};

export const CATEGORY_HELP: HelpDict = {
  Nome: {
    text: 'Nome da seção do cardápio, como o cliente vai ver.',
    example: 'Lanches, Bebidas, Sobremesas',
  },
  'Foto da categoria': {
    text: 'Imagem pequena que aparece ao lado do nome da categoria no cardápio online.',
  },
  'Cozinha (KDS)': {
    text: 'Para qual tela de cozinha (ou impressora) vão os itens desta categoria. Ao trocar, todos os itens dela passam para a cozinha escolhida; um item ainda pode ter a sua própria.',
    link: { to: '/configuracoes?foco=secao-setores', label: 'Criar ou editar cozinhas' },
  },
};

export const FAMILY_HELP: HelpDict = {
  'Nome da família': {
    text: 'Nome do grupo de vendas nos relatórios. Família não aparece para o cliente.',
    example: 'Bebidas, Pizzas, Sobremesas',
  },
  Inativa: {
    text: 'A família some da escolha no cadastro do item. Os relatórios antigos continuam com ela.',
  },
  'Vendido como complemento, conta como produto': {
    text: 'Ligue na família dos sabores de pizza: na análise do cardápio, a pizza meio a meio conta meia venda de cada sabor.',
    link: { to: '/relatorios', label: 'Ver relatórios' },
  },
};

export const GROUP_HELP: HelpDict = {
  'Nome do grupo': {
    text: 'Título que o cliente vê quando escolhe as opções.',
    example: 'Escolha o tamanho, Adicionais',
  },
  Tipo: {
    text: 'Adicional: extras opcionais. Tamanho/variação: escolhe 1 (P, M, G). Sabores: pizza meio a meio. Retirar ingrediente: "sem cebola", sem custo.',
  },
  Cobrança: {
    text: 'Como o preço das opções entra no item. Somar: cada opção soma. Mais cara: pizza meio a meio cobra o sabor mais caro. Média: cobra a média dos sabores.',
  },
  Mínimo: {
    text: 'Quantas opções o cliente precisa escolher no mínimo. 0 = opcional; 1 ou mais = obrigatório (o pedido não segue sem escolher).',
  },
  Máximo: {
    text: 'Quantas opções o cliente pode escolher no máximo. Ex.: pizza de 2 sabores tem máximo 2.',
  },
  'Opções do grupo': {
    text: 'Cada linha é uma opção. Preço é o valor somado ao item (0 = grátis). Padrão já vem marcada. Disponível desmarcado esconde a opção sem apagar.',
  },
  'Pausar o grupo': {
    text: 'Esconde o grupo do PDV, do garçom e do cardápio online sem desligar dos itens.',
  },
};

export const MENUS_HELP: HelpDict = {
  Nome: {
    text: 'Nome interno do cardápio, só a equipe vê.',
    example: 'Delivery fim de semana',
  },
  Tipo: {
    text: 'Principal vale no balcão, no salão, no garçom e na mesa. Delivery vale na entrega, na retirada e no cardápio online. Só um de cada tipo fica ativo. Integração vai para a sua loja no iFood (um por loja).',
  },
  Integração: {
    text: 'A loja do iFood que recebe este cardápio. Itens, preços, complementos e disponibilidade vão sozinhos a cada alteração; o botão Sincronizar manda tudo na hora (e as fotos).',
  },
  'Começar com': {
    text: 'De onde vêm os itens do cardápio novo: todos os itens no preço base, ou uma cópia de um cardápio que já existe (com os preços dele).',
  },
  'Nome do cardápio': {
    text: 'Nome interno do cardápio, só a equipe vê.',
  },
  'Vale em': {
    text: 'Onde este cardápio é usado. O tipo não muda depois de criado; para outro uso, crie outro cardápio.',
  },
  'Itens no cardápio': {
    text: 'Ligue os itens que aparecem neste cardápio. O preço vazio usa o preço do item; preencha para cobrar diferente aqui. Reajustar preços aplica um % em todos de uma vez.',
  },
  Percentual: {
    text: 'Quanto subir ou baixar, em %. Use número negativo para baixar.',
    example: '10 para subir 10%, -5 para baixar 5%',
  },
  Arredondar: {
    text: 'Deixa o preço com um final redondo. No aumento arredonda para cima e na redução para baixo. Pode usar só o arredondamento, sem percentual.',
    example: 'R$ 43,89 vira R$ 43,90',
  },
  Categoria: {
    text: 'Reajusta só os itens de uma categoria, ou de todas.',
  },
};
