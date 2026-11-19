import {
  CURRENT_RELEASE,
  FIX_HINTS,
  RELEASES,
  ROLE_LABELS,
  roleHas,
  STATIC_ENTRIES,
  type Role,
} from '@comandou/shared';

/**
 * O que o assistente sabe do Comandou: as telas, para que servem e os caminhos mais comuns.
 * Fica curto de propósito (vai em toda pergunta e conta tokens).
 */
const SCREENS: { path: string; name: string; perms: string[]; text: string }[] = [
  {
    path: '/',
    name: 'PDV',
    perms: ['orders:write'],
    text: 'tela inicial: salão em cima e pedidos embaixo em colunas pelo andamento (aceitar, produzir, despachar). "Nova venda" abre em tela cheia com a grade de produtos, os itens e o painel do pedido (balcão, mesa, retirada, entrega ou **Fiado**). Fiado: escolha Fiado no Tipo de atendimento (ou no pedido já lançado, opção Fiado); a cobrança vai para a Agenda com a tag Fiado e o cliente recebe o lembrete pelo WhatsApp.',
  },
  {
    path: '/pedidos',
    name: 'Pedidos',
    perms: ['orders:read'],
    text: 'todos os pedidos de todas as origens (PDV, salão, garçom, cardápio online, WhatsApp e aplicativos de delivery). Abas Hoje, Em andamento, A receber, Concluídos em aberto, Últimos 7 dias e Aplicativos (iFood, 99Food, Keeta, Rappi, aiqfome); filtros por período, status, tipo e busca. Clique no pedido para ver detalhes, mudar status, cancelar, imprimir, lançar como fiado ou emitir nota. Pedido de aplicativo não muda itens nem valores.',
  },
  {
    path: '/mesas',
    name: 'Salão',
    perms: ['tables:operate', 'payments:create'],
    text: 'mapa de mesas e comandas (visões Mesas, Comandas, Delivery e Para levar): abrir mesa, abrir comanda avulsa, lançar itens, transferir, dividir conta e receber. O desenho do salão é editável; o cadastro das mesas e o QR Code de cada uma ficam em Ajustes › Mesas do salão.',
  },
  {
    path: '/reservas',
    name: 'Reservas',
    perms: ['tables:operate', 'settings:manage'],
    text: 'calendário de reservas no jeito da Agenda: visões Dia (cartões ao lado da grade de horários), Semana, Mês e Lista, com minicalendário, resumo do dia e filtro por situação. **Nova reserva** cria uma; arrastar o cartão remarca e cada reserva tem o tempo na mesa. O cliente reserva pelo cardápio online ou pela IA do WhatsApp e a equipe confirma, escolhe a mesa e marca a chegada. As regras (horários, lotação, antecedência) ficam no botão de ajustes da tela.',
  },
  {
    path: '/cozinha',
    name: 'Cozinha',
    perms: ['kitchen:operate', 'orders:manage'],
    text: 'fila da cozinha (KDS) por setor: começar preparo e marcar pronto. A cozinha tem um app só dela.',
  },
  {
    path: '/caixa',
    name: 'Caixa',
    perms: ['cash:operate', 'cash:close', 'reports:read'],
    text: 'abrir o caixa com o troco, sangria e suprimento, ver os recebimentos por forma de pagamento e fechar o caixa conferindo os valores. Sem caixa aberto não dá para receber. Ao fechar, o dia vai sozinho para o Financeiro: cada forma de pagamento vira um recebível com a taxa da maquininha e o dia em que o dinheiro cai na conta (o dinheiro da gaveta já entra como recebido; sobra ou falta entra no DRE).',
  },
  {
    path: '/entregas',
    name: 'Entregas',
    perms: ['delivery:manage'],
    text: 'abas Ao vivo (despacho para o entregador e mapa com quem está na rua), Entregadores, Área de entrega (taxa e pedido mínimo desenhados no mapa), Hoje, Acerto e Repasses (ganhos dos entregadores). O entregador conclui com o código de 4 dígitos do cliente; pelo painel dá para concluir sem o código. Quando o aplicativo de delivery leva o pedido, o despacho com motoboy da loja fica travado.',
  },
  {
    path: '/cardapio',
    name: 'Cardápio',
    perms: ['catalog:read'],
    text: 'submenu Itens (cadastro com preço, foto, complementos, ficha técnica e dados fiscais), Famílias de item, Grupos de complementos e Cardápios (Principal para salão/balcão e Delivery; o cardápio do iFood segue o estoque e mostra o que está diferente do portal). Primeiros passos com IA (botão na Conta) lê PDF, fotos, link ou texto do cardápio e até acha o restaurante no Google Maps; tudo cai numa conferência antes de entrar. Venda por peso (sorveteria, restaurante por quilo, açougue): no cadastro do item ligue **Vendido por peso**; o preço passa a ser o do kg e dá para informar a **tara** (peso do pote ou prato, descontado do que a balança mostra). Ao lançar o item no PDV, no salão ou no app do garçom, o sistema pede o peso (aceita 0,350, 350 g ou 1,2 kg); no cardápio online o cliente escolhe o peso de 100 g a 5 kg. Cupom, cozinha e nota mostram o peso (a nota sai em KG).',
  },
  {
    path: '/estoque',
    name: 'Estoque',
    perms: ['stock:read'],
    text: 'submenu com quatro telas: Insumos (saldo, custo e alerta de cada insumo; dentro dela, Lotes e validade em /estoque/lotes), Movimentações (Recebimento da nota do fornecedor em /estoque/recebimento, Saída de estoque em /estoque/saida e Produção dos preparos da casa em /estoque/producao), Fichas técnicas (/estoque/fichas, com Fatores de conversão em /estoque/fatores e Precificação, CMV e preço sugerido, em /estoque/precificacao) e Inventário (/estoque/inventario). A venda baixa os insumos pela ficha técnica. Custo automático: quando o custo de um insumo muda (entrada ou recebimento com preço, produção ou o botão **Mudar preço** no detalhe do insumo), o sistema recalcula sozinho o custo de todo preparo da casa que leva o insumo (em cascata) e de todos os itens do cardápio e complementos que usam ele; a margem e o preço sugerido da Precificação já mostram o novo custo. Compra registrada mexe no custo médio (ponderado pelo saldo); para usar o preço novo na hora, use **Mudar preço** (mostra antes o impacto em cada item). Preparo não tem preço manual: o custo dele vem da ficha de preparo. Ficha circular (um preparo levando o outro) é recusada. O histórico fica em Precificação › Mudanças de custo e o detalhe do insumo mostra onde ele é usado. Quando uma compra encarece o custo, gerentes e administradores recebem um aviso com os itens que mais pesam. O preço de venda nunca muda sozinho.',
  },
  {
    path: '/loja-online',
    name: 'Loja online',
    perms: ['settings:manage'],
    text: 'o cardápio do cliente (link /pedir), com prévia ao lado. Abas Aparência (cores e logo), Página, Banners, Destaques, Fidelidade (pontos ou carimbos), Funcionamento (horários), Pix e Pagamentos (pagamento online). O cardápio abre de dois jeitos: online (entrega e retirada) e mesa (QR Code de cada mesa, em Ajustes › Mesas do salão; na mesa não tem entrega, reserva, conversa nem fidelidade).',
  },
  {
    path: '/clientes',
    name: 'Clientes',
    perms: ['customers:read'],
    text: 'cadastro dos clientes com histórico de pedidos, endereços, favoritos, pontos de fidelidade, CPF/CNPJ para nota e observações da equipe.',
  },
  {
    path: '/financeiro',
    name: 'Financeiro',
    perms: ['finance:read'],
    text: 'abas Visão geral (gráficos e leituras automáticas do mês), Contas (contas a pagar e a receber com categoria do plano de contas, que decide a linha do DRE; dá para repetir todo mês, como aluguel), Fechamentos (cada dia com os caixas fechados: vendas por forma, taxas, líquido, quando cai na conta, quebra de caixa, ticket médio; caixa antigo tem o botão Lançar no financeiro), Conciliação (importar o extrato OFX do banco; o que bate sozinho concilia sozinho: depósitos das maquininhas, PIX do dia e contas já pagas; o resto vira sugestão para confirmar, criar lançamento, marcar como transferência ou ignorar; recebível pago sem extrato dá para marcar à mão; tudo pode ser desfeito, menos o que baixou conta), Aplicativos (repasses do iFood e outros apps: cada repasse vira conta a receber "Repasse de vendas"; a taxa do app entra no DRE como despesa variável), Fluxo de caixa (entradas, taxas e saídas por dia) e DRE (receita, deduções, CMV, lucro bruto, despesas variáveis, margem de contribuição, despesas fixas, lucro líquido e sobra de caixa, comparado com o mês anterior, por competência ou por caixa, com indicadores: CMV de 25% a 35%, pessoal até 30%, ocupação até 10%, CMV + pessoal até 65%, margem líquida de 10% ou mais e ponto de equilíbrio). Em "Taxas e prazos" o gerente cadastra a taxa e os dias de cada forma de pagamento (padrão: débito 1,5% em 1 dia, crédito 3,2% em 30 dias, vale-refeição 3,6% em 15 dias, PIX e dinheiro sem taxa). O gerente escolhe em "Dia de início do mês" o dia em que o mês financeiro começa; os totais, a aba "Do mês", o fluxo e o DRE seguem esse período.',
  },
  {
    path: '/relatorios',
    name: 'Relatórios',
    perms: ['reports:read'],
    text: 'abas Relatórios (dezenas de relatórios prontos por grupo: vendas, produtos, curva ABC, engenharia de cardápio, formas de pagamento, canais, Vendas por aplicativo, cancelamentos, descontos, fiado em aberto, entregas por motoboy, bairros, clientes novos e que pararam de comprar, garçons e desafios, fechamentos de caixa), Análise (compara com o período anterior e aponta onde agir), Cardápio online (o que os clientes fazem no cardápio: visitas, itens vistos, carrinho, buscas e quantos pediram), Calendário (o mês dia a dia) e Dia (um dia em detalhe).',
  },
  {
    path: '/equipe',
    name: 'Equipe',
    perms: ['users:manage'],
    text: 'pessoas da equipe e perfis (Administrador, Gerente, Caixa, PDV (balcão), Garçom, Cozinha, Entregador): convidar, trocar perfil, desativar e redefinir senha.',
  },
  {
    path: '/impressao',
    name: 'Impressão',
    perms: ['printing:manage'],
    text: 'impressoras térmicas por setor (cozinha, bar, caixa) pelo aplicativo Comandou Impressão instalado num computador da loja (baixar o aplicativo, computadores conectados, como ligar a impressora, modelos de impressão, teste e fila de impressões).',
  },
  {
    path: '/fiscal/nfce',
    name: 'Fiscal (nota fiscal)',
    perms: ['fiscal:emit', 'fiscal:manage'],
    text: 'NFC-e e NF-e pela Focus NFe: notas emitidas, canceladas ou recusadas (cada recusa explica o motivo e o que corrigir), Configuração (dados da empresa, certificado A1, CSC, homologação para testar e produção para valer), Padrões fiscais (NCM, CFOP, CST), Inutilização e Notas recebidas. A NFC-e sai do detalhe do pedido depois de pago, ou sozinha se a emissão automática estiver ligada.',
  },
  {
    path: '/whatsapp',
    name: 'WhatsApp',
    perms: ['messaging:manage'],
    text: 'conectar o WhatsApp da loja lendo o QR Code (ou a API oficial da Meta), escolher os avisos automáticos ao cliente (pedido aceito, pronto, saiu, entregue) e enviar uma mensagem de teste.',
  },
  {
    path: '/assistente-ia',
    name: 'Assistente de IA',
    perms: ['settings:manage'],
    text: 'o gerente configura a IA que atende os clientes no WhatsApp: ligar o atendimento, nome, jeito de falar, boas-vindas, sobre a casa, o que ela não deve fazer, o que ela pode fazer (mostrar preços, sugerir itens, mandar o link do cardápio, fazer e cancelar reservas com o SIM do cliente, mandar o arquivo do cardápio e o calendário de reservas), quais itens do cardápio ela pode oferecer, os arquivos do cardápio e um teste da conversa como se fosse o cliente. Quando a IA chama a equipe, chega um aviso e ela fica quieta naquela conversa por um tempo.',
  },
  {
    path: '/integracoes',
    name: 'Aplicativos de delivery',
    perms: ['orders:manage'],
    text: 'iFood, 99Food, Keeta, Rappi e aiqfome: um cartão por aplicativo com a situação, as lojas ligadas (ligar loja, receber pedidos, aceitar sozinho), pausar e reabrir a loja no app, último evento, erros, itens que chegaram sem vínculo com o cardápio e as avaliações dos clientes (a resposta é sempre escrita por uma pessoa). Os pedidos dos apps entram em Pedidos (aba Aplicativos) e na cozinha como os outros. "Loja fechada" no PDV pausa os apps junto.',
  },
  {
    path: '/chamados',
    name: 'Chamados',
    perms: ['plan:read'],
    text: 'pedir ajuda ao Comandou sobre o que não funciona ou o que falta, com fotos e vídeos, e acompanhar cada passo em colunas do Recebido ao Resolvido. Para conversar sobre um chamado, botão **Falar no chat** (abre a aba Suporte do chat).',
  },
  {
    path: '/agenda',
    name: 'Agenda pessoal',
    perms: [],
    text: 'compromissos e tags de cada pessoa (só a própria pessoa vê os dela), visões Dia, Semana, Mês e Lista, lembrete pelo WhatsApp da loja (precisa do WhatsApp conectado por QR Code) e as cobranças de **fiado** (tag Fiado), que mandam a mensagem de cobrança ao cliente. Fica no pé do menu, acima da Conta.',
  },
  {
    path: '/conta',
    name: 'Conta',
    perms: [],
    text: 'aberta pelo nome no pé do menu (computador) ou pelo cartão do topo da tela Mais (celular). Blocos: Seu restaurante (Dados do restaurante, só o dono; Assinatura; Ajustes), Ajuda e novidades (Novidades, Falar com a Comandou, Primeiros passos, Rever apresentação), Este aparelho (tema claro ou escuro, instalar o app) e Você (Meus dados, Trocar senha, Sair).',
  },
  {
    path: '/plano',
    name: 'Assinatura (plano)',
    perms: ['plan:read'],
    text: 'fica na Conta. Mensalidade (valor único por mês, com tudo incluso e sem limite de pessoas, produtos ou pedidos), quanto falta, contrato, pagar e forma de pagamento da assinatura.',
  },
  {
    path: '/novidades',
    name: 'Novidades',
    perms: [],
    text: 'fica na Conta. O que mudou em cada versão do sistema.',
  },
  {
    path: '/configuracoes',
    name: 'Ajustes',
    perms: ['settings:manage', 'orders:read'],
    text: 'fica na Conta. Blocos: Este aparelho (fica só nele: modo maquininha e largura da bobina da impressão pelo navegador), Loja online (atalho), Setores de produção (cozinha, bar…), Mesas do salão (cadastro e QR Code de cada mesa) e Terminais de caixa. Formas de pagamento e taxas não ficam aqui: as do cardápio online estão em Loja online › Pagamentos e as taxas das maquininhas em Financeiro › Taxas e prazos.',
  },
];

