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
    version: '0.111.0',
    date: '2026-11-12',
    title: 'Cada restaurante atualiza na hora que você escolher',
    summary:
      'O Super Admin fica sempre na versão mais nova, e cada restaurante continua na versão dele até você clicar em Atualizar agora ou agendar a atualização, na tela do cliente.',
    notes: [
      {
        tag: 'novo',
        text: 'Versão do sistema na visão geral do cliente: mostra a versão em que o restaurante está e a mais nova, com "Atualizar agora" e "Agendar" (data e hora). Antes de atualizar é feito um backup do banco dele.',
      },
      {
        tag: 'novo',
        text: 'Atualizar sistema não leva mais os restaurantes juntos: quem tem banco próprio fica na versão atual, que continua no ar ao lado da nova até o último restaurante ser atualizado.',
      },
      {
        tag: 'melhoria',
        text: 'Infra › Servidor mostra quantos restaurantes estão em cada versão e quantos têm atualização agendada.',
      },
      {
        tag: 'correção',
        text: 'O número da versão no topo do sistema e no login agora é o mesmo do Super Admin, com a correção (ex.: 0.110.1).',
      },
    ],
  },
  {
    version: '0.110.1',
    date: '2026-11-12',
    title: 'Busca do cardápio no celular e acompanhamento sem piscar',
    summary:
      'Buscar no cardápio pelo celular leva direto aos resultados, e a tela do pedido do cliente não fica mais piscando.',
    notes: [
      {
        tag: 'correção',
        text: 'Busca do cardápio no celular: ao digitar, a busca sobe para o topo com os resultados logo embaixo (antes, buscando do fim do cardápio, sobrava uma tela vazia). Com o teclado aberto, o menu de baixo e a sacola saem da frente.',
      },
      {
        tag: 'melhoria',
        text: 'Acompanhamento do pedido do cliente: o círculo do status e a bolinha de "atualiza sozinha" ficam parados, sem clarear e escurecer.',
      },
    ],
  },
  {
    version: '0.110.0',
    date: '2026-11-12',
    title: 'Chamados em colunas',
    summary:
      'A tela de Chamados mostra cada chamado na coluna da etapa em que ele está, do Recebido ao Resolvido.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Chamados em colunas: Recebido, Em análise, Aprovado, Em desenvolvimento, Em testes e Resolvido. Dá para ver de relance onde cada chamado está e quais têm mensagem nova da equipe. Cancelados e recusados ficam numa lista abaixo do quadro.',
      },
    ],
  },
  {
    version: '0.109.1',
    date: '2026-11-12',
    title: 'Logo maior e menu lateral mais alinhado',
    summary:
      'Com o menu lateral aberto, a logo da loja aparece bem maior no topo e as linhas do menu ficaram mais firmes e alinhadas.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Menu aberto: a logo ocupa a largura do menu, inteira e sem cortar, seja quadrada ou larga.',
      },
      {
        tag: 'melhoria',
        text: 'Linhas do menu com texto um pouco maior, altura igual e ícones numa coluna só, então os nomes (inclusive Conta) ficam alinhados. Os subitens acompanham.',
      },
    ],
  },
  {
    version: '0.109.0',
    date: '2026-11-12',
    title: 'Pagamento pelo app, cardápio mais visual e link com a cara da loja',
    summary:
      'O cliente paga cartão de crédito ou Pix direto no cardápio pelo PagBank, o início do cardápio ficou com menos texto e mais desenho, e o link do cardápio mostra o nome e a logo da loja na prévia do WhatsApp.',
    notes: [
      {
        tag: 'novo',
        text: 'Pagamento pelo app: conecte sua conta PagBank em Loja online › Pagamentos e o cliente paga cartão de crédito à vista ou Pix no cardápio. O dinheiro cai na sua conta, o pedido vai para a cozinha depois de pago e entra no caixa sozinho. Sem pagamento em 20 minutos, cancela sozinho.',
      },
      {
        tag: 'novo',
        text: 'Estorno pelo caixa devolve o pagamento no PagBank, e pedido pago cancelado antes do caixa é estornado sozinho. Sem conta conectada, o cardápio continua como antes (Pix com comprovante e pagamento na entrega).',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio mais visual: capa mais alta com a logo no meio, moto andando com o tempo de entrega, categorias com foto, fidelidade e reserva em blocos animados, banners com barrinhas como nos stories e os mais pedidos numa fileira com 1, 2, 3.',
      },
      {
        tag: 'melhoria',
        text: 'Link do cardápio com a cara da loja: no WhatsApp, Instagram e Telegram a prévia mostra o nome, o texto e a logo da sua loja. No link de um produto, aparecem o nome, a descrição e a foto dele.',
      },
      {
        tag: 'melhoria',
        text: 'Item em 3D: o cadastro do item traz a lista de aplicativos e sites para escanear ou criar o modelo.',
      },
      {
        tag: 'correção',
        text: 'O visualizador 3D do cardápio buscava um componente fora do Comandou e podia não abrir o modelo; agora usa só o que vem do próprio sistema.',
      },
    ],
  },
  {
    version: '0.108.0',
    date: '2026-11-12',
    title: 'Cardápio por foto com IA, primeiros passos em conversa e visual mais enxuto',
    summary:
      'A IA lê a foto ou o PDF do cardápio e cadastra os itens, o primeiro acesso virou uma conversa com o mascote, o item pode aparecer em 3D na mesa do cliente e o painel ficou mais compacto, com o menu lateral levando a logo da loja.',
    notes: [
      {
        tag: 'novo',
        text: 'Importar com IA em Cardápio › Itens: mande a foto do cardápio, a foto de um prato ou o PDF. A IA lê nomes, descrições e preços, você confere, corrige e salva. Usa a cota de IA do restaurante.',
      },
      {
        tag: 'novo',
        text: 'Primeiros passos em conversa: na loja nova, o mascote pergunta como você vende, o WhatsApp, o endereço e o tempo de preparo, e já deixa tudo gravado. No meio, o cardápio entra por foto. Dá para rever em Conta › Primeiros passos.',
      },
      {
        tag: 'novo',
        text: 'Item em 3D: envie o modelo escaneado (GLB e, para iPhone, USDZ) no cadastro do item. O cliente gira o prato na tela e, no celular, vê em tamanho real na mesa pela câmera.',
      },
      {
        tag: 'novo',
        text: 'Relatórios em PDF: cada relatório baixa em PDF pronto para enviar, com resumo, gráfico e tabela, além do Excel.',
      },
      {
        tag: 'melhoria',
        text: 'Pedido: botões de ação mais claros, cancelar sem precisar escrever o motivo e o comprovante do Pix abre direto no pedido.',
      },
      {
        tag: 'melhoria',
        text: 'Menu lateral com a logo e o nome da sua loja, campos e cartões mais compactos e padronizados no computador e no celular, e telas mais leves para abrir.',
      },
      {
        tag: 'melhoria',
        text: 'Conversas da equipe, do suporte e com o cliente em linhas, com nome, foto e hora, mais fáceis de ler em telas grandes.',
      },
      {
        tag: 'melhoria',
        text: 'Caixa com o resumo do turno num cartão só, com os números principais em destaque e o detalhe logo abaixo.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio do cliente mais simples: categorias em uma linha abaixo da busca e um menu de baixo direto, com ícone e nome em todas as abas.',
      },
    ],
  },
  {
    version: '0.107.0',
    date: '2026-11-11',
    title: 'Estoque que não vende o que acabou e com menos telas',
    summary:
      'O pedido do cardápio online reserva o estoque na hora em que o cliente pede, o Estoque passou de nove telas para quatro e dá para controlar o estoque de um item direto no cadastro dele.',
    notes: [
      {
        tag: 'correção',
        text: 'Pedido online em análise já reserva o estoque: dois clientes não levam o último item. Se a loja recusa ou o cliente cancela, o estoque volta sozinho. Vale por unidade e por quilo (um balde de 1,5 kg esgota antes da porção de 75 g do mesmo frango).',
      },
      {
        tag: 'melhoria',
        text: 'Estoque em quatro telas: Insumos (com lotes e validade), Movimentações (entrada, saída e perdas, produção), Fichas técnicas (com unidades de compra e custo e preço) e Inventário. Os endereços antigos continuam abrindo.',
      },
      {
        tag: 'novo',
        text: 'Controle simples: na ficha técnica do item, diga quanto tem hoje e toque em "Controlar estoque". Cada venda baixa e, quando acabar, o item sai do cardápio sozinho.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio online: se um item esgota enquanto o cliente monta a sacola, ele vê o aviso e a sacola se acerta.',
      },
    ],
  },
  {
    version: '0.106.1',
    date: '2026-11-11',
    title: 'Caixa, Pix cancelado e comanda mais seguros',
    summary:
      'Três correções da auditoria: o fechamento do caixa confere cada forma de pagamento, o pedido cancelado com comprovante de Pix enviado avisa que há Pix a devolver, e o garçom só move para a comanda os pedidos que ele enxerga.',
    notes: [
      {
        tag: 'correção',
        text: 'Fechamento do caixa: sobra numa forma de pagamento não cobre mais a falta em outra. Se o dinheiro tem R$ 5 a mais e o cartão R$ 5 a menos, o fechamento pede observação e a diferença de cada forma fica gravada. O relatório de fechamentos ganhou a coluna "Falta por forma".',
      },
      {
        tag: 'correção',
        text: 'Pix a devolver: pedido cancelado (pelo cliente ou pela loja) com o comprovante ainda sem conferir aparece em aviso no PDV. A equipe marca "Já devolvi o Pix" (gerente ou dono) ou "Não recebi este Pix", e o cliente acompanha pelo link do pedido.',
      },
      {
        tag: 'segurança',
        text: 'Mover pedido para a comanda: o garçom só move pedidos do salão ou lançados por ele. Pedido de delivery e pedido ainda em análise não entram em comanda.',
      },
    ],
  },
  {
    version: '0.106.0',
    date: '2026-11-09',
    title: 'Mesa com localização e pedido pronto que chega até ela',
    summary:
      'Quem pede pelo QR Code da mesa confirma pela localização que está no restaurante. O garçom vê os pedidos prontos para levar e toca em "Entreguei"; se a loja preferir, o cliente busca no balcão. Pix pelo cardápio e reservas agora pedem a conta do cliente.',
    notes: [
      {
        tag: 'segurança',
        text: 'QR Code da mesa: antes de pedir, o celular confirma que o cliente está no restaurante (perto do ponto da loja no mapa). Foto do QR Code não faz pedido de casa. Quem já liberou a localização confirma sem tocar em nada. Dá para desligar em Loja online › Funcionamento.',
      },
      {
        tag: 'novo',
        text: 'App do garçom: "Prontos para levar" no topo das mesas, com a mesa, o que levar e há quanto tempo está pronto. Um toque em "Entreguei" e o pedido sai da lista (também na comanda, no PDV e no detalhe do pedido).',
      },
      {
        tag: 'novo',
        text: 'Pedido da mesa pago pelo Pix e entregue conclui sozinho, e a comanda paga inteira pelo Pix fecha e libera a mesa, sem ninguém precisar fechar a conta.',
      },
      {
        tag: 'novo',
        text: 'Opção "Cliente busca o pedido pronto no balcão": o acompanhamento avisa "Pronto! Busque no balcão" (o celular vibra) e o cliente toca em "Já peguei".',
      },
      {
        tag: 'segurança',
        text: 'Pix pelo cardápio só com a conta do cliente aberta: sem login, o checkout mostra "Entre para pagar pelo Pix" e volta para a finalização depois de entrar.',
      },
      {
        tag: 'segurança',
        text: 'Reserva pelo cardápio só com cadastro: quem não entrou vê "Entre para reservar".',
      },
      {
        tag: 'melhoria',
        text: 'O acompanhamento do pedido da mesa mostra "Na mesa" assim que o garçom entrega, e não mais só quando a conta fecha.',
      },
    ],
  },
  {
    version: '0.105.0',
    date: '2026-11-09',
    title: 'Cardápio mais leve e Pix direto da mesa',
    summary:
      'O cardápio abre bem mais rápido no celular e mostra os produtos logo de cara, com menos texto. Quem pede pelo QR Code da mesa pode pagar na hora pelo Pix, e o cardápio sugere instalar o app conforme o aparelho.',
    notes: [
      {
        tag: 'melhoria',
        text: 'O cardápio do cliente baixa menos da metade do que baixava para abrir (o sistema da equipe não vem mais junto). Sacola, pedidos, conversa e conta chegam em segundo plano, prontos quando o cliente toca.',
      },
      {
        tag: 'melhoria',
        text: 'Menos texto no início do cardápio: aberto, tempo e taxa ficam numa linha só embaixo do nome da loja, os cartões mostram foto, nome e preço (a descrição fica na página do produto) e os produtos aparecem mais perto do topo. O aviso grande só aparece com a loja fechada.',
      },
      {
        tag: 'novo',
        text: 'Pedido pela mesa: o cliente escolhe "Pagar agora no Pix" (paga pelo QR Code e manda o comprovante) ou "Pagar no fim", com o garçom. O comprovante aparece no PDV e na comanda; aprovado, o valor sai do saldo da mesa.',
      },
      {
        tag: 'segurança',
        text: 'A comanda não cobra um pedido que já tem comprovante do Pix esperando conferência: aprove ou recuse o comprovante antes, para o cliente não pagar duas vezes.',
      },
      {
        tag: 'novo',
        text: 'O cardápio mostra, uma vez, um aviso pequeno para instalar o app da loja: "Baixe o app" no Android, "Coloque na Tela de Início" no iPhone (com o botão de compartilhar desenhado) e "Coloque na área de trabalho" no computador. Fechou, só volta depois de um mês.',
      },
      {
        tag: 'correção',
        text: 'O app instalado pelo cardápio abre no cardápio, e não mais na tela de login da equipe.',
      },
    ],
  },
  {
    version: '0.104.3',
    date: '2026-11-09',
    title: 'Menu de baixo encostado na tela e conversa que não quebra',
    summary:
      'No celular, o menu de baixo do cardápio encosta na borda da tela como num app. E a conversa com a loja não perde mais as últimas mensagens quando o teclado, os emojis ou a foto sobem.',
    notes: [
      {
        tag: 'melhoria',
        text: 'O menu de baixo do cardápio fica preso na borda de baixo, de ponta a ponta, e o fundo dele desce por trás do risco do iPhone. A bolinha da aba troca de lugar mais rápido.',
      },
      {
        tag: 'correção',
        text: 'Conversa: ao abrir o teclado, os emojis, a prévia da foto ou escrever várias linhas, a conversa continua mostrando as últimas mensagens. Antes elas sumiam atrás do que tinha subido.',
      },
      {
        tag: 'correção',
        text: 'A foto ou o vídeo ampliado na conversa cobre a tela inteira: no tablet a barra do topo ficava por cima do botão de fechar, e no notebook a foto passava da tela.',
      },
      {
        tag: 'melhoria',
        text: 'O menu do clipe (galeria, foto, vídeo) abre flutuando em cima do botão, sem empurrar a conversa, e fecha ao tocar fora. O dia das mensagens só aparece no topo enquanto você rola, sem ficar por cima do texto.',
      },
      {
        tag: 'correção',
        text: 'Ao abrir a conversa, o menu de baixo não passa mais por cima do campo de mensagem, e a página por trás não arrasta junto com o teclado aberto no iPhone.',
      },
    ],
  },
  {
    version: '0.104.2',
    date: '2026-11-09',
    title: 'Endereço de entrega que o mapa não achava',
    summary:
      'O cardápio agora acha muito mais endereços no mapa e nunca trava o pedido: quando não acha a casa, mostra o mapa para o cliente tocar onde mora.',
    notes: [
      {
        tag: 'correção',
        text: 'A busca no mapa procura em etapas: a casa, a rua sem o número, a rua sem "Doutor" ou "Professor", o bairro sem "Loteamento" ou "Residencial" e a cidade da loja. Antes era uma busca só, sem cidade, e qualquer palavra a mais fazia o endereço "não existir".',
      },
      {
        tag: 'melhoria',
        text: 'O CEP do endereço corrige a grafia da rua, e uma segunda base de mapas (Photon) aceita erro de digitação.',
      },
      {
        tag: 'correção',
        text: 'Sem achar a casa, o mapa aparece mesmo assim, no bairro ou na loja: o cliente toca ou arrasta o pino até a casa e a taxa e o código Pix aparecem na hora.',
      },
      {
        tag: 'melhoria',
        text: 'O ponto marcado fica salvo no endereço da conta, e o próximo pedido já sai sem procurar.',
      },
    ],
  },
  {
    version: '0.104.1',
    date: '2026-11-09',
    title: 'Telas e janelas abrindo direto no lugar',
    summary:
      'Nenhuma tela ou janela abre mais embaixo para depois subir. Cada tela já aparece no topo, e as janelas nascem no lugar final, crescendo do lado do botão que você tocou.',
    notes: [
      {
        tag: 'correção',
        text: 'Ao trocar de tela, a página volta ao topo antes de aparecer, sem mostrar a rolagem antiga e depois pular para cima.',
      },
      {
        tag: 'correção',
        text: 'As entradas de telas, abas, listas e cards agora só aparecem suavemente no lugar, sem subir de baixo.',
      },
      {
        tag: 'melhoria',
        text: 'Janelas (mesa, caixa, cardápio, estoque, equipe, reservas, impressão, cozinha) abrem já na posição final e crescem a partir do botão, sem deslizar depois.',
      },
    ],
  },
  {
    version: '0.104.0',
    date: '2026-11-09',
    title: 'Pix pelo cardápio: o cliente paga com QR Code e manda o comprovante para o PDV aprovar',
    summary:
      'Com a chave Pix da loja cadastrada, quem escolhe Pix no checkout do cardápio vê o QR Code e o Pix copia e cola já com o valor do pedido, paga no app do banco e anexa o comprovante. O pedido chega no PDV com o selo Comprovante: um toque abre a prévia ali mesmo, sem abrir o pedido, para aprovar ou recusar. O dinheiro cai direto na conta do restaurante, sem intermediário.',
    notes: [
      {
        tag: 'novo',
        text: 'Loja online → aba Pix (ou Configurações → Pix pelo cardápio): tipo e chave Pix, nome de quem recebe e cidade. Antes de ligar, um Pix de teste de R$ 1,00 mostra no app do banco o nome que o cliente vai ver.',
      },
      {
        tag: 'novo',
        text: 'No checkout, Pix mostra o valor, o botão Copiar código Pix e o QR Code (para pagar com outro aparelho). O comprovante (print ou PDF do banco) é anexado antes de enviar o pedido; a foto é reduzida no próprio celular para subir rápido.',
      },
      {
        tag: 'novo',
        text: 'No PDV, o cartão do pedido mostra o selo Comprovante com a miniatura: abre a foto grande com o valor do Pix para Aprovar (o Pix entra no caixa aberto e o pedido fica pago), Aprovar e aceitar, ou Recusar com o motivo. Chega com som e aviso, e o detalhe do pedido guarda o histórico dos comprovantes.',
      },
      {
        tag: 'melhoria',
        text: 'Recusado, o cliente vê o motivo no acompanhamento do pedido e manda outro comprovante (até 5). Se o envio falhar por falta de internet, também dá para mandar de novo por lá. Os arquivos ficam guardados por 180 dias.',
      },
    ],
  },
  {
    version: '0.103.0',
    date: '2026-11-09',
    title:
      'Cardápio online: desenhos minimalistas na cor da loja e confirmação do pedido sem piscar',
    summary:
      'Os desenhos do cardápio (motoboy, favoritos, pedidos, endereços, busca, loja fechada e acompanhamento) e os avatares do perfil foram refeitos com traço fino e só nos tons da cor que a loja escolheu. A tela de pedido enviado ficou mais calma e não pisca mais.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Desenhos e avatares em estilo minimalista: traço fino, sem enfeites e pintados só com a cor da loja (claro e escuro). Trocar a cor da marca repinta todos.',
      },
      {
        tag: 'melhoria',
        text: 'Animações mais curtas e discretas: rodas e vento no motoboy, vapor na panela e o visto se desenhando no pedido enviado. Saíram os confetes, o motoboy atravessando a tela e os pulos.',
      },
      {
        tag: 'correção',
        text: 'Pedido enviado não pisca mais: a confirmação entra já por cima da finalização e o acompanhamento carrega por trás, então abre pronto, sem tela vazia no meio.',
      },
    ],
  },
  {
    version: '0.102.1',
    date: '2026-11-09',
    title: 'Animações mais rápidas e janela da mesa abrindo direto no lugar',
    summary:
      'Todas as animações ficaram mais curtas e quase sem pulo, porque no sistema o que importa é velocidade. A janela da mesa no Salão não abre mais para baixo e depois sobe: ela já nasce no lugar certo.',
    notes: [
      {
        tag: 'correção',
        text: 'Salão: ao abrir uma mesa a janela descia e depois subia quando os pedidos carregavam. Agora ela já abre num lugar onde cabe e, se o conteúdo crescer, só cresce para cima, sem deslizar.',
      },
      {
        tag: 'melhoria',
        text: 'Janelas abrem em cerca de 0,25 s e fecham em 0,16 s; botões, interruptores, abas, avisos e troca de tela também ficaram mais rápidos e com mola bem mais discreta.',
      },
    ],
  },
  {
    version: '0.102.0',
    date: '2026-11-09',
    title: 'QR Code da mesa abre o cardápio já na mesa e o pedido cai na comanda',
    summary:
      'O cliente que aponta a câmera para o QR Code colado na mesa abre o cardápio com a mesa já escolhida: escolhe, põe o nome e toca em Pedir para a mesa, sem endereço nem pagamento, e o pedido vai para a comanda daquela mesa. Quem é da equipe e lê o mesmo QR cai direto na comanda da mesa, no app do garçom ou no Salão.',
    notes: [
      {
        tag: 'novo',
        text: 'Pedido pela mesa: o QR Code de cada mesa (Salão → QR das mesas) abre o cardápio online mostrando "Você está na Mesa 5". Na finalização só se pede o nome (WhatsApp é opcional); o pedido entra na comanda aberta da mesa ou abre uma no nome do cliente. A conta é paga no fim, com o garçom ou no caixa.',
      },
      {
        tag: 'novo',
        text: 'Na mesa valem os preços do cardápio Principal (o do salão) e a taxa de serviço da comanda aparece no resumo antes de pedir. Não há taxa de entrega nem pedido mínimo, e o acompanhamento mostra a mesa e as etapas até chegar nela.',
      },
      {
        tag: 'melhoria',
        text: 'O pedido da mesa segue o aceite da loja online: com o aceite automático vai direto para a cozinha; sem ele, aparece em análise no PDV com o aviso "Novo pedido da Mesa 5 pelo celular". Enquanto um pedido do cliente espera aceite, a comanda não é cobrada nem fechada.',
      },
      {
        tag: 'melhoria',
        text: 'Equipe lendo o QR pela câmera do celular: o garçom cai na comanda da mesa (ou no pedido novo, se ela está livre) no app dele. O dono ou gerente abre no app do garçom se é o que estava usando naquele aparelho, ou no Salão do painel.',
      },
      {
        tag: 'segurança',
        text: 'A mesa só vale no próprio restaurante e se estiver ativa; com a loja fechada o cliente vê "Chame o garçom para pedir". A mesa fica lembrada só naquela aba do navegador, por até 6 horas: abrir o cardápio em casa depois não pede para a mesa por engano.',
      },
    ],
  },
  {
    version: '0.101.0',
    date: '2026-11-09',
    title: 'Administrador define uma senha nova para quem esqueceu',
    summary:
      'Na tela Equipe, cada pessoa ganhou o botão Nova senha: o administrador digita a senha nova, a pessoa sai de todos os aparelhos e já entra com ela, mesmo que tenha ficado bloqueada por errar a senha.',
    notes: [
      {
        tag: 'novo',
        text: 'Equipe › Nova senha: só o administrador vê e usa. A senha nova vale na hora, encerra as sessões abertas da pessoa e acaba com o bloqueio por senhas erradas. Fica registrado na auditoria quem trocou (a senha nunca é guardada).',
      },
      {
        tag: 'segurança',
        text: 'Quem usa a mesma conta em outro restaurante não tem a senha trocada por aqui: só a própria pessoa (Trocar minha senha) ou o suporte do Comandou. Assim um restaurante nunca mexe no acesso de outro.',
      },
      {
        tag: 'melhoria',
        text: 'Na sua própria linha da Equipe aparece Trocar senha, que abre a troca da sua senha (pede a atual).',
      },
    ],
  },
  {
    version: '0.100.0',
    date: '2026-11-09',
    title: 'Janelas abrem perto de onde você tocou, com movimento de mola',
    summary:
      'As janelas não abrem mais sempre no meio da tela: saem de dentro do botão que você tocou e ficam ao lado dele, esticando com um efeito de mola como no iPhone. Botões, interruptores, abas e avisos ganharam o mesmo movimento, e os botões ficaram mais fáceis de enxergar.',
    notes: [
      {
        tag: 'melhoria',
        text: 'No computador e no iPad a janela abre perto de quem abriu: botão à direita, janela à direita; embaixo dele quando cabe (a linha ou mesa tocada continua à vista). Ao fechar, ela volta para dentro do botão. No celular a folha cresce do botão até o lugar dela.',
      },
      {
        tag: 'melhoria',
        text: 'Movimento com mola de verdade (passa um pouquinho do ponto e assenta), rodando na placa de vídeo para não travar: janelas, botões ao tocar, interruptores (a bolinha estica segurando o dedo), abas e avisos.',
      },
      {
        tag: 'melhoria',
        text: 'Botões mais fáceis de ver: o secundário tem contorno firme e o simples (Cancelar, Personalizar mesas, QR das mesas…) ganhou fundo cinza, em vez de parecer texto solto. O X das janelas virou a bolinha cinza do iPhone e não desce mais para baixo do título.',
      },
      {
        tag: 'melhoria',
        text: 'Visual mais limpo: sem faixas coloridas no topo das mesas e colunas do PDV (o estado virou uma bolinha antes do nome), sem listra grossa nos avisos e nos indicadores do Estoque, títulos de seção sem caixa alta e telas vazias com ícone cinza simples.',
      },
      {
        tag: 'correção',
        text: 'Interruptor "Loja aberta" fica verde como o texto; na barra do PDV no iPad em pé os botões não cortam mais o texto e o atalho F2 some em telas de toque.',
      },
    ],
  },
  {
    version: '0.99.0',
    date: '2026-11-09',
    title: 'Cardápio online com desenhos novos, pedido comemorado e foto no perfil',
    summary:
      'O cardápio do cliente ganhou desenhos no mesmo estilo do motoboy em cada tela vazia e no acompanhamento do pedido. Finalizar ficou mais claro: o botão mostra o que falta preencher e, ao enviar, uma comemoração confirma o pedido antes de abrir o acompanhamento. O cliente agora pode pôr uma foto ou escolher um avatar desenhado no perfil.',
    notes: [
      {
        tag: 'novo',
        text: 'Desenhos novos no cardápio: hambúrguer com coração (Favoritos), comanda com o sininho (Pedidos), casinha com o alfinete do mapa (Endereços), lupa no prato vazio (busca sem resultado), panela no fogo (cardápio em preparo) e a lojinha de porta fechada com lua quando a loja está fechada.',
      },
      {
        tag: 'novo',
        text: 'Acompanhamento do pedido com um desenho para cada etapa: comanda chegando, panela no fogo, sacola pronta, motoboy a caminho e sacola com o selo de entregue.',
      },
      {
        tag: 'novo',
        text: 'Pedido enviado: a sacola cai com o selo de ok, papeizinhos estouram e o motoboy passa na tela. Depois de 3 segundos o acompanhamento abre sozinho (ou na hora, em "Acompanhar pedido").',
      },
      {
        tag: 'melhoria',
        text: 'Finalizar pedido: com algum dado faltando, "Fazer pedido" leva até o campo, marca em vermelho e diz o que falta (nome, WhatsApp com DDD, endereço, ponto no mapa ou troco), em vez de ficar apagado sem explicação. Enviando, o botão mostra que está trabalhando; o total dá um pulinho quando muda.',
      },
      {
        tag: 'novo',
        text: 'Foto do perfil no cardápio: o cliente envia uma foto (recortada e reduzida no próprio celular) ou escolhe um de 12 avatares desenhados. Quem não escolhe ganha um avatar fixo. A foto aparece na aba da conta, na finalização e, para a equipe, em Clientes.',
      },
    ],
  },
  {
    version: '0.98.0',
    date: '2026-11-06',
    title: 'Funciona sem internet: salva no aparelho e sobe quando a conexão volta',
    summary:
      'Se a internet cair, o sistema continua aberto com os últimos dados e o que você salvar (pedidos, clientes, cardápio, mesas, estoque e o resto) fica guardado no aparelho, mesmo fechando ou recarregando. Quando a conexão volta, tudo vai para a nuvem sozinho, na ordem, sem duplicar.',
    notes: [
      {
        tag: 'novo',
        text: 'Sem internet, uma faixa no topo avisa que o que for salvo fica só neste aparelho e mostra quantas alterações esperam para subir. Em "Ver itens" dá para conferir a lista e enviar na hora quando a conexão voltar.',
      },
      {
        tag: 'novo',
        text: 'Telas já abertas com internet abrem de novo sem conexão, inclusive depois de fechar ou recarregar o app, com a sessão guardada no aparelho.',
      },
      {
        tag: 'melhoria',
        text: 'Cada envio da fila leva uma chave única: se a rede cair depois do servidor gravar, o reenvio não cria pedido ou cadastro em dobro. O que o servidor recusar ao sincronizar aparece para revisar, tentar de novo ou descartar.',
      },
      {
        tag: 'melhoria',
        text: 'Pagamentos, caixa, nota fiscal, WhatsApp, impressão, envio de fotos e login continuam precisando de internet e avisam isso na hora. Ao sair, os dados guardados no aparelho são apagados; o que ainda não subiu fica para quando a mesma pessoa entrar de novo.',
      },
    ],
  },
  {
    version: '0.97.0',
    date: '2026-11-06',
    title: 'Estoque pela ficha técnica: quanto dá para vender e bloqueio quando falta',
    summary:
      'Cada item do cardápio mostra o que leva de matéria-prima, quanto tem de cada uma e quantas unidades ainda dá para vender. Quando um insumo acaba, o item fica "Sem estoque" e não vende no PDV, no garçom nem no cardápio online até dar entrada.',
    notes: [
      {
        tag: 'novo',
        text: 'Estoque › Fichas técnicas ganhou a coluna "Dá para vender" (unidades, em amarelo quando restam 5 ou menos) e a aba "Sem estoque", com o insumo que falta em cada item.',
      },
      {
        tag: 'novo',
        text: 'Na ficha técnica (no estoque e no cadastro do item) cada insumo mostra quanto tem, em vermelho o que não dá para mais uma unidade, e um aviso diz quantas unidades dá para vender.',
      },
      {
        tag: 'novo',
        text: 'Cardápio › Itens: situação "Sem estoque" com o que falta, "Restam N unidades" quando está acabando e aviso no topo com os itens travados.',
      },
      {
        tag: 'melhoria',
        text: 'Item sem estoque pela ficha aparece esgotado sozinho no PDV, no app do garçom, no cardápio online e na IA do WhatsApp, sem precisar marcar à mão; volta a vender assim que der entrada.',
      },
      {
        tag: 'melhoria',
        text: 'O pedido com item sem estoque é recusado já na montagem, dizendo qual insumo falta. Insumo com "permitir negativo" nunca trava; item por peso só trava quando o insumo zera.',
      },
    ],
  },
  {
    version: '0.96.0',
    date: '2026-11-06',
    title: 'Panda mais simples: sem roupinhas',
    summary:
      'O panda voltou a ser só o panda: saíram as roupinhas e o passeio pelo canto da tela. Ele fica no topo olhando de um lado para o outro, segue o mouse com os olhos e reage quando você toca nele.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Saiu a "Roupa do panda" do menu da Conta, junto com as peças, os looks prontos e o passeio no canto de baixo da tela.',
      },
      {
        tag: 'melhoria',
        text: 'Parado, o panda olha para um lado e para o outro e, de vez em quando, vira a cabeça para olhar em volta, sem pulos nem acenos sozinho.',
      },
    ],
  },
  {
    version: '0.95.0',
    date: '2026-11-05',
    title: 'Migrar um cliente inteiro para outro servidor',
    summary:
      'No painel Super Admin › Infraestrutura › Migrações dá para escolher um restaurante e levar tudo dele (banco, fotos, equipe, pedidos, cadastro, domínios e assinatura) para outra instalação do Comandou num servidor novo, em seis fases acompanhadas na tela: preparar, enviar, criar, restaurar, virar e encerrar.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › Infraestrutura › Migrações: cadastre a stack do servidor novo (endereço do painel de lá e o token que ele gera) e use "Migrar cliente". O pacote é o banco do restaurante, com tamanho e sha256, enviado em blocos e conferido do outro lado.',
      },
      {
        tag: 'novo',
        text: 'O servidor novo instala o cliente sozinho: cria o cadastro e o banco, restaura, aplica as migrações da versão dele e confere as contagens de cada tabela antes da virada.',
      },
      {
        tag: 'novo',
        text: 'Depois da virada, o endereço antigo leva cada página para o mesmo lugar no endereço novo.',
      },
      {
        tag: 'novo',
        text: 'Opções: só copiar (fica uma cópia suspensa lá para conferir), backup de segurança antes, deixar suspenso no destino e apagar o banco antigo no fim (com backup final).',
      },
      {
        tag: 'segurança',
        text: 'Se algo falhar antes da virada, o destino apaga o que criou e o restaurante volta a funcionar onde estava. O servidor novo só aceita pacotes com o token gerado nele, e a migração para se a chave das integrações for diferente.',
      },
    ],
  },
  {
    version: '0.94.0',
    date: '2026-11-05',
    title: 'Venda por peso para sorveteria e restaurante por quilo',
    summary:
      'Item vendido por peso agora funciona em toda a venda: o preço é do quilo, o sistema pede o peso ao lançar (PDV, salão e app do garçom), desconta a tara do pote ou do prato e mostra o peso no pedido, na cozinha, no cupom e na nota. No cardápio online o cliente escolhe quanto quer. A IA do WhatsApp e o assistente da equipe já sabem explicar.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápio › Itens: com "Vendido por peso" ligado, o item ganha o campo Tara (g), o peso do pote, prato ou marmita, descontado do que a balança mostra.',
      },
      {
        tag: 'novo',
        text: 'PDV, Salão e app do garçom: tocar num item por peso abre a pesagem. Aceita 0,350, 350 g ou 1,2 kg, tem atalhos de 100 g a 1 kg e mostra o valor na hora. Cada pesagem vira uma linha, e tocar no peso da linha permite corrigir.',
      },
      {
        tag: 'novo',
        text: 'Cardápio online: no item por peso o cliente escolhe o peso de 50 em 50 g (100 g a 5 kg), e o preço aparece "/kg".',
      },
      {
        tag: 'melhoria',
        text: 'Pedidos, comandas, cozinha (KDS), cupom impresso e acompanhamento do cliente mostram "350 g" em vez de "0,35×". A nota fiscal sai em KG quando o item não tem outra unidade.',
      },
      {
        tag: 'melhoria',
        text: 'IA do WhatsApp: entende que o preço do item por peso é do quilo, faz a conta de uma porção (ex.: 300 g) e avisa que o valor final é o da balança. O assistente da equipe ensina a cadastrar e vender por peso.',
      },
      {
        tag: 'correção',
        text: 'Item vendido por unidade não aceita mais quantidade quebrada (como 1,5) no pedido.',
      },
    ],
  },
  {
    version: '0.93.0',
    date: '2026-11-05',
    title: 'Super Admin: Infraestrutura numa aba só e calendário de recebimentos',
    summary:
      'Servidor, Bancos e Backups viraram uma aba só, a Infraestrutura, com uma aba para cada parte. Na Cobrança, um calendário mostra em que dia cada cliente paga e quanto, e as configurações ganharam explicações com exemplos.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Super Admin: Servidor, Bancos e Backups juntos na tela Infraestrutura (/servidor, /servidor/bancos, /servidor/backups). Os endereços antigos continuam funcionando.',
      },
      {
        tag: 'novo',
        text: 'Cobrança: calendário do mês com o que já entrou, as faturas enviadas, as vencidas e a previsão das próximas mensalidades de cada cliente. Toque num dia para ver quem paga e quanto.',
      },
      {
        tag: 'melhoria',
        text: 'Cobrança: configurações separadas em grupos (Asaas, mensalidade, contrato, cartão, página de preços), cada campo com o limite aceito e um exemplo, e uma linha do tempo com os números escolhidos.',
      },
    ],
  },
  {
    version: '0.92.0',
    date: '2026-11-05',
    title: 'Conversa com a loja ocupando a tela no notebook',
    summary:
      'No notebook, a conversa do cliente com a loja deixou de ser uma caixa estreita no meio da tela. Agora ela ocupa todo o espaço ao lado do menu e ganhou uma coluna com a loja, os pedidos do cliente e um desenho de como a conversa funciona.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cardápio online, Conversa no notebook: a conversa ocupa a largura da tela, com um fundo pontilhado na cor da loja.',
      },
      {
        tag: 'novo',
        text: 'Coluna ao lado da conversa com a capa e a situação da loja, o tempo de entrega, a retirada e o endereço.',
      },
      {
        tag: 'novo',
        text: '"Falar sobre um pedido": tocar num pedido recente já manda a próxima mensagem com o número dele.',
      },
    ],
  },
  {
    version: '0.91.1',
    date: '2026-11-05',
    title: 'Comandas do Salão sem texto vazando',
    summary:
      'Na aba Comandas do Salão, o selo "conta", o valor e o tempo podiam sair para fora do cupom. Agora tudo cabe no cartão em qualquer tela, e o tempo aberto aparece curto (10 h 17, 6 d) em vez de milhares de minutos.',
    notes: [
      {
        tag: 'correção',
        text: 'Salão › Comandas: cupom reorganizado (número e selo de conta em cima; mesa, cliente e tempo na linha de baixo) e textos longos cortados com reticências.',
      },
      {
        tag: 'melhoria',
        text: 'Salão: tempo de mesa, de comanda e de pedido em minutos, horas ou dias.',
      },
    ],
  },
  {
    version: '0.91.0',
    date: '2026-11-05',
    title: 'CEP que preenche o endereço em todo lugar',
    summary:
      'Digitar o CEP preenche rua, bairro, cidade e UF, e digitar o nome da rua mostra os CEPs para escolher. Isso agora vale no cardápio online, no PDV, no app do garçom, na Loja online, na nota fiscal, no cartão da assinatura e no painel Super Admin. A consulta ficou mais rápida e tem reservas quando um serviço de CEP falha.',
    notes: [
      {
        tag: 'correção',
        text: 'A consulta de CEP pergunta a três serviços ao mesmo tempo e responde com o primeiro que achar. Se o servidor não conseguir, o próprio navegador pergunta à ViaCEP e à BrasilAPI.',
      },
      {
        tag: 'correção',
        text: 'A busca do CEP pelo nome da rua usa a cidade da Loja online ou, sem ela, a cidade da empresa na nota fiscal. Se o servidor não achar, o navegador procura de novo sem o "Rua" ou "Av." do começo.',
      },
      {
        tag: 'novo',
        text: 'PDV e garçom: o endereço de entrega ganhou CEP, rua com sugestões, número, complemento, bairro e cidade.',
      },
      {
        tag: 'novo',
        text: 'Loja online, contrato e cadastro de restaurante: o CEP preenche o endereço e a cidade. No cartão da assinatura, o CEP mostra o endereço achado para conferir.',
      },
    ],
  },
  {
    version: '0.90.0',
    date: '2026-11-05',
    title: 'Puxar para recarregar no app',
    summary:
      'No app instalado na tela inicial, puxar a tela para baixo lá no topo e segurar recarrega a página, como nos aplicativos do celular. No fim da tela, o conteúdo estica um pouco e volta sozinho, sem recarregar.',
    notes: [
      {
        tag: 'novo',
        text: 'Puxar para recarregar: no topo de qualquer tela que rola (painel, cardápio online, garçom, entregador), puxe para baixo até a bolinha encher e a seta virar para cima, e solte. Soltar antes desiste.',
      },
      {
        tag: 'melhoria',
        text: 'Fim da tela mais macio: puxar para cima no fim da lista estica o conteúdo com resistência e ele volta sozinho ao soltar.',
      },
      {
        tag: 'melhoria',
        text: 'O gesto não atrapalha janelas abertas, mapas, campos de texto nem carrosséis que deslizam para os lados.',
      },
    ],
  },
  {
    version: '0.89.0',
    date: '2026-11-05',
    title: 'Botão de tela cheia',
    summary:
      'Agora tem uma abinha no topo da tela, bem no meio. Um toque nela expande o sistema para ocupar a tela toda, sem a barra do navegador. Outro toque, ou a tecla Esc, volta ao normal.',
    notes: [
      {
        tag: 'novo',
        text: 'Abinha de tela cheia no topo de todas as telas do sistema: painel, PDV, salão, cardápio, garçom, cozinha, entregador e Super Admin.',
      },
      {
        tag: 'melhoria',
        text: 'As telas do cliente (cardápio online, acompanhamento do pedido e rastreio) ficam sem a abinha. No iPhone ela não aparece, porque o Safari não deixa sites usarem a tela cheia.',
      },
    ],
  },
  {
    version: '0.88.0',
    date: '2026-11-05',
    title: 'Cardápio online com cara de app',
    summary:
      'O cardápio online ficou com um jeito próprio para cada tela. No celular, o menu de baixo ganhou uma bolinha que desliza até a aba aberta. No tablet, ele parece um totem de pedido, com as categorias numa coluna e a barra do pedido sempre à mão. No notebook, as categorias ficam num menu do lado e a sacola fica aberta ao lado do cardápio. Tudo com desenhos de motoboy e da loja.',
    notes: [
      {
        tag: 'novo',
        text: 'Celular: menu de baixo animado. A aba aberta sobe para uma bolinha na cor da loja, encaixada num recorte da barra, e os dois deslizam juntos ao trocar de aba.',
      },
      {
        tag: 'novo',
        text: 'Tablet: layout de totem, com abas no topo, categorias com foto numa coluna à esquerda, todas as seções em sequência e a barra "Ver sacola" presa embaixo.',
      },
      {
        tag: 'novo',
        text: 'Notebook: menu lateral com a loja, as abas e as categorias. Tocar numa categoria rola o cardápio até ela, e rolar o cardápio marca a categoria que está na tela.',
      },
      {
        tag: 'novo',
        text: 'Notebook largo: a sacola fica aberta ao lado do cardápio, com quantidade de cada item, entrega ou retirada, total e o botão que já abre a finalização.',
      },
      {
        tag: 'melhoria',
        text: 'Desenhos de motoboy e da loja no topo do cardápio, na sacola vazia, nos pedidos e no acompanhamento (saiu para entrega ou pronto para retirar).',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio no computador mais compacto: cabeçalho com a capa, cartões de produto menores e com botão "Adicionar", sem espaços sobrando.',
      },
    ],
  },
  {
    version: '0.87.0',
    date: '2026-11-05',
    title: 'Salão de cara nova',
    summary:
      'O Salão ganhou abas no topo para Mesas, Comandas, Delivery e Para levar, com filtros rápidos em cada uma. As mesas aparecem desenhadas de cima, no formato cadastrado e com uma cadeira por lugar; as comandas viraram cupons e os pedidos de entrega mostram em que etapa estão.',
    notes: [
      {
        tag: 'novo',
        text: 'Salão: abas Mesas, Comandas, Delivery e Para levar no topo, cada uma com a sua ação principal (escanear mesa, comanda avulsa, novo delivery, novo para levar).',
      },
      {
        tag: 'novo',
        text: 'Salão: filtros em pílulas (livres, ocupadas, em pagamento; pediram a conta, de mesa, avulsas; na cozinha, prontos, em rota) com a contagem de cada um.',
      },
      {
        tag: 'melhoria',
        text: 'Mapa de mesas: cada mesa é desenhada de cima (redonda, quadrada ou retangular) com as cadeiras em volta; a cor mostra se está livre, ocupada ou pedindo a conta, com o tempo de mesa no canto.',
      },
      {
        tag: 'melhoria',
        text: 'Comandas em formato de cupom, com barra do quanto já foi pago; delivery e para levar com a linha do pedido (recebido, preparo, pronto, em rota) e destaque para o que espera aceite.',
      },
    ],
  },
  {
    version: '0.86.0',
    date: '2026-11-05',
    title: 'Assinatura nova, cartão automático e página de preços',
    summary:
      'A tela Assinatura foi redesenhada: dias que faltam, pagar em um toque, cobrança automática no cartão, Pix gerado sozinho e troca de plano para cima ou para baixo. E o Comandou ganhou a página pública /precos, com os planos e a tabela de comparação, que acompanha o que for mudado no Super Admin.',
    notes: [
      {
        tag: 'novo',
        text: 'Assinatura: cadastre um cartão e a mensalidade sai sozinha no dia do vencimento. Se o banco recusar, tentamos de novo e o Pix e o boleto continuam valendo.',
      },
      {
        tag: 'novo',
        text: 'Assinatura: escolha pagar por Pix (a fatura sai sozinha dias antes e chega no e-mail), boleto ou cartão automático.',
      },
      {
        tag: 'novo',
        text: 'Mudar para um plano menor pela própria tela: vale a partir do próximo mês, com a mensalidade já no preço novo, e dá para desfazer até lá.',
      },
      {
        tag: 'novo',
        text: 'Página /precos: planos, tabela de comparação e perguntas frequentes, sem login. Preço, limites, frase, destaques e "Mais escolhido" vêm do Super Admin › Planos.',
      },
      {
        tag: 'melhoria',
        text: 'Tela Assinatura em duas colunas, mais limpa: plano e pagamento à esquerda; planos, forma de pagamento e faturas à direita.',
      },
    ],
  },
  {
    version: '0.85.1',
    date: '2026-11-05',
    title: 'Resposta do chat da loja não some mais',
    summary:
      'Na conversa com o cliente da loja online, o texto que a equipe estava digitando podia sumir sozinho quando o contador de mensagens não lidas atualizava. Agora a conversa fica como está até você enviar.',
    notes: [
      {
        tag: 'correção',
        text: 'Chat da loja: o texto digitado na resposta não é mais apagado quando chega aviso de mensagem não lida.',
      },
    ],
  },
  {
    version: '0.85.0',
    date: '2026-11-04',
    title: 'Modo maquininha, tutorial do Estoque e ajuda em aparelhos antigos',
    summary:
      'O Comandou agora tem um modo maquininha para Smart POS com Android (Sunmi, PAX, Gertec, Positivo, Ingenico): botões maiores para o dedo e impressão na bobina de 58 mm. O Estoque ganhou um tutorial passo a passo e o "?" dos campos abre também em iPhone, iPad e maquininhas com navegador mais antigo.',
    notes: [
      {
        tag: 'novo',
        text: 'Ajustes › Este aparelho: modo maquininha (automático, ligado ou desligado) e largura da bobina (58 ou 80 mm) para comprovante e comanda impressos pelo navegador, com impressão de teste.',
      },
      {
        tag: 'novo',
        text: 'Botão Tutorial em todas as telas do Estoque: insumos, fichas técnicas, recebimento, fatores, produção, lotes, saídas, inventário e precificação, na ordem de quem está começando.',
      },
      {
        tag: 'correção',
        text: 'O "?" dentro das janelas não abria em navegadores sem a camada de cima (iOS até o 16, Android antigo e maquininhas): o balão agora fica preso dentro da janela e aparece inteiro.',
      },
      {
        tag: 'correção',
        text: 'Ler o QR Code da mesa pela câmera (garçom e Salão) voltou a funcionar no servidor: o cabeçalho de segurança do site bloqueava a câmera.',
      },
      {
        tag: 'melhoria',
        text: 'Caixa no celular estreito (320 px): os valores não quebram mais no meio ("R$ 1.279,52" numa linha só).',
      },
    ],
  },
  {
    version: '0.84.1',
    date: '2026-11-04',
    title: 'Ajuda (?) funcionando dentro das janelas',
    summary:
      'O "?" ao lado dos campos agora abre a explicação também dentro das janelas (como Reajustar preços, Nova categoria e Novo cardápio). Antes o balão abria por trás da janela e não dava para ver nem clicar.',
    notes: [
      {
        tag: 'correção',
        text: 'Balão de ajuda aparece por cima das janelas, com o X e o link clicáveis; Esc fecha só o balão.',
      },
    ],
  },
  {
    version: '0.84.0',
    date: '2026-11-04',
    title: 'Cardápio de integração com o iFood',
    summary:
      'Novo tipo de cardápio, Integração: ligue a sua loja do iFood e o Comandou manda itens, categorias, preços, complementos e disponibilidade para o iFood conforme você edita. O botão Sincronizar com o iFood envia na hora e mostra o resumo da última sincronização.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápios > Ligar loja do iFood: a loja autoriza o Comandou no Portal do Parceiro e fica ligada a este restaurante (outro restaurante não consegue ligar a mesma loja).',
      },
      {
        tag: 'novo',
        text: 'Cardápio do tipo Integração, ligado a uma loja do iFood. Item novo é criado no iFood, item editado é atualizado e item que sai do cardápio ou é desativado fica indisponível lá (nada é apagado).',
      },
      {
        tag: 'novo',
        text: 'Envio automático: com o cardápio ativo, cada alteração vai sozinha para o iFood em instantes, mandando só o que mudou (preço e disponibilidade vão pelo caminho rápido do iFood).',
      },
      {
        tag: 'novo',
        text: 'Cartão Cardápio no iFood com a data da última sincronização e o resumo (criados, atualizados, sem alteração e deixados indisponíveis), e a lista do que deu erro.',
      },
      {
        tag: 'melhoria',
        text: 'As fotos dos itens vão para o iFood em JPG: o aparelho converte as fotos em WebP ao tocar em Sincronizar.',
      },
    ],
  },
  {
    version: '0.83.0',
    date: '2026-11-04',
    title: 'Cardápio mais fácil e reajuste de preços de uma vez',
    summary:
      'O editor de cada cardápio ficou mais direto: categorias em abas no topo, itens com foto, preço e um botão de liga/desliga. Agora dá para reajustar todos os preços de uma vez (por percentual, com arredondamento e por categoria) e criar categorias com ícone e cozinha.',
    notes: [
      {
        tag: 'novo',
        text: 'Reajustar preços no cardápio: percentual para subir ou baixar, arredondamento (,90, ,99, ,50 ou inteiro), filtro por categoria e prévia antes de aplicar. Pode incluir os complementos.',
      },
      {
        tag: 'novo',
        text: 'Nova categoria com ícone (emoji) e cozinha (KDS). Trocar a cozinha da categoria leva todos os itens dela, e item novo já nasce nessa cozinha.',
      },
      {
        tag: 'melhoria',
        text: 'Editor do cardápio com categorias em abas, foto do item, unidade, liga/desliga e lápis para editar o item. No celular os botões do topo viram ícones.',
      },
      {
        tag: 'melhoria',
        text: 'Aba Itens mais limpa: sem a coluna Família, com a categoria embaixo do nome e lápis para editar cada categoria. Famílias (só para relatórios) foi para o fim das abas.',
      },
    ],
  },
  {
    version: '0.82.0',
    date: '2026-11-04',
    title: 'Cardápio e checkout melhores no notebook',
    summary:
      'No notebook, o cardápio online usa a tela toda, com mais produtos por linha. A sacola e o checkout ganharam duas colunas: o formulário à esquerda, com campos menores e organizados lado a lado, e o resumo do pedido fixo à direita. No celular nada muda.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cardápio online ocupa a largura toda do notebook, com até 6 produtos por linha.',
      },
      {
        tag: 'melhoria',
        text: 'Checkout no notebook com campos mais baixos e endereço em linhas (CEP e rua, número, bairro, cidade e UF).',
      },
      {
        tag: 'melhoria',
        text: 'Resumo do pedido e botão de finalizar ficam fixos ao lado, sem a barra no rodapé.',
      },
    ],
  },
  {
    version: '0.81.0',
    date: '2026-11-04',
    title: 'Mês financeiro no dia que você escolher',
    summary:
      'No Financeiro, o gerente escolhe em que dia o mês começa (por exemplo, dia 5, quando o dinheiro entra). O mês passa a ir do dia 5 até o dia 4 do mês seguinte, e os totais do mês, as contas do mês e o fluxo de caixa seguem esse período.',
    notes: [
      {
        tag: 'novo',
        text: 'Botão "Dia de início do mês" no Financeiro, com um exemplo do período antes de salvar. Dia 1 continua sendo o mês do calendário; nos meses mais curtos que o dia escolhido, o mês começa no último dia.',
      },
      {
        tag: 'novo',
        text: 'Resumo do mês no topo das contas: vendas recebidas, contas recebidas e pagas, saldo do mês e o que ainda falta pagar e receber. As setas mostram os meses anteriores e os próximos.',
      },
      {
        tag: 'melhoria',
        text: 'Aba "Do mês" nas contas (o que vence no mês financeiro) e o fluxo de caixa já abre com as datas do mês escolhido.',
      },
    ],
  },
  {
    version: '0.80.0',
    date: '2026-11-04',
    title: 'Endereço completo pelo CEP ou pelo nome da rua',
    summary:
      'Nos endereços do cardápio online, da empresa (fiscal) e do cliente da nota, digitar o CEP preenche rua, bairro, cidade e UF, e digitar o nome da rua mostra os CEPs dessa rua na cidade para escolher. Com um único resultado, o CEP já entra ao sair do campo.',
    notes: [
      {
        tag: 'correção',
        text: 'A consulta de CEP parava quando a ViaCEP bloqueava ou demorava e chegava a guardar "CEP não encontrado" por uma semana. Agora tenta também BrasilAPI e OpenCEP, não guarda falhas e, se o servidor não alcançar nenhum serviço, o próprio navegador consulta a ViaCEP.',
      },
      {
        tag: 'melhoria',
        text: 'Busca pela rua mais esperta: acha "Av. Paulista", "Rua Augusta" ou nomes sem acento, e põe primeiro as ruas que começam pelo que foi digitado.',
      },
      {
        tag: 'novo',
        text: 'CEP e busca pela rua também no cadastro da empresa (fiscal) e no endereço do cliente da nota.',
      },
      {
        tag: 'melhoria',
        text: 'Mensagens claras na rua: falta cidade/UF para buscar, nenhuma rua com esse nome, ou busca fora do ar.',
      },
    ],
  },
  {
    version: '0.79.0',
    date: '2026-11-04',
    title: 'Fechar conta do pedido em painel lateral, via de entrega e cancelar item à vista',
    summary:
      'No painel do pedido, "Fechar conta" abre um painel que desliza da direita com taxa de serviço, frete, desconto, pagamento imediato ou posterior (a receber), vários meios de pagamento e divisão por pessoa. O pedido também ganhou "Imprimir pedido", "Imprimir via de entrega" com pré-visualização e "Cancelar item" embaixo de cada item.',
    notes: [
      {
        tag: 'novo',
        text: 'Fechar conta: itens à esquerda e, à direita, taxa de serviço (%), frete, desconto em R$ ou %, Imediato ou Posterior (a receber), um ou mais meios de pagamento e "Dividir por" com o valor por pessoa. Dinheiro acima do total vira troco.',
      },
      {
        tag: 'novo',
        text: 'Via de entrega para o motoboy: cliente, telefone, endereço, itens, quanto cobrar na porta, forma de pagamento e troco. Pré-visualiza antes de imprimir e, sem o app de impressão, imprime pelo navegador.',
      },
      {
        tag: 'novo',
        text: 'A via de entrega tem modelo próprio em Impressão > Modelos de impressão (Liquid, parecido com o Jinja), com prévia do último delivery.',
      },
      {
        tag: 'melhoria',
        text: '"Cancelar item" fica embaixo de cada item do pedido, com o motivo logo ali. No último item, ele leva ao cancelamento do pedido inteiro.',
      },
      {
        tag: 'melhoria',
        text: 'As regras continuam: "a receber" exige o gerente e o motivo, e o pedido só é concluído quando a conta zera.',
      },
    ],
  },
  {
    version: '0.78.0',
    date: '2026-11-04',
    title: 'CrowdSec: o servidor passa a bloquear robôs, força bruta no login e IPs de ataque',
    summary:
      'O Comandou ganhou o CrowdSec, uma proteção gratuita que lê o tráfego do servidor, reconhece ataques e bloqueia o IP do atacante por algumas horas, além de barrar IPs que já atacaram outros servidores no mundo. Liga com um comando no servidor (docs/crowdsec.md) e não bloqueia pagamentos, o teste de status nem o uso normal dos restaurantes.',
    notes: [
      {
        tag: 'segurança',
        text: 'CrowdSec: robôs procurando falhas (/wp-login.php, /.env, painéis de administração, ataques conhecidos) e ferramentas de ataque são bloqueados no Traefik, antes de chegar ao sistema. O bloqueio dura 4 horas.',
      },
      {
        tag: 'segurança',
        text: 'CrowdSec: mais de 15 erros seguidos de login do mesmo IP em poucos minutos (equipe, Super Admin ou conta do cliente na loja) bloqueiam o IP. Soma-se ao limite por minuto e ao bloqueio por conta que já existiam.',
      },
      {
        tag: 'segurança',
        text: 'CrowdSec: o servidor recebe a lista da comunidade com IPs que atacaram outros servidores e já os barra na primeira visita.',
      },
      {
        tag: 'melhoria',
        text: 'Nunca bloqueados: o aviso de pagamento do Asaas, o teste de status do Super Admin, os health checks, as métricas e o próprio servidor. O uso normal da API também não conta como ataque, porque num restaurante todos os aparelhos saem pelo mesmo IP do Wi-Fi.',
      },
      {
        tag: 'melhoria',
        text: 'Se o CrowdSec parar, os sites continuam no ar (só sem o bloqueio). O comando scripts/crowdsec.sh liga tudo na ordem certa, confere cada passo, mostra quem está bloqueado (--status) e desliga sem derrubar nada (--off). Numa instalação nova, o instalador oferece ligar no final.',
      },
    ],
  },
  {
    version: '0.77.0',
    date: '2026-11-03',
    title: 'Login mais simples e bonito, e você só entra uma vez em cada aparelho',
    summary:
      'Todas as telas de entrada (painel, garçom, cozinha, entregas e Super Admin) ficaram no estilo limpo do Planejai, pensadas primeiro para o celular. E depois do primeiro login o aparelho fica conectado: não precisa entrar de novo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Login no celular e no app instalado: sem cartão nem enfeite, título grande, campos e botão de 52px, ajuda no pé da tela e sem o teclado abrindo sozinho ao abrir a tela. No computador, formulário à esquerda e um painel liso com o mascote.',
      },
      {
        tag: 'novo',
        text: 'Fica conectado: quem entra no painel, no app do garçom, da cozinha ou das entregas continua conectado naquele aparelho. A sessão se renova a cada uso (vale 60 dias sem abrir); para trocar de pessoa, use Sair.',
      },
      {
        tag: 'novo',
        text: 'Super Admin: "Lembrar este aparelho" vem marcado. Depois do primeiro login com o código, o painel fica aberto no aparelho por até 30 dias sem uso, renovando sozinho, e o próximo login nem pede o código. Assinar contrato continua pedindo o código.',
      },
    ],
  },
  {
    version: '0.76.0',
    date: '2026-11-03',
    title: 'Cozinha com várias telas: Bar, Chapa, Forno...',
    summary:
      'Cada tela da cozinha escolhe qual cozinha mostra e guarda a escolha. Os pedidos chegam separados por Delivery, Mesa, Balcão e Retirada, em colunas mais fáceis de ler, com cronômetro, impressão da comanda e ajustes de tema, cor, layout e som no próprio aparelho.',
    notes: [
      {
        tag: 'novo',
        text: 'Ao abrir a cozinha, o aparelho pergunta qual cozinha vai exibir (Bar, Chapa, Fritadeira...) e lembra a escolha. Dá para trocar a qualquer momento pela seta ao lado do nome.',
      },
      {
        tag: 'novo',
        text: 'Abas por tipo de pedido (Todos, Delivery, Mesa, Balcão, Retirada) com a contagem de cada uma, e só os tipos que aquela cozinha recebe.',
      },
      {
        tag: 'melhoria',
        text: 'Colunas A fazer, Preparando e Pronto redesenhadas: número grande, tipo do pedido, mesa ou cliente, cronômetro que muda de cor no aviso e no atraso, e botões "Iniciar preparo" e "Tudo pronto" no próprio cartão.',
      },
      {
        tag: 'novo',
        text: 'Imprimir a comanda pelo cartão: vai para a impressora da loja quando há uma ligada, ou sai pela impressora do próprio aparelho, só com os itens daquela cozinha.',
      },
      {
        tag: 'novo',
        text: 'Configurações da tela: tema claro ou escuro, cor de destaque, layout em colunas ou lista, tamanho do texto, som com volume e teste, onde imprimir e de quanto em quanto tempo conferir a fila.',
      },
      {
        tag: 'novo',
        text: 'Topo com tempo médio de espera e quantos pedidos estão atrasados, relógio e faixa de baixo com o total de cada item ainda por fazer.',
      },
      {
        tag: 'novo',
        text: 'Super Admin: aba Cozinha em cada restaurante para cadastrar as cozinhas com cor, escolher que tipo de pedido cada uma recebe e ligar ou desligar o que aparece na tela (cronômetro, fotos, adicionais, observações, coluna Pronto, impressão...). Vale na hora para as telas abertas.',
      },
    ],
  },
  {
    version: '0.75.0',
    date: '2026-11-03',
    title: 'Assistente de IA: o gerente configura como a IA atende os clientes',
    summary:
      'Nova tela em Sistema > Assistente de IA. O gerente escolhe o nome, o jeito de falar, as boas-vindas, o que a IA sabe da casa e o que ela não deve fazer, marca os itens do cardápio que ela pode oferecer e testa a conversa antes de ligar o atendimento no WhatsApp.',
    notes: [
      {
        tag: 'novo',
        text: 'Assistente de IA (gerente e dono): nome do atendente, jeito de falar (simpático, formal ou descontraído) com exemplo, boas-vindas, "Sobre a casa", regras e a frase para chamar uma pessoa. Cada campo tem o "?" explicando com exemplo.',
      },
      {
        tag: 'novo',
        text: 'Itens que a IA pode oferecer: lista do cardápio por categoria, com busca e marcar/desmarcar todos. A IA só fala dos itens marcados, com o preço do cardápio Delivery, e avisa quando um item está esgotado.',
      },
      {
        tag: 'novo',
        text: 'O que a IA pode fazer: sugerir itens e adicionais, informar preços e mandar o link do cardápio online. Ela nunca fecha pedido, dá desconto ou pede dados de cartão.',
      },
      {
        tag: 'novo',
        text: 'Testar a conversa: o gerente escreve como se fosse o cliente e vê a resposta com o que está na tela, mesmo sem salvar.',
      },
      {
        tag: 'novo',
        text: 'Atendimento no WhatsApp: ligar ou desligar, responder sempre ou só com a loja aberta. Quando o cliente pede uma pessoa, a IA avisa a equipe no chat e fica quieta na conversa por 12 horas. O uso conta no mesmo limite mensal da IA (e nos tokens extras).',
      },
    ],
  },
  {
    version: '0.74.0',
    date: '2026-11-03',
    title: 'Comprovante de fechamento com modelo próprio e NFC-e mesmo com a SEFAZ fora do ar',
    summary:
      'Ao fechar a mesa ou a comanda, o comprovante aparece na tela para conferir e imprimir. O formato do comprovante, da comanda da cozinha e do rodapé do cupom fiscal agora é editável, e a NFC-e continua saindo quando a SEFAZ cai.',
    notes: [
      {
        tag: 'novo',
        text: 'Comprovante de fechamento: na mesa/comanda (botão "Comprovante" e logo depois de fechar a conta) e no pedido, com pré-visualização e Imprimir. Sem o app de impressão, imprime pelo navegador.',
      },
      {
        tag: 'novo',
        text: 'Impressão > Modelos de impressão: edite o comprovante de fechamento, a comanda da cozinha e o rodapé do cupom fiscal com variáveis e laços (linguagem Liquid, parecida com o Jinja), com prévia do último pedido e "Voltar ao padrão".',
      },
      {
        tag: 'novo',
        text: 'NFC-e em contingência offline: com a SEFAZ fora do ar, o cupom sai com "EMITIDA EM CONTINGÊNCIA" em duas vias (consumidor e estabelecimento) e a nota é confirmada sozinha quando a SEFAZ volta. Opção em Fiscal > Configuração.',
      },
      {
        tag: 'melhoria',
        text: 'Nota em contingência mostra "contingência pendente" na lista e só pode ser cancelada depois que a SEFAZ recebe.',
      },
      {
        tag: 'melhoria',
        text: 'Comprovante da mesa junta todas as rodadas num papel só, com o endereço da loja e a hora da impressão.',
      },
      {
        tag: 'correção',
        text: 'Cancelamento de nota recusado pela SEFAZ às vezes vinha sem o motivo.',
      },
      {
        tag: 'segurança',
        text: 'Modelos de impressão não leem arquivos nem rodam código, e têm limite de tamanho, tempo e memória.',
      },
    ],
  },
  {
    version: '0.73.0',
    date: '2026-11-03',
    title: 'Caixa com linha do tempo: tudo o que entrou e saiu, evento por evento',
    summary:
      'A aba Caixa mostra os totais do turno no topo e, embaixo, a linha do tempo com cada venda, suprimento e sangria separados por forma de pagamento. Abrir e fechar o caixa é feito na mesma tela.',
    notes: [
      {
        tag: 'novo',
        text: 'Caixa: totais desde a abertura (vendido, frete, acréscimos, movimentado, contas fechadas, suprimentos, sangrias e dinheiro esperado).',
      },
      {
        tag: 'novo',
        text: 'Linha do tempo do caixa: abertura, vendas (um registro por pedido, mesmo pago em mais de uma forma), suprimentos, sangrias e estornos, com frete, desconto e colunas de dinheiro, cartão de crédito, cartão de débito e PIX.',
      },
      {
        tag: 'novo',
        text: 'Em cada venda: Emitir NFC-e (ou a situação da nota, que abre a nota fiscal) e Reimprimir o comprovante. Tocar no número do pedido abre o pedido.',
      },
      {
        tag: 'melhoria',
        text: 'Este terminal ou Todos os caixas abertos, com o terminal escolhido lembrado no aparelho. Suprimento, Sangria, Abrir caixa e Fechar caixa ficam no topo da tela.',
      },
      {
        tag: 'melhoria',
        text: 'Sessões antigas abrem com a mesma linha do tempo e o resultado do fechamento. No celular, cada evento vira um cartão só com o que tem valor.',
      },
    ],
  },
  {
    version: '0.72.0',
    date: '2026-11-03',
    title: 'Sininho de novidades na barra de cima',
    summary:
      'Um sininho no topo mostra o que saiu de novo no sistema, com o número do que você ainda não viu. Cada novidade fica ali por 2 dias e depois some sozinha.',
    notes: [
      {
        tag: 'novo',
        text: 'Sininho na barra de cima, ao lado do som e do tema: um toque abre as novidades recentes com o que mudou em cada versão.',
      },
      {
        tag: 'novo',
        text: 'Contador do que ainda não foi visto neste aparelho. Ao abrir, tudo fica marcado como lido.',
      },
      {
        tag: 'melhoria',
        text: 'Cada novidade some sozinha 2 dias depois do dia em que saiu, sem precisar limpar. O histórico completo continua em Novidades.',
      },
    ],
  },
  {
    version: '0.71.1',
    date: '2026-11-03',
    title:
      'WhatsApp não para mais de responder depois de horas parado, e agora mostra "digitando..."',
    summary:
      'A conexão do WhatsApp por QR Code se cuida sozinha: percebe quando a linha morreu sem avisar e religa na hora. Também recebe as mensagens dos clientes e mostra "online", "digitando..." e os tiques azuis, a base para o atendimento por IA.',
    notes: [
      {
        tag: 'correção',
        text: 'WhatsApp: depois de muito tempo sem conversa a conexão podia ficar "meio aberta" (parecia conectada, mas nada saía nem chegava). Agora um vigia confere cada conexão a cada 15 segundos e religa a que ficou muda, e o WhatsApp recebe um sinal a cada 20 segundos para a rede não derrubar a conexão parada.',
      },
      {
        tag: 'correção',
        text: 'WhatsApp: antes de enviar com a conexão parada há um tempo, o sistema confere se ela ainda responde; se caiu, religa e espera voltar em vez de falhar na hora. Se a conexão morre no meio do envio, religa e manda de novo uma vez.',
      },
      {
        tag: 'correção',
        text: 'WhatsApp: se o servidor do WhatsApp não responde ao conectar, o sistema tenta de novo sozinho, sem ficar preso em "conectando".',
      },
      {
        tag: 'novo',
        text: 'WhatsApp: as mensagens que os clientes mandam para o número da loja chegam ao sistema (texto, foto com legenda, áudio, localização e respostas de botão; grupos e status ficam de fora), inclusive de contatos com número escondido.',
      },
      {
        tag: 'novo',
        text: 'WhatsApp: o sistema pode mostrar "digitando..." antes de responder, marcar a mensagem do cliente como lida (tiques azuis), reagir com emoji e ficar "online" enquanto atende. Depois de um minuto volta a "offline", para o celular da loja continuar recebendo as notificações.',
      },
      {
        tag: 'melhoria',
        text: 'WhatsApp: conferido que cada restaurante conecta o próprio número, com a sessão separada das outras. Envio, mensagem recebida, queda e desconexão de um não mexem nos outros (agora com teste de várias lojas conectadas ao mesmo tempo).',
      },
    ],
  },
  {
    version: '0.71.0',
    date: '2026-11-03',
    title: 'Aba Tokens no Super Admin: suas chaves de API, limite de cada cliente e tokens extras',
    summary:
      'Tudo de chave e token ficou numa aba só: a sua chave do OpenRouter (sistema e esteira) separada da dos restaurantes, o uso de cada uma, o limite do mês de cada cliente e os tokens extras que só o Super Admin doa ou retira.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › Tokens: duas chaves do OpenRouter. A sua é usada pela esteira de chamados e pelos testes do painel (e pode ser a mesma do CI); a dos restaurantes é a que o assistente de cada cliente gasta. Cada uma mostra o uso de hoje, do mês, desde sempre e o limite da chave.',
      },
      {
        tag: 'novo',
        text: 'Tokens extras: o Super Admin doa (ou retira) tokens para um restaurante, com motivo. Eles não vencem e só são gastos depois que o limite do mês acaba. Só o painel muda isso; o restaurante apenas vê o saldo.',
      },
      {
        tag: 'novo',
        text: 'Extrato de uso: cada chamada de IA com a chave que pagou, o restaurante ou a parte do sistema (esteira, teste), tokens, quanto saiu dos extras e o custo. As doações e retiradas ficam no extrato e na auditoria.',
      },
      {
        tag: 'novo',
        text: 'Todas as chaves do sistema num lugar: Asaas, Focus NFe, WhatsApp, GitHub, backups, servidor. Mostra o que está configurado, o que falta e onde trocar, sem nunca mostrar o valor.',
      },
      {
        tag: 'melhoria',
        text: 'Assistente da equipe: com tokens extras, ele continua respondendo depois do limite do mês e a barra de uso mostra quantos extras sobram.',
      },
      {
        tag: 'segurança',
        text: 'O uso de IA do restaurante passa a ser gravado por uma função do banco que trava a conta do restaurante, para duas respostas ao mesmo tempo nunca gastarem o mesmo token extra.',
      },
    ],
  },
  {
    version: '0.70.0',
    date: '2026-11-03',
    title: 'Super Admin: status de cada site em tempo real logo depois do login',
    summary:
      'A tela inicial do painel mostra todos os restaurantes com a situação do site, do banco, do WhatsApp e do backup, atualizando sozinha a cada 15 segundos.',
    notes: [
      {
        tag: 'novo',
        text: 'Status: cada site é testado pelo endereço público (o mesmo caminho do cliente) e mostra se está online, o código HTTP e o tempo de resposta. Domínios próprios verificados também são testados.',
      },
      {
        tag: 'novo',
        text: 'Na mesma linha: banco do restaurante (central ou próprio, servidor e tempo de resposta), WhatsApp (conectado, aguardando QR ou desconectado) e último backup bom.',
      },
      {
        tag: 'novo',
        text: 'Busca e filtros (fora do ar, com atenção, WhatsApp desconectado, suspensos), com os problemas no topo. Ações por site: entrar no sistema já logado e abrir o site numa nova aba.',
      },
      {
        tag: 'melhoria',
        text: 'Números do topo resumem sites, bancos, WhatsApp, backups e alertas; os alertas, o servidor e a saúde da plataforma continuam logo abaixo.',
      },
    ],
  },
  {
    version: '0.69.3',
    date: '2026-11-03',
    title: 'Cobrança da assinatura confirma o pagamento sozinha, mesmo sem o aviso do Asaas',
    summary:
      'O restaurante que paga é liberado mesmo quando o aviso do Asaas se perde, ninguém recebe a mesma cobrança duas vezes e estorno tira de volta os dias que o pagamento tinha liberado.',
    notes: [
      {
        tag: 'correção',
        text: 'Cobrança: a cada ciclo o sistema confere no Asaas as faturas em aberto. Pagamento cujo aviso (webhook) não chegou libera os 30 dias e tira o bloqueio do mesmo jeito.',
      },
      {
        tag: 'correção',
        text: 'Cobrança: se o envio de uma fatura ao Asaas cair no meio, o reenvio reaproveita a cobrança que já foi criada lá, sem cobrar o cliente em dobro.',
      },
      {
        tag: 'correção',
        text: 'Cobrança: estorno, chargeback ou pagamento desfeito no Asaas tira os 30 dias que aquela mensalidade tinha liberado (e devolve se o pagamento voltar).',
      },
      {
        tag: 'melhoria',
        text: 'Cobrança: "Baixar" no painel também dá baixa no Asaas, então o cliente para de receber a cobrança daquela fatura.',
      },
      {
        tag: 'melhoria',
        text: 'Cobrança: aviso do Asaas que chega antes da fatura terminar de ser gravada é ligado à fatura certa pela referência.',
      },
    ],
  },
  {
    version: '0.69.2',
    date: '2026-11-03',
    title: 'App do garçom, do entregador e Cardápio mais bonitos e mais fluidos no celular',
    summary:
      'As telas de rua e de salão seguem o mesmo padrão do painel: troca de tela suave, listas que entram em cascata, toque que responde na hora e nada escondido atrás do botão do chat.',
    notes: [
      {
        tag: 'correção',
        text: 'Garçom: em "Meus pedidos" a barra de baixo sumia; agora fica em todas as abas.',
      },
      {
        tag: 'correção',
        text: 'Entregador e garçom (Desafios): a tela não passa mais da largura do celular nem corta botões na direita.',
      },
      {
        tag: 'melhoria',
        text: 'O chat da equipe virou a aba "Chat" no garçom e um botão no cabeçalho do entregador, com a bolinha de não lidas. O botão redondo não cobre mais preços nem endereços.',
      },
      {
        tag: 'melhoria',
        text: 'Garçom: a aba ativa ganha um fundo que desliza de uma aba para outra; troca de tela, mesas, pedidos e desafios entram com movimento curto.',
      },
      {
        tag: 'melhoria',
        text: 'Entregador: cabeçalho fixo no topo, botões "Ligar" e "WhatsApp" com nome, e o código de entrega aparece com transição.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio no celular: as categorias viram fichas com foto que rolam para o lado e os itens aparecem logo abaixo, sem rolar a lista inteira.',
      },
    ],
  },
  {
    version: '0.69.1',
    date: '2026-11-03',
    title: 'WhatsApp por QR Code mais estável e avisos que chegam no número certo',
    summary:
      'Os avisos pelo WhatsApp encontram o número certo do cliente (com ou sem o 9), a conexão por QR Code não fica presa tentando reconectar e a tela mostra por que o WhatsApp desconectou.',
    notes: [
      {
        tag: 'correção',
        text: 'Aviso para celular cadastrado no WhatsApp sem o 9 agora chega: o sistema pergunta ao WhatsApp qual é o número certo. Número sem WhatsApp vira falha na hora, sem ficar tentando.',
      },
      {
        tag: 'correção',
        text: 'QR Code que ninguém leu expira e pede um novo, em vez de ficar gerando QR para sempre. Sessão aberta em outro lugar ou número bloqueado param de reconectar e a tela mostra o motivo.',
      },
      {
        tag: 'melhoria',
        text: 'Depois de ler o QR Code a conexão fecha na hora, e dá para desconectar enquanto ela ainda está "conectando".',
      },
      {
        tag: 'correção',
        text: '"Reenviar" um aviso que ainda está na fila não manda mais a mensagem duas vezes.',
      },
    ],
  },
  {
    version: '0.69.0',
    date: '2026-11-03',
    title:
      'Dinheiro e nota fiscal sob controle: acerto do entregador, NFC-e da mesa e cupom na térmica',
    summary:
      'Pedido só conclui pago (ou "a receber" com motivo), o caixa faz o acerto do entregador, a NFC-e sai para a comanda inteira e para o delivery pago na entrega, e o cupom fiscal imprime na térmica. Também: cancelar um item, taxa de serviço, horário automático da loja e login do painel mais seguro.',
    notes: [
      {
        tag: 'correção',
        text: 'Pedido com saldo não é mais concluído por engano: o PDV abre o pedido para receber. Quem pode cancelar conclui "a receber" (fiado) com motivo, e os pedidos ficam na aba "Concluídos em aberto".',
      },
      {
        tag: 'novo',
        text: 'Entregas › Acerto: o que cada entregador recebeu na porta, por pedido. O caixa confere e lança no caixa aberto, com a forma de pagamento. O app do entregador pergunta como o cliente pagou.',
      },
      {
        tag: 'correção',
        text: 'Delivery pago na entrega agora tem NFC-e: a nota sai quando o pedido vai para a rua (com a emissão automática ligada) ou pelo botão.',
      },
      {
        tag: 'melhoria',
        text: 'Mesa com várias rodadas tem uma NFC-e só, com a conta inteira, emitida quando a conta fecha.',
      },
      {
        tag: 'novo',
        text: 'Cupom da NFC-e na impressora térmica do caixa, com QR Code, assim que a nota é autorizada; "Imprimir cupom" tira a 2ª via. Liga e desliga em Fiscal › Configuração. App de impressão 1.1.0.',
      },
      {
        tag: 'novo',
        text: 'Cancelar um item do pedido (gerente), com motivo: o total é refeito, o estoque volta e a cozinha recebe o aviso de cancelamento.',
      },
      {
        tag: 'novo',
        text: 'Taxa de serviço: defina o percentual em Ajustes e ela entra sozinha nas comandas novas. Na comanda dá para tirar ou recolocar.',
      },
      {
        tag: 'novo',
        text: 'Horário de funcionamento da loja online por dia da semana, com mais de um turno e turno que passa da meia-noite: fora do horário a loja fecha sozinha e não aceita pedido.',
      },
      {
        tag: 'melhoria',
        text: 'Assinatura bloqueada não trava mais o caixa: receber, fechar conta, despachar e emitir nota continuam funcionando; só pedido e comanda novos ficam bloqueados.',
      },
      {
        tag: 'segurança',
        text: 'Painel da plataforma: o navegador só fica lembrado se marcar "Lembrar este aparelho", e por 30 dias (antes eram 400).',
      },
    ],
  },
  {
    version: '0.68.0',
    date: '2026-10-30',
    title: 'Mesas de volta no PDV e tutoriais do Cardápio e da Nota fiscal',
    summary:
      'O bloco do Salão voltou ao PDV. Cardápio e Nota fiscal ganharam um botão Tutorial que mostra cada parte da tela passo a passo, e cada campo ganhou um "?" que explica o que é e leva à tela ligada.',
    notes: [
      {
        tag: 'melhoria',
        text: 'PDV: as mesas e comandas voltaram para cima dos pedidos, com livres, ocupadas e em pagamento. Mesa livre abre a venda ali mesmo; ocupada abre a comanda.',
      },
      {
        tag: 'novo',
        text: 'Botão Tutorial no Cardápio, no cadastro do item e em todas as telas da Nota fiscal: o tour abre cada aba, enquadra o bloco e explica o que preencher, sem salvar nada.',
      },
      {
        tag: 'novo',
        text: 'Ponto de interrogação ao lado de cada campo do Cardápio, da configuração fiscal, dos padrões fiscais, da NF-e, da inutilização e do CPF na nota: explica o campo, dá exemplo e tem link para a tela relacionada.',
      },
      {
        tag: 'melhoria',
        text: 'Apresentação do primeiro acesso mais completa: passa por loja online, cardápio, complementos, ajustes, equipe, caixa, PDV com as mesas, salão, pedidos, cozinha e nota fiscal. Rever em Conta › Rever apresentação.',
      },
    ],
  },
  {
    version: '0.67.0',
    date: '2026-10-30',
    title: 'Pontuação e desafios dos garçons para o gestor',
    summary:
      'O dono e o gerente agora veem o selo, os desafios do dia e o ranking de cada garçom, em Relatórios e em Meus garçons.',
    notes: [
      {
        tag: 'novo',
        text: 'Relatórios › Operação e equipe › Pontuação e desafios dos garçons: ranking por desafios cumpridos, selo atual e quanto falta para o próximo, selos ganhos, pedidos, mesas e vendido no período, quais desafios cada um cumpre e o placar de hoje. Baixa em Excel como os outros.',
      },
      {
        tag: 'novo',
        text: 'Em Salão › Garçons, toque no garçom para abrir a pontuação dele: progresso até o próximo selo e os quatro desafios de hoje. O botão Ranking leva direto ao relatório.',
      },
    ],
  },
  {
    version: '0.66.1',
    date: '2026-10-30',
    title: 'Instalação em um comando com o repositório privado',
    summary:
      'O instalador agora vem dentro da imagem pública do sistema, então o comando de instalação funciona sem token mesmo com o repositório fechado.',
    notes: [
      {
        tag: 'correção',
        text: 'Instalar ou atualizar um servidor por SSH voltou a funcionar: curl -fsSL https://admin.comandou.com/instalar | sudo bash. Antes o comando dava erro 404 porque buscava os arquivos no GitHub.',
      },
      {
        tag: 'melhoria',
        text: 'A versão a instalar é a última publicada nas imagens (a mesma que o botão Atualizar sistema enxerga).',
      },
      {
        tag: 'correção',
        text: 'O Traefik que o instalador coloca passou para a versão 3.6. A 3.1 não funcionava com o Docker 29, que é o que vem instalado hoje em servidor novo, e nenhum endereço abria.',
      },
      {
        tag: 'correção',
        text: 'Na primeira instalação a migração espera o banco terminar de subir (até 12 tentativas) em vez de o instalador parar com erro logo na primeira.',
      },
    ],
  },
  {
    version: '0.66.0',
    date: '2026-10-30',
    title: 'Nota fiscal pronta para testar, com telas menores',
    summary:
      'A configuração da nota fiscal ficou em abas curtas (Empresa, NFC-e, NF-e e Geral), com um resumo do que falta para emitir e uma explicação curta em cada campo.',
    notes: [
      {
        tag: 'novo',
        text: 'Resumo no topo da configuração: ambiente, o que falta para emitir (empresa, certificado, CSC, token, padrão fiscal) e o botão de ligar a emissão.',
      },
      {
        tag: 'novo',
        text: 'Conta própria na Focus NFe com um token de homologação e outro de produção. Antes era um só, e trocar para produção usava o token de teste.',
      },
      {
        tag: 'novo',
        text: 'Botão Sincronizar Focus: busca de novo os tokens e a validade do certificado da empresa cadastrada.',
      },
      {
        tag: 'novo',
        text: 'CPF/CNPJ da contabilidade no cadastro da empresa (alguns estados exigem).',
      },
      {
        tag: 'melhoria',
        text: 'Padrões fiscais: nova aba Onde vale, com os itens e os NCMs ligados ao padrão e o padrão da empresa, na ordem em que a nota procura.',
      },
      {
        tag: 'melhoria',
        text: 'Campos das telas fiscais mais baixos e organizados; inutilização com a justificativa inteira à vista; textos do WhatsApp um por linha.',
      },
    ],
  },
  {
    version: '0.65.0',
    date: '2026-10-30',
    title: 'Chamados: conte o problema e acompanhe a solução',
    summary:
      'Nova tela Chamados (Sistema › Chamados): o dono e o gerente contam o que não funciona ou o que falta, com fotos e vídeos, e acompanham cada passo até ficar resolvido.',
    notes: [
      {
        tag: 'novo',
        text: 'Abra um chamado com resumo, assunto, quanto atrapalha, descrição e fotos ou vídeos da tela. Ele recebe um número (#CH-0001).',
      },
      {
        tag: 'novo',
        text: 'Andamento sempre à vista: Recebido, Em análise, Aprovado, Em desenvolvimento, Em testes e Resolvido. Se não for feito, o motivo aparece ali.',
      },
      {
        tag: 'novo',
        text: 'Converse com a equipe do Comandou dentro do chamado, com fotos e vídeos, e veja a bolinha quando houver resposta.',
      },
    ],
  },
  {
    version: '0.64.0',
    date: '2026-10-30',
    title: 'Fale com a Comandou pelo chat',
    summary:
      'O dono e o gerente agora conversam direto com a equipe da Comandou pela aba Suporte do chat, com texto, emojis, fotos e vídeos do problema.',
    notes: [
      {
        tag: 'novo',
        text: 'Aba Suporte no chat do sistema (e em Conta › Falar com a Comandou): mande a dúvida ou o erro com foto ou vídeo da tela e acompanhe a resposta ali mesmo, com aviso de mensagem nova.',
      },
      {
        tag: 'novo',
        text: 'Funciona mesmo com o sistema bloqueado pela cobrança, para dar para pedir ajuda.',
      },
    ],
  },
  {
    version: '0.63.0',
    date: '2026-10-30',
    title: 'Apresentação guiada pelas telas',
    summary:
      'No primeiro acesso, a apresentação passa pelas telas de verdade e enquadra o botão que você deve tocar: loja online, cardápio, equipe, caixa e venda. Funciona no celular e no computador.',
    notes: [
      {
        tag: 'novo',
        text: 'Tour guiado: cada passo abre a tela, escurece o resto e destaca o botão da vez (Adicionar item, Adicionar pessoa, Abrir caixa, Nova venda) e onde ele fica no menu.',
      },
      {
        tag: 'melhoria',
        text: 'Poucos passos, na ordem de quem está começando, e só com as telas que a pessoa pode usar. Dá para rever em Conta › Rever apresentação.',
      },
    ],
  },
  {
    version: '0.62.2',
    date: '2026-10-30',
    title: 'Cardápio com a cor da loja no topo',
    summary:
      'A barra do topo do celular agora fica na cor do restaurante, e Destaques e Mais pedidos aparecem com foto, como as outras categorias.',
    notes: [
      {
        tag: 'correção',
        text: 'Cardápio online: a barra do topo do navegador usa a cor escolhida pelo restaurante, e não o laranja padrão.',
      },
      {
        tag: 'melhoria',
        text: 'Carrossel de categorias: Destaques (ou o nome que a loja deu) e Mais pedidos mostram a foto de um produto delas, sem ícones.',
      },
    ],
  },
  {
    version: '0.62.1',
    date: '2026-10-30',
    title: 'Atualizações com o repositório privado',
    summary:
      'O painel volta a achar versões novas mesmo com o código no GitHub privado: olha direto as imagens publicadas, ou usa um token do GitHub se você configurar um.',
    notes: [
      {
        tag: 'correção',
        text: 'Servidor → Versão: com o repositório privado, a última versão vem das tags das imagens no GHCR.',
      },
      {
        tag: 'melhoria',
        text: 'Opcional: UPDATE_GITHUB_TOKEN na API e login do registro no agente, para quando as imagens também forem privadas.',
      },
    ],
  },
  {
    version: '0.62.0',
    date: '2026-10-30',
    title: 'Trocar de servidor de banco pelo painel',
    summary:
      'O Super Admin ganhou a tela Bancos: cadastre outro servidor Postgres e leve para lá um restaurante, ou todos, com um clique. Tudo é copiado, conferido tabela por tabela e só depois trocado.',
    notes: [
      {
        tag: 'novo',
        text: 'Tela Bancos no Super Admin: o servidor principal e os servidores extras, quantos restaurantes há em cada um, espaço usado, versão do Postgres e se as permissões e senhas estão certas (conferido sozinho a cada minuto).',
      },
      {
        tag: 'novo',
        text: 'Trocar de servidor: um restaurante por vez (na aba Banco do restaurante) ou "Mover todos" de um servidor para outro. O restaurante fica parado só durante a cópia dele; com backup ligado, um backup é feito antes.',
      },
      {
        tag: 'novo',
        text: 'Escolha onde nascem os restaurantes novos, desative um servidor para esvaziá-lo e remova quando estiver vazio. Nenhuma senha é pedida nem guardada: o servidor novo usa os mesmos papéis do principal.',
      },
      {
        tag: 'segurança',
        text: 'Se o servidor de destino já tiver um banco com dados do restaurante (o mesmo servidor cadastrado com outro endereço), a troca para sem mexer em nada. Qualquer falha antes da troca desfaz tudo e o restaurante continua onde estava.',
      },
    ],
  },
  {
    version: '0.61.1',
    date: '2026-10-30',
    title: 'Sistema abre mais rápido, principalmente no celular',
    summary:
      'Antes o sistema baixava todas as telas de uma vez ao abrir. Agora baixa só a tela que você abriu e traz as outras em segundo plano, então a primeira abertura fica bem mais leve e trocar de tela continua instantâneo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Primeira abertura cerca de três vezes mais leve: o cardápio online do cliente não baixa mais o painel, e garçom, cozinha e entregador baixam só o app deles.',
      },
      {
        tag: 'melhoria',
        text: 'Depois que o painel abre, as outras telas chegam em segundo plano, sem atrasar o que está na tela. O mapa da entrega só baixa quando a moto sai.',
      },
      {
        tag: 'melhoria',
        text: 'Limpeza de código que não era mais usado.',
      },
    ],
  },
  {
    version: '0.61.0',
    date: '2026-10-30',
    title: 'Nova demonstração: Aurora Café & Padaria, com fotos reais',
    summary:
      'Além da Casa Brasa, o sistema agora sobe com uma segunda empresa de exemplo: uma cafeteria e padaria com logo própria, fotos reais em todos os produtos e todas as partes do sistema preenchidas, do cardápio ao contrato.',
    notes: [
      {
        tag: 'novo',
        text: 'Aurora Café & Padaria em aurora.<domínio>: 61 produtos com fotos reais, adicionais e ficha técnica, 3 setores, 14 mesas, ~1.500 pedidos dos últimos 30 dias em todos os canais, caixa, financeiro, entregadores com repasse e posição no mapa, áreas de entrega, banners e cardápio de entrega com preço próprio.',
      },
      {
        tag: 'novo',
        text: 'Tudo o que vai além do básico também vem preenchido: estoque com fornecedores, recebimentos, contagem, lotes e produção; fidelidade; reservas; conversas e mural da equipe; regras fiscais; conversa com o Comandinho e o panda com roupinhas.',
      },
      {
        tag: 'novo',
        text: 'No Super Admin a Aurora aparece com cadastro, assinatura paga e faturas. Com os dados da contratada preenchidos, o contrato já chega assinado pelo cliente, esperando a contra-assinatura. Nada é enviado por e-mail.',
      },
      {
        tag: 'melhoria',
        text: 'Variável COMANDOU_DEMO2_SLUG muda o endereço da Aurora ou a desliga (false). As fotos são do Open Images (licença CC BY 2.0), com autor e link de cada uma registrados.',
      },
    ],
  },
  {
    version: '0.60.0',
    date: '2026-10-30',
    title: 'Conversa do cliente com a loja, direto no cardápio',
    summary:
      'O cliente não precisa mais ir para o WhatsApp: no cardápio online tem a aba Conversa, com emojis, fotos e vídeos. A equipe responde pelo PDV, que avisa com selo, som e aviso na tela quando chega mensagem.',
    notes: [
      {
        tag: 'novo',
        text: 'Aba Conversa no cardápio (celular e computador): o cliente com conta entra direto; quem não tem conta informa nome e celular. Dá para mandar texto, mais de 300 emojis, fotos (tirar na hora ou da galeria) e vídeos de até 20 MB. "Falar com a loja" no acompanhamento do pedido abre a conversa já citando o pedido.',
      },
      {
        tag: 'novo',
        text: 'Mensagens dos clientes no painel: lista de conversas com busca, não lidas e encerradas; conversa com fotos e vídeos, respostas prontas, "digitando…", lida (✓✓), último pedido do cliente e encerrar/reabrir.',
      },
      {
        tag: 'novo',
        text: 'Alertas no PDV: botão Mensagens com selo de quantas conversas esperam resposta, som próprio ("Mensagem de cliente", com repetição e silenciar como os pedidos), aviso no canto com "Responder" e notificação do computador com a aba em segundo plano.',
      },
      {
        tag: 'melhoria',
        text: 'Loja online › O que aparece: liga ou desliga a conversa; em Textos dá para escrever a mensagem de boas-vindas. Fotos e vídeos da conversa são privados (só o cliente e a equipe veem) e têm limite de espaço por restaurante; os mais antigos saem primeiro.',
      },
    ],
  },
  {
    version: '0.59.1',
    date: '2026-10-30',
    title: 'Sino só com pedido novo e PDV mais limpo',
    summary:
      'Abrir o app não faz mais o sino tocar: ele só apita quando chega um pedido novo. O PDV ficou só com os pedidos, o chat abre na hora e as listas de escolha ficaram legíveis no modo escuro.',
    notes: [
      {
        tag: 'correção',
        text: 'O sino que repete até alguém atender só toca por pedido ou cancelamento que chegou depois de abrir a tela. O que já estava esperando não dispara o som ao abrir.',
      },
      {
        tag: 'correção',
        text: 'No modo escuro, a lista que abre ao tocar num campo de escolha (como Ordenar por) tinha fundo branco com letra clara. Agora segue o tema.',
      },
      {
        tag: 'melhoria',
        text: 'A bolinha do chat abre e fecha a conversa na hora, sem animação.',
      },
      {
        tag: 'melhoria',
        text: 'O PDV não mostra mais o bloco do Salão. Mesas e comandas continuam na tela Salão.',
      },
      {
        tag: 'melhoria',
        text: 'O app do entregador funciona direto no navegador: não precisa mais colocar o atalho na tela inicial. Só a localização continua obrigatória.',
      },
    ],
  },
  {
    version: '0.59.0',
    date: '2026-10-30',
    title: 'Conta dividida: uma parte por pessoa',
    summary:
      'Ao dividir a conta da comanda, o caixa já recebe uma parte por pessoa, cada uma com a sua forma de pagamento, sem escolher tudo de novo a cada vez. O garçom também pode dizer em quantas pessoas a mesa vai dividir ao pedir a conta.',
    notes: [
      {
        tag: 'novo',
        text: 'Receber › Dividir em N mostra as N partes (Pessoa 1, Pessoa 2...). Depois de confirmar uma, a janela já passa para a próxima com o valor certo; as pagas ficam marcadas com a forma de pagamento.',
      },
      {
        tag: 'novo',
        text: 'Se alguém pagar um valor diferente, o que sobra é redividido entre quem ainda falta. Dá para tocar numa parte para receber fora da ordem e aumentar o número de pessoas (botão +, até 20).',
      },
      {
        tag: 'novo',
        text: 'Garçom: "Pediu a conta" pergunta em quantas pessoas dividir e mostra quanto fica para cada um. O caixa vê o aviso e o recebimento já abre dividido.',
      },
    ],
  },
  {
    version: '0.58.2',
    date: '2026-10-30',
    title: 'Migração aparece como concluída no Servidor',
    summary:
      'O serviço de migração roda uma vez a cada atualização e depois para. O painel mostrava isso como "0/1" em vermelho, como se estivesse fora do ar. Agora aparece "concluído".',
    notes: [
      {
        tag: 'correção',
        text: 'Super Admin › Servidor: serviço de execução única que terminou sem erro aparece como "concluído", não como parado.',
      },
      {
        tag: 'melhoria',
        text: 'Atualizar sistema espera até 15 minutos pela migração (baixar a imagem e passar por todos os bancos dos restaurantes pode passar de 5 minutos).',
      },
    ],
  },
  {
    version: '0.58.1',
    date: '2026-10-29',
    title: 'Janelas do celular não quebram mais com o teclado',
    summary:
      'No iPhone, abrir o teclado dentro de uma janela (Nova venda, formulários, busca, chat) cortava os campos e mostrava a tela de trás. Agora a janela fica presa à parte visível da tela.',
    notes: [
      {
        tag: 'correção',
        text: 'Com o teclado aberto, janelas e folhas acompanham a parte visível da tela: o topo não some, o total e os botões ficam logo acima do teclado e não sobra espaço em branco nem o fundo aparecendo.',
      },
    ],
  },
  {
    version: '0.58.0',
    date: '2026-10-29',
    title: 'Panda maior no topo, rosto novo e só preto e branco',
    summary:
      'O panda do topo ficou maior e veste a sua roupa; tocar nele abre a janela para trocar a roupinha. Ele também ganhou um rosto mais caprichado, contorno mais fino e pelo mais nítido, só em preto e branco.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Panda do topo maior, no lugar do quadradinho laranja. Tocar nele abre "Seu panda" para trocar a roupa, ver as expressões e ligar ou desligar o passeio.',
      },
      {
        tag: 'melhoria',
        text: 'Rosto novo: olhos com íris e brilho, nariz de panda e boquinha em "w". Saiu o rosa das bochechas; o panda agora é só preto e branco, com contorno mais fino e pelo mais nítido.',
      },
    ],
  },
  {
    version: '0.57.0',
    date: '2026-10-29',
    title: 'O panda ganhou roupinhas, pelo macio e passeia pelo canto da tela',
    summary:
      'O panda do Comandou ficou mais bonito, com luz, sombra e textura de pelo. Cada pessoa da equipe pode vestir o seu: chef, garçom, entregador, atendente ou Natal. De vez em quando ele aparece no canto de baixo, acena e vai embora.',
    notes: [
      {
        tag: 'novo',
        text: 'Roupa do panda (em Conta): touca de chef, boné, fone, gorro de Natal, lenço, gravatinha e cachecol, ou um dos prontos. A escolha fica salva na sua conta e vale em qualquer aparelho.',
      },
      {
        tag: 'novo',
        text: 'Passeio: o panda entra pulando pelo canto de baixo à esquerda, acena, olha em volta e sai. Tocar nele faz ele acenar e ir embora. Dá para desligar na Roupa do panda.',
      },
      {
        tag: 'melhoria',
        text: 'Panda mais bonito: pelo macio, luz vindo de cima, sombra suave no chão e brilho no nariz e nas orelhas. O assistente do chat aparece com a mesma roupa que você escolheu.',
      },
    ],
  },
  {
    version: '0.56.0',
    date: '2026-10-29',
    title: 'Quando algo trava, o sistema mostra o que fazer e leva até a tela certa',
    summary:
      'Caixa fechado, comanda já fechada, item esgotado, nota sem certificado ou impressora desligada: em vez de só o erro, aparece o que fazer e um botão que abre a tela que resolve. O assistente do chat também passou a mandar links direto para as telas.',
    notes: [
      {
        tag: 'novo',
        text: 'Avisos que guiam: ao receber, fechar comanda, lançar pedido, emitir nota, imprimir ou despachar, o aviso diz o que fazer e tem o botão para a tela certa (por exemplo, "Abrir o caixa"). Quem não tem acesso àquela tela vê a quem pedir.',
      },
      {
        tag: 'novo',
        text: 'O assistente do chat da equipe conhece todas as telas, seções e atalhos do sistema e responde com links que levam direto até lá.',
      },
      {
        tag: 'melhoria',
        text: 'O assistente vê um retrato da loja na hora (caixa aberto, comandas, pedidos em andamento, itens esgotados, loja online, nota fiscal, impressão e WhatsApp) e consegue dizer por que algo não está funcionando.',
      },
      {
        tag: 'melhoria',
        text: 'No app do garçom, os avisos levam ao mapa de mesas dele, e o assistente fala das telas que o garçom, a cozinha e o entregador usam.',
      },
    ],
  },
  {
    version: '0.55.0',
    date: '2026-10-29',
    title: 'PDV inteiro na tela, chat mais discreto e troca de tema em círculo',
    summary:
      'O PDV cabe na altura da janela sem rolar a página, o botão do chat ficou menor e no canto, e no celular o chat abre por "Conversas" no Mais.',
    notes: [
      {
        tag: 'melhoria',
        text: 'PDV: salão, quadro de pedidos e totais do dia aparecem juntos em qualquer tamanho de tela. Só a lista de cada coluna (e a grade de mesas, se tiver muitas) rola por dentro.',
      },
      {
        tag: 'melhoria',
        text: 'Cartões de pedido em colunas estreitas não se sobrepõem mais: a etiqueta Online e os botões descem de linha para o valor e o cliente ficarem legíveis.',
      },
      {
        tag: 'melhoria',
        text: 'Botão do chat da equipe menor e mais colado no canto da tela no computador.',
      },
      {
        tag: 'novo',
        text: 'Celular: o botão flutuante do chat saiu das telas. O chat (conversas, pessoas, mural, IA e avisos) abre por "Conversas" no topo do menu Mais, com o número de mensagens não lidas.',
      },
      {
        tag: 'melhoria',
        text: 'Troca entre tema claro e escuro: a cor nova se abre num círculo a partir do ponto onde você clicou.',
      },
    ],
  },
  {
    version: '0.54.0',
    date: '2026-10-29',
    title: 'Painel super admin mais leve e o sistema sem enfeites',
    summary:
      'O painel admin ganhou um visual mais limpo e uma visão geral de cada cliente numa tela só. No sistema todo saíram os emojis e enfeites.',
    notes: [
      {
        tag: 'novo',
        text: 'Ficha do restaurante abre na "Visão geral": assinatura e quantos dias faltam, uso do plano contra os limites (equipe, produtos e pedidos), contrato, cadastro e o que falta preencher, operação, nota fiscal, assistente de IA, banco, equipe e domínios. Cada cartão leva à aba certa.',
      },
      {
        tag: 'melhoria',
        text: 'Painel admin mais leve: números lado a lado numa peça só, etiquetas em pílula de tom suave, cores só no que pede atenção e títulos de tela com as ações na mesma linha.',
      },
      {
        tag: 'melhoria',
        text: 'Lista de restaurantes em colunas (plano, situação e pedidos do mês), com as iniciais de cada cliente. No restaurante, "Abrir sistema" e "Suspender" ficam à mão e o resto vai para o botão de mais ações.',
      },
      {
        tag: 'melhoria',
        text: 'Sem emojis e enfeites no sistema: saíram os emojis de textos e avisos, os ícones de brilho, foguete e confete, e o degradê com pontinhos da tela de entrada, que agora é lisa.',
      },
    ],
  },
  {
    version: '0.53.0',
    date: '2026-10-29',
    title: 'Assinatura com pagamento por Pix, boleto e cartão',
    summary:
      'A mensalidade agora é cobrada pelo próprio sistema: 7 dias de teste, cada pagamento libera mais 30 dias e, sem pagamento, o sistema bloqueia sozinho até a fatura ser paga.',
    notes: [
      {
        tag: 'novo',
        text: 'Tela Assinatura (antes Plano): quantos dias faltam, faturas, pagamento por Pix (QR Code e copia e cola), boleto ou cartão, e o contrato com a data de renovação.',
      },
      {
        tag: 'novo',
        text: 'Subir de plano pela própria tela: o plano novo vale na hora e só a diferença dos dias que faltam é cobrada à parte.',
      },
      {
        tag: 'novo',
        text: 'Bloqueio automático: sem pagamento até o fim do período, o sistema fica só para consulta (sem pedidos, vendas ou cadastros) e volta assim que o pagamento é confirmado. Nada é apagado.',
      },
      {
        tag: 'novo',
        text: 'Aviso no topo de todas as telas quando a fatura está para vencer, quando o sistema foi bloqueado e quando o contrato precisa ser renovado.',
      },
      {
        tag: 'novo',
        text: 'Super Admin › Cobrança: conta do Asaas (chave cifrada, webhook cadastrado com um clique), prazos, recebido e vencido no mês, situação de cada cliente; no restaurante, faturas com conferir, baixar e cancelar.',
      },
      {
        tag: 'melhoria',
        text: 'Contrato renovado todo ano: vigência de até 12 meses, aviso 30 dias antes e o novo contrato já começa no dia seguinte ao fim do atual.',
      },
      {
        tag: 'correção',
        text: 'Limites do plano: duas criações ao mesmo tempo (produto, pessoa da equipe ou pedido) não passam mais juntas do limite.',
      },
    ],
  },
  {
    version: '0.52.1',
    date: '2026-10-29',
    title: 'Conferência de conta completa e telas sem travar no pico',
    summary:
      'A conferência impressa agora mostra cada parte do valor (taxa de entrega, desconto, acréscimo), como o cliente vai pagar, o troco e as observações.',
    notes: [
      {
        tag: 'correção',
        text: 'Conferência de conta impressa: subtotal, desconto, acréscimo e taxa de entrega aparecem antes do total; o motoboy vê quanto cobrar, em que forma e quanto levar de troco.',
      },
      {
        tag: 'correção',
        text: 'Observações do item ("sem picles") e do pedido saem na conferência, e o pedido de mesa mostra a mesa ou comanda.',
      },
      {
        tag: 'correção',
        text: 'Restaurante cheio não trava mais as telas: o limite de acessos por minuto passou a valer para cada pessoa, e não para todos os aparelhos que saem pelo mesmo Wi-Fi.',
      },
      {
        tag: 'segurança',
        text: 'As chaves guardadas cifradas (integrações, WhatsApp e backups) só abrem com o selo de autenticidade completo.',
      },
    ],
  },
  {
    version: '0.52.0',
    date: '2026-10-29',
    title: 'Sons de aviso novos, que ficam tocando até alguém atender',
    summary:
      'Os avisos ganharam timbres de sino, marimba e kalimba. O pedido novo fica apitando até ser aceito, e dá para gravar o próprio som.',
    notes: [
      {
        tag: 'novo',
        text: 'Pedido do cardápio online esperando aceite e pedido de cancelamento ficam tocando de novo (a cada 10 s, ou o intervalo que você escolher) até alguém resolver. O botão de som balança enquanto isso e tem "Silenciar 2 min".',
      },
      {
        tag: 'novo',
        text: 'Grave seu próprio som pelo microfone (até 15 s) ou escolha um arquivo, e use em qualquer aviso. Fica guardado só no aparelho em que foi gravado.',
      },
      {
        tag: 'melhoria',
        text: 'Sons refeitos com timbre de instrumento (campainha, marimba, sinos de vento, kalimba), mais agradáveis e sem chiado. Cada aviso pode trocar de timbre em Sons de aviso.',
      },
      {
        tag: 'correção',
        text: 'Os sons agora tocam pelo modo de mídia também em produção (antes a política de segurança do site barrava e o iPhone podia ficar mudo com a chave de silencioso).',
      },
    ],
  },
  {
    version: '0.51.0',
    date: '2026-10-29',
    title: 'Janelas que nascem do botão, no jeito do iPhone',
    summary:
      'Toda janela agora sai do botão que você tocou e volta para ele ao fechar. A troca de tela ficou mais fluida e os textos mais fáceis de ler.',
    notes: [
      {
        tag: 'novo',
        text: 'No computador, as janelas crescem a partir do botão, linha ou cartão clicado e encolhem de volta para ele ao fechar (pelo X, pelo Esc ou clicando fora).',
      },
      {
        tag: 'novo',
        text: 'No celular, as folhas sobem de baixo e descem ao fechar, inclusive quando você arrasta a alça para baixo. O painel lateral do pedido sai pela direita.',
      },
      {
        tag: 'melhoria',
        text: 'Janelas com acabamento de vidro (desfocam levemente o que está atrás), que fica sólido para quem pediu menos transparência no sistema.',
      },
      {
        tag: 'melhoria',
        text: 'Troca de tela sem piscar: a tela antiga sai enquanto a nova entra. Botões afundam ao toque e voltam com mola; indicadores dos painéis entram em sequência.',
      },
      {
        tag: 'melhoria',
        text: 'Textos de apoio, selos de "Pago"/"Pendente" e avisos ficaram um tom mais escuros para ler bem em qualquer tela, no claro e no escuro.',
      },
      {
        tag: 'melhoria',
        text: 'Categorias da Nova venda, do garçom e do calendário marcam a escolha com tom suave e contorno, no mesmo padrão do resto do sistema.',
      },
      {
        tag: 'novo',
        text: 'No celular, telas abertas pelo "Mais" (como o Cardápio) têm a seta de voltar no topo.',
      },
      {
        tag: 'melhoria',
        text: 'Celular e app instalado: a tela não "estica" mais ao puxar além do começo ou do fim, o cabeçalho das telas ficou mais enxuto e as abas e filtros das listas quebram linha em vez de rolar para o lado.',
      },
    ],
  },
  {
    version: '0.50.4',
    date: '2026-10-29',
    title: 'Volta o panda antigo em todas as telas',
    summary: 'O panda de corpo inteiro foi retirado de tudo. Ficou só o panda de sempre.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Removido o panda novo das telas vazias, do chat e da IA; todas voltam a usar o panda de antes.',
      },
    ],
  },
  {
    version: '0.50.3',
    date: '2026-10-29',
    title: 'Caixas de busca com um só contorno',
    summary: 'Em todas as caixas de busca do sistema, o contorno de foco aparece só uma vez.',
    notes: [
      {
        tag: 'correção',
        text: 'Busca de pedidos, mesas, comandas, garçom, chat, nova venda e loja: sem contorno duplo ao clicar.',
      },
    ],
  },
  {
    version: '0.50.2',
    date: '2026-10-29',
    title: 'Panda sem roupinhas e sem o canto da tela',
    summary:
      'Saíram o panda grande que ficava no canto da tela e as roupinhas. O panda do topo e o das telas vazias e do chat continuam com o desenho novo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Removidos o panda flutuante do canto e o guarda-roupa com as roupinhas.',
      },
    ],
  },
  {
    version: '0.50.1',
    date: '2026-10-29',
    title: 'Ajustes visuais: botões do pedido, busca e troca de tema',
    summary:
      'Os botões da gaveta do pedido não cortam mais o texto, a caixa de busca ficou com um só contorno no foco e a troca de tema pinta a tela de uma ponta à outra.',
    notes: [
      {
        tag: 'correção',
        text: 'Botões da gaveta do pedido quebram de linha em vez de cortar o texto.',
      },
      { tag: 'correção', text: 'Caixa de busca: contorno único ao clicar.' },
      {
        tag: 'melhoria',
        text: 'Trocar entre claro e escuro pinta a tela da esquerda para a direita.',
      },
    ],
  },
  {
    version: '0.50.0',
    date: '2026-10-29',
    title: 'Panda novo, maior no canto e com roupinhas',
    summary:
      'O panda foi redesenhado com corpo inteiro, volume e detalhes, e agora fica grande no canto da tela. Toque nele para dar um oi ou abra o guarda-roupa para vesti-lo.',
    notes: [
      {
        tag: 'novo',
        text: 'Panda de corpo inteiro: olhos de vidro, nariz brilhante, patas e barriga. Ele segue o mouse com o olhar, pisca, respira, pula, acena e amassa quando você toca.',
      },
      {
        tag: 'novo',
        text: 'Roupinhas: 12 itens de cabeça (chef, festa, coroa, gorro, boné, Papai Noel, caubói, bruxa, fone, laço, flor, auréola), 3 de olhos (óculos, óculos escuros, coração) e 7 de pescoço (cachecol, gravatinha, gravata, bandana, colar, medalha, avental).',
      },
      {
        tag: 'melhoria',
        text: 'O panda fica no canto inferior da tela, com botões para trocar de roupinha e para esconder. A roupinha escolhida fica salva neste aparelho e aparece também nas telas vazias e no chat.',
      },
    ],
  },
  {
    version: '0.49.0',
    date: '2026-10-29',
    title: 'Fiscal completo: NFC-e, NF-e e notas recebidas',
    summary:
      'A nota fiscal virou um menu Fiscal com NFC-e, NF-e, notas recebidas, inutilização, padrões fiscais e configuração. Nota recusada mostra o motivo em palavras simples e onde corrigir, e é reemitida com o mesmo número.',
    notes: [
      {
        tag: 'novo',
        text: 'NF-e (modelo 55) para empresas: abra pelo pedido pago, confira o rascunho (cliente com CNPJ, endereço e inscrição estadual, natureza da operação, frete) e emita.',
      },
      {
        tag: 'novo',
        text: 'Detalhe de cada nota: venda, itens com a tributação de cada um, pagamentos, eventos, DANFE e XML. Dá para cancelar, mandar por e-mail e fazer carta de correção.',
      },
      {
        tag: 'novo',
        text: 'Padrões fiscais: CFOP, CSOSN ou CST, PIS/COFINS, IPI e IBS/CBS em regras reutilizáveis. Escolha o padrão no item do cardápio, ligue por NCM ou deixe o padrão da empresa.',
      },
      {
        tag: 'novo',
        text: 'CPF/CNPJ na nota: informe no pagamento ou no detalhe do pedido.',
      },
      {
        tag: 'novo',
        text: 'Emissão automática da NFC-e quando o pedido é quitado (ligue em Fiscal → Configuração).',
      },
      {
        tag: 'novo',
        text: 'Inutilização de números pulados, com a lista dos números que faltam.',
      },
      {
        tag: 'novo',
        text: 'Notas recebidas: as NF-e dos fornecedores para o seu CNPJ, com ciência, confirmação da compra, PDF e XML.',
      },
      {
        tag: 'correção',
        text: 'NFC-e paga com cartão ou Pix agora leva os dados do cartão que a SEFAZ exige, e a forma "Outros" leva a descrição. Antes, essas notas podiam ser recusadas.',
      },
      {
        tag: 'melhoria',
        text: 'Cliente com CPF/CNPJ e inscrição estadual no cadastro, usados direto na nota.',
      },
    ],
  },
  {
    version: '0.48.0',
    date: '2026-10-29',
    title: 'Chat da equipe e o Comandinho, seu guia',
    summary:
      'Todas as telas ganharam um botãozinho redondo no canto que abre o chat da equipe: conversas, grupos, canais, mural e avisos. Na aba IA, o panda Comandinho tira dúvidas sobre o sistema e guia a equipe passo a passo.',
    notes: [
      {
        tag: 'novo',
        text: 'Chat da equipe em todas as telas (painel, garçom, cozinha e entregador): conversa direta, grupos, canais abertos, fotos, emojis, reações, respostas, @menções, “digitando…” e confirmação de leitura.',
      },
      {
        tag: 'novo',
        text: 'Abas Conversas, Pessoas, Mural, IA e Avisos. No celular o chat ocupa a tela inteira, com as abas embaixo.',
      },
      {
        tag: 'novo',
        text: 'Comandinho, o assistente de IA: sabe em que tela você está e explica como fazer cada coisa. Mostra a barra de uso do mês e avisa o gestor em 80% e 100% do limite.',
      },
      {
        tag: 'melhoria',
        text: 'O panda do topo ficou vivo: acompanha o mouse com os olhos, pisca, acena e reage ao toque.',
      },
      {
        tag: 'novo',
        text: 'Super Admin › IA: chave do OpenRouter (guardada cifrada), modelo, saldo da conta, gasto e tokens do mês, gráfico de 30 dias e o consumo de cada restaurante com barra e limite próprio.',
      },
    ],
  },
  {
    version: '0.47.0',
    date: '2026-10-29',
    title: 'Relatórios com painel e Excel',
    summary:
      'A aba Relatórios virou uma lista de relatórios por assunto, cada um com o seu painel (indicadores, gráficos e tabelas) e o botão Baixar Excel, que gera uma planilha caprichada com gráficos e uma aba por tabela.',
    notes: [
      {
        tag: 'novo',
        text: 'Quanto vendi e quanto sobrou: Resultado (com comparação com a semana e o mês anteriores), Vendas (extrato) com as formas de pagamento, Vendas ao longo do tempo e Ticket médio e formas de pagamento.',
      },
      {
        tag: 'novo',
        text: 'Onde estou perdendo dinheiro: Perdas e controle por operador, Cancelamentos (motivo, itens, quem pediu e quem autorizou) e Fechamentos de caixa (esperado × contado e como o dinheiro esperado se forma).',
      },
      {
        tag: 'novo',
        text: 'Cardápio: Produtos por família e categoria, e Engenharia de cardápio com carro-chefe, popular de margem baixa, rentável que vende pouco, candidato a sair e curva ABC.',
      },
      {
        tag: 'novo',
        text: 'Operação e equipe: Pedidos por hora com o mapa da semana e Vendas por funcionário. Delivery: por bairro, por motoboy e frete arrecadado. Clientes: novos, que voltaram, quem mais compra e quem parou de comprar.',
      },
      {
        tag: 'novo',
        text: 'Baixar Excel: planilha com cabeçalho do restaurante, indicadores com o período anterior, gráficos do próprio Excel, filtros, totais e barras de dados.',
      },
    ],
  },
  {
    version: '0.44.0',
    date: '2026-10-29',
    title: 'Telas mais limpas e alinhadas',
    summary:
      'Pedidos com tabela compacta e o detalhe numa gaveta à direita, botões alinhados numa linha em todas as telas, nada saindo das colunas com zoom e um só carregamento: o ícone da loja.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Detalhe do pedido em gaveta lateral: cliente, telefone, horário, status e pagamento num bloco só, itens em cartões com quantidade × preço, resumo de valores e todos os botões numa linha no rodapé (ajuste e impressão ficam no botão "…").',
      },
      {
        tag: 'melhoria',
        text: 'Tabela de Pedidos menor e sem quebra de linha: com zoom alto ou notebook estreito, os itens e o tipo vão para baixo do cliente e a tabela sempre cabe no cartão.',
      },
      {
        tag: 'melhoria',
        text: 'Botões das linhas das tabelas (Editar, Esgotar, Pagar, Cancelar, Desativar…) com o mesmo tamanho e contorno, sempre numa linha só. Escolhas marcadas usam um tom suave, sem blocos fortes de cor.',
      },
      {
        tag: 'melhoria',
        text: 'Um só carregamento em todo o sistema: o ícone da loja girando, e só quando a carga demora. Trocar de tela não pisca nada.',
      },
      {
        tag: 'correção',
        text: 'Todo modal fecha ao clicar fora no computador, inclusive a Nova venda e a escolha de opções do produto.',
      },
      {
        tag: 'correção',
        text: 'Cabeçalho das listas não fica mais por cima das linhas quando a tabela precisa rolar para o lado.',
      },
    ],
  },
  {
    version: '0.43.0',
    date: '2026-10-28',
    title: 'Contrato com as duas assinaturas',
    summary:
      'O contrato do cliente agora é assinado pelos dois lados: o cliente assina primeiro (desenhando a rubrica ou digitando o nome) e o contrato volta para o painel para a plataforma assinar por último. Só então a via final vai por e-mail para os dois.',
    notes: [
      {
        tag: 'novo',
        text: 'Depois que o cliente assina, o contrato fica como "falta a sua assinatura": chega um e-mail com o botão Conferir e assinar, e a tela Status avisa até o prazo de 10 dias.',
      },
      {
        tag: 'novo',
        text: 'No painel você vê a assinatura do cliente (imagem, IP, navegador e localização, se ele permitiu), assina desenhando ou digitando e confirma com o código do autenticador.',
      },
      {
        tag: 'novo',
        text: 'PDF final com as rubricas das duas partes no pé de cada página e um manifesto com as duas assinaturas, os códigos de integridade e a trilha do documento.',
      },
      {
        tag: 'segurança',
        text: 'Trilha encadeada: cada evento do contrato guarda o código do anterior, o painel confere a cadeia ao abrir o contrato e avisa se algum registro foi alterado. A assinatura do cliente não muda mais depois de feita, nem direto no banco.',
      },
      {
        tag: 'melhoria',
        text: 'Cancelar um contrato que o cliente já assinou avisa o cliente por e-mail. As regras estão no próprio contrato, na cláusula Assinatura eletrônica.',
      },
    ],
  },
  {
    version: '0.42.2',
    date: '2026-10-28',
    title: 'Pedidos na coluna certa',
    summary:
      'O quadro de pedidos do PDV ficou mais claro e o aceite automático passou a funcionar de ponta a ponta.',
    notes: [
      {
        tag: 'correção',
        text: 'A primeira coluna do quadro agora se chama "Em análise": é onde ficam os pedidos online esperando você aceitar ou recusar. Aceitos vão para "Em produção", prontos para "Prontos".',
      },
      {
        tag: 'correção',
        text: 'Ligar o aceite automático agora aceita também os pedidos que já estavam em análise: eles vão para a produção, baixam o estoque e imprimem na cozinha.',
      },
      {
        tag: 'correção',
        text: 'Pedido online aceito automaticamente toca o som e mostra o aviso no PDV, como o pedido que espera aceite. Antes ele entrava em silêncio.',
      },
      {
        tag: 'correção',
        text: 'Os botões "Loja aberta" e "Aceite automático" ficam bloqueados para quem não pode mudá-los (garçom), em vez de dar erro ao clicar.',
      },
    ],
  },
  {
    version: '0.42.1',
    date: '2026-10-28',
    title: 'Cardápio rola de lado sem fim',
    summary:
      'No celular, as categorias e os banners do cardápio online dão a volta: depois da última categoria vem a primeira de novo, para os dois lados.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Categorias do cardápio no celular: role para o lado à vontade, a faixa não acaba. As setas também dão a volta.',
      },
      {
        tag: 'melhoria',
        text: 'Banners das promoções dão a volta sem fim e continuam trocando sozinhos; no computador ganham setas ao passar o mouse.',
      },
    ],
  },
  {
    version: '0.42.0',
    date: '2026-10-27',
    title: 'Estoque com seções próprias',
    summary:
      'O Estoque virou um menu com subabas, como o Cardápio: Visão geral, Lotes, Produção, Recebimento, Saída de estoque, Inventário, Fichas técnicas, Fatores de conversão e Precificação. Cada uma explica no topo para que serve.',
    notes: [
      {
        tag: 'novo',
        text: 'Visão geral com código de cada insumo (IN-000001) e um detalhe por insumo: saldo, custo, a movimentação completa e os lotes.',
      },
      {
        tag: 'novo',
        text: 'Recebimento: lance a nota do fornecedor com vários itens de uma vez. Comprou em caixa ou fardo? Escolha a embalagem e o sistema converte quantidade e custo.',
      },
      {
        tag: 'novo',
        text: 'Produção: molho, massa e recheio feitos na casa. Monte a ficha de preparo (o que leva e quanto rende), bipe a etiqueta ou adicione a linha, e a produção baixa os insumos, calcula o custo e cria o lote com validade.',
      },
      {
        tag: 'novo',
        text: 'Lotes com fabricação e validade: abas Vencendo e Vencidos, e o descarte de um lote registra a perda no estoque.',
      },
      {
        tag: 'novo',
        text: 'Saída de estoque: tudo o que saiu e por quê (venda, perda, produção) e a saída avulsa para consumo da equipe, doação ou cortesia.',
      },
      {
        tag: 'novo',
        text: 'Fatores de conversão: cadastre as embalagens de compra (1 CX12 = 12 un, saco de 25 kg). Quilo/grama e litro/mililitro já convertem sozinhos.',
      },
      {
        tag: 'melhoria',
        text: 'Fichas técnicas numa lista só (itens do cardápio, complementos e preparos), com custo, CMV e o aviso dos itens que ainda estão sem ficha.',
      },
    ],
  },
  {
    version: '0.41.0',
    date: '2026-10-27',
    title: 'Painel mais confortável no celular',
    summary:
      'No celular, o topo mostra o nome inteiro da tela, as janelas têm Salvar e Cancelar sempre à vista no rodapé e as listas viraram cartões sem texto espremido. Trocar de tela ou de aba agora desliza do lado tocado.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Topo do celular com o nome da tela inteiro (antes saía cortado, ex.: "Pe..."). O aviso "Tempo real" virou só a bolinha verde.',
      },
      {
        tag: 'melhoria',
        text: 'Trocar de tela pela barra de baixo ou de aba (ex.: Insumos, Inventário) desliza o conteúdo do lado tocado. Quem pediu ao aparelho para reduzir movimento não vê a animação.',
      },
      {
        tag: 'melhoria',
        text: 'Janelas que sobem de baixo seguem um padrão só: alça em cima, título fixo e Salvar/Cancelar presos no rodapé enquanto rola. Valeu para comanda avulsa, abrir caixa, sangria, suprimento, fechamento, receber pagamento e nova categoria. No pedido, o próximo passo (iniciar preparo, marcar pronto, receber) fica no rodapé.',
      },
      {
        tag: 'correção',
        text: 'Listas no celular (Equipe, Complementos, Financeiro, Caixa, Estoque): nome e detalhes em linhas próprias e textos longos quebram linha em vez de sair do quadro.',
      },
      {
        tag: 'melhoria',
        text: 'Números do topo (Clientes, Caixa, Financeiro, Entregas, Reservas) em dois por linha, compactos e com o rótulo inteiro.',
      },
      {
        tag: 'correção',
        text: 'Salão: busca de mesa voltou a ter o visual do campo e os botões do topo ficaram em grade, com "Escanear mesa" em destaque. Reservas, WhatsApp e Nota fiscal sem texto espremido.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio no celular: lista de itens compacta (foto, nome, opções e preço numa linha), abas Itens/Famílias/Complementos/Cardápios numa linha só e o Salvar do cadastro do item fica preso no topo ao rolar.',
      },
    ],
  },
  {
    version: '0.40.1',
    date: '2026-10-27',
    title: 'Cardápio online mais leve e com transições',
    summary:
      'Ajuste fino no cardápio do cliente: botões e cartões em tamanhos mais equilibrados, nome de cada categoria embaixo da bolinha e transições suaves ao trocar de aba e de categoria.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Carrossel de categorias com o nome embaixo de cada bolinha; acima da grade aparece a categoria aberta e quantos itens ela tem. No computador as categorias ficam lado a lado.',
      },
      {
        tag: 'melhoria',
        text: 'Trocar de aba desliza para o lado da aba escolhida, e trocar de categoria faz os cartões entrarem pelo lado para onde o carrossel andou.',
      },
      {
        tag: 'melhoria',
        text: 'A pílula "Ver sacola" ficou clara e mais fina, sem competir com a barra de abas; barra, busca, filtro e cartões ficaram mais compactos.',
      },
      {
        tag: 'melhoria',
        text: '"Mais informações" virou um botão discreto com ícone, e os cartões ganharam um leve destaque ao passar o mouse.',
      },
    ],
  },
  {
    version: '0.40.0',
    date: '2026-10-27',
    title: 'Filtros dinâmicos nas listas e formulários compactos',
    summary:
      'Pedidos, Clientes, Itens do cardápio, Estoque e Financeiro ganharam a mesma barra de lista: abas com contagem, busca, filtros por qualquer campo e a opção de salvar o filtro atual como uma aba sua. Os formulários no computador ficaram mais compactos, com até três campos por linha.',
    notes: [
      {
        tag: 'novo',
        text: 'Abas prontas em cada lista (ex.: Hoje, Em andamento, A receber nos Pedidos; Em aberto, Vencidos, Pagos no Financeiro), cada uma com quantos registros tem.',
      },
      {
        tag: 'novo',
        text: '"+ Filtro" escolhe qualquer campo; cada filtro abre uma lista com busca, caixas de seleção e a quantidade de cada opção. Datas têm atalhos (hoje, 7 dias, este mês) ou período livre.',
      },
      {
        tag: 'novo',
        text: '"Salvar como aba" guarda os filtros atuais com um nome, neste navegador. A aba criada pode ser apagada no X ao lado dela.',
      },
      {
        tag: 'melhoria',
        text: 'Ao rolar a lista, a barra de filtros e os títulos das colunas ficam fixos no topo.',
      },
      {
        tag: 'melhoria',
        text: 'Formulários e janelas no computador: rótulos menores, campos mais baixos com fundo cinza claro e até três campos por linha. No celular continua um campo por linha.',
      },
    ],
  },
  {
    version: '0.39.0',
    date: '2026-10-27',
    title: 'PDV e nova venda no estilo PedidoJá',
    summary:
      'A tela inicial do PDV mostra o salão em cima e os pedidos embaixo, em colunas que seguem o andamento. A nova venda abre em tela cheia, com a grade de produtos com foto, a tabela dos itens e o painel do pedido ao lado.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Salão no topo do PDV: mesas livres, ocupadas e em pagamento (ou as comandas abertas). Mesa livre já abre a venda; ocupada abre a comanda.',
      },
      {
        tag: 'melhoria',
        text: 'Pedidos em quatro colunas (Novo, Em produção, Prontos, Saiu para entrega) com cartões compactos ou completos, filtro por tipo e aceite automático no cabeçalho.',
      },
      {
        tag: 'melhoria',
        text: 'Rodapé do quadro com os pedidos concluídos e cancelados no dia e os cancelamentos que o cliente pediu.',
      },
      {
        tag: 'melhoria',
        text: 'Nova venda (F2) em tela cheia: busca, categorias, produtos com foto, itens em tabela com complementos e, ao lado, cliente, tipo de atendimento e total. Ctrl+Enter envia.',
      },
      {
        tag: 'novo',
        text: 'Ao digitar o nome do cliente na venda, o sistema sugere os clientes já cadastrados e preenche o telefone.',
      },
    ],
  },
  {
    version: '0.38.1',
    date: '2026-10-27',
    title: 'Filtros de Pedidos mais simples',
    summary:
      'A aba Pedidos ficou num cartão só, com os filtros compactos numa linha: período, status operacional, status financeiro, tipo e busca. A tabela pode ser ordenada por qualquer coluna e mostra os itens de cada pedido.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Filtre por período (de/até), Status op., Status fin. e Tipo, e busque pelo número, nome do cliente, mesa ou telefone.',
      },
      {
        tag: 'melhoria',
        text: 'Atalhos para ver só os pedidos em andamento, só os do cardápio online ou só os com cancelamento solicitado. "Limpar filtros" volta para o dia de hoje.',
      },
      {
        tag: 'melhoria',
        text: 'Clique no título da coluna para ordenar por número, data, cliente, status ou valor. O topo mostra quantos pedidos e o total do filtro.',
      },
      {
        tag: 'melhoria',
        text: 'No celular, a busca fica sempre à vista e os demais filtros abrem no botão Filtros, que mostra quantos estão ativos.',
      },
    ],
  },
  {
    version: '0.38.0',
    date: '2026-10-27',
    title: 'Cardápio online com cara nova',
    summary:
      'O cardápio que o cliente abre no celular ficou mais simples e bonito: logo redonda sobre a capa, busca com filtro, carrossel de categorias e os produtos em cartões de duas colunas.',
    notes: [
      {
        tag: 'novo',
        text: 'Carrossel de categorias: o cliente arrasta para o lado e a categoria do meio aparece logo abaixo. Destaques e Mais pedidos entram como as primeiras do carrossel.',
      },
      {
        tag: 'novo',
        text: 'Botão de filtro ao lado da busca: ordenar por preço ou nome e esconder os produtos esgotados.',
      },
      {
        tag: 'melhoria',
        text: '"Mais informações" abre o horário, a entrega, a retirada, o pedido mínimo e o endereço da loja numa janela só.',
      },
      {
        tag: 'melhoria',
        text: 'Barra de baixo flutuante na cor da loja, com o nome da aba aberta.',
      },
    ],
  },
  {
    version: '0.37.2',
    date: '2026-10-27',
    title: 'Cardápio com submenu na barra lateral',
    summary:
      'O ícone do Cardápio na barra lateral agora abre um submenu com Itens, Famílias de item, Grupos de complementos e Cardápios, como nos outros grupos do sistema. No celular, a aba Cardápio abre as mesmas quatro opções numa folha.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cardápio virou um grupo na barra lateral: Itens, Famílias de item, Grupos de complementos e Cardápios ficam a um clique. O cadastro de um item mantém "Itens" aceso no menu.',
      },
      {
        tag: 'correção',
        text: 'O destaque do item atual nos submenus da barra lateral (Gestão, Sistema, Cardápio) às vezes aparecia deslocado ao abrir o menu.',
      },
    ],
  },
  {
    version: '0.37.1',
    date: '2026-10-27',
    title: 'Restaurante de demonstração com estoque estável',
    summary:
      'O restaurante de demonstração passa a mostrar sempre os mesmos três insumos abaixo do mínimo, em qualquer dia e horário em que for criado.',
    notes: [
      {
        tag: 'correção',
        text: 'Na demonstração, a massa de pizza às vezes aparecia abaixo do mínimo depois de um fim de semana movimentado. Agora só o bacon, o morango e o catupiry ficam no alerta de estoque baixo.',
      },
    ],
  },
  {
    version: '0.37.0',
    date: '2026-10-27',
    title: 'Cardápios, cadastro de itens, famílias e complementos',
    summary:
      'O Cardápio ganhou quatro partes: Itens, Famílias, Complementos e Cardápios. Cada item tem um cadastro completo em abas (Principal, Complementos e Ficha técnica), e o restaurante passa a ter o cardápio Principal (salão e balcão) e o Delivery (entrega, retirada e cardápio online), cada um com os seus itens e preços.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápios Principal e Delivery: escolha quais itens aparecem em cada um e dê preço próprio quando quiser (ex.: delivery 10% mais caro). Dá para reajustar todos de uma vez por porcentagem, criar um cardápio novo copiando outro e trocar o ativo com um toque. O PDV, o garçom e o cardápio online já usam o cardápio do canal, e o pedido é cobrado pelo preço dele.',
      },
      {
        tag: 'novo',
        text: 'Cadastro do item em tela cheia: código (IT-000001 automático), nome, descrição, foto, categoria, família, unidade de medida, cozinha (KDS), vendido por peso, destaque e selo, preço em cada cardápio, custo e margem, NCM, CFOP, CSOSN, origem e código de barras (fixo, peso variável ou valor variável).',
      },
      {
        tag: 'novo',
        text: 'Famílias de itens (Bebidas, Lanches, Sabores de pizza…) para agrupar as vendas nos relatórios, com a opção "vendido como complemento, conta como produto" para a pizza meio a meio. Dá para marcar vários itens de uma vez.',
      },
      {
        tag: 'novo',
        text: 'Grupos de complementos com tipo (adicional, tamanho, sabores de pizza, retirar ingrediente), regra de cobrança (somar, cobrar a mais cara ou a média), mínimo e máximo, opção padrão já marcada, ordem das opções e os itens que usam o grupo, tudo na mesma tela.',
      },
      {
        tag: 'melhoria',
        text: 'Ficha técnica e custo dentro do cadastro do item, com CMV, margem e markup na hora. Sem ficha, dá para informar o custo à mão.',
      },
      {
        tag: 'melhoria',
        text: 'No PDV, item vendido por peso pede o peso em kg no carrinho, e a busca de itens acha por nome, código ou código de barras.',
      },
    ],
  },
  {
    version: '0.36.0',
    date: '2026-10-27',
    title: 'Relatórios inteligentes',
    summary:
      'Relatórios ganharam a aba Análise: o sistema compara o período com o anterior e aponta o que merece atenção, o que vende, o que dá lucro e onde agir.',
    notes: [
      {
        tag: 'novo',
        text: 'Análise do período (hoje, 7 ou 30 dias, este mês, mês passado ou datas livres), com filtro por canal e comparação automática com o período anterior.',
      },
      {
        tag: 'novo',
        text: '"O que merece atenção": alertas e dicas como queda de faturamento, projeção do fechamento, custo dos insumos alto, despesas maiores que o lucro, pico e dia mais fraco, produtos em alta ou em queda, cancelamentos e cozinha demorada.',
      },
      {
        tag: 'novo',
        text: 'Engenharia de cardápio (estrelas, burros de carga, quebra-cabeças e abacaxis), curva ABC, mapa de movimento por dia e hora, clientes novos e recorrentes, vendas por pessoa da equipe e produtos parados.',
      },
      {
        tag: 'novo',
        text: 'Personalizar: escolha e ordene os blocos do relatório. Exporte os produtos para planilha ou imprima.',
      },
      {
        tag: 'correção',
        text: 'Os cartões de resumo não cortam mais valores grandes ou negativos, no notebook e no celular.',
      },
    ],
  },
  {
    version: '0.35.2',
    date: '2026-10-27',
    title: 'Detalhe do pedido mais organizado',
    summary:
      'O painel do pedido que abre de lado ficou mais limpo: informações em blocos com rótulo pequeno em cima, endereço e contato em texto menor, sem etiquetas coloridas e com negrito só no que importa.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Status, pagamento, tipo e horário do pedido no topo, e um bloco do cliente com nome, telefone, endereço, forma de pagamento e observação.',
      },
      {
        tag: 'melhoria',
        text: 'Itens alinhados com quantidade, adicionais e observação logo abaixo do nome; totais, pagamentos, nota fiscal e ações separados por linhas finas.',
      },
      {
        tag: 'melhoria',
        text: 'Histórico em linha do tempo, com quem mudou e quando. Funciona igual no notebook e no celular.',
      },
    ],
  },
  {
    version: '0.35.1',
    date: '2026-10-26',
    title: 'Atualizar limpa o cache',
    summary:
      'Atualizar o sistema agora limpa o cache de todos os navegadores: painel, garçom, cozinha, entregador e cardápio do cliente abrem a versão nova direto do servidor, sem ficar presos numa cópia antiga.',
    notes: [
      {
        tag: 'melhoria',
        text: 'O botão "Atualizar" do aviso de nova versão apaga os arquivos guardados pelo app e o service worker antes de recarregar.',
      },
      {
        tag: 'melhoria',
        text: 'Quem abre o app com uma cópia velha guardada no celular ou no computador recebe a versão nova na hora, com o cache limpo.',
      },
      {
        tag: 'melhoria',
        text: 'No Super Admin, ao terminar "Atualizar sistema" o painel limpa o próprio cache e já abre na versão nova. A API reinicia sem nada guardado em memória.',
      },
    ],
  },
  {
    version: '0.35.0',
    date: '2026-10-26',
    title: 'Contrato digital de cada cliente',
    summary:
      'No painel da plataforma, cada restaurante ganhou a aba Contrato: o contrato de licença do Comandou sai pronto em PDF com os dados do cliente, vai por e-mail pelo n8n e o cliente assina pelo celular depois de ler até o fim. O PDF assinado fica guardado e o aviso chega por e-mail.',
    notes: [
      {
        tag: 'novo',
        text: 'Contrato completo (plano e preço, pagamento e reajuste, vigência e rescisão, disponibilidade, suporte, NFC-e, LGPD, propriedade intelectual, limitação de responsabilidade, foro e mais), preenchido com o cadastro e o plano do cliente, com número e código de integridade (SHA-256).',
      },
      {
        tag: 'novo',
        text: 'Assinatura pelo link pessoal: o cliente só assina depois de rolar até o fim, desenhando ou digitando o nome, com CPF. Ficam registrados IP, data e hora, navegador e o hash do documento num manifesto anexado ao PDF.',
      },
      {
        tag: 'novo',
        text: 'Envio e aviso pelo n8n: e-mail com o botão de assinatura e o PDF, e, depois de assinado, o PDF final para o dono da plataforma e uma via para o cliente.',
      },
    ],
  },
  {
    version: '0.34.0',
    date: '2026-10-26',
    title: 'Perfis da equipe mais simples e código de entrega',
    summary:
      'A equipe agora tem 7 perfis: Administrador, Gerente, Caixa, PDV (balcão), Garçom, Cozinha e Entregador. O entregador tem um app só dele e conclui a entrega com o código de 4 dígitos que o cliente recebe, como no iFood. A cozinha abre direto na fila, com tela cheia.',
    notes: [
      {
        tag: 'novo',
        text: 'Código de entrega: o cliente vê os 4 números no acompanhamento do pedido, no link de rastreio e no aviso de "saiu para entrega" do WhatsApp. O entregador digita para concluir; depois de 5 erros, só o restaurante conclui (pelo painel, sem código).',
      },
      {
        tag: 'melhoria',
        text: 'App do entregador (/entregas): só as corridas dele e "Meus ganhos", sem menu da loja. Para usar, precisa colocar o atalho na tela inicial e permitir a localização, que fica sempre ligada. O link do entregador (sem login) segue as mesmas regras.',
      },
      {
        tag: 'melhoria',
        text: 'App da cozinha (/cozinha): o login da cozinha abre só a fila de preparo, com botão de tela cheia para TV ou tablet.',
      },
      {
        tag: 'melhoria',
        text: 'Equipe: ao adicionar alguém, só os 7 perfis, cada um com uma linha explicando o que acessa. Quem era Estoquista, Financeiro ou Fiscal passou a Gerente.',
      },
      {
        tag: 'segurança',
        text: 'Entregador e cozinha não acessam mais a lista de pedidos da loja; o entregador também não vê cardápio, clientes nem a posição dos outros motoboys.',
      },
    ],
  },
  {
    version: '0.33.0',
    date: '2026-10-26',
    title: 'Programa de fidelidade e cardápio mais leve',
    summary:
      'O cliente com conta junta pontos (ou carimbos) a cada pedido concluído e troca por desconto ou produto grátis ao finalizar. O dono configura tudo em Loja online › Fidelidade e acompanha o resultado. O cardápio ficou mais minimalista: cartões menores, cantos discretos e sem gradientes.',
    notes: [
      {
        tag: 'novo',
        text: 'Fidelidade: pontos por real gasto ou carimbo por pedido, validade opcional, recompensas de desconto em R$ ou produto grátis, e pedidos do balcão com o celular do cliente também contam.',
      },
      {
        tag: 'novo',
        text: 'O cliente vê o saldo no início do cardápio e na conta, acompanha o extrato e escolhe a recompensa na finalização; pedido cancelado devolve os pontos.',
      },
      {
        tag: 'novo',
        text: 'Relatório da fidelidade: clientes com saldo, vendas de quem participa, pontos dados, trocas e descontos concedidos, com os clientes que mais juntaram.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio online mais minimalista: cartões e fotos menores, cantos menos arredondados, sem gradiente nem brilho, e a página Conta com cabeçalho sóbrio.',
      },
    ],
  },
  {
    version: '0.32.0',
    date: '2026-10-26',
    title: 'Central de ganhos do motoboy e repasses',
    summary:
      'O entregador vê quanto ganha em cada corrida, no dia, na semana e no mês, e quanto falta receber. O dono define a regra de pagamento (fixo, por km, parte da taxa, diária) e paga pela aba Repasses, com INSS, IRRF e ISS calculados conforme o regime do motoboy.',
    notes: [
      {
        tag: 'novo',
        text: 'Central do entregador ("Meus ganhos"): ganho de hoje, da semana e do mês, km rodados, valor a receber já com as retenções, últimas corridas e pagamentos recebidos.',
      },
      {
        tag: 'novo',
        text: 'Entregas › Repasses: ganhos, custo para a loja, taxas de entrega cobradas, pagos e a pagar por entregador, custo por dia e recibo para imprimir. O pagamento entra no Financeiro e as retenções viram conta a pagar no dia 20.',
      },
      {
        tag: 'novo',
        text: 'Regra de pagamento da loja ou de cada motoboy: valor fixo, por km, fixo + km adicional ou parte da taxa de entrega, com mínimo, diária e percentual quando não entrega. Regime MEI, autônomo (RPA) ou CLT.',
      },
      {
        tag: 'melhoria',
        text: 'Rota em um toque no Waze, Google Maps ou Apple Mapas; o app usado por último fica em destaque. Cada corrida mostra quanto o motoboy ganha nela.',
      },
      {
        tag: 'melhoria',
        text: 'Relatórios: novo indicador "Entregadores" com o custo do mês e o valor a pagar.',
      },
    ],
  },
  {
    version: '0.31.0',
    date: '2026-10-26',
    title: 'CEP, nova senha e avisos no WhatsApp',
    summary:
      'No cardápio online o cliente digita o CEP e o endereço se completa, ou digita a rua e escolhe o CEP. Quem esquece a senha recebe um código no WhatsApp da loja. O cliente é avisado no WhatsApp quando o pedido é aceito, fica pronto, sai, é entregue ou cancelado.',
    notes: [
      {
        tag: 'novo',
        text: 'Endereço de entrega por CEP (ViaCEP, com BrasilAPI de reserva) e sugestão de CEP pelo nome da rua, na sacola e em Endereços.',
      },
      {
        tag: 'novo',
        text: '"Esqueci minha senha" no cardápio: código de 6 dígitos pelo WhatsApp da loja, válido por 15 minutos. A equipe também pode gerar o código na ficha do cliente.',
      },
      {
        tag: 'novo',
        text: 'Avisos no WhatsApp do cliente: pedido aceito, entregue e cancelado (além de pronto e saiu para entrega), cada um com texto próprio e liga/desliga.',
      },
      {
        tag: 'melhoria',
        text: 'Configurações da loja online ganharam cidade e UF, usadas para achar o CEP pela rua.',
      },
    ],
  },
  {
    version: '0.30.2',
    date: '2026-10-26',
    title: 'Cor da loja em todas as telas',
    summary:
      'A cor salva na Loja online passa a valer na hora, sem cache, em todas as telas da loja (PDV, salão, cozinha, garçom, entregas, cardápio e login). O painel do administrador do Comandou segue com as cores do Comandou.',
    notes: [
      {
        tag: 'correção',
        text: 'As cores e o ícone da loja não ficam mais presos em cache do navegador ou do servidor depois de salvar.',
      },
      {
        tag: 'melhoria',
        text: 'Marcadores do mapa de áreas de entrega usam a cor da loja.',
      },
      {
        tag: 'correção',
        text: 'Escolher a cor (ou letra e cantos) na Loja online agora salva sozinho, sem precisar clicar em "Salvar identidade".',
      },
      {
        tag: 'novo',
        text: 'O app instalado no celular (PWA) usa o nome, a cor e o ícone da própria loja: cada restaurante tem o seu manifesto.',
      },
    ],
  },
  {
    version: '0.30.1',
    date: '2026-10-26',
    title: 'Painel admin com o layout da loja',
    summary:
      'O painel admin agora usa o mesmo layout, cores e componentes do app da loja, no computador e no celular, com tema claro e escuro. O ícone da aba e do app instalado é o padrão do Comandou.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Admin: menu lateral, topo, cartões, campos e janelas iguais aos do app da loja, sem o tema escuro próprio.',
      },
      {
        tag: 'melhoria',
        text: 'Admin: o ícone (favicon e app instalado) é o padrão do Comandou, sem seguir a cor de nenhuma loja.',
      },
    ],
  },
  {
    version: '0.30.0',
    date: '2026-10-26',
    title: 'Fotos dos itens em todo o pedido',
    summary:
      'A foto de cada produto aparece nos itens do pedido: acompanhamento do cliente, PDV, detalhe do pedido, cozinha, comanda e app do garçom. A sacola do cardápio online ficou mais segura contra preço desatualizado, item esgotado e toque duplo.',
    notes: [
      {
        tag: 'novo',
        text: 'Foto do produto nos itens do pedido (cliente, PDV, detalhe, cozinha, mesas e garçom); sem foto, aparece a inicial do nome na cor da loja.',
      },
      {
        tag: 'melhoria',
        text: 'A sacola do cardápio online confere o cardápio ao abrir: atualiza preços, tira o que saiu do cardápio e avisa quando um item esgotou antes de enviar.',
      },
      {
        tag: 'correção',
        text: 'Toque duplo em "Fazer pedido" ou "Enviar pedido" não dispara dois envios, e a observação do item no PDV e no garçom não perde o foco a cada letra.',
      },
      {
        tag: 'melhoria',
        text: 'Mensagens mais claras quando um produto saiu do cardápio ou quando um pedido já tinha sido registrado antes da conexão cair.',
      },
    ],
  },
  {
    version: '0.29.0',
    date: '2026-10-26',
    title: 'Laranja mais forte e janelas largas no notebook',
    summary:
      'O laranja padrão ficou mais forte (#E23A00) e, no notebook, as janelas de cadastro abrem mais largas com os campos lado a lado.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Laranja padrão mais forte e com melhor contraste do texto branco nos botões; quem escolheu a própria cor não muda.',
      },
      {
        tag: 'melhoria',
        text: 'No notebook, as janelas com formulário abrem mais largas e distribuem os campos em 2 colunas; no celular e no app instalado seguem em uma coluna.',
      },
    ],
  },
  {
    version: '0.28.1',
    date: '2026-10-26',
    title: 'Troca de claro e escuro sem piscar',
    summary: 'Ao alternar o tema, as cores mudam num fade suave em vez de piscar a tela.',
    notes: [
      {
        tag: 'correção',
        text: 'A troca de tema não usa mais a onda em tela cheia (que piscava): fundos, bordas, textos e ícones mudam juntos num fade curto.',
      },
    ],
  },
  {
    version: '0.28.0',
    date: '2026-10-26',
    title: 'Visual mais limpo e formulários em linhas',
    summary:
      'Laranja novo (#FC4B08), botões e cartões sem brilho nem sombra forte, modo escuro mais calmo e janelas com um campo por linha.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cores e botões padronizados: fundo liso, linha fina no lugar de sombra e laranja só no que importa (ação principal, item ativo e foco).',
      },
      {
        tag: 'melhoria',
        text: 'Janelas de cadastro (reservas, financeiro, equipe, estoque, mesas) mostram cada campo em uma linha, com rótulo à esquerda e seções.',
      },
      {
        tag: 'melhoria',
        text: 'Modo escuro com cinzas neutros e laranja mais suave, sem cartões coloridos gritando; o PDV usa cabeçalhos discretos.',
      },
    ],
  },
  {
    version: '0.27.1',
    date: '2026-10-26',
    title: 'Menu de baixo do admin no lugar certo no iPhone',
    summary:
      'No app do admin instalado no iPhone, o menu de baixo voltou a encostar no fim da tela, sem a faixa vazia embaixo.',
    notes: [
      {
        tag: 'correção',
        text: 'No iOS 26, a barra de status translúcida deixava a tela do app instalado mais curta e o menu de baixo subia. A página agora ocupa a tela toda, inclusive para quem já tinha instalado, sem precisar reinstalar.',
      },
    ],
  },
  {
    version: '0.27.0',
    date: '2026-10-26',
    title: 'Atualizar sistema também faz a limpeza',
    summary:
      'Ao terminar "Atualizar sistema" no painel, o servidor limpa sozinho o que ficou sem uso, sem precisar do Portainer.',
    notes: [
      {
        tag: 'novo',
        text: 'Depois que todos os serviços sobem na versão nova, o agente apaga contêineres parados, imagens antigas, cache de build e volumes anônimos sem uso.',
      },
      {
        tag: 'segurança',
        text: 'Volumes com nome (banco, uploads, backups) nunca são apagados, e nada é limpo se a atualização falhar.',
      },
    ],
  },
  {
    version: '0.26.1',
    date: '2026-10-26',
    title: 'Cozinha com rolagem por coluna',
    summary: 'Cada coluna da Cozinha rola sozinha, sem arrastar a tela inteira.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Na Cozinha, A fazer, Preparando e Pronto têm cada uma a sua rolagem, com o título colorido fixo no topo. Funciona no computador, no tablet e no celular.',
      },
    ],
  },
  {
    version: '0.26.0',
    date: '2026-10-26',
    title: 'Aviso de versão nova com botão Atualizar',
    summary:
      'Quando sai uma versão nova, quem está com o Comandou aberto (painel, PDV, garçom, cozinha e cardápio do cliente) vê na hora o aviso "Nova versão disponível" e escolhe quando atualizar, sem perder o que está fazendo.',
    notes: [
      {
        tag: 'novo',
        text: 'Aviso "Nova versão disponível" com botão Atualizar em todas as telas, nas cores da sua loja.',
      },
      {
        tag: 'melhoria',
        text: 'O app não se recarrega mais sozinho no meio de um pedido: a versão nova espera o clique em Atualizar.',
      },
    ],
  },
  {
    version: '0.25.1',
    date: '2026-10-26',
    title: 'Voltar no app do garçom',
    summary:
      'Todas as telas do app do garçom têm seta de voltar, para quem usa o app instalado no celular (PWA), sem botão do navegador.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Meus pedidos e Desafios ganharam a seta de voltar para o mapa de mesas; dono e gerente voltam ao Salão do painel.',
      },
    ],
  },
  {
    version: '0.25.0',
    date: '2026-10-26',
    title: 'App do garçom novo, com desafios',
    summary:
      'O garçom tem um app só dele em /garcom, como no Anota AI e no PedidoJá: mapa de mesas e comandas, pedido rápido, cardápio com fotos e desafios com selos. Ele não acessa mais caixa, cozinha, relatórios nem configurações.',
    notes: [
      {
        tag: 'novo',
        text: 'App do garçom: mesas livres, ocupadas e em pagamento, comandas, pedido rápido (delivery ou para levar), lista de produtos por categoria e "Meus pedidos" do dia.',
      },
      {
        tag: 'novo',
        text: 'Desafios do garçom: selos por número de pedidos (Bem-vindo, Iniciante, Aprendiz… até Hall da fama) e metas do dia.',
      },
      {
        tag: 'novo',
        text: 'Salão › Garçons: lista de garçons ativos e inativos, criar garçom, desempenho do dia e link do app para compartilhar.',
      },
      {
        tag: 'segurança',
        text: 'Garçom só lança pedidos e pede cancelamento: não muda status, não dá desconto, não vê delivery de outros, cozinha, reservas nem a loja online (bloqueado também no servidor).',
      },
    ],
  },
  {
    version: '0.24.2',
    date: '2026-10-26',
    title: 'Busca do cardápio mais bonita',
    summary:
      'A barra de busca do cardápio ganhou um visual mais leve e um contorno único na cor da loja ao tocar nela. A descrição da loja foi para dentro do cartão da loja.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Busca do cardápio: ao tocar, aparece um contorno só, suave e na cor da loja (antes ficava com borda dupla).',
      },
      {
        tag: 'melhoria',
        text: 'A descrição da loja fica no cartão, abaixo do nome, e o "Bem-vindo" fica alinhado com o cartão no computador.',
      },
    ],
  },
  {
    version: '0.24.1',
    date: '2026-10-26',
    title: 'Sons de aviso voltam a tocar',
    summary:
      'O botão "Testar" e os avisos de pedido, cozinha e entrega agora tocam no computador, no celular e no iPhone.',
    notes: [
      {
        tag: 'correção',
        text: 'Os sons passaram a tocar como mídia do navegador (funciona com o celular no silencioso e destrava no primeiro toque), com o Web Audio como reserva.',
      },
    ],
  },
  {
    version: '0.24.0',
    date: '2026-10-26',
    title: 'Cores e ícone da loja escolhidos pelo restaurante',
    summary:
      'Em Loja online › Aparência o restaurante escolhe a cor principal, a cor de destaque, a letra, os cantos e o ícone da aba. O cardápio inteiro (e, se quiser, o sistema da equipe) muda junto.',
    notes: [
      {
        tag: 'novo',
        text: 'Cor principal e cor de destaque da loja, com cores prontas ou qualquer outra. Botões, abas, preços, selos e links do cardápio seguem a cor escolhida.',
      },
      {
        tag: 'novo',
        text: 'Os tons claros, escuros e a cor do texto por cima são calculados sozinhos e sempre ficam legíveis, também no modo escuro (com a cor mais suave).',
      },
      {
        tag: 'novo',
        text: 'Letra do cardápio (moderna, do celular, clássica ou arredondada) e cantos retos, suaves ou redondos.',
      },
      {
        tag: 'novo',
        text: 'Ícone próprio da aba do navegador e do atalho na tela inicial (sem ícone, vale o logo).',
      },
      {
        tag: 'novo',
        text: 'Opção de usar as cores da loja também no PDV, pedidos, cozinha, cardápio e demais telas da equipe.',
      },
      {
        tag: 'melhoria',
        text: 'A prévia do celular mostra as cores antes de salvar.',
      },
    ],
  },
  {
    version: '0.23.1',
    date: '2026-10-23',
    title: 'Prévia do celular, menus, abas, tema e fonte do admin',
    summary:
      'A prévia do cardápio na Loja online voltou a aparecer, os menus laterais abrem ao lado do botão, as abas ficam bonitas no celular e a troca de tema passa pela tela.',
    notes: [
      {
        tag: 'correção',
        text: 'Loja online: a prévia do celular mostra o cardápio de verdade (antes ficava em branco no servidor).',
      },
      {
        tag: 'correção',
        text: 'Menus da barra lateral: abrir, fechar e trocar de menu sem piscar ou quebrar; o menu Conta abre ao lado do botão.',
      },
      {
        tag: 'melhoria',
        text: 'Abas deslizantes no modo escuro com um laranja queimado mais discreto.',
      },
      {
        tag: 'melhoria',
        text: 'No celular, as abas ocupam a largura toda, ficam maiores e centralizadas e quebram linha em vez de cortar o texto.',
      },
      {
        tag: 'melhoria',
        text: 'Trocar entre claro e escuro agora tem uma onda que atravessa a tela a partir do botão.',
      },
      {
        tag: 'melhoria',
        text: 'Painel admin com fonte maior, mais nítida e com mais contraste.',
      },
    ],
  },
  {
    version: '0.23.0',
    date: '2026-10-23',
    title: 'Painel admin: novo restaurante, backup no servidor e planos prontos',
    summary:
      'Cadastro de restaurante mais organizado (também no celular), backup automático no próprio servidor enquanto o Backblaze não está configurado, planos que já vêm no sistema e suspensão que bloqueia de verdade.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Novo restaurante em seções (Restaurante, Acesso do dono, Plano, Contato e cobrança): o endereço sai do nome sozinho, a senha pode ser gerada, o plano é escolhido em cartões e, no celular, tudo fica numa coluna só.',
      },
      {
        tag: 'novo',
        text: 'Campos novos no cadastro: cidade e UF, fuso horário (sugerido pela UF), razão social, CPF ou CNPJ, responsável, telefone/WhatsApp, e-mail de cobrança e observações internas. Ficam na nova aba Cadastro do restaurante e o telefone já vira o WhatsApp da loja online.',
      },
      {
        tag: 'novo',
        text: 'Sem Backblaze configurado, o backup diário fica no próprio servidor (volume comandou_backups), nas mesmas pastas, com retenção e teste de restauração. O painel mostra o destino e o espaço livre.',
      },
      {
        tag: 'novo',
        text: 'Planos Essencial, Profissional e Premium já vêm no sistema na primeira subida (dá para mudar preço e limites em Planos).',
      },
      {
        tag: 'segurança',
        text: 'Restaurante suspenso: login, sessões já abertas, cardápio online e tempo real param na hora, e quem abre o sistema vê o aviso "Restaurante suspenso" em vez de um erro.',
      },
      {
        tag: 'melhoria',
        text: 'Tela Servidor mostra só os serviços, containers e logs da stack do Comandou; logs e reinício de outros sistemas da VM ficam bloqueados.',
      },
      {
        tag: 'melhoria',
        text: 'Instalação nova: só admin.<domínio> fica no ar de início; cada restaurante ganha o endereço quando é criado no painel.',
      },
    ],
  },
  {
    version: '0.22.0',
    date: '2026-10-23',
    title: 'Restaurante de demonstração: Casa Brasa',
    summary:
      'O sistema já sobe com um restaurante de exemplo funcionando, cheio de dados de verdade, para testar e mostrar cada tela sem cadastrar nada.',
    notes: [
      {
        tag: 'novo',
        text: 'Casa Brasa em exemplo.comandou.com: cardápio com fotos, adicionais e ficha técnica, 14 mesas, comandas abertas, cerca de 1.000 pedidos dos últimos 30 dias (salão, balcão, retirada, delivery e cardápio online) e pedidos acontecendo agora em todas as situações.',
      },
      {
        tag: 'novo',
        text: 'Equipe com um usuário para cada papel (dono, gerente, caixa, garçom, cozinha, entregador, atendente, estoque, financeiro e fiscal), todos com a senha comandou123.',
      },
      {
        tag: 'novo',
        text: 'Caixa fechado todo dia, estoque com alertas de mínimo, entregadores, áreas de entrega no mapa, clientes com conta, contas a pagar e receber, conferência de recebimentos e notas de homologação.',
      },
      {
        tag: 'novo',
        text: 'Loja online com logo, capa e banners. O ícone da aba do navegador no cardápio passa a ser a logo do restaurante.',
      },
      {
        tag: 'melhoria',
        text: 'É criado uma vez na subida e não é sobrescrito. COMANDOU_DEMO=reset recria do zero e COMANDOU_DEMO=false desliga.',
      },
    ],
  },
  {
    version: '0.20.2',
    date: '2026-10-23',
    title: 'Abas visíveis no modo escuro',
    summary:
      'As abas do PDV, do Salão e do cardápio e o indicador que desliza entre botões agora aparecem bem no modo escuro.',
    notes: [
      {
        tag: 'correção',
        text: 'No modo escuro a aba ativa ganha tom laranja, borda clara e texto branco; as demais ficam mais claras, e o indicador deslizante dos menus também aparece.',
      },
    ],
  },
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
