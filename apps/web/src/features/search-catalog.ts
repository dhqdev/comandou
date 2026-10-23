/**
 * Tudo o que a busca global encontra sem perguntar ao servidor: telas, seções dentro das telas
 * e atalhos de cadastro. Cada item só aparece para quem tem a permissão da tela.
 * `words` são sinônimos do jeito que a equipe fala ("sangria", "garçom", "cupom"…).
 */
export type StaticGroup = 'Telas' | 'Seções' | 'Atalhos';
export type StaticIcon =
  | 'pdv'
  | 'orders'
  | 'tables'
  | 'kitchen'
  | 'cash'
  | 'delivery'
  | 'menu'
  | 'store'
  | 'customers'
  | 'stock'
  | 'finance'
  | 'reports'
  | 'team'
  | 'printing'
  | 'fiscal'
  | 'whatsapp'
  | 'plan'
  | 'settings'
  | 'news'
  | 'plus'
  | 'theme'
  | 'password'
  | 'logout'
  | 'external';

export interface StaticEntry {
  id: string;
  group: StaticGroup;
  title: string;
  /** Onde fica, mostrado embaixo do título. */
  hint?: string;
  words?: string;
  icon: StaticIcon;
  /** Destino no app. Sem `to`, é uma ação do próprio menu (tema, senha, sair). */
  to?: string;
  /** Abre fora do sistema (ex.: o cardápio online). */
  external?: boolean;
  action?: 'theme' | 'password' | 'logout';
  /** Basta uma destas permissões. Sem `perms`, todos veem. */
  perms?: string[];
}

const SCREENS: StaticEntry[] = [
  {
    id: 's-pdv',
    group: 'Telas',
    title: 'PDV',
    hint: 'Vender no balcão, mesa ou entrega',
    words: 'ponto de venda caixa rapido balcao venda vender pedido novo quadro',
    icon: 'pdv',
    to: '/',
  },
  {
    id: 's-pedidos',
    group: 'Telas',
    title: 'Pedidos',
    hint: 'Histórico do dia, status e pagamento',
    words: 'historico vendas comandas status cancelar',
    icon: 'orders',
    to: '/pedidos',
    perms: ['orders:read'],
  },
  {
    id: 's-salao',
    group: 'Telas',
    title: 'Salão',
    hint: 'Mesas, comandas e fechamento de conta',
    words: 'mesas mesa comanda comandas garcom conta fechar conta transferir',
    icon: 'tables',
    to: '/mesas',
    perms: ['tables:operate', 'payments:create'],
  },
  {
    id: 's-cozinha',
    group: 'Telas',
    title: 'Cozinha',
    hint: 'Tela de produção (KDS)',
    words: 'kds producao preparo chapa bar setor',
    icon: 'kitchen',
    to: '/cozinha',
    perms: ['kitchen:operate', 'orders:read'],
  },
  {
    id: 's-caixa',
    group: 'Telas',
    title: 'Caixa',
    hint: 'Abertura, sangria, suprimento e fechamento',
    words: 'abrir caixa fechar caixa sangria suprimento fechamento conferencia gaveta troco',
    icon: 'cash',
    to: '/caixa',
    perms: ['cash:operate', 'cash:close', 'reports:read'],
  },
  {
    id: 's-entregas',
    group: 'Telas',
    title: 'Entregas',
    hint: 'Despachar pedidos e acompanhar motoboys',
    words: 'delivery motoboy entregador despachar rastreio rota',
    icon: 'delivery',
    to: '/entregas',
    perms: ['delivery:manage', 'delivery:operate'],
  },
  {
    id: 's-cardapio',
    group: 'Telas',
    title: 'Cardápio',
    hint: 'Categorias, produtos, preços e fotos',
    words: 'produtos itens precos categorias adicionais opcoes complementos esgotar foto',
    icon: 'menu',
    to: '/cardapio',
  },
  {
    id: 's-loja',
    group: 'Telas',
    title: 'Loja online',
    hint: 'Cardápio online para o cliente pedir',
    words: 'site cardapio online delivery proprio link qr code pedir',
    icon: 'store',
    to: '/loja-online',
    perms: ['settings:manage'],
  },
  {
    id: 's-clientes',
    group: 'Telas',
    title: 'Clientes',
    hint: 'Contas do cardápio online',
    words: 'cliente contatos telefone endereco fidelidade',
    icon: 'customers',
    to: '/clientes',
    perms: ['customers:read'],
  },
  {
    id: 's-estoque',
    group: 'Telas',
    title: 'Estoque',
    hint: 'Insumos, entradas, perdas e contagens',
    words: 'insumos compras entrada perda contagem inventario',
    icon: 'stock',
    to: '/estoque',
    perms: ['stock:read'],
  },
  {
    id: 's-financeiro',
    group: 'Telas',
    title: 'Financeiro',
    hint: 'Contas a pagar e a receber',
    words: 'contas a pagar receber boleto despesas fornecedor dinheiro',
    icon: 'finance',
    to: '/financeiro',
    perms: ['finance:read'],
  },
  {
    id: 's-relatorios',
    group: 'Telas',
    title: 'Relatórios',
    hint: 'Vendas, ticket médio e mais vendidos',
    words: 'relatorio vendas faturamento ticket medio dashboard numeros',
    icon: 'reports',
    to: '/relatorios',
    perms: ['reports:read'],
  },
  {
    id: 's-equipe',
    group: 'Telas',
    title: 'Equipe',
    hint: 'Usuários, papéis e acessos',
    words: 'usuarios funcionarios garcom atendente gerente acesso permissao login',
    icon: 'team',
    to: '/equipe',
    perms: ['users:manage'],
  },
  {
    id: 's-impressao',
    group: 'Telas',
    title: 'Impressão',
    hint: 'Impressoras e fila de impressão',
    words: 'impressora cupom comanda imprimir agente termica',
    icon: 'printing',
    to: '/impressao',
    perms: ['printing:manage'],
  },
  {
    id: 's-fiscal',
    group: 'Telas',
    title: 'Nota fiscal',
    hint: 'NFC-e: emissão e configuração',
    words: 'nfce nfc-e nota cupom fiscal sefaz focus',
    icon: 'fiscal',
    to: '/nota-fiscal',
    perms: ['fiscal:emit', 'fiscal:manage'],
  },
  {
    id: 's-whatsapp',
    group: 'Telas',
    title: 'WhatsApp',
    hint: 'Conexão e mensagens automáticas',
    words: 'whats zap mensagens avisos qr code conectar',
    icon: 'whatsapp',
    to: '/whatsapp',
    perms: ['messaging:manage'],
  },
  {
    id: 's-plano',
    group: 'Telas',
    title: 'Plano',
    hint: 'Assinatura e uso do restaurante',
    words: 'assinatura mensalidade pagamento limite',
    icon: 'plan',
    to: '/plano',
    perms: ['plan:read'],
  },
  {
    id: 's-ajustes',
    group: 'Telas',
    title: 'Ajustes',
    hint: 'Mesas, setores e terminais de caixa',
    words: 'configuracoes configurar preferencias',
    icon: 'settings',
    to: '/configuracoes',
    perms: ['settings:manage', 'orders:read'],
  },
  {
    id: 's-novidades',
    group: 'Telas',
    title: 'Novidades',
    hint: 'O que mudou no sistema',
    words: 'versao atualizacao releases changelog',
    icon: 'news',
    to: '/novidades',
  },
];