export function screenName(path: string | null | undefined): string | null {
  if (!path) return null;
  const s = [...SCREENS]
    .sort((a, b) => b.path.length - a.path.length)
    .find((x) => (x.path === '/' ? path === '/' || path === '/pdv' : path.startsWith(x.path)));
  return s?.name ?? null;
}

export function systemPrompt(o: {
  assistantName: string;
  userName: string;
  role: Role;
  tenantName: string;
  screen?: string | null;
  now: Date;
  /** Retrato da operação agora (caixa, comandas, nota, impressão…), uma linha por item. */
  state?: string[];
}): string {
  const app = OWN_APPS[o.role];
  // Garçom, cozinha e entregador só abrem o app deles: as telas da loja ficam sem acesso.
  const can = (perms: string[]) =>
    !app && (perms.length === 0 || perms.some((p) => roleHas(o.role, p as never)));
  const screens = SCREENS.map(
    (s) =>
      `- ${s.name} (${s.path})${can(s.perms) ? '' : ' [sem acesso para este perfil]'}: ${s.text}`,
  ).join('\n');
  const news = RELEASES.slice(0, 4)
    .map((r) => `- v${r.version} (${r.date}): ${r.title}. ${r.summary}`)
    .join('\n');
  const where = screenName(o.screen);
  return `Você é ${o.assistantName}, o panda assistente do Comandou, sistema de gestão para restaurantes (PDV, salão, delivery, cozinha, estoque, financeiro, nota fiscal). Você guia a equipe no uso do sistema, passo a passo.

Regras:
- Responda em português do Brasil, curto, simpático e direto. Use listas numeradas para passos e **negrito** no nome dos botões e telas.
- Fale só do que existe no Comandou (lista abaixo). Se não souber ou a função não existir, diga com franqueza e sugira o caminho mais próximo ou falar com o suporte do Comandou.
- Sempre que mandar a pessoa a uma tela, coloque o link clicável no formato [Nome da tela](/caminho), usando só caminhos das listas abaixo (nunca invente caminho nem endereço de fora). Prefira o link mais exato (a seção, não só a tela). Não ponha link para tela marcada [sem acesso]. O link vira um botão que leva a pessoa direto ao lugar; diga também o caminho pelo menu (ex.: **Gestão › Financeiro › DRE**), para ela aprender.
- Se a pergunta for vaga ("onde fica isso?", "não acho"), use a "Tela aberta agora" para entender do que ela fala; se ainda assim não der, pergunte uma coisa só antes de responder.
- Quando a pessoa contar um erro ou algo que a impede (não consegue receber, fechar a comanda, emitir nota, imprimir…), diga a causa provável, o que fazer em passos curtos e o link da tela que resolve. Use "Impedimentos comuns" e "Estado agora".
- Você não faz ações no sistema: oriente onde clicar. Dos dados você só conhece o "Estado agora"; para números e listas, mande à tela certa.
- Perguntas de dinheiro (lucro, CMV, DRE, contas, quanto vai cair na conta, conciliação): responda com os números do "Estado agora" quando eles estiverem lá, explique em palavras simples o que cada um quer dizer e compare com a referência do setor; diga o que fazer para melhorar e mande à aba certa do Financeiro. Sem esses números (perfil sem acesso ao financeiro), não invente: diga a quem pedir.
- Se a pessoa não tiver acesso a uma tela, diga a quem pedir (administrador, gerente ou caixa).
- Nunca peça senhas, tokens ou dados de cartão.

Quem pergunta: ${o.userName}, perfil ${ROLE_LABELS[o.role] ?? o.role}, no restaurante "${o.tenantName}".
${where ? `Tela aberta agora: ${where}.` : ''}
Data e hora: ${o.now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Versão do sistema: ${CURRENT_RELEASE.version}.

Navegação: no computador, barra lateral de ícones (Operação: PDV, Pedidos, Salão, Reservas, Cozinha, Caixa, Entregas, Cardápio, Estoque e Fiscal; Gestão abre Loja online, Clientes, Financeiro, Relatórios e Equipe; Sistema abre Impressão, Aplicativos de delivery, WhatsApp, Assistente de IA e Chamados). No pé do menu ficam a Agenda pessoal e a Conta (o nome da pessoa), onde estão Assinatura, Ajustes e Novidades. No celular, abas embaixo e o resto em "Mais". A busca do topo (Ctrl+K) encontra telas, seções, pedidos, mesas, clientes e produtos. No topo, o botão **IA** abre você e o botão **Chat** abre as conversas, com as abas Conversas, Pessoas, Mural, Avisos, Clientes (conversas do cardápio online) e Suporte (falar com o Comandou).

Telas:
${screens}
${app ? `\nApp de ${ROLE_LABELS[o.role]} (o que esta pessoa usa):\n${app}\n` : ''}
Links diretos (seções e atalhos):
${links(can) || '- nenhum para este perfil'}

Impedimentos comuns (problema: o que fazer → tela):
${FIX_HINTS.map((h) => `- ${h.problem}: ${h.what}${h.to && can(h.perms ?? []) ? ` → ${h.to}` : h.ask ? ` (${h.ask})` : ''}`).join('\n')}
${o.state?.length ? `\nEstado agora no restaurante:\n${o.state.map((l) => `- ${l}`).join('\n')}\n` : ''}
Novidades recentes:
${news}`;
}

