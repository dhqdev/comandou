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
    version: '0.20.1',
    date: '2026-10-23',
    title: 'Loja online mais bonita no computador',
    summary:
      'A loja online (cardápio do cliente) ficou mais organizada no notebook e mais agradável no modo escuro.',
    notes: [
      {
        tag: 'melhoria',
        text: 'No computador, a capa e o menu (Início, Favoritos, Pedidos, Entrar) ficam alinhados na mesma coluna do cardápio, em vez de soltos no canto da tela.',
      },
      {
        tag: 'melhoria',
        text: 'Categorias maiores e sem rolagem escondida; "Mais pedidos" vira uma grade sem corte na borda; cartões da lista com foto maior e sem espaço sobrando.',
      },
      {
        tag: 'melhoria',
        text: 'Modo escuro: a capa não fica mais marrom lamacenta, com contraste melhor para o texto.',
      },
      {
        tag: 'novo',
        text: 'Restaurante sem pratos cadastrados mostra "O cardápio está sendo preparado" em vez de uma tela vazia.',
      },
    ],
  },
  {
    version: '0.20.0',
    date: '2026-10-23',
    title: 'Garçom no celular, painel do entregador e mapa de entregas',
    summary:
      'O garçom atende o salão pelo celular escaneando o QR da mesa, o entregador tem um painel simples (com login ou por um link) e as áreas de entrega são desenhadas num mapa, com taxa e pedido mínimo por área.',
    notes: [
      {
        tag: 'novo',
        text: 'Salão para o garçom: mapa de mesas livres, ocupadas e em pagamento, busca, aba Comandas e botão Escanear mesa (câmera do celular). Tocar numa mesa livre já abre o pedido; o pedido enviado abre a comanda.',
      },
      {
        tag: 'novo',
        text: 'QR Code das mesas pronto para imprimir (Salão > QR das mesas). O garçom escaneia e cai na mesa; o cliente que aponta a câmera vê o cardápio online.',
      },
      {
        tag: 'novo',
        text: 'Pediu a conta: o garçom marca na comanda e o salão mostra a mesa em pagamento para o caixa.',
      },
      {
        tag: 'novo',
        text: 'Painel do entregador: corridas na rua com endereço, rota no Google Maps ou Waze, ligar ou WhatsApp do cliente, quanto cobrar e troco, e os botões Entreguei e Não consegui. Também compartilha a localização para o cliente acompanhar.',
      },
      {
        tag: 'novo',
        text: 'Link do entregador (Entregas > Entregadores): o entregador abre o painel pelo link, sem login. Dá para enviar pelo WhatsApp, gerar um novo ou desligar o link a qualquer momento.',
      },
      {
        tag: 'novo',
        text: 'Área de entrega no mapa (Entregas > Área de entrega): marque o restaurante, desenhe bairros ou um raio em km e defina taxa, pedido mínimo e tempo de cada área. Mapa público OpenStreetMap, sem chave.',
      },
      {
        tag: 'melhoria',
        text: 'Loja online: com áreas cadastradas, o cliente confirma o endereço num pino no mapa e a taxa e o mínimo vêm da área. Endereço fora das áreas avisa que ainda não entregamos lá.',
      },
      {
        tag: 'melhoria',
        text: 'Cada função abre na sua tela: garçom no Salão, entregador em Minhas entregas, cozinha na Cozinha, estoque, financeiro e fiscal nas suas telas. O menu mostra só o que cada um usa.',
      },
      {
        tag: 'correção',
        text: 'Tela sem permissão mostra um aviso amigável com o caminho de volta, em vez de erro. O estoquista não recebe mais erro ao abrir o cardápio.',
      },
    ],
  },
  {
    version: '0.19.0',
    date: '2026-10-23',
    title: 'Banco próprio para cada restaurante',
    summary:
      'Cada restaurante cadastrado no painel admin ganha um banco de dados só dele, com backup numa pasta própria no Backblaze B2. Pelo painel também dá para mover os restaurantes antigos e excluir um restaurante com a base dele.',
    notes: [
      {
        tag: 'novo',
        text: 'Restaurante novo no painel admin cria um banco de dados só dele (comandou_<endereço>), com todas as tabelas, o administrador e o plano. A tela mostra o andamento e se atualiza sozinha.',
      },
      {
        tag: 'novo',
        text: 'Aba Banco de dados no restaurante: nome e tamanho do banco, pasta no bucket, último backup e histórico do que foi feito. Restaurantes antigos têm o botão Mover para banco próprio, que copia e confere tudo antes da troca.',
      },
      {
        tag: 'novo',
        text: 'Excluir restaurante: com ele suspenso, você digita o endereço e o motivo; antes de apagar, um backup final vai para restaurantes/<endereço>/final/ no bucket, que a retenção nunca apaga. Tudo fica na auditoria.',
      },
      {
        tag: 'melhoria',
        text: 'Backups organizados em pastas no bucket: plataforma/ para o banco central e restaurantes/<endereço>/ para cada restaurante, separados por ano e mês. A tela Backups mostra as pastas e as bases excluídas.',
      },
      {
        tag: 'segurança',
        text: 'Os dados de um restaurante ficam num banco separado dos outros, além do isolamento por restaurante que já existia dentro de cada banco. O teste de restauração confere o banco central e o de cada restaurante.',
      },
    ],
  },
  {
    version: '0.18.1',
    date: '2026-10-23',
    title: 'App atualiza sozinho',
    summary:
      'O app instalado (PWA) agora baixa e aplica a versão nova sozinho, sem ficar preso numa versão antiga; fundo atrás do menu inferior igual ao da tela.',
    notes: [
      {
        tag: 'correção',
        text: 'O PWA do iPhone não fica mais com a versão antiga (menu inferior com faixa vazia): a atualização é automática, também ao voltar para o app.',
      },
    ],
  },
  {
    version: '0.18.0',
    date: '2026-10-23',
    title: 'Backup no Backblaze B2',
    summary:
      'No painel admin → Backups você informa o bucket do Backblaze B2 e a chave; o sistema passa a enviar todo dia o backup de todos os restaurantes (dados e fotos), cifrado.',
    notes: [
      {
        tag: 'novo',
        text: 'Backups no painel admin: endereço, bucket, keyID e applicationKey do Backblaze B2, com botão Testar conexão. A chave fica cifrada e nunca é mostrada de novo.',
      },
      {
        tag: 'novo',
        text: 'Backup diário no horário que você escolher (Brasília), guardado pelo número de dias que você definir (sempre mantém os 3 últimos), mais botões Fazer backup agora e Testar restauração.',
      },
      {
        tag: 'melhoria',
        text: 'O backup salva o banco inteiro, com todos os restaurantes e as fotos, cifrado (AES-256) antes de sair do servidor. Histórico mostra quem disparou cada execução e os erros em português.',
      },
      {
        tag: 'melhoria',
        text: 'Aviso na visão geral quando o backup não está configurado ou o serviço de backup está parado. Os segredos do bucket saíram da stack e do instalador.',
      },
    ],
  },
  {
    version: '0.17.0',
    date: '2026-10-23',
    title: 'Busca global: ache qualquer coisa no sistema',
    summary:
      'A barra “Buscar” do topo agora procura em tudo que você tem acesso e leva direto ao lugar: pedidos, comandas, mesas, clientes, produtos, estoque, equipe, contas, caixa, telas e ajustes. Abre também com Ctrl+K (⌘K no Mac) e pela lupa no celular.',
    notes: [
      {
        tag: 'novo',
        text: 'Busca global: digite o número do pedido ou da comanda, o nome ou o celular do cliente, um produto, um adicional, um insumo, uma pessoa da equipe, um entregador ou uma conta a pagar, e clique no resultado para ir direto a ele.',
      },
      {
        tag: 'novo',
        text: 'Ao escolher um resultado, a tela certa abre com o item já aberto (pedido, comanda, cliente, sessão de caixa) ou destacado na lista.',
      },
      {
        tag: 'novo',
        text: 'Também acha telas, seções e atalhos pelo nome que a equipe usa: “sangria”, “nota fiscal”, “impressora”, “banners”, “cadastrar produto”, “trocar senha”, “modo escuro”…',
      },
      {
        tag: 'melhoria',
        text: 'Funciona sem acento e com teclado (setas e Enter), lembra as últimas buscas e, no celular, abre em tela cheia pela lupa do topo.',
      },
      {
        tag: 'segurança',
        text: 'Cada pessoa só vê resultados do próprio restaurante e das áreas que o papel dela permite (garçom não vê clientes, financeiro nem equipe, por exemplo).',
      },
    ],
  },
  {
    version: '0.16.4',
    date: '2026-10-23',
    title: 'Janelas fecham ao clicar fora',
    summary: 'Em qualquer tela, clicar fora de uma janela (no fundo escurecido) fecha a janela.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Janelas e painéis laterais fecham ao clicar fora. Selecionar um texto e soltar o mouse fora não fecha.',
      },
    ],
  },
  {
    version: '0.16.3',
    date: '2026-10-23',
    title: 'Menu inferior flutuante em vidro líquido',
    summary:
      'No celular, o menu de baixo agora é uma pílula flutuante de vidro, com um vidro que desliza até a tela escolhida. Vale para o restaurante, o painel admin e o cardápio online.',
    notes: [
      {
        tag: 'novo',
        text: 'Menu inferior suspenso com efeito de vidro líquido e indicador que desliza entre os itens, igual em todos os apps.',
      },
      {
        tag: 'correção',
        text: 'A barra ocupa menos altura e não fica mais colada na borda do iPhone.',
      },
    ],
  },
  {
    version: '0.16.2',
    date: '2026-10-23',
    title: 'Sem cadastro de domínio no restaurante',
    summary:
      'O restaurante não cadastra mais domínio ou subdomínio dentro do sistema. A tela virou apenas “Plano”.',
    notes: [
      {
        tag: 'melhoria',
        text: 'A tela “Plano e domínio” agora é só “Plano”: mostra o que o plano inclui e o uso do mês, sem a opção de adicionar domínio.',
      },
    ],
  },
  {
    version: '0.16.1',
    date: '2026-10-23',
    title: 'Painel admin: largura toda e menu do iPhone',
    summary:
      'No notebook, o painel admin passa a ocupar a tela inteira e acompanha o zoom. No iPhone (PWA), o menu inferior encosta no fim da tela, sem faixa vazia embaixo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Painel admin no notebook: o conteúdo não fica mais preso à esquerda com largura máxima; usa a tela toda e se adapta ao zoom.',
      },
      {
        tag: 'correção',
        text: 'Menu inferior no iPhone instalado como app: a moldura agora cobre a tela inteira e a barra fica na altura certa, sem espaço sobrando embaixo.',
      },
    ],
  },
  {
    version: '0.16.0',
    date: '2026-10-23',
    title: 'Cardápio online novo e contas de cliente',
    summary:
      'O cardápio online virou um app de pedidos, com telas animadas, banners e destaques. O cliente pode criar conta, e o painel ganhou as páginas Loja online e Clientes.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápio online redesenhado: capa com saudação, busca, banners que passam sozinhos, categorias com foto, faixas de Destaques e Mais pedidos, e abas embaixo (Início, Favoritos, Pedidos e Conta).',
      },
      {
        tag: 'novo',
        text: 'Transições entre telas: a foto do prato cresce ao abrir, tamanhos viram botões, adicionais viram interruptores e o item “voa” para a sacola.',
      },
      {
        tag: 'novo',
        text: 'Conta do cliente: cadastro com celular e senha, endereços salvos, favoritos, histórico e acompanhamento dos pedidos, e tema claro ou escuro.',
      },
      {
        tag: 'novo',
        text: 'Painel: página Loja online com Aparência (capa, logo, tema e textos), Banners, Destaques e selos, e Funcionamento, com prévia do celular ao lado.',
      },
      {
        tag: 'novo',
        text: 'Painel: aba Clientes com busca, total gasto, último pedido, endereços, pratos favoritos, observações da equipe e bloqueio.',
      },
      {
        tag: 'segurança',
        text: 'Senhas de clientes guardadas com scrypt, sessão em cookie protegido e bloqueio após várias tentativas de login erradas.',
      },
    ],
  },
  {
    version: '0.15.4',
    date: '2026-10-23',
    title: 'Menu inferior do iPhone mais baixo',
    summary: 'A barra de baixo do app no iPhone estava alta demais e foi reduzida.',
    notes: [
      {
        tag: 'correção',
        text: 'iPhone (app instalado): o menu inferior ocupava a área do indicador de início por inteiro e ficava mais alto que o normal. Agora tem a altura de um app nativo.',
      },
    ],
  },
  {
    version: '0.15.3',
    date: '2026-10-23',
    title: 'PDV em largura total e barra de atalhos',
    summary:
      'As telas agora ocupam a largura toda e acompanham o zoom; o PDV ganhou colunas mais fortes e a barra de atalhos da direita.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Conteúdo de todas as telas vai até as bordas e se adapta ao zoom do navegador.',
      },
      {
        tag: 'melhoria',
        text: 'PDV: colunas com cabeçalho de cor cheia (laranja, amarelo e verde).',
      },
      {
        tag: 'novo',
        text: 'PDV: barra da direita com 4 atalhos e contadores (solicitações de atendimento, notas e ajustes, mapa de mesas, finalizados do dia) e dicas ao passar o mouse.',
      },
    ],
  },
  {
    version: '0.15.2',
    date: '2026-10-23',
    title: 'Seletores e janelas de celular',
    summary:
      'No celular, escolher opções e datas agora abre uma folha grande que sobe de baixo, e o topo mostra em qual tela você está.',
    notes: [
      {
        tag: 'novo',
        text: 'Seletores próprios no toque: listas (status, canal, entregador, caixa…) viram opções grandes e datas abrem um calendário com atalhos Hoje, Ontem e Há 7 dias.',
      },
      {
        tag: 'melhoria',
        text: 'Janelas no celular ficaram maiores, com alça, título maior e botões de largura inteira.',
      },
      {
        tag: 'melhoria',
        text: 'Topo do celular mostra o nome da tela atual e ganha sombra ao rolar, separando do conteúdo no tema escuro.',
      },
      {
        tag: 'melhoria',
        text: 'Encerrar o acesso de suporte volta direto para o restaurante no painel admin.',
      },
    ],
  },
  {
    version: '0.15.1',
    date: '2026-10-23',
    title: 'Menu do iPhone e limpeza de código',
    summary:
      'Componentes, estilos e constantes que nenhuma tela usava foram removidos. Nada muda no uso.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Saíram do sistema: painel lateral, cabeçalho e imagem genéricos do design system que não eram usados, o card de pedido e o quadro kanban antigos.',
      },
      {
        tag: 'correção',
        text: 'iPhone: o menu "Mais" que sobe de baixo aparecia cortado no Safari. Agora abre por completo.',
      },
    ],
  },
  {
    version: '0.15.0',
    date: '2026-10-23',
    title: 'Panda, laranja e navegação de app',
    summary:
      'O Comandou ganhou o panda como mascote e o laranja como cor. A navegação virou uma barra lateral de ícones (computador) e abas embaixo (celular), com tema claro e escuro em todas as telas.',
    notes: [
      {
        tag: 'novo',
        text: 'Identidade nova: panda no logo, no ícone do app e no favicon; cor laranja usada com parcimônia (botão principal, item ativo e detalhes).',
      },
      {
        tag: 'novo',
        text: 'Barra lateral fixa de ícones com o nome embaixo, unida ao topo. Gestão, Sistema e Conta abrem um submenu que desliza da barra.',
      },
      {
        tag: 'novo',
        text: 'Tema claro e escuro com o botão sol/lua no topo (fica salvo no navegador). Vale para o sistema do restaurante e para o painel admin.',
      },
      {
        tag: 'melhoria',
        text: 'Celular e app instalado: abas grandes embaixo, "Mais" sobe de baixo e fecha arrastando, sem zoom e sem a tela deslizar para os lados. Quadro de pedidos por abas e tabelas viram cartões.',
      },
      {
        tag: 'segurança',
        text: 'Painel admin: depois de entrar uma vez com o código do autenticador, aquele navegador fica lembrado e pede só a senha. Redefinir o 2º fator volta a pedir o código em todos.',
      },
    ],
  },
  {
    version: '0.14.0',
    date: '2026-10-23',
    title: 'Atualizar o sistema pelo painel',
    summary:
      'Na tela Servidor do painel admin, o botão "Atualizar sistema" compara a versão instalada com a última publicada e atualiza tudo com um clique.',
    notes: [
      {
        tag: 'novo',
        text: 'Seção Versão na tela Servidor: versão instalada x última publicada no GitHub, lista do que vai mudar e confirmação antes de atualizar.',
      },
      {
        tag: 'novo',
        text: 'A atualização segue uma ordem fixa: migração do banco, API, site, WhatsApp e, por último, o próprio agente. Mostra o andamento passo a passo.',
      },
      {
        tag: 'segurança',
        text: 'Só troca a versão das imagens do próprio Comandou (nunca outra imagem), só aceita versões no formato vX.Y.Z, confere se a imagem existe antes de começar, para se a migração falhar e deixa o Swarm voltar sozinho ao serviço anterior se uma versão nova não subir. Tudo fica na auditoria.',
      },
    ],
  },
  {
    version: '0.13.0',
    date: '2026-10-22',
    title: 'Cardápio online, acompanhamento do pedido e tela inicial nova',
    summary:
      'O cliente agora pede pelo link da loja, com fotos, e acompanha o pedido em tempo real. A tela inicial virou um quadro de 3 colunas para aceitar, produzir e despachar sem trocar de tela.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápio online em /pedir: capa, logo, categorias com fotos, opções do produto (escolha 1 / opcional), carrinho, entrega ou retirada e forma de pagamento com troco.',
      },
      {
        tag: 'novo',
        text: 'Página de acompanhamento do pedido para o cliente: em análise, aceito, pronto, saiu para entrega e entregue, com cancelamento enquanto ainda está em análise.',
      },
      {
        tag: 'novo',
        text: 'Status "Em análise": pedidos do cardápio online esperam o aceite da loja (com aviso sonoro) ou entram direto com o aceite automático ligado. Recusar pede o motivo.',
      },
      {
        tag: 'novo',
        text: 'Tela inicial em 3 colunas (Em análise, Em produção, Prontos para entrega) com filtros por canal, busca, botão de abrir e fechar a loja e painéis que deslizam de lado para novo pedido, detalhes e despacho.',
      },
      {
        tag: 'novo',
        text: 'Despachar entregador direto do pedido, com botão para avisar o entregador no WhatsApp com o endereço e os itens.',
      },
      {
        tag: 'novo',
        text: 'Fotos de produtos e categorias no Cardápio (arraste a imagem ou clique). As fotos são reduzidas no navegador antes de enviar e aparecem no PDV e no cardápio online.',
      },
      {
        tag: 'novo',
        text: 'Ajustes da loja online: link para divulgar, capa, logo, taxa de entrega, pedido mínimo, tempo de entrega, WhatsApp e endereço.',
      },
    ],
  },
  {
    version: '0.12.0',
    date: '2026-10-22',
    title: 'Identidade visual nova do Comandou',
    summary:
      'O sistema inteiro ganhou cara própria: cor páprica, fonte Inter, cantos discretos, o mascote Comandinho e menus com indicador que desliza entre as opções.',
    notes: [
      {
        tag: 'novo',
        text: 'Mascote Comandinho (uma comanda com rosto) no logotipo, no login, no ícone do app e no favicon.',
      },
      {
        tag: 'novo',
        text: 'Indicador deslizante no menu lateral, nas abas e nos filtros (cozinha, nova venda, painel admin): o destaque escorrega até a opção escolhida.',
      },
      {
        tag: 'melhoria',
        text: 'Cor da marca páprica com neutros quentes, fonte Inter embutida (funciona offline), cantos e sombras discretos e modo escuro em todas as telas.',
      },
      {
        tag: 'melhoria',
        text: 'Menu lateral claro com nome e cargo do usuário compactos, barra superior translúcida e transição suave ao trocar de tela.',
      },
      {
        tag: 'melhoria',
        text: 'No celular, janelas abrem como folha que sobe de baixo; o menu lateral escurece o fundo e fecha ao tocar fora.',
      },
      {
        tag: 'novo',
        text: 'Componentes de foto prontos para o cardápio: proporção fixa, carregamento suave e prato neutro quando não há imagem.',
      },
      {
        tag: 'melhoria',
        text: 'Painel admin no mesmo padrão: grafite quente com destaque páprica.',
      },
    ],
  },
  {
    version: '0.11.0',
    date: '2026-10-22',
    title: 'Consumo e operação de cada restaurante',
    summary:
      'No painel admin, cada restaurante ganhou as abas Operação e Consumo, e a tela Servidor ganhou o ranking de consumo de todos eles.',
    notes: [
      {
        tag: 'novo',
        text: 'Aba Operação: pedidos, faturamento, ticket médio, cancelamentos, horários de pico, canais, formas de pagamento, mais vendidos, caixa, entregas, estoque, notas fiscais, WhatsApp, impressoras e a atividade de cada pessoa da equipe (30 dias).',
      },
      {
        tag: 'novo',
        text: 'Aba Consumo: tamanho dos dados do restaurante no banco (por tabela), linhas, quem está online agora e, com METRICS_PER_TENANT ligado, requisições e tempo de servidor consumido.',
      },
      {
        tag: 'novo',
        text: 'Servidor: ranking de consumo por restaurante, com acesso direto a cada um.',
      },
      {
        tag: 'segurança',
        text: 'Só números agregados: nome, telefone e endereço de clientes finais não aparecem no painel. Memória RAM e CPU são do servidor todo e não são separáveis por restaurante; o painel mostra o que dá para medir de verdade.',
      },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-10-22',
    title: 'Painel da plataforma novo',
    summary:
      'O painel admin ganhou visual próprio, funciona como app no celular e passou a mostrar o servidor. Cada restaurante pode ser aberto com um clique.',
    notes: [
      {
        tag: 'novo',
        text: 'Visual escuro e direto, com menu inferior no celular e janelas que sobem de baixo. Dá para instalar como app “Comandou Admin”.',
      },
      {
        tag: 'novo',
        text: '“Abrir sistema”: um link de uso único entra no restaurante já logado, como o dono ou outro membro. A sessão dura até 2 horas, mostra um aviso de suporte e fica registrada.',
      },
      {
        tag: 'novo',
        text: 'Por restaurante: equipe com último acesso, encerrar sessões, redefinir senha de um membro e renomear.',
      },
      {
        tag: 'novo',
        text: 'Tela Servidor: CPU, memória, disco e rede da VM com gráficos, serviços e containers rodando ou parados, logs, reiniciar serviço e limpeza do Docker.',
      },
      {
        tag: 'segurança',
        text: 'O agente do servidor só tem ações fixas (sem terminal), fica na rede interna com token, e toda ação vai para a auditoria.',
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-10-22',
    title: 'Pronto para crescer: banco dedicado, PgBouncer e uso por restaurante',
    summary:
      'Preparos para clientes grandes. Nada muda no dia a dia: todos os restaurantes continuam no mesmo banco, mas a plataforma já sabe migrar vários bancos, pode usar PgBouncer e medir o uso de cada restaurante.',
    notes: [
      {
        tag: 'novo',
        text: 'Ponto único que decide o banco de cada restaurante. Hoje é sempre o compartilhado; um cliente Enterprise poderá ter banco próprio sem mudar o resto do sistema.',
      },
      {
        tag: 'novo',
        text: 'As migrações podem rodar em uma lista de bancos, com relatório por banco. Uma falha em um banco dedicado não para os outros.',
      },
      {
        tag: 'novo',
        text: 'Métricas por restaurante (opcionais): quantidade de acessos, tempo de resposta e erros de cada cliente.',
      },
      {
        tag: 'melhoria',
        text: 'PgBouncer opcional entre a API e o banco, para aguentar mais conexões.',
      },
    ],
  },
  {
    version: '0.8.2',
    date: '2026-10-22',
    title: 'Traefik 2 consegue descobrir os restaurantes',
    summary:
      'Ajuste na instalação: o Traefik versão 2 não envia cabeçalhos ao consultar o Comandou, então a consulta de endereços também aceita o token na URL.',
    notes: [
      {
        tag: 'correção',
        text: 'A rota interna que lista os endereços para o Traefik aceita ?token=..., e o token não aparece nos registros (logs).',
      },
    ],
  },
  {
    version: '0.8.1',
    date: '2026-10-22',
    title: 'Endereço do restaurante no ar sozinho',
    summary:
      'Ao criar um restaurante no painel, o endereço dele (nome.comandou.com) pode passar a funcionar sozinho, sem ninguém editar a instalação.',
    notes: [
      {
        tag: 'novo',
        text: 'Opção de instalação (TRAEFIK_TENANT_HOSTS) para o Traefik descobrir cada restaurante ativo e emitir o certificado dele automaticamente.',
      },
    ],
  },
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