const SECTIONS: StaticEntry[] = [
  // Ajustes
  {
    id: 'c-mesas',
    group: 'Seções',
    title: 'Cadastro de mesas',
    hint: 'Ajustes',
    words: 'mesa nova mesa salao',
    icon: 'settings',
    to: '/configuracoes?foco=secao-mesas',
    perms: ['settings:manage'],
  },
  {
    id: 'c-setores',
    group: 'Seções',
    title: 'Setores de produção',
    hint: 'Ajustes',
    words: 'cozinha bar chapa tempo atraso',
    icon: 'settings',
    to: '/configuracoes?foco=secao-setores',
    perms: ['settings:manage'],
  },
  {
    id: 'c-terminais',
    group: 'Seções',
    title: 'Terminais de caixa',
    hint: 'Ajustes',
    words: 'caixa terminal novo caixa',
    icon: 'settings',
    to: '/configuracoes?foco=secao-caixas',
    perms: ['settings:manage'],
  },
  // Loja online
  {
    id: 'c-aparencia',
    group: 'Seções',
    title: 'Aparência da loja',
    hint: 'Loja online',
    words: 'cores logo tema capa cadastro de clientes',
    icon: 'store',
    to: '/loja-online?aba=aparencia',
    perms: ['settings:manage'],
  },
  {
    id: 'c-banners',
    group: 'Seções',
    title: 'Banners',
    hint: 'Loja online',
    words: 'promocao imagem destaque topo',
    icon: 'store',
    to: '/loja-online?aba=banners',
    perms: ['settings:manage'],
  },
  {
    id: 'c-destaques',
    group: 'Seções',
    title: 'Produtos em destaque',
    hint: 'Loja online',
    words: 'destaques selo mais pedido novidade',
    icon: 'store',
    to: '/loja-online?aba=destaques',
    perms: ['settings:manage'],
  },
  {
    id: 'c-funcionamento',
    group: 'Seções',
    title: 'Horário de funcionamento',
    hint: 'Loja online',
    words: 'horario aberto fechado taxa de entrega pedido minimo tempo',
    icon: 'store',
    to: '/loja-online?aba=funcionamento',
    perms: ['settings:manage'],
  },
  // Estoque
  {
    id: 'c-ficha',
    group: 'Seções',
    title: 'Ficha técnica',
    hint: 'Estoque',
    words: 'receita composicao baixa automatica',
    icon: 'stock',
    to: '/estoque?aba=recipes',
    perms: ['stock:read'],
  },
  {
    id: 'c-movimentos',
    group: 'Seções',
    title: 'Movimentos de estoque',
    hint: 'Estoque',
    words: 'historico entradas saidas perdas',
    icon: 'stock',
    to: '/estoque?aba=movements',
    perms: ['stock:read'],
  },
  // Financeiro
  {
    id: 'c-fluxo',
    group: 'Seções',
    title: 'Fluxo de caixa',
    hint: 'Financeiro',
    words: 'entradas saidas saldo projecao',
    icon: 'finance',
    to: '/financeiro?aba=flow',
    perms: ['finance:read'],
  },
  {
    id: 'c-conciliacao',
    group: 'Seções',
    title: 'Conciliação',
    hint: 'Financeiro',
    words: 'conferencia maquininha cartao pix extrato',
    icon: 'finance',
    to: '/financeiro?aba=reconcile',
    perms: ['finance:read'],
  },
  // Relatórios
  {
    id: 'c-mais-vendidos',
    group: 'Seções',
    title: 'Mais vendidos',
    hint: 'Relatórios',
    words: 'ranking produtos top',
    icon: 'reports',
    to: '/relatorios?foco=secao-mais-vendidos',
    perms: ['reports:read'],
  },
  {
    id: 'c-recebimentos',
    group: 'Seções',
    title: 'Recebimentos por forma de pagamento',
    hint: 'Relatórios',
    words: 'pix cartao dinheiro credito debito',
    icon: 'reports',
    to: '/relatorios?foco=secao-recebimentos',
    perms: ['reports:read'],
  },
  {
    id: 'c-canais',
    group: 'Seções',
    title: 'Vendas por canal',
    hint: 'Relatórios',
    words: 'balcao mesa delivery retirada',
    icon: 'reports',
    to: '/relatorios?foco=secao-canais',
    perms: ['reports:read'],
  },
  // Impressão
  {
    id: 'c-agentes',
    group: 'Seções',
    title: 'Agentes de impressão',
    hint: 'Impressão',
    words: 'impressora instalar computador token',
    icon: 'printing',
    to: '/impressao?foco=secao-agentes',
    perms: ['printing:manage'],
  },
  {
    id: 'c-fila',
    group: 'Seções',
    title: 'Fila de impressão',
    hint: 'Impressão',
    words: 'reimprimir cupom comanda',
    icon: 'printing',
    to: '/impressao?foco=secao-fila',
    perms: ['printing:manage'],
  },
  // Nota fiscal
  {
    id: 'c-notas',
    group: 'Seções',
    title: 'Notas emitidas',
    hint: 'Nota fiscal',
    words: 'nfce cancelar nota xml danfe',
    icon: 'fiscal',
    to: '/nota-fiscal?foco=secao-notas',
    perms: ['fiscal:emit', 'fiscal:manage'],
  },
  {
    id: 'c-emissao',
    group: 'Seções',
    title: 'Emissão de nota',
    hint: 'Nota fiscal',
    words: 'automatica ambiente homologacao producao',
    icon: 'fiscal',
    to: '/nota-fiscal?foco=secao-emissao',
    perms: ['fiscal:manage'],
  },
  {
    id: 'c-focus',
    group: 'Seções',
    title: 'Dados fiscais (Focus NFe)',
    hint: 'Nota fiscal',
    words: 'cnpj token ncm cfop csosn certificado',
    icon: 'fiscal',
    to: '/nota-fiscal?foco=secao-focus',
    perms: ['fiscal:manage'],
  },
  // WhatsApp
  {
    id: 'c-qr',
    group: 'Seções',
    title: 'Conectar WhatsApp (QR Code)',
    hint: 'WhatsApp',
    words: 'qr code conectar celular numero',
    icon: 'whatsapp',
    to: '/whatsapp?foco=secao-qr',
    perms: ['messaging:manage'],
  },
  {
    id: 'c-avisos',
    group: 'Seções',
    title: 'Avisos automáticos',
    hint: 'WhatsApp',
    words: 'mensagens automaticas pedido saiu pronto confirmacao',
    icon: 'whatsapp',
    to: '/whatsapp?foco=secao-avisos',
    perms: ['messaging:manage'],
  },
  {
    id: 'c-meta',
    group: 'Seções',
    title: 'API oficial da Meta',
    hint: 'WhatsApp',
    words: 'cloud api business oficial',
    icon: 'whatsapp',
    to: '/whatsapp?foco=secao-meta',
    perms: ['messaging:manage'],
  },
  {
    id: 'c-teste',
    group: 'Seções',
    title: 'Enviar mensagem de teste',
    hint: 'WhatsApp',
    words: 'testar mensagem',
    icon: 'whatsapp',
    to: '/whatsapp?foco=secao-teste',
    perms: ['messaging:manage'],
  },
];