/** Apps próprios de cada papel, com os caminhos que existem neles. */
const OWN_APPS: Partial<Record<Role, string>> = {
  waiter:
    '- Mesas (/garcom/mesas): mapa do salão; tocar na mesa abre a comanda para lançar itens (item vendido por peso pede o peso da balança), pedir a conta, transferir e pedir cancelamento (o caixa aprova).\n- Meus pedidos (/garcom/pedidos): os pedidos que você lançou e o andamento.\n- Desafios (/garcom/desafios): metas e selos do garçom.\nReceber, dar desconto e fechar a conta ficam com o caixa.',
  kitchen:
    '- Cozinha (/cozinha): fila de preparo por setor; tocar no item começa o preparo e marca pronto.',
  driver:
    '- Entregas (/entregas): suas corridas; abrir no mapa, iniciar e concluir com o código de 4 dígitos que o cliente recebe.',
};

/** Seções e atalhos do catálogo de navegação (o mesmo da busca do topo). */
function links(can: (perms: string[]) => boolean): string {
  return STATIC_ENTRIES.filter(
    (e) =>
      e.to &&
      !e.external &&
      !e.action &&
      !SCREENS.some((s) => s.path === e.to) &&
      can(e.perms ?? []),
  )
    .map((e) => `- ${e.title}${e.hint ? ` (${e.hint})` : ''}: ${e.to}`)
    .join('\n');
}
