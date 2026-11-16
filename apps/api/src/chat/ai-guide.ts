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
    text: 'tela inicial: salão em cima e pedidos embaixo em colunas pelo andamento (aceitar, produzir, despachar). "Nova venda" abre em tela cheia com a grade de produtos, os itens e o painel do pedido (balcão, mesa, retirada ou entrega).',
  },
  {
    path: '/pedidos',
    name: 'Pedidos',
    perms: ['orders:read'],
    text: 'todos os pedidos de todas as origens (PDV, salão, garçom, cardápio online, WhatsApp). Filtros por período, status, tipo e busca; clique no pedido para ver detalhes, mudar status, cancelar, imprimir ou emitir nota.',
  },
  {
    path: '/mesas',
    name: 'Salão',
    perms: ['tables:operate', 'payments:create'],
    text: 'mapa de mesas e comandas: abrir mesa, lançar itens, transferir, dividir conta e receber. O desenho do salão é editável.',
  },
  {
    path: '/reservas',
    name: 'Reservas',
    perms: ['tables:operate', 'settings:manage'],
    text: 'agenda de reservas do dia; o cliente reserva pelo cardápio online e a equipe confirma, escolhe a mesa e marca chegada. As regras (horários, lotação) ficam no botão de ajustes da tela.',
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
    text: 'abrir o caixa com o troco, sangria e suprimento, ver os recebimentos por forma de pagamento e fechar o caixa conferindo os valores. Sem caixa aberto não dá para receber.',
  },
  {
    path: '/entregas',
    name: 'Entregas',
    perms: ['delivery:manage'],
    text: 'pedidos de entrega, despacho para o entregador, mapa ao vivo, áreas de entrega (taxa e pedido mínimo desenhados no mapa), repasses e ganhos dos entregadores. O entregador conclui com o código de 4 dígitos do cliente.',
  },
  {
    path: '/cardapio',
    name: 'Cardápio',
    perms: ['catalog:read'],
    text: 'submenu Itens (cadastro com preço, foto, complementos, ficha técnica e dados fiscais), Famílias de item, Grupos de complementos e Cardápios (Principal para salão/balcão e Delivery). Venda por peso (sorveteria, restaurante por quilo, açougue): no cadastro do item ligue **Vendido por peso**; o preço passa a ser o do kg e dá para informar a **tara** (peso do pote ou prato, descontado do que a balança mostra). Ao lançar o item no PDV, no salão ou no app do garçom, o sistema pede o peso (aceita 0,350, 350 g ou 1,2 kg); no cardápio online o cliente escolhe o peso de 100 g a 5 kg. Cupom, cozinha e nota mostram o peso (a nota sai em KG).',
  },
  {
    path: '/estoque',
    name: 'Estoque',
    perms: ['stock:read'],
    text: 'submenu Visão geral (insumos e saldo), Lotes (validade), Produção (preparos da casa), Recebimento (nota do fornecedor), Saída de estoque, Inventário, Fichas técnicas, Fatores de conversão e Precificação (CMV e preço sugerido). A venda baixa os insumos pela ficha técnica.',
  },
  {
    path: '/loja-online',
    name: 'Loja online',
    perms: ['settings:manage'],
    text: 'o cardápio do cliente (link /pedir): aparência e cores, banners, horários, formas de pagamento, entrega e retirada, fidelidade (pontos ou carimbos) e o QR Code da loja.',
  },
  {
    path: '/clientes',
    name: 'Clientes',
    perms: ['customers:read'],
    text: 'cadastro dos clientes com histórico de pedidos, endereços e pontos de fidelidade.',
  },
  {
    path: '/financeiro',
    name: 'Financeiro',
    perms: ['finance:read'],
    text: 'contas a pagar e a receber, categorias e fluxo de caixa. O gerente escolhe em "Dia de início do mês" o dia em que o mês financeiro começa (ex.: dia 5, quando recebe); os totais do mês, a aba "Do mês" e o fluxo de caixa seguem esse período.',
  },
  {
    path: '/relatorios',
    name: 'Relatórios',
    perms: ['reports:read'],
    text: 'vendas por período, produtos, formas de pagamento, calendário do mês e a aba Análise, que compara com o período anterior e aponta onde agir.',
  },
  {
    path: '/equipe',
    name: 'Equipe',
    perms: ['users:manage'],
    text: 'pessoas da equipe e perfis (Administrador, Gerente, Caixa, PDV, Garçom, Cozinha, Entregador): convidar, trocar perfil, desativar e redefinir senha.',
  },
  {
    path: '/impressao',
    name: 'Impressão',
    perms: ['printing:manage'],
    text: 'impressoras térmicas por setor (cozinha, bar, caixa) via o agente de impressão instalado num computador da loja; teste de impressão e fila de impressões.',
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
    text: 'conectar o WhatsApp da loja lendo o QR Code e escolher os avisos automáticos ao cliente (pedido aceito, pronto, saiu, entregue).',
  },
  {
    path: '/assistente-ia',
    name: 'Assistente de IA',
    perms: ['settings:manage'],
    text: 'o gerente configura a IA que atende os clientes no WhatsApp: ligar o atendimento, nome, jeito de falar, boas-vindas, sobre a casa, o que ela não deve fazer, quais itens do cardápio ela pode oferecer e um teste da conversa como se fosse o cliente.',
  },
  {
    path: '/plano',
    name: 'Assinatura (plano)',
    perms: ['plan:read'],
    text: 'mensalidade (valor único por mês, com tudo incluso e sem limite de pessoas, produtos ou pedidos), contrato e pagamento da assinatura.',
  },
  {
    path: '/novidades',
    name: 'Novidades',
    perms: [],
    text: 'o que mudou em cada versão do sistema.',
  },
  {
    path: '/configuracoes',
    name: 'Ajustes',
    perms: ['settings:manage', 'orders:read'],
    text: 'dados da loja, setores de produção, formas de pagamento, taxas e preferências da operação.',
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
- Sempre que mandar a pessoa a uma tela, coloque o link clicável no formato [Nome da tela](/caminho), usando só caminhos das listas abaixo (nunca invente caminho nem endereço de fora). Prefira o link mais exato (a seção, não só a tela). Não ponha link para tela marcada [sem acesso].
- Quando a pessoa contar um erro ou algo que a impede (não consegue receber, fechar a comanda, emitir nota, imprimir…), diga a causa provável, o que fazer em passos curtos e o link da tela que resolve. Use "Impedimentos comuns" e "Estado agora".
- Você não faz ações no sistema: oriente onde clicar. Dos dados você só conhece o "Estado agora"; para números e listas, mande à tela certa.
- Se a pessoa não tiver acesso a uma tela, diga a quem pedir (administrador, gerente ou caixa).
- Nunca peça senhas, tokens ou dados de cartão.

Quem pergunta: ${o.userName}, perfil ${ROLE_LABELS[o.role] ?? o.role}, no restaurante "${o.tenantName}".
${where ? `Tela aberta agora: ${where}.` : ''}
Data e hora: ${o.now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Versão do sistema: ${CURRENT_RELEASE.version}.

Navegação: no computador, barra lateral de ícones (Gestão e Sistema abrem submenus); no celular, abas embaixo e o resto em "Mais". A busca do topo (Ctrl+K) encontra telas, pedidos, clientes e produtos. O chat da equipe fica no botão redondo no canto da tela, com as abas Conversas, Pessoas, Mural, IA e Avisos.

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
