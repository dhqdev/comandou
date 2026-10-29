/**
 * Impedimentos comuns da operação e o caminho para resolver cada um.
 *
 * Quando a API recusa algo (caixa fechado, comanda já fechada, item esgotado…), a tela não
 * mostra só o erro: mostra o que fazer e um botão que leva direto à tela certa. O assistente de
 * IA do chat da equipe usa a mesma lista para orientar quem pergunta.
 *
 * `match` olha a mensagem que a API devolve. `to` só vira botão para quem tem uma das `perms`;
 * quem não tem lê `ask` (a quem pedir ajuda).
 */
export interface FixHint {
  id: string;
  /** O impedimento em poucas palavras (para o assistente de IA). */
  problem: string;
  match: RegExp;
  /** O que fazer, numa frase curta e direta. */
  what: string;
  /** Tela que resolve. */
  to?: string;
  /** Texto do botão ("Abrir o caixa"). */
  label?: string;
  /** Basta uma destas permissões para ir à tela. */
  perms?: string[];
  /** Para quem não pode ir à tela: a quem pedir. */
  ask?: string;
}

export const FIX_HINTS: FixHint[] = [
  // Caixa
  {
    id: 'cash-closed',
    problem: 'Caixa fechado ao receber',
    match: /caixa fechado|abra um caixa|nenhum caixa aberto/i,
    what: 'Abra o caixa com o troco inicial e depois receba de novo.',
    to: '/caixa',
    label: 'Abrir o caixa',
    perms: ['cash:operate'],
    ask: 'Peça a quem cuida do caixa para abrir o caixa.',
  },
  {
    id: 'cash-terminal-busy',
    problem: 'Terminal já tem caixa aberto',
    match: /terminal já tem um caixa aberto/i,
    what: 'Use o caixa que já está aberto neste terminal, ou feche-o antes de abrir outro.',
    to: '/caixa',
    label: 'Ver o caixa aberto',
    perms: ['cash:operate', 'cash:close'],
  },
  {
    id: 'cash-close-perm',
    problem: 'Sem permissão para fechar o caixa',
    match: /sem permissão para fechar o caixa/i,
    what: 'Fechar o caixa é com o gerente ou o administrador.',
    to: '/equipe',
    label: 'Ver perfis da equipe',
    perms: ['users:manage'],
    ask: 'Peça ao gerente para fechar o caixa.',
  },
  {
    id: 'cash-refund-money',
    problem: 'Sem dinheiro no caixa para estorno',
    match: /não há dinheiro suficiente neste caixa/i,
    what: 'Estorne em outra forma de pagamento ou faça um suprimento no caixa antes.',
    to: '/caixa',
    label: 'Fazer suprimento',
    perms: ['cash:operate'],
  },
  // Pedido
  {
    id: 'product-sold-out',
    problem: 'Produto esgotado no pedido',
    match: /produto esgotado/i,
    what: 'Tire o item do pedido, ou volte o item a ficar disponível no Cardápio.',
    to: '/cardapio',
    label: 'Abrir o Cardápio',
    perms: ['catalog:write'],
    ask: 'Tire o item do pedido. Para voltar a vender, peça ao gerente.',
  },
  {
    id: 'product-option',
    problem: 'Complemento inválido no item',
    match: /opção inválida para/i,
    what: 'Os complementos do item mudaram. Remova o item e adicione de novo.',
    to: '/cardapio/complementos',
    label: 'Ver complementos',
    perms: ['catalog:write'],
  },
  {
    id: 'order-table-missing',
    problem: 'Pedido de mesa sem mesa ou comanda',
    match: /pedido de mesa exige mesa ou comanda/i,
    what: 'Escolha a mesa ou a comanda no painel do pedido. Sem mesas cadastradas, crie em Ajustes.',
    to: '/configuracoes?foco=secao-mesas',
    label: 'Cadastrar mesas',
    perms: ['settings:manage'],
  },
  {
    id: 'order-address',
    problem: 'Entrega sem endereço',
    match: /delivery exige endereço|informe o endereço de entrega/i,
    what: 'Preencha o endereço de entrega do cliente no painel do pedido.',
  },
  {
    id: 'order-discount-perm',
    problem: 'Desconto sem permissão',
    match: /desconto e acréscimo ficam com o caixa ou o gerente/i,
    what: 'Envie o pedido sem desconto e peça ao caixa para aplicar na hora de receber.',
    ask: 'Peça ao caixa ou ao gerente para dar o desconto.',
  },
  {
    id: 'order-cancel-auth',
    problem: 'Cancelamento ou estorno pede autorização',
    match:
      /cancelamento exige autorização|estorno exige autorização|reabrir item exige autorização/i,
    what: 'Peça ao gerente para digitar a senha dele na confirmação.',
  },
  {
    id: 'order-dispatch',
    problem: 'Despachar entrega',
    match: /escolha o entregador na tela entregas/i,
    what: 'Despache o pedido escolhendo o entregador na tela Entregas.',
    to: '/entregas',
    label: 'Abrir Entregas',
    perms: ['delivery:manage'],
  },
  {
    id: 'order-not-ready',
    problem: 'Entrega ainda não está pronta',
    match: /pedido precisa estar pronto para sair/i,
    what: 'Marque o pedido como pronto (na Cozinha ou no PDV) e despache de novo.',
    to: '/cozinha',
    label: 'Abrir a Cozinha',
    perms: ['kitchen:operate', 'orders:manage'],
  },
  {
    id: 'order-stale',
    problem: 'Pedido alterado por outra pessoa',
    match: /alterado por outra pessoa|o pedido foi alterado/i,
    what: 'Feche esta janela e abra o pedido de novo para ver a versão atual.',
  },
  {
    id: 'order-below-paid',
    problem: 'Novo total menor que o já pago',
    match: /menor que o valor já pago/i,
    what: 'Estorne a diferença no pagamento do pedido e depois altere.',
    to: '/pedidos',
    label: 'Abrir Pedidos',
    perms: ['orders:read'],
  },
  // Salão e comandas
  {
    id: 'tab-closed',
    problem: 'Comanda já fechada',
    match: /comanda (de destino )?não está aberta/i,
    what: 'Essa comanda já foi fechada. Abra uma nova comanda no Salão.',
    to: '/mesas',
    label: 'Abrir o Salão',
    perms: ['tables:operate'],
  },
  {
    id: 'table-busy',
    problem: 'Mesa ocupada',
    match: /mesa (de destino )?(já )?está ocupada/i,
    what: 'Escolha uma mesa livre, ou lance os itens na comanda que já está aberta nela.',
    to: '/mesas',
    label: 'Ver o Salão',
    perms: ['tables:operate'],
  },
  {
    id: 'tab-unpaid',
    problem: 'Fechar comanda com saldo em aberto',
    match: /há saldo em aberto em/i,
    what: 'Receba o que falta (botão Receber na comanda) e feche de novo.',
  },
  {
    id: 'tab-in-production',
    problem: 'Fechar comanda com itens em produção',
    match: /ainda em produção/i,
    what: 'Marque os itens como prontos na Cozinha, ou cancele o que não vai sair, e feche de novo.',
    to: '/cozinha',
    label: 'Abrir a Cozinha',
    perms: ['kitchen:operate', 'orders:manage'],
  },
  {
    id: 'table-delete-open',
    problem: 'Excluir mesa com comanda aberta',
    match: /feche a comanda desta mesa antes de excluir/i,
    what: 'Receba e feche a comanda da mesa no Salão; depois exclua a mesa.',
    to: '/mesas',
    label: 'Abrir o Salão',
    perms: ['tables:operate'],
  },
  // Nota fiscal
  {
    id: 'fiscal-setup',
    problem: 'Nota fiscal sem CNPJ ou token',
    match: /configure o cnpj|informe o cnpj|token da focus nfe indisponível/i,
    what: 'Complete os dados da empresa e da Focus NFe na configuração fiscal.',
    to: '/fiscal/configuracao?foco=secao-focus',
    label: 'Configurar a nota',
    perms: ['fiscal:manage'],
    ask: 'Peça ao administrador para configurar a nota fiscal.',
  },
  {
    id: 'fiscal-certificate',
    problem: 'Nota fiscal sem certificado',
    match: /certificado digital a1/i,
    what: 'Envie o certificado A1 (.pfx) da empresa na configuração fiscal.',
    to: '/fiscal/configuracao?foco=secao-focus',
    label: 'Enviar o certificado',
    perms: ['fiscal:manage'],
    ask: 'Peça ao administrador para enviar o certificado digital.',
  },
  {
    id: 'fiscal-unpaid',
    problem: 'Nota de pedido não pago',
    match: /nota só é emitida com o pedido totalmente pago/i,
    what: 'Receba o valor que falta do pedido; depois emita a nota.',
  },
  {
    id: 'fiscal-owner',
    problem: 'Ligar nota em produção',
    match: /só o dono do restaurante muda a emissão/i,
    what: 'A troca para produção é feita pelo administrador dono do restaurante.',
    ask: 'Peça ao dono do restaurante para fazer a troca.',
  },
  // Impressão, entregas, estoque, WhatsApp
  {
    id: 'printing-agent',
    problem: 'Impressora não imprime',
    match: /nenhum agente de impressão ativo/i,
    what: 'Instale o aplicativo de impressão no computador da loja e conecte com o código.',
    to: '/impressao?foco=secao-agentes',
    label: 'Configurar impressão',
    perms: ['printing:manage'],
    ask: 'Peça ao gerente para ligar o computador da impressora.',
  },
  {
    id: 'courier-inactive',
    problem: 'Entregador inativo',
    match: /entregador inativo/i,
    what: 'Reative o entregador na Equipe ou escolha outro.',
    to: '/equipe',
    label: 'Abrir a Equipe',
    perms: ['users:manage'],
  },
  {
    id: 'stock-low',
    problem: 'Saldo de estoque insuficiente',
    match: /saldo insuficiente/i,
    what: 'Lance a entrada da mercadoria (Recebimento) ou ajuste a contagem no Inventário.',
    to: '/estoque/recebimento',
    label: 'Lançar recebimento',
    perms: ['stock:write'],
  },
  {
    id: 'stock-negative',
    problem: 'Estoque negativo',
    match: /saldo negativo: ajuste o estoque/i,
    what: 'Faça a contagem no Inventário para zerar o negativo e tente de novo.',
    to: '/estoque/inventario',
    label: 'Abrir o Inventário',
    perms: ['stock:write'],
  },
  {
    id: 'whatsapp-off',
    problem: 'WhatsApp desligado no servidor',
    match: /whatsapp não configurado no servidor/i,
    what: 'O envio pelo WhatsApp ainda não foi ligado no servidor. Fale com o suporte do Comandou.',
  },
  {
    id: 'permission',
    problem: 'Sem permissão',
    match: /permissão insuficiente/i,
    what: 'Seu perfil não faz isso. O administrador pode mudar o perfil na tela Equipe.',
    to: '/equipe',
    label: 'Abrir a Equipe',
    perms: ['users:manage'],
    ask: 'Peça ao administrador do restaurante.',
  },
];

export function findFixHint(message: string | null | undefined): FixHint | null {
  if (!message) return null;
  return FIX_HINTS.find((h) => h.match.test(message)) ?? null;
}
