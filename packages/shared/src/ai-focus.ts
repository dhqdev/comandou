/**
 * Campos, botões e blocos que o assistente de IA da equipe sabe apontar. O link dele leva à tela
 * com `?foco=<id>`: a tela rola até o elemento com `data-search-id="<id>"` e ele pisca
 * (`useSearchSpotlight` de apps/web/src/lib/deep-link.ts). As seções que a busca do topo já
 * conhece (STATIC_ENTRIES) não se repetem aqui.
 *
 * Alvo novo: um item aqui + `data-search-id` (ou `searchId` no Card) no elemento da tela. O teste
 * `apps/web/src/lib/ai-focus.test.ts` falha se o id não existir em nenhuma tela.
 */
export interface FocusTarget {
  id: string;
  /** Tela (e aba) onde o elemento aparece sem precisar de outro clique. */
  path: string;
  /** O que é, do jeito que a equipe fala. */
  title: string;
  /** Basta uma destas permissões. Sem `perms`, todos veem. */
  perms?: string[];
}

export const FOCUS_TARGETS: readonly FocusTarget[] = [
  // PDV
  {
    id: 'botao-nova-venda',
    path: '/',
    title: 'Botão Nova venda (F2)',
    perms: ['orders:write'],
  },
  {
    id: 'botao-loja-aberta',
    path: '/',
    title: 'Interruptor Loja aberta / Loja fechada (pausa os aplicativos junto)',
    perms: ['orders:write'],
  },
  // Caixa
  { id: 'botao-abrir-caixa', path: '/caixa', title: 'Botão Abrir caixa', perms: ['cash:operate'] },
  {
    id: 'botao-sangria',
    path: '/caixa',
    title: 'Botões Sangria e Suprimento (com o caixa aberto)',
    perms: ['cash:operate'],
  },
  { id: 'botao-fechar-caixa', path: '/caixa', title: 'Botão Fechar caixa', perms: ['cash:close'] },
  // Cardápio, estoque, equipe, clientes, reservas
  {
    id: 'botao-novo-item',
    path: '/cardapio',
    title: 'Botão Adicionar item do cardápio',
    perms: ['catalog:write'],
  },
  {
    id: 'botao-importar-cardapio',
    path: '/cardapio',
    title: 'Botão Importar com IA (lê PDF, foto ou link do cardápio)',
    perms: ['catalog:write'],
  },
  {
    id: 'botao-novo-insumo',
    path: '/estoque',
    title: 'Botão Novo insumo',
    perms: ['stock:write'],
  },
  {
    id: 'botao-nova-pessoa',
    path: '/equipe',
    title: 'Botão Adicionar pessoa da equipe',
    perms: ['users:manage'],
  },
  {
    id: 'botao-aniversarios',
    path: '/clientes',
    title: 'Botão Aniversários (parabéns pelo WhatsApp)',
    perms: ['customers:read'],
  },
  {
    id: 'botao-nova-reserva',
    path: '/reservas',
    title: 'Botão Nova reserva',
    perms: ['tables:operate', 'settings:manage'],
  },
  // Financeiro
  {
    id: 'botao-taxas-prazos',
    path: '/financeiro',
    title: 'Botão Taxas e prazos (taxa da maquininha e dias para o dinheiro cair)',
    perms: ['finance:write'],
  },
  {
    id: 'botao-inicio-mes',
    path: '/financeiro',
    title: 'Botão Dia de início do mês',
    perms: ['finance:write'],
  },
  // Loja online
  {
    id: 'campo-cor-loja',
    path: '/loja-online?aba=aparencia',
    title: 'Cor principal da loja (cardápio e sistema)',
    perms: ['settings:manage'],
  },
  {
    id: 'secao-horarios',
    path: '/loja-online?aba=funcionamento',
    title: 'Horário de funcionamento da loja',
    perms: ['settings:manage'],
  },
  {
    id: 'campo-taxa-entrega',
    path: '/loja-online?aba=funcionamento',
    title: 'Campo Taxa de entrega (padrão, fora das áreas desenhadas)',
    perms: ['settings:manage'],
  },
  {
    id: 'campo-pedido-minimo',
    path: '/loja-online?aba=funcionamento',
    title: 'Campo Pedido mínimo',
    perms: ['settings:manage'],
  },
  {
    id: 'campo-chave-pix',
    path: '/loja-online?aba=pix',
    title: 'Campo Chave Pix do cardápio',
    perms: ['settings:manage'],
  },
  {
    id: 'secao-pagamentos',
    path: '/loja-online?aba=pagamentos',
    title: 'Pagamento online no cardápio (Pix e cartão pelo PagBank)',
    perms: ['settings:manage'],
  },
  // Nota fiscal, ajustes, impressão
  {
    id: 'campo-csc',
    path: '/fiscal/configuracao',
    title: 'Campos do CSC da NFC-e (homologação e produção)',
    perms: ['fiscal:manage'],
  },
  {
    id: 'taxa-servico',
    path: '/configuracoes',
    title: 'Taxa de serviço (10% do garçom)',
    perms: ['settings:manage'],
  },
  {
    id: 'secao-aparelho',
    path: '/configuracoes',
    title: 'Este aparelho (modo maquininha e largura da bobina)',
    perms: ['settings:manage', 'orders:read'],
  },
  {
    id: 'secao-modelos',
    path: '/impressao',
    title: 'Modelos de impressão (editor visual do papel, estilos prontos e IA)',
    perms: ['printing:manage'],
  },
  {
    id: 'secao-ligacao',
    path: '/impressao',
    title: 'Como ligar a impressora',
    perms: ['printing:manage'],
  },
  // WhatsApp, IA do WhatsApp e aplicativos de delivery
  {
    id: 'secao-mensagens',
    path: '/whatsapp',
    title: 'Mensagens automáticas do WhatsApp',
    perms: ['messaging:manage'],
  },
  {
    id: 'secao-ia-ligar',
    path: '/assistente-ia',
    title: 'Ligar a IA que atende no WhatsApp',
    perms: ['settings:manage'],
  },
  {
    id: 'secao-ia-jeito',
    path: '/assistente-ia',
    title: 'Jeito de atender da IA do WhatsApp',
    perms: ['settings:manage'],
  },
  {
    id: 'secao-ia-menu',
    path: '/assistente-ia',
    title: 'Atendimento por menu do WhatsApp (pedido pela conversa, o que a IA pode fazer)',
    perms: ['settings:manage'],
  },
  {
    id: 'secao-ia-arquivo',
    path: '/assistente-ia',
    title: 'Arquivos do cardápio que a IA manda no WhatsApp',
    perms: ['settings:manage'],
  },
  {
    id: 'secao-vinculos',
    path: '/integracoes',
    title: 'Itens dos aplicativos ligados ao cardápio',
    perms: ['orders:manage'],
  },
  {
    id: 'secao-sem-vinculo',
    path: '/integracoes',
    title: 'Itens dos aplicativos sem vínculo com o cardápio',
    perms: ['orders:manage'],
  },
  {
    id: 'secao-avaliacoes',
    path: '/integracoes',
    title: 'Avaliações dos clientes nos aplicativos',
    perms: ['orders:manage'],
  },
  // Conta
  {
    id: 'conta-uso-ia',
    path: '/conta',
    title: 'Uso de IA (quanto o restaurante usou e onde)',
    perms: ['plan:read'],
  },
  { id: 'conta-assinatura', path: '/conta', title: 'Assinatura', perms: ['plan:read'] },
  {
    id: 'conta-dados-restaurante',
    path: '/conta',
    title: 'Dados do restaurante (só o dono)',
    perms: ['users:manage'],
  },
  {
    id: 'conta-inicio',
    path: '/conta',
    title: 'Primeiros passos com IA',
    perms: ['settings:manage'],
  },
  { id: 'conta-suporte', path: '/conta', title: 'Falar com a Comandou', perms: ['plan:read'] },
  { id: 'conta-tour', path: '/conta', title: 'Rever apresentação' },
  { id: 'conta-tema', path: '/conta', title: 'Tema claro ou escuro' },
  { id: 'conta-sons', path: '/conta', title: 'Sons de aviso' },
  { id: 'conta-meus-dados', path: '/conta', title: 'Meus dados (nome e e-mail)' },
  { id: 'conta-senha', path: '/conta', title: 'Trocar senha' },
];

/** Link que leva ao elemento e faz ele piscar. */
export function focusHref(t: Pick<FocusTarget, 'id' | 'path'>): string {
  return `${t.path}${t.path.includes('?') ? '&' : '?'}foco=${t.id}`;
}
