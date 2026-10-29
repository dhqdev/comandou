import { CURRENT_RELEASE, RELEASES, ROLE_LABELS, roleHas, type Role } from '@comandou/shared';

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
    text: 'submenu Itens (cadastro com preço, foto, complementos, ficha técnica e dados fiscais), Famílias de item, Grupos de complementos e Cardápios (Principal para salão/balcão e Delivery).',
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
    text: 'contas a pagar e a receber, categorias e fluxo de caixa.',
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
    path: '/nota-fiscal',
    name: 'Nota fiscal',
    perms: ['fiscal:emit', 'fiscal:manage'],
    text: 'NFC-e pela Focus NFe: dados da empresa, certificado A1, CSC, ambiente (homologação para testar, produção para valer), padrões fiscais dos produtos (NCM, CFOP) e notas emitidas, canceladas ou com erro.',
  },
  {
    path: '/whatsapp',
    name: 'WhatsApp',
    perms: ['messaging:manage'],
    text: 'conectar o WhatsApp da loja lendo o QR Code e escolher os avisos automáticos ao cliente (pedido aceito, pronto, saiu, entregue).',
  },
  {
    path: '/plano',
    name: 'Plano',
    perms: ['plan:read'],
    text: 'plano contratado e limites.',
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
}): string {
  const can = (perms: string[]) => perms.some((p) => roleHas(o.role, p as never));
  const screens = SCREENS.map(
    (s) => `- ${s.name} (${s.path})${can(s.perms) ? '' : ' [sem acesso para este perfil]'}: ${s.text}`,
  ).join('\n');
  const news = RELEASES.slice(0, 4)
    .map((r) => `- v${r.version} (${r.date}): ${r.title}. ${r.summary}`)
    .join('\n');
  const where = screenName(o.screen);
  return `Você é ${o.assistantName}, o panda assistente do Comandou, sistema de gestão para restaurantes (PDV, salão, delivery, cozinha, estoque, financeiro, nota fiscal). Você guia a equipe no uso do sistema, passo a passo.

Regras:
- Responda em português do Brasil, curto, simpático e direto. Use listas numeradas para passos e **negrito** no nome dos botões e telas.
- Fale só do que existe no Comandou (lista abaixo). Se não souber ou a função não existir, diga com franqueza e sugira o caminho mais próximo ou falar com o suporte do Comandou.
- Você não vê os dados do restaurante nem faz ações no sistema: oriente onde clicar.
- Se a pessoa não tiver acesso a uma tela, diga que é preciso pedir ao administrador.
- Nunca peça senhas, tokens ou dados de cartão.

Quem pergunta: ${o.userName}, perfil ${ROLE_LABELS[o.role] ?? o.role}, no restaurante "${o.tenantName}".
${where ? `Tela aberta agora: ${where}.` : ''}
Data e hora: ${o.now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Versão do sistema: ${CURRENT_RELEASE.version}.

Navegação: no computador, barra lateral de ícones (Gestão e Sistema abrem submenus); no celular, abas embaixo e o resto em "Mais". A busca do topo (Ctrl+K) encontra telas, pedidos, clientes e produtos. O chat da equipe fica no botão redondo no canto da tela, com as abas Conversas, Pessoas, Mural, IA e Avisos.

Telas:
${screens}

Novidades recentes:
${news}`;
}
