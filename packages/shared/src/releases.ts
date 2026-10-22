/**
 * Histórico de versões exibido na tela "Novidades" do sistema.
 * Regra do projeto: toda etapa entregue acrescenta uma versão aqui, no mesmo PR.
 * A primeira da lista é a versão atual.
 */
export type ReleaseTag = 'novo' | 'melhoria' | 'correção' | 'segurança';

export interface ReleaseNote {
  tag: ReleaseTag;
  text: string;
}

export interface Release {
  version: string;
  date: string; // AAAA-MM-DD
  title: string;
  summary: string;
  notes: ReleaseNote[];
}

export const RELEASES: readonly Release[] = [
  {
    version: '0.8.0',
    date: '2026-10-22',
    title: 'Agora somos Comandou',
    summary:
      'O sistema passou a se chamar Comandou, com endereço próprio em comandou.com. Nada muda no seu dia a dia: pedidos, caixa e cadastros continuam iguais.',
    notes: [
      {
        tag: 'novo',
        text: 'Novo nome e novo ícone: Comandou. Os restaurantes ficam em <seu-restaurante>.comandou.com.',
      },
      {
        tag: 'melhoria',
        text: 'Cada atualização aprovada nos testes vira uma versão nova automaticamente, com as imagens prontas para instalar.',
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-10-22',
    title: 'Instalação em um comando',
    summary:
      'Instalar o Comandou ficou simples: um comando baixa tudo do GitHub e prepara o servidor. O seu acesso de Super Admin nasce da senha que você escolhe na instalação.',
    notes: [
      {
        tag: 'novo',
        text: 'Um comando instala o sistema em um servidor novo (Docker, HTTPS automático e segredos incluídos), em máquinas AMD64 e ARM64.',
      },
      {
        tag: 'novo',
        text: 'O Super Admin é criado com o e-mail e a senha que você informa na instalação ou na stack, com o código do aplicativo autenticador.',
      },
      {
        tag: 'novo',
        text: 'Esqueceu a senha do Super Admin? Um comando define uma nova e encerra as sessões antigas.',
      },
      {
        tag: 'melhoria',
        text: 'O domínio do sistema agora vem da configuração, em vez de ficar fixo no arquivo da stack.',
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-22',
    title: 'Etapa 7 — Pronto para produção',
    summary:
      'Revisão de segurança, teste de carga com 1 milhão de pedidos, ensaio de restauração de backup e o guia de operação para colocar o Comandou no ar.',
    notes: [
      {
        tag: 'segurança',
        text: 'Depois de 10 senhas erradas em 15 minutos, a conta fica bloqueada por um tempo, de qualquer computador. Vale para os restaurantes e para o painel Super Admin.',
      },
      {
        tag: 'segurança',
        text: 'O limite de tentativas agora vale para todos os servidores juntos, não para cada um.',
      },
      {
        tag: 'segurança',
        text: 'O link de rastreio do cliente não aparece mais nos registros do servidor.',
      },
      {
        tag: 'melhoria',
        text: 'Lista de pedidos rápida mesmo com muitos pedidos: de 1,7 s para 9 ms num restaurante com 1 milhão de pedidos.',
      },
      {
        tag: 'melhoria',
        text: 'Dados antigos que não servem mais (sessões encerradas há 90 dias, posição do entregador depois de 30 dias) são apagados sozinhos, como pede a LGPD. Pedidos, pagamentos e notas nunca são apagados.',
      },
      {
        tag: 'novo',
        text: 'Alertas de monitoramento: sistema fora do ar, erros, lentidão e backup atrasado.',
      },
      {
        tag: 'novo',
        text: 'Checagem automática do servidor antes e depois de cada atualização.',
      },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-10-22',
    title: 'Etapa 6 — SaaS: painel da plataforma, planos e backups',
    summary:
      'Painel Super Admin separado e auditado, planos com limites, domínio próprio do restaurante, monitoramento, backups cifrados com teste de restauração e deploy com aprovação manual.',
    notes: [
      {
        tag: 'novo',
        text: 'Painel Super Admin em admin.comandou.com: restaurantes, planos, assinaturas, saúde do sistema, backups e auditoria. Entrada com senha e código do aplicativo autenticador.',
      },
      {
        tag: 'novo',
        text: 'Planos e assinaturas: limite de pessoas na equipe, produtos ativos e pedidos por mês, e recursos por plano (NFC-e, WhatsApp, domínio próprio). Trocar de plano nunca apaga dados.',
      },
      {
        tag: 'novo',
        text: 'Tela "Plano e domínio" no restaurante: uso do plano em barras e cadastro do domínio próprio com verificação por registro TXT no DNS.',
      },
      {
        tag: 'novo',
        text: 'Restaurante novo pelo painel, com plano escolhido; suspender e reativar exige motivo, que fica na auditoria.',
      },
      {
        tag: 'melhoria',
        text: 'Monitoramento: métricas no formato Prometheus (protegidas por token) e verificação de saúde do banco, Redis e WhatsApp.',
      },
      {
        tag: 'segurança',
        text: 'O painel usa um usuário próprio no banco, com acesso mínimo: não lê senhas nem pedidos e não apaga nada. Toda ação, inclusive login recusado, vai para a auditoria.',
      },
      {
        tag: 'segurança',
        text: 'Backup diário cifrado (age) para B2/S3 e teste semanal de restauração num banco temporário; o deploy faz um backup antes e só roda com aprovação manual.',
      },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-10-22',
    title: 'Etapa 5 — Nota fiscal, WhatsApp e filas',
    summary:
      'NFC-e pela Focus NFe (começando em homologação), avisos ao cliente pelo WhatsApp e uma fila de trabalhos que não trava o pedido.',
    notes: [
      {
        tag: 'novo',
        text: 'Nota fiscal (NFC-e) pela Focus NFe: emita pelo detalhe do pedido pago, acompanhe a autorização e abra o DANFE.',
      },
      {
        tag: 'novo',
        text: 'Cancelamento de NFC-e com justificativa. Pedido com nota autorizada só é cancelado ou estornado depois de cancelar a nota.',
      },
      {
        tag: 'novo',
        text: 'Tela Nota fiscal: notas emitidas e configuração (CNPJ, token, CFOP, CSOSN/CST e NCM padrão). Começa em homologação; produção só pelo dono, com confirmação.',
      },
      {
        tag: 'novo',
        text: 'Cardápio: dados fiscais por produto (NCM, CFOP, CSOSN/CST, origem e unidade).',
      },
      {
        tag: 'novo',
        text: 'WhatsApp por QR Code: conecte o número do restaurante e o cliente recebe aviso quando o pedido fica pronto ou sai para entrega. Os textos são editáveis.',
      },
      {
        tag: 'novo',
        text: 'Alternativa: API oficial do WhatsApp (Meta), com modelos aprovados.',
      },
      {
        tag: 'melhoria',
        text: 'Fila de trabalhos (Redis): a nota e as mensagens são enviadas em segundo plano, com novas tentativas, sem segurar o caixa.',
      },
      {
        tag: 'segurança',
        text: 'Tokens da Focus NFe e da Meta e as sessões do WhatsApp ficam cifrados; a tela mostra só o final do token.',
      },
      {
        tag: 'segurança',
        text: 'A mesma nota nunca é emitida duas vezes, mesmo com falha de rede ou clique repetido.',
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-22',
    title: 'Etapa 4 — Estoque, entregas, impressão, financeiro e equipe',
    summary:
      'Operações do dia a dia além do salão: controle de insumos, delivery com rastreio, impressão automática, contas e usuários.',
    notes: [
      {
        tag: 'novo',
        text: 'Tela Novidades: acompanhe aqui tudo o que foi entregue em cada versão.',
      },
      {
        tag: 'novo',
        text: 'Equipe: adicione pessoas com papel (caixa, garçom, entregador…), troque o papel ou desative o acesso na hora.',
      },
      {
        tag: 'novo',
        text: 'Trocar minha senha, no menu lateral. Os outros aparelhos conectados são desconectados.',
      },
      {
        tag: 'novo',
        text: 'Estoque por insumo: entradas com custo médio, perdas e contagens com motivo, alerta de estoque mínimo.',
      },
      {
        tag: 'novo',
        text: 'Ficha técnica de produtos e adicionais: cada venda baixa os insumos e o cancelamento devolve.',
      },
      {
        tag: 'novo',
        text: 'Entregas: despacho com entregador, link de rastreio para o cliente (expira sozinho) e conclusão pelo celular do entregador.',
      },
      {
        tag: 'novo',
        text: 'Impressão automática das comandas por setor com o agente local, reimpressão e conferência de conta.',
      },
      {
        tag: 'novo',
        text: 'Financeiro: contas a pagar e a receber, fluxo de caixa diário e conciliação por forma de pagamento.',
      },
      {
        tag: 'segurança',
        text: 'Venda sem saldo é recusada (salvo insumo que permita negativo), mesmo com vendas simultâneas.',
      },
      {
        tag: 'segurança',
        text: 'Lançamento pago não pode ser apagado nem cancelado; a baixa não duplica em clique duplo.',
      },
      {
        tag: 'melhoria',
        text: '"Saiu para entrega" agora sempre registra o entregador (pela tela Entregas).',
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-22',
    title: 'Etapa 3 — Pedidos, cozinha, salão e caixa',
    summary:
      'Primeiro fluxo comercial completo: vender, produzir, servir na mesa, receber e fechar o caixa.',
    notes: [
      {
        tag: 'novo',
        text: 'Adicionais e variações no cardápio (ex.: Tamanho P/M/G, Bacon +R$ 4,50), com mínimo e máximo por grupo.',
      },
      {
        tag: 'novo',
        text: 'PDV com nova venda (atalho F2) e quadro de pedidos atualizado em tempo real.',
      },
      {
        tag: 'novo',
        text: 'Cozinha por setor com aviso e atraso por tempo de espera, avanço por item ou pedido.',
      },
      {
        tag: 'novo',
        text: 'Salão: mesas, comandas, transferência de mesa, divisão de conta e fechamento.',
      },
      {
        tag: 'novo',
        text: 'Caixa: abertura, suprimento, sangria, pagamento com troco, estorno e fechamento conferido.',
      },
      { tag: 'novo', text: 'Relatório do dia separando faturamento de recebimentos.' },
      {
        tag: 'segurança',
        text: 'Pagamentos, estornos e fechamento não duplicam se a internet cair no meio da operação.',
      },
      {
        tag: 'correção',
        text: 'A API não lê mais arquivos de configuração que não são dela ao iniciar no servidor.',
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-21',
    title: 'Etapas 1 e 2 — Fundação',
    summary: 'Base técnica segura para vários restaurantes no mesmo sistema.',
    notes: [
      {
        tag: 'novo',
        text: 'Cada restaurante no seu endereço (ex.: demo.comandou.com), com dados isolados no banco.',
      },
      {
        tag: 'novo',
        text: 'Login com sessão segura, papéis e permissões (dono, gerente, caixa, garçom, cozinha…).',
      },
      { tag: 'novo', text: 'Cardápio com categorias e produtos, marcar como esgotado.' },
      { tag: 'novo', text: 'Aplicativo instalável (PWA) no celular, tablet e computador.' },
    ],
  },
];

export const CURRENT_RELEASE = RELEASES[0];