const SHORTCUTS: StaticEntry[] = [
  {
    id: 'a-pedido',
    group: 'Atalhos',
    title: 'Novo pedido',
    hint: 'PDV',
    words: 'vender venda lancar pedido balcao',
    icon: 'plus',
    to: '/',
    perms: ['orders:write'],
  },
  {
    id: 'a-comanda',
    group: 'Atalhos',
    title: 'Abrir comanda avulsa',
    hint: 'Salão',
    words: 'nova comanda cartao comanda sem mesa',
    icon: 'plus',
    to: '/mesas?acao=comanda',
    perms: ['tables:operate'],
  },
  {
    id: 'a-produto',
    group: 'Atalhos',
    title: 'Cadastrar produto',
    hint: 'Cardápio',
    words: 'novo produto novo item adicionar item',
    icon: 'plus',
    to: '/cardapio?acao=produto',
    perms: ['catalog:write'],
  },
  {
    id: 'a-categoria',
    group: 'Atalhos',
    title: 'Criar categoria',
    hint: 'Cardápio',
    words: 'nova categoria grupo de produtos',
    icon: 'plus',
    to: '/cardapio?acao=categoria',
    perms: ['catalog:write'],
  },
  {
    id: 'a-insumo',
    group: 'Atalhos',
    title: 'Cadastrar insumo',
    hint: 'Estoque',
    words: 'novo insumo materia prima ingrediente',
    icon: 'plus',
    to: '/estoque?acao=insumo',
    perms: ['stock:write'],
  },
  {
    id: 'a-conta',
    group: 'Atalhos',
    title: 'Lançar conta a pagar ou receber',
    hint: 'Financeiro',
    words: 'nova conta despesa boleto lancamento',
    icon: 'plus',
    to: '/financeiro?acao=conta',
    perms: ['finance:write'],
  },
  {
    id: 'a-pessoa',
    group: 'Atalhos',
    title: 'Adicionar pessoa à equipe',
    hint: 'Equipe',
    words: 'novo usuario funcionario garcom convidar acesso',
    icon: 'plus',
    to: '/equipe?acao=pessoa',
    perms: ['users:manage'],
  },
  {
    id: 'a-cardapio',
    group: 'Atalhos',
    title: 'Ver cardápio online',
    hint: 'Abre em outra aba',
    words: 'link loja site cliente pedir',
    icon: 'external',
    to: '/pedir',
    external: true,
  },
  {
    id: 'a-tema',
    group: 'Atalhos',
    title: 'Alternar tema claro/escuro',
    words: 'modo escuro dark claro light cores',
    icon: 'theme',
    action: 'theme',
  },
  {
    id: 'a-senha',
    group: 'Atalhos',
    title: 'Trocar minha senha',
    words: 'senha password conta',
    icon: 'password',
    action: 'password',
  },
  {
    id: 'a-sair',
    group: 'Atalhos',
    title: 'Sair do sistema',
    words: 'logout desconectar encerrar sessao',
    icon: 'logout',
    action: 'logout',
  },
];

export const STATIC_ENTRIES: StaticEntry[] = [...SCREENS, ...SECTIONS, ...SHORTCUTS];

/** Minúsculas e sem acento: "Cardápio" e "cardapio" batem. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Pontua um item pela busca: todas as palavras precisam aparecer (título, onde fica ou
 * sinônimos). Título que começa com a busca vem antes. 0 = não serve.
 */
export function scoreEntry(e: StaticEntry, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const title = fold(e.title);
  const hay = `${title} ${fold(e.hint ?? '')} ${e.words ?? ''}`;
  if (!words.every((w) => hay.includes(w))) return 0;
  const q = words.join(' ');
  if (title === q) return 100;
  if (title.startsWith(q)) return 80;
  if (words.every((w) => title.includes(w))) return 60;
  return e.group === 'Telas' ? 30 : 20;
}

export function filterStatic(
  entries: StaticEntry[],
  query: string,
  can: (perms?: string[]) => boolean,
  limit = 8,
): StaticEntry[] {
  return entries
    .filter((e) => can(e.perms))
    .map((e) => ({ e, s: scoreEntry(e, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);
}
