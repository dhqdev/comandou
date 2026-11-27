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
    version: '0.273.0',
    date: '2026-11-27',
    title: 'Sua foto na conversa com o Comandinho',
    summary:
      'Agora dá para pôr uma foto no seu perfil, em Conta › Meus dados. Ela aparece nas suas mensagens para o assistente de IA, no menu e na tela Conta. A conversa com o assistente ficou mais larga e arrumada: cada mensagem tem a foto de quem fala, o nome e a hora, e o texto fica sempre alinhado.',
    notes: [
      {
        tag: 'novo',
        text: 'Foto do perfil em Conta › Meus dados (ou tocando na foto do topo da Conta): escolha uma foto ou tire na hora pelo celular. Ela é recortada e reduzida no aparelho antes de enviar, e dá para trocar ou tirar quando quiser.',
      },
      {
        tag: 'melhoria',
        text: 'Conversa com o assistente: suas perguntas ficam à direita, num balão, com a sua foto; as respostas do Comandinho ficam à esquerda, com o panda num círculo. Nome e hora em cima de cada mensagem.',
      },
      {
        tag: 'melhoria',
        text: 'A janela do assistente ficou mais larga no computador e com mais espaço dos lados, então as respostas quebram menos as linhas. Listas numeradas com o recuo certo.',
      },
      {
        tag: 'segurança',
        text: 'A foto só é vista pela própria pessoa, com a sessão dela; o servidor confere que o arquivo é mesmo uma foto (JPG, PNG ou WebP, até 1 MB) e registra a troca no histórico.',
      },
    ],
  },
  {
    version: '0.272.0',
    date: '2026-11-27',
    title: 'Item em 3D sai por enquanto',
    summary:
      'O 3D dos itens do cardápio foi retirado por enquanto: o cartão "Item em 3D" do cadastro do item, o "Ver em 3D" e o "Ver na sua mesa" do cardápio online e o interruptor do 3D no Super Admin. Fotos e "Melhorar a foto" continuam iguais.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cadastro do item sem o cartão "Item em 3D" e cardápio online sem o botão do prato em 3D.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin › Tokens de IA sem o interruptor "3D pela foto com IA" e sem a parte "3D dos itens" no uso; o que já foi gasto com o 3D aparece em "Outros".',
      },
      {
        tag: 'melhoria',
        text: 'A demonstração e o site deixam de mostrar pratos em 3D. Os modelos já salvos ficam guardados, só não aparecem.',
      },
    ],
  },
  {
    version: '0.271.1',
    date: '2026-11-27',
    title: 'Item em 3D com o formato do lanche',
    summary:
      'O "Fazer o 3D pela foto" agora recorta o item do fundo e monta o modelo pelo contorno dele: o hambúrguer sai com o pão redondo, o recheio e o pão de baixo no lugar, sem o fundo escuro da foto enrolado num bloco. O recorte roda no próprio Comandou e não gasta tokens de IA.',
    notes: [
      {
        tag: 'correção',
        text: 'Lanche, copo, xícara e porção vistos de lado seguem a silhueta recortada da foto, linha por linha; a asa da caneca, o palito e a batata do lado ficam de fora.',
      },
      {
        tag: 'correção',
        text: 'O fundo da foto não aparece mais nas laterais, atrás e embaixo do modelo: ele é trocado pela cor da borda do item. Vale também para pratos e tigelas.',
      },
      {
        tag: 'melhoria',
        text: 'O recorte usa um modelo pequeno que roda no servidor, sem custo de IA; "Montar de novo" continua sem gastar tokens.',
      },
    ],
  },
  {
    version: '0.271.0',
    date: '2026-11-27',
    title: 'Comandinho leva até a tela e avisa o que está travando',
    summary:
      'Quando você pergunta onde fica alguma coisa, o assistente de IA agora sempre responde com o botão que leva até lá (e o campo pisca ao chegar). Ele também enxerga o que está dando problema agora, como pedido parado, nota recusada ou impressora desligada, e ajuda a resolver.',
    notes: [
      {
        tag: 'novo',
        text: 'Toda tela, aba ou campo citado pelo Comandinho vira um botão que leva até lá, mesmo nas conversas antigas. Endereço errado é trocado pelo certo, e só aparece o que o seu perfil abre.',
      },
      {
        tag: 'novo',
        text: 'Problemas agora: o assistente vê pedidos parados ou esperando aceite, pedidos concluídos sem pagamento, notas recusadas, certificado vencendo, impressão parada, WhatsApp desconectado, caixa aberto há muito tempo, chamados de mesa, entregas demoradas e o limite de IA perto do fim, e diz em qual tela resolver.',
      },
      {
        tag: 'melhoria',
        text: 'O Comandinho fala como braço direito do dono: resolve junto, avisa no fim de algo urgente que você ainda não viu e explica o que depende da Comandou (como o limite de IA do plano) e onde pedir.',
      },
      {
        tag: 'correção',
        text: 'A pergunta sobre o uso de tokens levava para Assinatura. Agora leva para Conta › Uso de IA.',
      },
    ],
  },
  {
    version: '0.270.0',
    date: '2026-11-27',
    title: 'Loja aberta ou fechada no topo do cardápio',
    summary:
      'No cardápio do cliente, o canto de cima à direita mostra agora um selo "Loja aberta" ou "Loja fechada", conforme o horário de funcionamento e a pausa da loja, com um pontinho verde que pulsa de leve quando está aberta. No notebook, o selo substitui a faixa "Aberta agora · 30–40 min".',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápio do cliente (celular e notebook): selo "Loja aberta" (verde, com o pontinho pulsando devagar) ou "Loja fechada" (cinza) no canto de cima, à direita, ao lado da sua conta.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio no notebook: saiu a faixa "Aberta agora · 30–40 min" do topo; o cartão da loja ocupa a linha inteira e, com a loja fechada, diz quando abre, como no celular.',
      },
    ],
  },
  {
    version: '0.269.2',
    date: '2026-11-27',
    title: '"Fechar e imprimir" imprime direto, sem prévia',
    summary:
      'Na tela Fechar conta (mesas, comandas e para levar), o botão "Fechar e imprimir" agora fecha a conta e manda o comprovante direto para a impressora, sem abrir a pré-visualização.',
    notes: [
      {
        tag: 'melhoria',
        text: '"Fechar e imprimir" imprime o comprovante de fechamento na hora: vai para o app de impressão quando ele está ligado, senão abre a impressora do navegador. A prévia continua no botão Comprovante do pedido e da mesa.',
      },
    ],
  },
  {
    version: '0.269.1',
    date: '2026-11-27',
    title: 'Tokens de IA cabendo na tela do celular',
    summary:
      'No Super Admin › Tokens de IA, o quadro de Fotos e 3D do cardápio e o interruptor do assistente passavam da largura da tela no celular. Agora tudo fica numa coluna, com os textos quebrando a linha.',
    notes: [
      {
        tag: 'correção',
        text: 'Super Admin › Tokens de IA no celular: o quadro Fotos e 3D do cardápio, os interruptores e os campos de modelo não passam mais da tela; os dois modelos das fotos ficam um embaixo do outro.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin › Tokens de IA no celular: o texto ao lado do título de cada parte e embaixo dos números aparece inteiro, sem cortar em "…", e no cartão de cada chave a situação desce para baixo da explicação.',
      },
    ],
  },
  {
    version: '0.269.0',
    date: '2026-11-27',
    title: 'Assistente de IA que leva até o campo e Uso de IA na Conta',
    summary:
      'O assistente do botão IA agora responde com os números do restaurante na hora e manda o link que leva até a tela certa, com o botão ou campo piscando. Em Conta › Uso de IA você vê quanto já usou e em que partes do sistema. E a IA ficou mais barata.',
    notes: [
      {
        tag: 'novo',
        text: 'Conta › Uso de IA: quanto do limite do mês já foi, as partes do sistema que mais usam IA (chat, WhatsApp, fotos, impressão, cardápio), quem mais usou e o uso dos últimos 30 dias, para este mês, o mês passado ou desde o início. Só administrador e gerente veem; a aba IA do chat tem o atalho Ver onde usou.',
      },
      {
        tag: 'novo',
        text: 'Assistente de IA: pergunte "onde abro o caixa?" ou "onde fica o X-Burguer?" e ele manda o link que abre a tela e faz o botão, o campo ou a linha do item piscar. Garçom, cozinha e entregador recebem a explicação, sem link.',
      },
      {
        tag: 'melhoria',
        text: 'Assistente de IA: responde com os números de agora, conforme a permissão de quem pergunta: vendas de hoje e de ontem, mais vendidos da semana, estoque baixo, reservas de hoje, entregas na rua, clientes, equipe e o uso de IA do mês. Telefone, e-mail e CPF de cliente não vão para a IA.',
      },
      {
        tag: 'melhoria',
        text: 'IA mais barata: a conversa (assistente, IA do WhatsApp e modelo de impressão) usa o DeepSeek V4 Flash, e se ele falhar outro modelo responde na mesma hora, sem a pessoa perceber.',
      },
      {
        tag: 'novo',
        text: 'Super Admin › Tokens de IA › Chaves e assistente: um cartão por modelo em uso, com para que serve, o preço, por que foi escolhido, o gasto do mês e onde foi usado (restaurantes e sistema). O modelo que lê o cardápio também pode ser trocado ali.',
      },
      {
        tag: 'novo',
        text: 'Super Admin › Chamados › Uso de IA: o gasto da esteira de desenvolvimento separado dos restaurantes, por dia, por agente, por modelo e por chamado, e de qual chave saiu.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin › Credenciais: o cartão OpenRouter · chave do sistema (esteira) explica que é a chave do próprio Comandou, separada da dos restaurantes. Sem ela, Chamados e Tokens de IA avisam e o link abre o cartão com o campo da chave piscando.',
      },
      {
        tag: 'correção',
        text: 'Super Admin › Chamados: o que a IA já cobrou numa etapa que deu erro passa a contar no total do chamado, e cada chamada guarda a etapa e o modelo que respondeu de verdade.',
      },
    ],
  },
  {
    version: '0.268.0',
    date: '2026-11-26',
    title: 'Zerar o uso de IA de um restaurante',
    summary:
      'No Super Admin › Tokens de IA, cada restaurante ganhou o botão Zerar uso: o consumo volta a zero para começar a contar de novo, por exemplo depois de trocar a chave do OpenRouter.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › Tokens de IA: ao abrir um restaurante, a caixa Zerar uso apaga o uso de IA dele (todos os períodos) depois de confirmar. O limite do mês volta a contar do zero e o que foi apagado (tokens, usos e custo) fica no histórico do restaurante.',
      },
    ],
  },
  {
    version: '0.267.2',
    date: '2026-11-26',
    title: 'Aba Operação do Super Admin volta a abrir',
    summary:
      'A aba Operação de um restaurante no Super Admin mostrava "Algo deu errado nesta tela". Voltou a abrir com todos os gráficos.',
    notes: [
      {
        tag: 'correção',
        text: 'Super Admin: a aba Operação do restaurante quebrava quando o faturamento médio de algum dia da semana dava frações de centavo (ex.: R$ 10,01 dividido por 4 semanas). Os valores agora são arredondados para centavos antes de aparecer.',
      },
      {
        tag: 'correção',
        text: 'Super Admin: fuso do restaurante vazio ou desconhecido pelo navegador não derruba mais os gráficos da Operação; usa o horário de Brasília.',
      },
    ],
  },
  {
    version: '0.267.1',
    date: '2026-11-26',
    title: 'Recompensa que já coloca o item e PDV que lembra o Compacto ou Completo',
    summary:
      'Escolhido o cliente, tocar em Usar numa recompensa de produto grátis já coloca o produto no pedido, marcado como "1 grátis pela recompensa". E a escolha entre Compacto e Completo nos pedidos do PDV fica salva na conta de cada pessoa, em qualquer computador.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Nova venda: ao usar uma recompensa de produto grátis (ex.: Batata frita média), o produto entra no pedido na hora, com o selo "1 grátis pela recompensa" e o desconto no total. Produto com complementos obrigatórios ou vendido por peso abre a escolha antes. Se o produto já estava no pedido, não duplica.',
      },
      {
        tag: 'melhoria',
        text: 'Tirar a recompensa, trocar por outra ou trocar de cliente tira o item que ela colocou. Sem o produto no pedido, o aviso embaixo do total ganhou o botão "Colocar no pedido". Produto esgotado ou fora do cardápio do atendimento avisa na hora.',
      },
      {
        tag: 'melhoria',
        text: 'PDV: Compacto ou Completo nos cartões de pedidos fica salvo na conta de cada pessoa do restaurante. Vale em qualquer computador ou navegador em que ela entrar, sem escolher de novo; quem já tinha escolhido neste navegador não perde a escolha.',
      },
      {
        tag: 'correção',
        text: 'Recompensa de produto vendido por peso: a tela mostrava de desconto o preço do quilo inteiro, e o pedido saía com o valor do que foi pesado. Agora a tela mostra o mesmo valor que o pedido.',
      },
    ],
  },
  {
    version: '0.267.0',
    date: '2026-11-26',
    title: 'Super Admin mais limpo, gráficos da operação, credenciais em cartões e e-mails novos',
    summary:
      'Credenciais viraram cartões com a situação de cada chave, que ampliam ao clicar. A Operação do restaurante ganhou gráficos, a Visão geral ficou mais direta, a Assinatura tem o plano fixo e o "pago até" aparece no calendário da Cobrança. Os serviços do plano se marcam por caixa em Preço, e os e-mails para os clientes ficaram minimalistas.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › Credenciais: cada chave é um cartão com a situação à vista (em uso, funcionando, falta, recusada, sem uso ou fora daqui), o final da chave e filtros em cima. Clicar amplia o cartão numa janela com o cadastro de um lado e o passo a passo e os links do outro. Links de outras telas abrem direto no cartão certo.',
      },
      {
        tag: 'novo',
        text: 'Detalhe do restaurante › Operação: gráficos de colunas do faturamento por dia (com a média), dos horários e dos dias da semana (com o pico e o melhor dia em destaque), rosca dos canais (balcão, mesa, entrega, retirada), barras das formas de pagamento e da situação dos pedidos e o ranking dos mais vendidos.',
      },
      {
        tag: 'novo',
        text: 'Super Admin › Preço: os serviços do plano (nota fiscal, WhatsApp e domínio próprio) se marcam por caixa em "Mudar valor e serviços" e valem para todos os clientes, os que já fecharam e os que fecharem. O resto do sistema vem sempre. Ao desmarcar um serviço, a janela avisa e mostra o destaque da página de preços que fala dele.',
      },
      {
        tag: 'melhoria',
        text: 'Detalhe do restaurante › Visão geral: uma faixa com a assinatura, os pedidos do mês, a equipe, a IA do mês e as notas dos últimos 30 dias, e o cartão da Assinatura com os serviços do plano. Saiu o cartão de Endereços.',
      },
      {
        tag: 'melhoria',
        text: 'Detalhe do restaurante › Assinatura: o plano é sempre o plano único, com o preço, sem escolha. Mudar o "Pago até" aparece no calendário da Cobrança, no dia em que o período pago acaba, como a próxima mensalidade ("Pago até …"); restaurante ainda em teste que ganha um "pago até" passa a Ativa.',
      },
      {
        tag: 'melhoria',
        text: 'E-mails para os clientes mais minimalistas: a marca pequena em cima, um cartão branco com linha fina, título grande, um botão só, dados em linhas finas e "Equipe Comandou" no fim. Saíram a capa escura e o panda. Continuam certos no modo escuro.',
      },
      {
        tag: 'melhoria',
        text: 'Status do Super Admin sem a parte de infraestrutura (servidor e saúde dos serviços): isso fica em Infraestrutura, e o que der problema continua aparecendo em "Pede atenção".',
      },
      {
        tag: 'melhoria',
        text: 'Detalhe do restaurante sem a aba Cozinha.',
      },
    ],
  },
  {
    version: '0.266.0',
    date: '2026-11-26',
    title: 'Tokens de IA: um cartão por restaurante e a pizza de onde a IA é usada',
    summary:
      'A tela Tokens de IA do Super Admin ficou mais simples: o saldo do OpenRouter, o gasto do mês e um cartão por restaurante. Tocando no cartão, uma pizza mostra quanto cada parte do restaurante gastou (WhatsApp, chat, modelo de impressão, fotos…). Imagem gerada pela IA agora sempre desconta do restaurante.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › Tokens de IA: cada restaurante virou um cartão com o uso do mês contra o limite, o custo e a parte que mais usa. Ao tocar, abre o detalhe com a pizza das partes (IA do WhatsApp, chat com a IA, modelo de impressão, fotos dos itens, 3D dos itens, cardápio e página), por tokens ou por custo, neste mês, no mês passado ou desde sempre, com a tabela de cada parte, os últimos 30 dias, os modelos usados e os ajustes de limite e tokens extras.',
      },
      {
        tag: 'melhoria',
        text: 'Tokens de IA mais simples: as chaves e o modelo do assistente foram para a aba Chaves e assistente, e saíram o extrato de chamadas, o gráfico geral e o panda do topo.',
      },
      {
        tag: 'correção',
        text: 'Fotos feitas ou refeitas pela IA (fundo limpo, foto criada) podiam não descontar nada do limite do restaurante: em alguns modelos o OpenRouter manda só o custo da imagem, sem tokens, e o limite é contado em tokens. Agora a imagem conta pelo custo, e sem nenhuma informação conta como uma imagem padrão.',
      },
      {
        tag: 'correção',
        text: 'O uso da IA do modelo de impressão aparecia com o nome técnico (print_template) no Super Admin; agora aparece como Modelo de impressão.',
      },
    ],
  },
  {
    version: '0.265.2',
    date: '2026-11-26',
    title: 'Topo do cardápio só com o Olá e código de senha que se copia no próprio e-mail',
    summary:
      'No celular, o topo do cardápio fica com o "Olá, nome" e mais espaço, sem o selo do tempo de entrega. O e-mail de nova senha não tem mais o botão que abria uma página: o código se copia ali mesmo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cardápio no celular: saiu o selo "Aberta · 35–50 min" do canto de cima. O topo fica com o "Olá, nome" (ou "Olá!"), um pouco maior, o sino dos avisos e os pontos embaixo, com mais folga até o cartão da loja. Com a loja fechada, o cartão da loja mostra quando ela abre. O tempo de entrega continua nas informações da loja e na sacola.',
      },
      {
        tag: 'melhoria',
        text: 'E-mail de código para nova senha (equipe, Super Admin e clientes do cardápio): saiu o botão Copiar código, que abria a página /codigo do site. Um toque (ou tocar e segurar) no código seleciona os 6 números de uma vez, e o código continua no começo do assunto e na notificação, onde o Gmail e o iPhone já oferecem copiar ou preencher sozinhos.',
      },
    ],
  },
  {
    version: '0.265.1',
    date: '2026-11-26',
    title: 'Topo do cardápio mais limpo no celular',
    summary:
      'O topo do início ficou mais simples: "Olá" e o selo "Aberta · 35–50 min" numa linha, os pontos embaixo e o cartão da loja sem enfeite extra. As categorias presas no topo não aparecem mais quebradas.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Celular: o selo da loja virou uma linha só ("Aberta · 35–50 min" ou "Fechada · abre 18h"), ao lado do "Olá". Os pontos ou o "Entre e ganhe pontos" ficam na linha de baixo, sem espremer.',
      },
      {
        tag: 'melhoria',
        text: 'Cartão da loja mais leve: contorno fino com o brilho na cor da loja, sem a sombra e sem o anel na logo.',
      },
      {
        tag: 'correção',
        text: 'Categorias presas no topo ao rolar: a marcação da categoria voltou a ficar atrás do nome (estava mais alta e o texto parecia quebrado) e as pontas da faixa somem num degradê.',
      },
    ],
  },
  {
    version: '0.265.0',
    date: '2026-11-26',
    title: 'O sistema se atualiza sozinho, sem aviso',
    summary:
      'Saiu o aviso "Nova versão disponível" de todas as telas. Quando sai versão nova, o sistema espera você terminar o que está fazendo, mostra uma faixa fina no topo, limpa o cache e já abre a versão nova.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Sem o aviso nem o botão Atualizar: o painel, o garçom, a cozinha e o cardápio trocam de versão sozinhos e limpam o cache no fim.',
      },
      {
        tag: 'melhoria',
        text: 'A troca espera a pessoa parar de digitar e fechar a janela aberta (como uma Nova venda), para não perder nada no meio.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin: ao clicar em Atualizar, a janela fecha na hora e uma barra mostra o andamento da atualização, serviço por serviço.',
      },
    ],
  },
  {
    version: '0.264.3',
    date: '2026-11-26',
    title: 'Reservas mais limpa, sem o calendário do canto',
    summary:
      'A tela de Reservas ficou mais simples: saiu o calendário pequeno do lado e a agenda usa a largura toda. O topo ficou organizado em duas linhas e funciona bem no notebook e no tablet.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Saiu o painel do lado com o calendário pequeno e o segundo botão Hoje. A Nova reserva foi para a barra de cima, à direita, ao lado de Dia, Semana, Mês e Lista.',
      },
      {
        tag: 'melhoria',
        text: 'Topo em duas linhas: em cima o período (Hoje, setas e o mês ou o dia), a busca, as reservas pelo cardápio e as visões; embaixo, as situações (Aguardando, Confirmada, Chegou…) mais leves, sem contorno.',
      },
      {
        tag: 'melhoria',
        text: 'No Dia, os cartões com as ações aparecem ao lado da grade já no notebook. No tablet a barra encolhe sem cortar nada: a Nova reserva vira só o +, o título fica curto e as situações cabem numa linha.',
      },
      {
        tag: 'correção',
        text: 'Saiu a barra de rolagem de lado que aparecia embaixo do calendário do canto (também na Agenda pessoal).',
      },
    ],
  },
  {
    version: '0.264.2',
    date: '2026-11-26',
    title: 'Barras de rolagem com a cor do restaurante',
    summary:
      'As barras de rolagem do sistema e do cardápio ganharam a cor do restaurante, cantos redondos e ficam mais fortes com o mouse em cima. O tamanho da barra mostra quanto tem na lista: lista longa, barra curta.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Barras de rolagem na cor do restaurante, nos temas claro e escuro. Com o mouse em cima ela engrossa e fica mais forte, e enquanto você arrasta fica na cor cheia. O tamanho acompanha o conteúdo, com um mínimo para dar para pegar.',
      },
      {
        tag: 'melhoria',
        text: 'No app instalado no computador as barras de rolagem voltaram a aparecer. No celular e no tablet fica a barrinha do próprio aparelho, que aparece só enquanto você rola.',
      },
    ],
  },
  {
    version: '0.264.1',
    date: '2026-11-26',
    title: 'Topo do cardápio no celular mais bonito',
    summary:
      'No celular, o cardápio mostra "Aberta" num selo no canto de cima, à direita, com o horário e o tempo de entrega. O cartão da loja ganhou um contorno na cor da loja e a busca com o filtro saiu do topo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Celular: "Aberta" (ou "Fechada" e quando abre) virou um selo no canto de cima, à direita, com a bolinha que pulsa, o horário e o tempo de entrega. A faixa larga do horário saiu.',
      },
      {
        tag: 'melhoria',
        text: 'Cartão da loja com contorno na cor da loja, com um brilho que dá a volta devagar, e a logo com um anel. Endereço comprido termina em "…".',
      },
      {
        tag: 'melhoria',
        text: 'Celular: saíram a busca e o botão de filtro do topo do cardápio. As categorias em texto continuam aparecendo presas no topo ao rolar.',
      },
      {
        tag: 'correção',
        text: 'O contorno da categoria marcada (fotos dos grupos) não fica mais cortado em cima.',
      },
      {
        tag: 'correção',
        text: 'Loja online › Prévia: o cardápio agora vai até a borda direita do celular (a barra de rolagem saiu da prévia).',
      },
    ],
  },
  {
    version: '0.264.0',
    date: '2026-11-26',
    title: 'Fechar caixa: confirmar o valor esperado num toque',
    summary:
      'No fechamento do caixa não precisa mais digitar o que bateu: um botão confirma todos os valores esperados de uma vez, e cada forma de pagamento tem o seu botão de confirmar. Dá para corrigir depois o que não bateu.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Caixa > Fechar caixa: "Confirmar valores esperados" preenche o contado de todas as formas com o esperado. O botão de visto ao lado de cada campo faz o mesmo só para aquela forma e fica verde quando o contado bate.',
      },
    ],
  },
  {
    version: '0.263.0',
    date: '2026-11-26',
    title: 'Estoque revisado: complementos, fichas e botões grandes',
    summary:
      'O estoque agora vale também para os complementos: um adicional com ficha técnica que acabou aparece sem estoque no PDV, no garçom e no cardápio, e não dá para pedir. As telas do Estoque ganharam botões maiores, as ações viram quadrados no celular e o Confirmar fica no fim, ao lado do total.',
    notes: [
      {
        tag: 'novo',
        text: 'Complemento com ficha técnica (ex.: Bacon extra) que ficou sem insumo aparece "Sem estoque" no PDV e no app do garçom e "Esgotado" no cardápio do cliente, sem dar para marcar. Se o pedido chegar com ele, é recusado dizendo o insumo que falta.',
      },
      {
        tag: 'novo',
        text: 'Item com escolha obrigatória em que nenhuma opção tem estoque (ex.: pizza com todos os sabores sem queijo) sai do cardápio como sem estoque, também no iFood. A opção que vem marcada sozinha não é marcada se estiver sem estoque.',
      },
      {
        tag: 'melhoria',
        text: 'Botões do Estoque maiores: 38px nas linhas das listas (44px na tela de toque) e 44px no topo. No celular, as ações de cada linha e do insumo viram quadrados iguais com ícone e nome.',
      },
      {
        tag: 'melhoria',
        text: 'Entrada e Produção: Confirmar recebimento e Confirmar produção ficam no fim, ao lado do total, sempre à vista enquanto você preenche as linhas.',
      },
      {
        tag: 'melhoria',
        text: 'Fichas técnicas com o botão Montar ficha ou Editar ficha em cada item. Custo e preço abre o simulador ao tocar na linha. Marcar um lote como usado pede confirmação.',
      },
      {
        tag: 'melhoria',
        text: 'Pesquisar e o tutorial usam os mesmos nomes do menu do Estoque: Saída e perdas, Unidades de compra (antes Fatores) e Custo e preço.',
      },
      {
        tag: 'correção',
        text: 'Não dá mais para mudar a unidade de um insumo que está numa ficha técnica (as quantidades da ficha ficariam erradas) nem desativar um insumo que está numa ficha. O aviso diz em quais fichas ele está.',
      },
      {
        tag: 'correção',
        text: 'Quantidade de um item sem ficha em Itens do cardápio usa o insumo de mesmo nome que já existe, em vez de dar erro. Se ele estiver em outra unidade, o aviso manda montar a ficha técnica.',
      },
      {
        tag: 'correção',
        text: 'Nome, código ou código de barras repetido no insumo, e sigla repetida na unidade de compra, mostram um aviso claro em vez de erro.',
      },
      {
        tag: 'correção',
        text: 'Contar um insumo com saldo negativo começa do zero. Em Saída e perdas › Vendas, a venda cancelada aparece como volta ao estoque (+) e não soma como saída.',
      },
    ],
  },
  {
    version: '0.262.4',
    date: '2026-11-26',
    title: 'Busca das listas mais limpa no notebook',
    summary:
      'No notebook e no computador, as listas (Itens do cardápio, Pedidos, Clientes, Estoque e as demais) mostram só a busca e os filtros. Saíram o botão de ordem e a caixa de ordenar (como "Categoria") ao lado da busca.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Notebook: sem o botão de crescente/decrescente e sem o "Ordenar por" ao lado do Pesquisar em todas as listas. Cada lista segue na ordem de sempre da tela.',
      },
      {
        tag: 'melhoria',
        text: 'Tablet e celular continuam com os dois, como antes.',
      },
    ],
  },
  {
    version: '0.262.3',
    date: '2026-11-26',
    title: 'Conversa do cardápio sem pular com o teclado',
    summary:
      'No celular, ao tocar no campo de mensagem da conversa com a loja, a tela subia de uma vez e depois voltava. Agora a conversa já fica do tamanho certo antes de o teclado subir e fica parada.',
    notes: [
      {
        tag: 'correção',
        text: 'iPhone: a conversa espera o teclado chegar, mesmo quando ele demora (a primeira vez que o teclado abre passa de um segundo). Antes ela voltava a ocupar a tela toda no meio do caminho e o teclado chegava empurrando tudo para cima.',
      },
      {
        tag: 'correção',
        text: 'iPhone: na primeira vez no aparelho, a conversa já reserva o espaço do teclado com a barra de sugestões, sem ficar curta e sem a tela ser empurrada.',
      },
      {
        tag: 'correção',
        text: 'Android: com a conversa aberta, o teclado encolhe a página em vez de cobrir e deslizar a tela, e a conversa sobe junto com ele.',
      },
    ],
  },
  {
    version: '0.262.2',
    date: '2026-11-26',
    title: 'Fechar conta já conclui o pedido',
    summary:
      'Depois de clicar em "Fechar conta", o painel ainda pedia um clique em "Concluir". Agora fechar a conta já conclui: o painel some e o aviso com o troco aparece na tela.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Sem o botão "Concluir" no fechamento: com tudo pago, "Fechar conta" grava os pagamentos, conclui o pedido e fecha o painel. O troco aparece no aviso verde.',
      },
      {
        tag: 'melhoria',
        text: 'Para sair com o comprovante, use "Fechar e imprimir": fecha a conta e abre o comprovante já com taxa, frete, desconto e pagamentos. Ao fechar o comprovante, o painel fecha junto.',
      },
      {
        tag: 'melhoria',
        text: '"Concluir a receber" (Posterior) também fecha o painel direto. Entregas continuam indo para o despacho, como antes.',
      },
    ],
  },
  {
    version: '0.262.1',
    date: '2026-11-26',
    title: 'Fotos do cardápio e do PDV carregando bem mais rápido',
    summary:
      'O cardápio do cliente, a Nova venda do PDV e o app do garçom baixavam cada foto no tamanho original, mesmo num cartão pequeno. Agora recebem uma versão reduzida da foto, várias vezes mais leve, e a foto grande só aparece quando o cliente abre o produto.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cartões do cardápio, grade da Nova venda, app do garçom e as fotinhas das listas usam a foto reduzida (até 640 px, ou 320 px nas menores). Uma foto de 250 KB vira cerca de 50 KB no cartão.',
      },
      {
        tag: 'melhoria',
        text: 'A foto reduzida é feita uma vez só e guardada; as fotos já enviadas também ganham a sua na primeira vez que aparecem. Fotos repetidas saem da memória do servidor, sem ir ao banco, e não seguram mais as outras telas da loja enquanto carregam.',
      },
      {
        tag: 'melhoria',
        text: 'Ao abrir um produto, a foto do cartão aparece na hora e a foto grande entra por cima quando chega, sem quadro vazio.',
      },
    ],
  },
  {
    version: '0.262.0',
    date: '2026-11-26',
    title: 'Obrigatório e Opcional nas escolhas do item',
    summary:
      'Cada grupo de complementos agora diz se é Obrigatório ou Opcional na hora de lançar o item, no PDV, no garçom e no cardápio online. Quem decide é o cadastro do grupo, com a nova caixa Obrigatório.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápio › Grupos de complementos: caixa Obrigatório no cadastro do grupo. Marcada, o item só entra no pedido com a escolha feita; desmarcada, o grupo aparece como Opcional. A lista de grupos e os complementos do item mostram a regra ("Obrigatório, escolhe 1" ou "Opcional, até 4").',
      },
      {
        tag: 'melhoria',
        text: 'PDV: na escolha das opções do item, cada grupo tem o selo Obrigatório ou Opcional (com o ✓ quando já foi escolhido). O Adicionar fica travado enquanto falta um obrigatório; o rodapé diz o que falta e, ao tocar, o grupo pendente pisca em vermelho.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio online e app do garçom: grupos sem escolha obrigatória agora aparecem com o selo Opcional, ao lado do Obrigatório que já existia.',
      },
    ],
  },
  {
    version: '0.261.0',
    date: '2026-11-26',
    title: 'Mesas em quadradinhos na Nova venda do PDV',
    summary:
      'Ao escolher o atendimento Mesa na Nova venda, as mesas aparecem em quadradinhos com o nome e se estão livres ou ocupadas, no lugar da lista que abria para baixo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Nova venda › Mesa: cada mesa é um quadradinho; livre fica em verde, ocupada em amarelo com o total da conta, e a escolhida fica destacada em laranja. Funciona nos temas claro e escuro e no celular.',
      },
    ],
  },
  {
    version: '0.260.0',
    date: '2026-11-26',
    title: 'Parabéns de aniversário pelo WhatsApp, com arte e o nome do cliente',
    summary:
      'Com o aniversário na ficha do cliente, o WhatsApp da loja manda no dia uma arte com o nome dele, a cor e a logo do restaurante, e a mensagem que você escrever. Dá para incluir um presente, e cada cliente recebe uma vez por ano.',
    notes: [
      {
        tag: 'novo',
        text: 'Aniversário na ficha do cliente (dia e mês, ano opcional) e na conta do cardápio, em Meus dados. A lista de Clientes ganhou a aba Aniversariantes e mostra quem faz aniversário nos próximos dias.',
      },
      {
        tag: 'novo',
        text: 'Clientes › Aniversários: liga o parabéns automático, escolhe o horário de envio, o estilo da arte (Festa, Bolo, Elegante ou Simples), a frase e o texto com {cliente}, {restaurante} e {presente}. A prévia mostra a arte e a mensagem como chegam no WhatsApp, e dá para mandar um teste para o seu número.',
      },
      {
        tag: 'novo',
        text: 'Presente opcional: pontos (ou carimbos) da fidelidade, que entram na conta do cliente junto com o parabéns, ou um presente escrito com validade, como "Sobremesa grátis", que a equipe confere na ficha.',
      },
      {
        tag: 'melhoria',
        text: 'Cada cliente recebe uma vez por ano, um parabéns a cada 25 segundos para o número da loja não parecer robô. Quem pediu para não receber ou está bloqueado fica de fora, e o histórico mostra o que saiu e o que falhou, com Tentar de novo.',
      },
      {
        tag: 'melhoria',
        text: 'A IA que atende no WhatsApp sabe do parabéns enviado e responde ao "obrigado!" lembrando do presente.',
      },
      {
        tag: 'correção',
        text: 'Meus dados no cardápio aberto direto pelo link agora já vem com o nome, o e-mail e o CPF preenchidos.',
      },
    ],
  },
  {
    version: '0.259.0',
    date: '2026-11-26',
    title: 'Perfil e cupons do cliente na mesa, e CPF na conta',
    summary:
      'Quem pede pelo QR Code da mesa ganha a aba Perfil: entra ou cria a conta, guarda o CPF e usa os cupons dele no pedido da mesa, sem nada de entrega. A loja liga ou desliga cada parte.',
    notes: [
      {
        tag: 'novo',
        text: 'Aba Perfil no cardápio da mesa: o cliente entra ou cria a conta, vê os avisos, a loja, a ajuda e os cupons. Endereços, forma de pagamento, reservas e conversa ficam só no cardápio online.',
      },
      {
        tag: 'novo',
        text: 'Cupons na mesa: com a conta aberta, o cliente aplica o cupom na aba Cupons ou na sacola e o desconto entra no pedido da mesa (cupom de entrega grátis segue só na entrega).',
      },
      {
        tag: 'novo',
        text: 'CPF na conta do cliente: campo opcional no cadastro e em Meus dados. No pedido da mesa o CPF já vem preenchido para a nota.',
      },
      {
        tag: 'melhoria',
        text: 'Loja online › Funcionamento › Pedido pela mesa: interruptores "Perfil do cliente na mesa" e "Cupons na mesa" para a loja decidir o que o cliente vê.',
      },
    ],
  },
  {
    version: '0.258.0',
    date: '2026-11-26',
    title: 'Nova venda: cliente já vem com o PIN, os pontos e as recompensas',
    summary:
      'Ao escolher o cliente na Nova venda, o PDV mostra o PIN do app dele, o saldo, o nível, as recompensas e os cupons, e deixa usar um deles no próprio pedido, em qualquer tipo de atendimento.',
    notes: [
      {
        tag: 'novo',
        text: 'Escolheu o cliente na Nova venda (Balcão, Mesa, Delivery, Retirada ou Fiado)? O PIN do app já aparece preenchido, com o saldo de pontos, o nível, as recompensas e os cupons que ele pode usar.',
      },
      {
        tag: 'novo',
        text: 'Toque em Usar numa recompensa ou cupom e o desconto entra no total do pedido na hora. Os pontos saem quando o pedido é lançado e voltam se ele for cancelado; o cupom volta também. Um por pedido, como no app.',
      },
      {
        tag: 'novo',
        text: 'Cliente com o app aberto? Em "Cliente com PIN do app" a equipe digita o PIN e o cliente já entra no pedido.',
      },
      {
        tag: 'melhoria',
        text: 'Recompensa de produto grátis pede o produto no pedido, e cupom de entrega grátis só vale no Delivery com taxa: o PDV avisa antes de enviar. Usar pontos e cupons fica com o caixa e o gerente.',
      },
    ],
  },
  {
    version: '0.257.1',
    date: '2026-11-26',
    title: 'Cardápio no celular: menu de baixo fixo, PIN só da loja e tela A loja mais completa',
    summary:
      'No app do cliente, o menu de baixo não some mais ao rolar até o fim, o PIN deixa de ser trocado pelo próprio cliente e a tela A loja mostra tudo o que o cliente precisa saber.',
    notes: [
      {
        tag: 'correção',
        text: 'Cardápio no celular: ao rolar até o fim da página e puxar mais um pouco, o menu de baixo sumia e só voltava ao soltar o dedo. Agora ele fica fixo o tempo todo.',
      },
      {
        tag: 'melhoria',
        text: 'Pontos do cliente: o botão "Gerar outro PIN" saiu do cardápio. O PIN continua aparecendo para mostrar no balcão, mas o cliente não troca mais por conta própria.',
      },
      {
        tag: 'melhoria',
        text: 'Conta › A loja: capa com a logo, situação e o horário de hoje, a frase e o texto da loja, botões rápidos (Como chegar, WhatsApp, Instagram e Compartilhar), como pedir (entrega com taxa e mínimo, retirada, na mesa pelo QR Code e tempo), formas de pagamento aceitas, endereço com Copiar e o horário da semana.',
      },
    ],
  },
  {
    version: '0.257.0',
    date: '2026-11-26',
    title: 'Cartões de produto da Nova venda com nome inteiro e pontos',
    summary:
      'Na Nova venda do PDV, cada produto mostra a foto, o nome inteiro logo embaixo e o preço no pé do cartão, alinhado com os vizinhos. Com a fidelidade ligada, o cartão mostra quantos pontos o item rende.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Nome do produto sem corte: quebra em quantas linhas precisar e o cartão cresce junto. O preço fica sempre no pé do cartão, na mesma altura em toda a fileira, e não quebra no meio.',
      },
      {
        tag: 'novo',
        text: 'Pontos de fidelidade em cada produto ("+44 pts"), no número fixo do item ou pelo preço × pontos por real. Só aparece quando o programa é de pontos e conta as vendas da equipe; item por peso sem número fixo não mostra.',
      },
    ],
  },
  {
    version: '0.256.1',
    date: '2026-11-26',
    title: 'Observação do item maior e mais clara no PDV',
    summary:
      'Na Nova venda, o campo de observação de cada item ficou maior e mostra bem quando está sendo digitado.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Itens do pedido (Nova venda): a observação do item ("sem cebola") ficou maior e com letra maior. Parada, aparece com borda tracejada; ao clicar, vira um campo com um contorno só na cor da loja, sem a borda dupla de antes.',
      },
    ],
  },
  {
    version: '0.256.0',
    date: '2026-11-26',
    title: 'App do cliente novo: pontos no topo, cupons, PIN e Conta em quadrados',
    summary:
      'O cardápio online virou um app completo: início com os pontos e a situação da loja, opções do item com foto e contador, cupons, PIN para usar pontos e cupons no balcão e uma Conta com todas as telas. Tudo se ajusta pela Loja online.',
    notes: [
      {
        tag: 'novo',
        text: 'Início do cardápio: saudação com o nível e os pontos do cliente, aviso de loja aberta ou fechada com o horário, banner em cima e as categorias em quadrados com foto. Cada item mostra quantos pontos rende ("Ganhe N pts"). A parte da entrega saiu do início e fica na sacola.',
      },
      {
        tag: 'novo',
        text: 'Opções do item em cartões com foto, contador de + e − para as opções que podem repetir e a regra escrita ("Escolha de 1 até 3 opções"). No cadastro do grupo, a loja marca "Pode repetir a mesma opção".',
      },
      {
        tag: 'novo',
        text: 'Cupons: aba Cupons no app, cupom de porcentagem, valor ou entrega grátis com validade, pedido mínimo, limite por cliente, só no primeiro pedido e cupom só pelo código. O cliente aplica na sacola ou digita o código na finalização. Loja online › Cupons cria, liga e mostra quem usou.',
      },
      {
        tag: 'novo',
        text: 'PIN do cliente: a tela de pontos do app mostra um PIN de 6 números. No balcão, o botão PIN do cliente (PDV, Cupons e Fidelidade) mostra o nome, o saldo e o nível, troca recompensas e registra o uso de cupons.',
      },
      {
        tag: 'novo',
        text: 'Conta em quadrados: Pontos, Minha conta, Notificações, Endereços, Pagamento, Cupons, Indique um amigo, Favoritos, Reservas, Conversa, A loja (endereço, mapa e horários), Ajuda, Sobre e Sair, cada uma com a sua tela.',
      },
      {
        tag: 'novo',
        text: 'Loja online › App do cliente: avisos com foto que abrem um produto ou mostram um cupom (aparecem em Notificações), perguntas da Ajuda por assunto (com perguntas prontas para começar) e o texto do Sobre com o Instagram.',
      },
      {
        tag: 'novo',
        text: 'Fidelidade: níveis (Bronze, Prata, Ouro…) com cor e benefício, contados desde o começo ou numa janela de tempo; pontos fixos por item; e Indique um amigo, com pontos para quem indica e para o amigo no primeiro pedido concluído.',
      },
      {
        tag: 'novo',
        text: 'Foto do item com IA no próprio clique da imagem: no cardápio, ao tocar na foto do item ou da opção, dá para enviar uma foto ou pedir para a IA criar uma pelo nome e pela descrição.',
      },
      {
        tag: 'melhoria',
        text: 'Celular, tablet e notebook: a Conta tem 3 quadrados por linha no celular e 4 com a explicação no tablet e no computador; as novas telas seguem a largura do app em cada aparelho.',
      },
    ],
  },
  {
    version: '0.255.1',
    date: '2026-11-26',
    title: 'Aviso com botão de fechar próprio',
    summary:
      'O X dos avisos agora se chama Fechar aviso para quem usa leitor de tela, e não se confunde com o Fechar da janela aberta.',
    notes: [
      {
        tag: 'correção',
        text: 'Com um aviso aberto dentro de uma janela (como a mesa no Salão), o X do aviso e o Fechar da janela tinham o mesmo nome. O do aviso passou a se chamar Fechar aviso.',
      },
    ],
  },
  {
    version: '0.255.0',
    date: '2026-11-26',
    title: 'LGPD: o cliente baixa ou apaga os próprios dados',
    summary:
      'O cliente do cardápio online baixa tudo o que a loja guarda dele e apaga a conta sozinho, e a equipe atende pela ficha do cliente ou pelo telefone de quem pediu sem conta.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápio › Conta › Privacidade e dados: o cliente baixa um arquivo com o cadastro, endereços, pedidos, reservas, pontos, avaliações e as conversas com a loja e com a IA do WhatsApp, e pode apagar a conta digitando a senha e a palavra APAGAR.',
      },
      {
        tag: 'novo',
        text: 'Clientes: a ficha do cliente ganhou o bloco Dados pessoais (LGPD) e a lista ganhou o botão Pedido LGPD, para atender pelo telefone quem pediu no balcão, por telefone ou pelo WhatsApp. Só dono e gerente usam, e cada atendimento fica registrado.',
      },
      {
        tag: 'segurança',
        text: 'Apagar não mexe no caixa: pedidos, pagamentos e notas ficam pelo prazo fiscal, sem nome, telefone e endereço (o CPF só fica no pedido com nota autorizada). Pedido em andamento, fiado em aberto, Pix a devolver ou reserva marcada travam o apagar até terminar. O registro do atendimento não guarda dado pessoal.',
      },
    ],
  },
  {
    version: '0.254.6',
    date: '2026-11-26',
    title: 'Pedidos no modo Completo mais bonitos e com mais informação',
    summary:
      'No quadro de pedidos do PDV, o modo Completo agora mostra o pedido inteiro, bem alinhado: quem é, o endereço, cada item com complementos e observação, o pagamento e o total.',
    notes: [
      {
        tag: 'melhoria',
        text: 'PDV, quadro de pedidos no modo Completo: o topo do cartão mostra o tipo (Delivery, Retirada, Balcão ou a mesa), o número, a hora em que foi feito e há quanto tempo, em vermelho quando passa de 30 minutos. Pedido agendado mostra para que horas.',
      },
      {
        tag: 'melhoria',
        text: 'PDV, modo Completo: nome e telefone do cliente e o endereço de entrega em até duas linhas, cada um com o seu ícone, alinhados com o número do pedido.',
      },
      {
        tag: 'melhoria',
        text: 'PDV, modo Completo: os itens vêm um por linha (quantidade, nome e valor), com os complementos e a observação do item logo embaixo do nome; a observação do pedido aparece num quadro âmbar. Pedidos grandes mostram os 6 primeiros e "+ N itens".',
      },
      {
        tag: 'melhoria',
        text: 'PDV, modo Completo: rodapé com o total em destaque, o próximo passo ao lado, a situação do pagamento com bolinha de cor e a forma escolhida (Pix, Dinheiro…), quanto falta no pago parcial, a taxa de entrega e o troco a levar.',
      },
      {
        tag: 'melhoria',
        text: 'PDV: no tablet deitado, com as colunas estreitas, o cartão Completo se ajusta (some o ícone do tipo e o valor de cada item, o total fica no rodapé). A escolha entre Compacto e Completo fica guardada no aparelho.',
      },
    ],
  },
  {
    version: '0.254.5',
    date: '2026-11-26',
    title: 'Aviso de impressão não trava mais o pedido',
    summary:
      'O aviso "Nenhum agente de impressão ativo" que aparecia no pedido aberto não respondia ao toque e parecia preso na tela. Agora fecha no X, leva para Impressão e some sozinho.',
    notes: [
      {
        tag: 'correção',
        text: 'Pedido aberto (e outras janelas): os avisos de erro com o que fazer, como "Nenhum agente de impressão ativo", agora respondem ao toque. O X fecha e "Configurar impressão" abre a tela certa; antes o aviso ficava por cima da janela sem responder.',
      },
      {
        tag: 'correção',
        text: 'Tocar várias vezes em Imprimir cozinha sem impressora mostra um aviso só, que some sozinho em alguns segundos, e a área em volta do aviso não segura mais o clique (Fechar conta e os outros botões seguem funcionando).',
      },
    ],
  },
  {
    version: '0.254.4',
    date: '2026-11-26',
    title: 'Item voando para a sacola mais bonito, no celular, tablet e notebook',
    summary:
      'Ao adicionar um item no cardápio online, a foto vira uma bolinha, voa em arco até a sacola e a sacola recebe com um pulo e um anel de cor.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cardápio online: ao adicionar um item, a foto vira uma bolinha com sombra, dá um pulinho e voa em arco até a sacola que está à vista (pílula embaixo no celular, barra do topo no tablet, sacola ao lado no notebook), encolhendo até caber nela. O tempo do voo acompanha a distância e fica sempre rápido.',
      },
      {
        tag: 'melhoria',
        text: 'A sacola recebe o item com um pulo de mola e um anel de cor, e o número de itens aparece com um pulinho. O botão "+" do cartão gira ao adicionar direto.',
      },
      {
        tag: 'melhoria',
        text: 'Adicionando pela tela do item com a foto já rolada para fora da tela, a bolinha sai do botão Adicionar. Muitos toques seguidos não enchem a tela de bolinhas, e quem pede menos movimento no aparelho vê só a sacola atualizar.',
      },
    ],
  },
  {
    version: '0.254.3',
    date: '2026-11-26',
    title: 'Itens do pedido mais bonitos e alinhados na Nova venda',
    summary:
      'Na Nova venda, a lista de itens do pedido ficou mais limpa e alinhada, e se arruma sozinha no notebook, no tablet deitado e no tablet em pé.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Nova venda: título, colunas e itens começam no mesmo recuo, os valores (Unitário e Total) ficam alinhados à direita e a quantidade virou um controle só (− 1 +). O topo da lista mostra quantos itens há e o subtotal.',
      },
      {
        tag: 'melhoria',
        text: 'Nova venda: os complementos e a observação ficam logo embaixo do nome do produto, no lugar da coluna Complementos que sobrava vazia no meio da lista.',
      },
      {
        tag: 'melhoria',
        text: 'Nova venda no tablet: com a lista mais estreita a coluna Unitário sai e o preço de cada um aparece embaixo do total (ex.: 2 × R$ 38,50); no tablet em pé e no celular cada item vira um bloco com o nome em cima e a quantidade e o total embaixo, com botões maiores para o toque.',
      },
    ],
  },
  {
    version: '0.254.2',
    date: '2026-11-26',
    title: 'Fotos na Nova venda pelo iPhone e tela que se ajusta ao notebook e ao zoom',
    summary:
      'As fotos dos produtos voltam a aparecer na Nova venda no Safari (iPhone e Mac), e a tela se arruma sozinha no notebook e com o zoom do navegador.',
    notes: [
      {
        tag: 'correção',
        text: 'Nova venda no iPhone (e no Safari do Mac): os cartões dos produtos apareciam só com o nome e o preço, sem a foto. A caixa da foto ficava com altura zero no Safari; agora a foto aparece em todos os navegadores.',
      },
      {
        tag: 'melhoria',
        text: 'Nova venda no notebook: em tela baixa o cabeçalho fica numa linha, a busca e as categorias ficam lado a lado e a foto fica um pouco mais deitada, para caberem duas fileiras de produtos e ainda os itens do pedido.',
      },
      {
        tag: 'melhoria',
        text: 'Nova venda com zoom do navegador: aumentando ou diminuindo o zoom, a tela se reorganiza (mais ou menos produtos por fileira, painel da direita proporcional e, com zoom alto, o mesmo jeito do celular) em vez de cortar ou espremer as fotos.',
      },
    ],
  },
  {
    version: '0.254.1',
    date: '2026-11-25',
    title: 'Nova venda mais larga, sacola sem repetir e link bonito no WhatsApp',
    summary:
      'A Nova venda ocupa quase a tela toda, com as fotos dos produtos maiores que a lista de itens e o nome e o preço fáceis de ler. No cardápio, a barra da sacola não repete mais o ícone a cada item, e o link da loja mandado no WhatsApp mostra a capa deitada em vez da logo enorme.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Nova venda: a janela usa quase toda a largura da tela e a grade de produtos fica com dois terços da altura, sempre maior que os itens do pedido. Cada produto é um cartão com a foto grande em cima e, embaixo, o nome em até duas linhas e o preço em destaque, sem nada escrito por cima da foto.',
      },
      {
        tag: 'correção',
        text: 'Cardápio do cliente: ao adicionar itens, a barra Ver sacola (e a sacola do topo e do lado) mostrava o ícone repetido, com números como 1, 2, 2, parecendo itens em dobro. Agora aparece uma sacola só com a quantidade certa. A sacola em si nunca teve itens duplicados.',
      },
      {
        tag: 'melhoria',
        text: 'Link do cardápio no WhatsApp: a prévia mostra a capa da loja num cartão largo (sem capa, a logo) e informa o tamanho da imagem, no lugar da logo quadrada enorme com os cantos brancos. O link de um produto segue com a foto dele. Links já mandados podem levar um tempo para trocar, porque o WhatsApp guarda a prévia.',
      },
      {
        tag: 'correção',
        text: 'Estoque: produção lançada entre 21h e meia-noite gravava o lote como feito no dia seguinte (pelo horário de Londres), ficando com um dia a menos de validade. Agora vale o dia do restaurante, como nas entradas.',
      },
    ],
  },
  {
    version: '0.254.0',
    date: '2026-11-25',
    title: 'Cardápio sem piscar e animações mais certinhas',
    summary:
      'Voltar do item para o cardápio não faz mais as fotos e os cartões sumirem e voltarem, nada fica pulsando de um jeito que esmaece a tela do iPhone, e a sacola pula na hora em que o item chega nela.',
    notes: [
      {
        tag: 'correção',
        text: 'Cardápio do cliente: foto que já apareceu volta na hora, sem o fade de novo, e os cartões e banners só entram com efeito na primeira vez. Voltar do item, buscar e filtrar não piscam mais o cardápio.',
      },
      {
        tag: 'correção',
        text: 'Bolinhas e anéis que pulsam (Aberto agora, pedido em andamento, procurando a mesa, passo da vez), o carimbo da fidelidade, o calendário da reserva e o vapor do garçom agora se mexem sem mexer na transparência, que fazia a tela do iPhone esmaecer e voltar.',
      },
      {
        tag: 'melhoria',
        text: 'Adicionar à sacola: a sacola pula quando a foto chega nela (antes pulava um pouco depois) e o total dá um pulinho junto, na pílula, na barra do topo e na do lado.',
      },
      {
        tag: 'melhoria',
        text: 'Coração dos favoritos pula só no toque (antes pulava em todos de uma vez ao abrir a lista). No cadastro do cardápio, os interruptores de ligar e desligar seguem a mola do sistema e afundam ao segurar.',
      },
    ],
  },
  {
    version: '0.253.0',
    date: '2026-11-25',
    title: 'Site novo: cardápio de dar fome, prato em 3D de verdade e lanchonete para testar',
    summary:
      'O site do Comandou ficou mais bonito e mais vivo: títulos com o efeito Shuffle, o celular do topo com o cardápio e as fotos da Fumaça Burger, o prato em 3D feito da própria foto, a criação do restaurante numa tela própria com a loja nascendo e a lanchonete de demonstração, onde dá para pedir como cliente e ver o pedido chegar na cozinha.',
    notes: [
      {
        tag: 'novo',
        text: 'Lanchonete de demonstração no site (comandou.com/demo): cardápio com fotos de verdade, escolhas obrigatórias, sacola, entrega ou retirada e pagamento, e ao lado a cozinha recebendo o pedido. Aceitar, pronto e despachar andam sozinhos ou no toque, e o cliente acompanha. No celular, as abas Cliente e Cozinha. Nada é cobrado nem gravado.',
      },
      {
        tag: 'novo',
        text: 'Prato em 3D com foto real: a foto do prato ganha profundidade e gira com o mouse ou com o dedo, num estúdio escuro. Dá para trocar entre Clássico, Combo Fumaça, Batata frita e Chopp.',
      },
      {
        tag: 'melhoria',
        text: 'Criar o restaurante pelo site: os dados abrem numa tela própria com a prévia do endereço enquanto digita, avisos no próprio campo e, ao criar, a loja nascendo ao lado (endereço, capa e os módulos acendendo um a um) até mostrar o login.',
      },
      {
        tag: 'melhoria',
        text: 'Topo do site: o título troca entre restaurante, lanchonete, pizzaria e bar com o efeito Shuffle (React Bits), o celular mostra o cardápio da Fumaça Burger com destaques em foto grande e as vendas do dia rolam como contador.',
      },
      {
        tag: 'melhoria',
        text: 'Títulos das seções, nomes dos aplicativos e o preço com movimento leve; tudo pensado também para o celular e parado para quem pede menos movimento no aparelho.',
      },
    ],
  },
  {
    version: '0.252.0',
    date: '2026-11-25',
    title: 'Foto melhorada pela IA e 3D feito pela própria foto do item',
    summary:
      'No cadastro do item, "Melhorar a foto" deixa a foto mais bonita sem mudar o prato, e o 3D agora sai da própria foto: a IA lê a forma e o Comandou monta o modelo, sem aplicativo de fora. O Super Admin liga, desliga e escolhe os modelos (os mais baratos), e tudo desconta dos tokens do restaurante.',
    notes: [
      {
        tag: 'novo',
        text: 'Melhorar a foto: a IA olha a foto do item e sugere um retoque leve de luz, cor e corte, com dicas para a próxima foto. Dá para comparar antes e depois arrastando a linha, mudar a força e, se quiser, pedir a mesma foto com fundo limpo.',
      },
      {
        tag: 'novo',
        text: 'Item em 3D pela foto: usa a foto do item (ou tire uma na hora), a IA lê se é prato, tigela, copo ou lanche e o tamanho, e o Comandou monta o 3D com a própria foto. Gira na tela antes de publicar; se ficar estranho, ajuste a forma e monte de novo sem gastar IA.',
      },
      {
        tag: 'melhoria',
        text: 'A lista de aplicativos e sites para escanear saiu do cadastro do item. Quem já tem o arquivo .glb ou .usdz ainda envia em "Já tem o arquivo 3D?".',
      },
      {
        tag: 'novo',
        text: 'Super Admin › Tokens: seção "Fotos e 3D do cardápio" para ligar cada função e escolher o modelo que olha a foto e o que refaz o fundo. O uso aparece no extrato com nome próprio.',
      },
    ],
  },
  {
    version: '0.251.0',
    date: '2026-11-25',
    title: 'Conversa mais suave, reservas no cadastro do cliente e estoque certinho',
    summary:
      'A mensagem enviada entra sem piscar, o pedido citado na conversa do cardápio abre com um toque, a reserva pode ser lançada no cadastro do cliente (e ele acompanha pela conta), a foto do cliente aparece no topo do cardápio e o estoque passou a contar cancelamentos, datas e descartes do jeito certo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Conversa do cardápio: tocar no pedido citado (na mensagem, no campo de escrever ou na lista de pedidos do lado) abre o acompanhamento daquele pedido.',
      },
      {
        tag: 'correção',
        text: 'Enviar mensagem não pisca mais: o botão fica laranja enquanto o aviãozinho voa, a mensagem nova entra deslizando e as de cima sobem junto, sem salto. A foto enviada não recarrega e o nome de quem mandou não muda depois de salvar. Vale no cardápio, no Suporte, em Clientes e no chat da equipe.',
      },
      {
        tag: 'correção',
        text: 'Cardápio no celular: com a conta aberta, a foto do cliente aparece no botão do topo da tela inicial.',
      },
      {
        tag: 'novo',
        text: 'Reservas: na Nova reserva dá para escolher um cliente já cadastrado. A reserva aparece na conta dele no cardápio (Conta › Reservas), onde ele acompanha e cancela. O cartão mostra "acompanha pelo app".',
      },
      {
        tag: 'melhoria',
        text: 'Reservas: cancelar pede o motivo no próprio cartão, sem a janela do navegador; e o cliente confirma o cancelamento na tela da reserva.',
      },
      {
        tag: 'correção',
        text: 'Estoque: o consumo por dia desconta as vendas canceladas; item com saldo negativo não soma valor negativo no total; datas de entrada, lote, produção e o filtro de movimentações seguem o fuso do restaurante (não viram o dia seguinte depois das 21h).',
      },
      {
        tag: 'melhoria',
        text: 'Estoque › Lotes: ao descartar, dá para dizer quanto foi para o lixo (antes ia o lote inteiro).',
      },
      {
        tag: 'melhoria',
        text: 'Segurar e arrastar o mouse não seleciona mais a tela toda. Campos, mensagens das conversas e códigos continuam selecionáveis para copiar.',
      },
    ],
  },
  {
    version: '0.250.0',
    date: '2026-11-25',
    title: 'Mais proteção: lojas de aplicativo, cadastro, PIN e suporte',
    summary:
      'Fechamos os pontos altos e médios da varredura de segurança: loja de aplicativo ligada só pelo código passa pela aprovação do Comandou, o cadastro do cliente confirma o celular pelo WhatsApp, o PIN da equipe tem 6 números e trava por aparelho, o Pix com comprovante só é pago depois do pedido existir, e o acesso de suporte não mexe mais em senhas nem cria donos.',
    notes: [
      {
        tag: 'segurança',
        text: 'Loja da Keeta, 99Food, Rappi, outros Open Delivery e iFood centralizado, ligada só pelo código, fica "aguardando aprovação" até o Super Admin conferir que é do restaurante (Super Admin › Aplicativos de delivery). Até lá, nada acontece com ela. aiqfome e iFood com código no portal seguem liberados na hora.',
      },
      {
        tag: 'segurança',
        text: 'Cadastro do cliente no cardápio: com o WhatsApp da loja ligado, a conta só é criada com o código que chega no celular. Sem WhatsApp, segue como antes.',
      },
      {
        tag: 'segurança',
        text: 'PIN da equipe: os novos têm 6 números. PINs errados travam só o aparelho que errou; um aparelho que nunca entrou não trava mais a equipe toda. Os PINs de 4 números de antes continuam entrando até o gerente gerar outro.',
      },
      {
        tag: 'segurança',
        text: 'Acesso de suporte: não troca senha, PIN nem e-mail de login, não cria acesso da equipe nem dono novo, e termina em no máximo 2 horas.',
      },
      {
        tag: 'segurança',
        text: 'Trocar a senha encerra as sessões da conta nos outros restaurantes também.',
      },
      {
        tag: 'melhoria',
        text: 'Pix com comprovante no cardápio online: o pedido é enviado primeiro e o comprovante vai no acompanhamento. Loja fechada ou item esgotado não deixam mais o cliente pagar por um pedido que não existe.',
      },
      {
        tag: 'melhoria',
        text: 'Pagamento do app que chega com o pedido já pago ou mais barato: a diferença volta sozinha pelo PagBank. Estorno do PagBank que deu certo, mas sem registro no caixa, aparece no histórico do pedido.',
      },
      {
        tag: 'melhoria',
        text: 'Assunto do e-mail guardado sem códigos nem números na fila de envio, e ação repetida do modo offline que chega duas vezes ao mesmo tempo só é feita uma vez.',
      },
      {
        tag: 'correção',
        text: 'Taxa de entrega: o pino muito longe do endereço digitado não escolhe mais a área. Cancelar ou editar item mantém o acréscimo zerado à mão e não cobra taxa na retirada.',
      },
    ],
  },
  {
    version: '0.249.0',
    date: '2026-11-25',
    title: 'Chat no jeito do WhatsApp e Mural com comentários',
    summary:
      'Todas as conversas viraram balões dos dois lados, como no WhatsApp: as suas à direita, na cor da loja, as dos outros à esquerda, na largura toda da conversa. Mandar ficou instantâneo, emojis sozinhos aparecem grandes e o Mural virou a rede social da equipe, com reações e comentários.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Chat da equipe (conversas, grupos e canais) em balões: nome e avatar na cor da pessoa em grupo, hora e risquinhos dentro do balão, reações numa pílula embaixo, resposta citada que leva até a mensagem e botão para descer quando chega mensagem nova.',
      },
      {
        tag: 'melhoria',
        text: 'Envio sem esperar: a mensagem aparece na hora com um efeito suave, dá para mandar várias seguidas (chegam na ordem certa) e, se a internet falhar, ela fica com "Tentar de novo" em vez de sumir.',
      },
      {
        tag: 'melhoria',
        text: 'Emojis: seletor maior com recentes e grupos, e mensagem só de emoji (até 3) aparece grande, sem balão.',
      },
      {
        tag: 'novo',
        text: 'Mural da equipe como rede social: escreva no topo com foto e emoji, reaja e comente cada recado. Quem publicou recebe aviso dos comentários; quem escreveu ou o gestor apaga.',
      },
      {
        tag: 'melhoria',
        text: 'Painel do Chat maior no computador e letra um pouco maior; Avisos numa lista mais limpa.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin › Conversas: a conversa ocupa a tela toda e os dados do restaurante abrem só quando você toca no nome ou no botão do topo. Suporte, Clientes e a conversa do cardápio ganharam os mesmos balões.',
      },
    ],
  },
  {
    version: '0.247.0',
    date: '2026-11-25',
    title: 'Super Admin pelo WhatsApp: menu, varredura e avisos',
    summary:
      'O WhatsApp do painel virou um painel de bolso. Os números cadastrados em Super Admin › WhatsApp › Menu do admin recebem um menu de opções: resumo do sistema, escolher um restaurante e ver visão geral, movimento, varredura completa, equipe, histórico e banco, além de saúde do servidor, backups, bancos e servidores, restaurantes novos e cobrança. Avisos automáticos e o resumo do dia chegam sozinhos.',
    notes: [
      {
        tag: 'novo',
        text: 'WhatsApp do painel: menu do Super Admin. Responda o número da opção ou digite o nome de um restaurante para abrir direto; "r" volta ao último restaurante e "menu" ao começo.',
      },
      {
        tag: 'novo',
        text: 'Varredura de um restaurante pelo WhatsApp: situação, assinatura, donos, banco próprio e último backup, versão, domínios, último pedido, notas com erro, mensagens que não saíram, estoque abaixo do mínimo e computador de impressão desligado, com os problemas primeiro.',
      },
      {
        tag: 'novo',
        text: 'Avisos automáticos (uma vez só por problema): banco, Redis ou gateway fora do ar, serviço de backup parado, backup que falhou ou atrasou, teste de restauração que falhou, disco dos backups quase cheio, restaurante que não terminou de ser criado, banco próprio que não ficou pronto, trabalho de banco ou migração que falhou, assinatura em atraso e restaurante novo. Com o WhatsApp do painel desconectado, os avisos esperam ele voltar.',
      },
      {
        tag: 'novo',
        text: 'Resumo do dia no horário escolhido (horário de Brasília): restaurantes no ar e ativos, novos, assinaturas, receita mensal, pedidos do mês, serviços, último backup e o resultado da varredura geral.',
      },
      {
        tag: 'segurança',
        text: 'O menu só responde aos números cadastrados de um Super Admin ativo. Backup agora, teste de restauração e limpar cache pedem SIM e entram no histórico do painel no nome dele; cadastrar, mudar e tirar números também.',
      },
    ],
  },
  {
    version: '0.246.0',
    date: '2026-11-25',
    title: 'Super Admin: Status com números certos e Credenciais conferidas de verdade',
    summary:
      'A tela Status do Super Admin foi revisada número a número: a migração que terminou bem não aparece mais como serviço com problema, a demonstração não conta como cliente pagante e cada número diz de quantos. Entraram receita por mês, testes grátis, faturas vencidas, atendimento, pedidos e versão nova. Em Credenciais, o botão Conferir todas agora usa cada chave salva no fornecedor e mostra a que foi recusada.',
    notes: [
      {
        tag: 'correção',
        text: 'Status: o serviço de migração (comandou-migrate) roda uma vez e termina; "0 de 1 rodando" depois de terminar bem é o normal e deixou de pintar Containers de vermelho e de virar alerta.',
      },
      {
        tag: 'correção',
        text: 'Status: a demonstração (Fumaça) não conta mais como assinatura ativa, receita nem pedidos; quem foi para outra instalação ou está sendo excluído também não.',
      },
      {
        tag: 'correção',
        text: 'Status: "WhatsApp ok" na Saúde agora se chama Serviço do WhatsApp e diz quantos restaurantes estão conectados e se o seu número do painel está conectado, em vez de parecer que estava tudo certo com 0 conectados.',
      },
      {
        tag: 'correção',
        text: 'Status: a fila de tarefas aparece em português ("81 feitas", "2 com falha") e tarefa com falha vira aviso; as falhas de 7 dias e o uso são lidos no banco de cada restaurante, sem contar restos do banco central.',
      },
      {
        tag: 'novo',
        text: 'Status: seção Negócio com receita por mês, recebido no mês e vencido, testes grátis acabando, clientes novos e cancelados em 30 dias, pedidos do mês e atendimento (conversas esperando e chamados com você).',
      },
      {
        tag: 'melhoria',
        text: 'Status: "Pede atenção" no topo junta tudo o que precisa de você, do mais grave ao menos (sites fora do ar, backup, credenciais faltando, WhatsApp do painel desconectado, faturas vencidas, testes acabados, chamados esperando, versão nova), e cada linha leva à tela que resolve.',
      },
      {
        tag: 'novo',
        text: 'Credenciais: botão Conferir todas agora. Usa cada chave salva no próprio fornecedor sem cobrar nem enviar nada (Focus, OpenRouter, Resend com o domínio do remetente, Asaas, PagBank, Backblaze, GitHub) e marca no cartão a que foi recusada e o motivo.',
      },
      {
        tag: 'melhoria',
        text: 'Credenciais: a situação separa as necessárias das opcionais. Antes o "8 de 26" misturava os seis aplicativos de delivery e outras chaves que você não usa.',
      },
      {
        tag: 'correção',
        text: 'Credenciais: salvar a credencial de um aplicativo de delivery sem redigitar o segredo do webhook mantém o salvo. Antes ele era apagado e a Rappi passava a recusar os pedidos.',
      },
    ],
  },
  {
    version: '0.245.3',
    date: '2026-11-25',
    title: 'Varredura: cobrança em dobro, sessão vencida e mais 25 correções',
    summary:
      'Uma revisão de ponta a ponta do sistema, das telas da equipe ao cardápio do cliente e à API. O principal: o caixa não deixa mais cobrar um pedido que o cliente está pagando (ou já pagou) pelo app, a sessão vencida leva direto ao login e o comprovante do Pix precisa bater com o total.',
    notes: [
      {
        tag: 'correção',
        text: 'Caixa: receber no balcão um pedido com Pix ou cartão do app esperando (ou pago e ainda fora do caixa) é recusado com o motivo. Antes o cliente podia pagar duas vezes e o valor do app ficava preso sem devolução.',
      },
      {
        tag: 'correção',
        text: 'Salão: ligar ou tirar a taxa de serviço da mesa não mexe mais em pedidos já concluídos e pagos, em fiado e a receber nem em retirada.',
      },
      {
        tag: 'correção',
        text: 'Cardápio: o comprovante do Pix anexado sai sozinho se o total mudar depois (sacola, recompensa ou taxa de entrega), e o cliente paga o código novo.',
      },
      {
        tag: 'correção',
        text: 'Sessão terminada no meio do uso (venceu, conta desligada) volta para o login, em vez de cada tela mostrar "Sessão inválida" e a fila sem internet ficar parada.',
      },
      {
        tag: 'correção',
        text: 'Detalhe do pedido: abrir um pedido logo depois de outro não mostra mais o anterior quando a rede está lenta (Receber e Cancelar agiam no pedido errado).',
      },
      {
        tag: 'correção',
        text: 'Nova venda e app do garçom: o cardápio se atualiza sozinho quando um item esgota ou muda de preço, e o aviso "já foi registrado com outros dados" não trava mais os envios seguintes.',
      },
      {
        tag: 'correção',
        text: 'Entregas: o código do cliente aceita no máximo 5 tentativas mesmo com toques ao mesmo tempo, e o GPS fraco não pede mais para mexer na permissão.',
      },
      {
        tag: 'correção',
        text: 'Fidelidade: dois vencimentos de pontos ao mesmo tempo não deixam mais o saldo negativo.',
      },
      {
        tag: 'correção',
        text: 'Equipe › Pagamentos: tablet ou celular só aberto não conta mais dia de trabalho; conta quando a pessoa faz algo no sistema.',
      },
      {
        tag: 'correção',
        text: 'Reservas pelo WhatsApp acham a reserva mesmo quando o número vem sem o 9, e o limite de 3 reservas em aberto vale também por conta.',
      },
      {
        tag: 'correção',
        text: 'Cozinha: trocar de setor não traz de volta o quadro do anterior, e o pedido avisa a situação certa depois de marcar item pronto.',
      },
      {
        tag: 'correção',
        text: 'Estoque: salvar de novo um insumo novo cujo saldo inicial falhou não cria um insumo repetido.',
      },
      {
        tag: 'correção',
        text: 'iFood: código de autorização digitado errado não obriga mais a gerar outro no Portal, e um aplicativo lento não atrasa mais o polling dos outros.',
      },
      {
        tag: 'correção',
        text: 'Site: cadastro do teste grátis que não deu certo agora tem "Tentar de novo" e não volta preso ao recarregar.',
      },
      {
        tag: 'correção',
        text: 'Cardápio: dado antigo guardado no aparelho não quebra mais a abertura, o acompanhamento para de consultar quando o pedido termina e Enter no favorito não abre mais o produto.',
      },
      {
        tag: 'segurança',
        text: 'Conversa do cliente com a loja: anexos de clientes nunca apagam arquivos recentes de outras conversas e têm limite diário por restaurante.',
      },
      {
        tag: 'segurança',
        text: 'Acesso de suporte do Comandou: tudo o que é feito nele entra no histórico do restaurante com o nome de quem atendeu.',
      },
      {
        tag: 'segurança',
        text: 'Links de acompanhamento, reserva, assinatura de contrato e teste grátis não aparecem mais inteiros nos logs. Sair da conta no cardápio apaga nome, telefone e CPF do aparelho.',
      },
      {
        tag: 'melhoria',
        text: 'E-mail: o Resend recebe uma chave por e-mail e não manda duas vezes quando a resposta se perde. Busca de endereço com fila cheia responde na hora (o cliente marca no mapa).',
      },
    ],
  },
  {
    version: '0.245.2',
    date: '2026-11-25',
    title: 'Troca de servidor de banco sem derrubar todos',
    summary:
      'No "Mover todos" de Bancos, cada restaurante agora fica fora do ar só durante a própria cópia (antes todos saíam do ar no clique e esperavam a fila inteira). A troca ficou à prova de reinício do serviço de backup e de restaurante em versão anterior, e a tela Status parou de acusar a migração que terminou bem.',
    notes: [
      {
        tag: 'correção',
        text: 'Super Admin › Bancos: "Mover todos" e "Trocar de servidor" tiravam o restaurante do ar já no pedido, e ele ficava sem acesso enquanto esperava a vez na fila (e durante o backup da noite, se coincidisse). Agora ele segue funcionando na fila, aparece como "na fila" e só para durante a própria cópia, como a tela prometia.',
      },
      {
        tag: 'correção',
        text: 'Troca de servidor: um servidor de destino removido ou desativado com a troca na fila deixava o restaurante preso em manutenção. Agora o trabalho falha sem tirar o restaurante do ar.',
      },
      {
        tag: 'correção',
        text: 'Troca de servidor de um restaurante numa versão anterior (versão por restaurante) sempre falhava depois de tirar o restaurante do ar: o banco novo ganhava as migrações da versão nova. Agora o banco novo fica na mesma versão do antigo.',
      },
      {
        tag: 'correção',
        text: 'Serviço de backup reiniciado no meio da troca (numa atualização, por exemplo): o trabalho retoma. Já trocado, só apaga o banco antigo (antes ele ficava esquecido e travava uma volta para aquele servidor); antes da troca, refaz o banco novo que ele mesmo criou.',
      },
      {
        tag: 'correção',
        text: 'Migrar cliente para outra instalação: o restaurante chegava lá com a versão presa daqui, e o migrate de lá pulava o banco dele nas atualizações seguintes. Agora ele acompanha o sistema de lá. Aqui, o cartão automático não cobra mais um restaurante migrado.',
      },
      {
        tag: 'correção',
        text: 'Tela Status: "comandou-migrate: 0/1 rodando" aparecia como alerta e o cartão Servidor contava "1 com problema", mas a migração roda uma vez a cada atualização e sai. Agora a Status usa a mesma regra de Infraestrutura › Servidor; só a migração que falhou vira alerta, com o erro.',
      },
      {
        tag: 'correção',
        text: 'Migrações (comandou-migrate): se a leitura da lista de bancos dos restaurantes falhasse, ele seguia só com o banco central e dizia que tinha dado certo, deixando os restaurantes sem a migração. Agora ele migra o central primeiro, lê a lista com tudo no lugar e, se não conseguir, para com erro.',
      },
      {
        tag: 'correção',
        text: 'Instalação com domínio de final duplo (como comandou.com.br): o endereço principal abria como restaurante em vez do site. Agora ele é reconhecido como site, igual ao comandou.com.',
      },
      {
        tag: 'correção',
        text: 'Trabalhos de banco: o de "Atualizar a versão" de um restaurante aparecia sem nome na aba Banco.',
      },
    ],
  },
  {
    version: '0.245.0',
    date: '2026-11-23',
    title: 'Site novo: mais limpo, com prato em 3D',
    summary:
      'O site do Comandou foi refeito: mais espaço, menos enfeite e três momentos em 3D. O celular da loja e os pedidos flutuam em camadas no topo, a tela do sistema chega deitada e se endireita ao rolar, e o hambúrguer, a batata, o milk-shake e o brownie da demonstração giram de verdade na tela.',
    notes: [
      {
        tag: 'novo',
        text: 'Site: seção Prato em 3D com os modelos de verdade da Fumaça Burger, no mesmo visualizador do cardápio. Arraste para girar e troque o prato embaixo. O visualizador só baixa quando a seção chega perto da tela.',
      },
      {
        tag: 'novo',
        text: 'Site: grade com os 16 módulos do sistema (PDV, salão, mesa pelo QR Code, cozinha, caixa, cardápio online, entregas, aplicativos, estoque, financeiro, nota fiscal, WhatsApp com IA, reservas, equipe, impressão e relatórios).',
      },
      {
        tag: 'melhoria',
        text: 'Site: topo com o celular e os cartões de pedidos em 3D, girando de leve com o mouse; telas do sistema numa moldura que se endireita com a rolagem; três passos, preço e perguntas com linha fina no lugar de cartões.',
      },
      {
        tag: 'melhoria',
        text: 'Site: saíram as faíscas no clique, o botão que segue o mouse, a frase que acende palavra por palavra e a faixa que passa sozinha. A página ficou mais leve e direta.',
      },
    ],
  },
  {
    version: '0.244.2',
    date: '2026-11-23',
    title: 'Sininho de novidades limpa ao abrir',
    summary:
      'Abrir o sininho de novidades agora marca todas como vistas e o número some. Em dias com muitas versões, as mais novas continuavam aparecendo como "nova" (o sininho mostrava 9+ mesmo depois de aberto).',
    notes: [
      {
        tag: 'correção',
        text: 'Sininho de novidades: o aparelho guardava só as últimas 50 versões vistas e, com 70 versões nos últimos 3 dias, apagava justamente as 20 mais novas, que voltavam como "20 novidades novas". Agora guarda todas as que estão no sininho e as recém-vistas nunca são cortadas.',
      },
    ],
  },
  {
    version: '0.244.1',
    date: '2026-11-23',
    title: 'Menu lateral muda num clique',
    summary:
      'O botão ao lado do nome do restaurante não abre mais uma janela: cada clique passa para o próximo jeito do menu (Aberto, Abre com o mouse, Fechado) e só o ícone gira no lugar.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Menu lateral: cada clique no botão do topo troca o jeito, na ordem Aberto → Abre com o mouse → Fechado → Aberto. O ícone mostra o jeito atual e, ao parar o mouse em cima, diz qual vem no próximo clique.',
      },
    ],
  },
  {
    version: '0.244.0',
    date: '2026-11-23',
    title: 'Troco no pedido e acompanhamento sem piscar no iPhone',
    summary:
      'Pedido pago em dinheiro com troco já mostra quanto levar de troco, no cartão do PDV e dentro do pedido. No iPhone, a tela em que o cliente acompanha o pedido parou de ficar mais clara e mais escura sem parar. As buscas ficaram só com "Pesquisar" e o visual ficou mais limpo em várias telas.',
    notes: [
      {
        tag: 'novo',
        text: 'Troco: no pedido em dinheiro com "troco para", o PDV mostra "Troco R$ 47,60" no cartão e "Levar R$ 47,60 de troco" no pedido (troco para R$ 400,00 num pedido de R$ 352,40). O valor também aparece no app do entregador e na mensagem enviada a ele.',
      },
      {
        tag: 'correção',
        text: 'Acompanhamento do pedido no iPhone: a tela inteira ficava mais clara e mais escura sem parar. Enquanto o pedido carregava, aparecia um bloco que pulsava, e o Safari do iPhone continuava pulsando a página toda depois que o pedido chegava. O carregamento agora tem o formato da tela, só com um brilho que passa, e a página do pedido é desenhada do zero quando chega.',
      },
      {
        tag: 'melhoria',
        text: 'Buscas do PDV, Pedidos, Salão, Clientes, Estoque, Financeiro, Reservas, Agenda, conversas e Cardápio mostram só "Pesquisar". O que cada uma encontra aparece ao parar o mouse em cima.',
      },
      {
        tag: 'melhoria',
        text: 'Visual mais limpo: rótulos sem letra maiúscula espaçada (ex.: "Online" nos cartões do PDV), sem faixas coloridas num lado só (Cozinha, Caixa, Entregas, Estoque, chat), números do Estoque numa faixa só, ícones sem quadradinho colorido na Cozinha e na Impressão e carregamentos que não piscam.',
      },
      {
        tag: 'melhoria',
        text: 'No celular, o botão de tema saiu do topo (fica em Conta › Este aparelho) e sobra mais espaço para o nome da tela.',
      },
      {
        tag: 'correção',
        text: 'Novidades no celular: nota com palavra comprida não corta mais o fim do texto.',
      },
    ],
  },
  {
    version: '0.243.1',
    date: '2026-11-23',
    title: 'Minha mesa mais limpa',
    summary:
      'Na aba Minha mesa do cardápio da mesa, o texto sobre fechar a conta e entrar na conta virou dois atalhos com desenho: Fechar a conta e Entrar na conta.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Minha mesa: no lugar dos dois parágrafos, os atalhos Fechar a conta (pedidos da mesa toda) e Entrar na conta (guardar no histórico, só para quem ainda não entrou). A conta sai da impressora dentro da bolinha e o boneco da conta acena, com movimento leve que não esmaece a tela no iPhone.',
      },
    ],
  },
  {
    version: '0.243.0',
    date: '2026-11-23',
    title: 'Conta paga sai do celular e pedido com a conta na mesa',
    summary:
      'Depois que a conta da mesa é paga, o celular do cliente não mostra mais o que foi pedido. E quem está no restaurante pode entrar na própria conta e pedir para a mesa, sem entrega nem retirada, também pelo app instalado, lendo o QR Code da mesa.',
    notes: [
      {
        tag: 'segurança',
        text: 'Conta da mesa paga (Pix aprovado, PagBank ou fechada no caixa): o link do acompanhamento e a aba Minha mesa deixam de mostrar os pedidos assim que cada um termina. Quem pegar o celular depois não vê o que foi pedido. O que ainda está na cozinha segue no acompanhamento até sair.',
      },
      {
        tag: 'novo',
        text: 'Entrar na conta no cardápio da mesa: botão no topo e "Tem conta? Entrar" na finalização. O pedido vai para a mesa no nome do cliente e fica no histórico da conta dele, mesmo depois que a conta da mesa é paga. Na mesa não aparecem entrega, retirada nem endereços.',
      },
      {
        tag: 'novo',
        text: '"Está no restaurante?" no cardápio online (lojas com mesas cadastradas): o cliente lê o QR Code da mesa pela câmera, dentro do próprio app, e o cardápio vira o da mesa. Serve para quem instalou o app, que não abre pelo QR lido na câmera do celular. QR de outro restaurante não vale.',
      },
      {
        tag: 'melhoria',
        text: 'A lista de pedidos do cardápio online não mistura mais os pedidos feitos na mesa: eles ficam na aba Minha mesa.',
      },
    ],
  },
  {
    version: '0.242.0',
    date: '2026-11-23',
    title: 'Menu lateral do seu jeito e topo mais limpo',
    summary:
      'O menu lateral ganhou três jeitos, escolhidos no botão ao lado do nome do restaurante: aberto, abre com o mouse ou fechado (só os ícones, mesmo com o mouse em cima). Letras e ícones do menu ficaram maiores, e o topo ficou mais limpo: sem versão, sem nome do restaurante e com a busca só com "Pesquisar". Os sons de aviso passaram para a tela Conta.',
    notes: [
      {
        tag: 'novo',
        text: 'Menu lateral em três jeitos: Aberto (ícones e nomes sempre à vista), Abre com o mouse (só ícones; encostar o mouse abre por cima da tela) e Fechado (só ícones, o mouse não abre; Cardápio, Estoque e os outros grupos abrem o submenu ao lado). Escolha no botão ao lado do nome do restaurante; no Fechado, encoste o mouse na logo para ele aparecer. O ícone do botão mostra o jeito escolhido, e a escolha fica guardada no aparelho.',
      },
      {
        tag: 'melhoria',
        text: 'Menu lateral com letra e ícones maiores (nomes de 16 px e ícones de 22 px), mais fácil de ler no balcão.',
      },
      {
        tag: 'melhoria',
        text: 'Topo mais limpo: sai o número da versão (continua no pé da tela Conta) e o nome do restaurante (fica no menu aberto). A busca mostra só "Pesquisar" e o atalho Ctrl K.',
      },
      {
        tag: 'melhoria',
        text: 'O botão de som saiu do topo. Volume, repetir até atender, som gravado e o som de cada aviso ficam em Conta › Este aparelho › Sons de aviso. No PDV, o Silenciar continua no mesmo lugar.',
      },
      {
        tag: 'correção',
        text: 'Com o menu recolhido, abrir um grupo (ex.: Cardápio) não faz mais os ícones do menu sumirem.',
      },
    ],
  },
  {
    version: '0.241.1',
    date: '2026-11-23',
    title: 'Desenhos do pedido voltam a se mexer, sem piscar',
    summary:
      'Na tela de acompanhar o pedido, o vapor da panela e da sacola volta a subir e o motoboy volta a andar. Só saiu o que fazia a tela inteira ficar mais fraca e mais forte no iPhone.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Acompanhamento do pedido: os desenhos voltaram a ter movimento (vapor subindo, rodas girando, vento, a sacola do pedido concluído entrando com o visto). O vapor agora sobe desenhando a linha em vez de sumir e aparecer, e nenhum movimento da tela mexe na transparência, que era o que fazia o Safari do iPhone esmaecer a tela toda.',
      },
    ],
  },
  {
    version: '0.241.0',
    date: '2026-11-23',
    title: 'Pedido da mesa com comprovante: só aprovar ou recusar',
    summary:
      'Quando a mesa mandou o comprovante do Pix da conta, o pedido não oferece mais Fechar conta, Desconto ou Vender fiado: a conta já foi paga pelo cliente. Ficam só Recusar Pix e Conferir Pix. Aprovando, a conta da mesa fecha e já aparece o comprovante de fechamento para imprimir, se quiser.',
    notes: [
      {
        tag: 'melhoria',
        text: 'No detalhe do pedido de uma mesa com comprovante esperando, somem Fechar conta, Desconto / Acréscimo, Vender fiado e os passos do pedido. No lugar, Recusar Pix e Conferir Pix com o valor da conta.',
      },
      {
        tag: 'melhoria',
        text: 'Aprovou o Pix (no pedido ou na mesa): a conta fecha e abre o comprovante de fechamento, com Imprimir e Fechar.',
      },
    ],
  },
  {
    version: '0.240.1',
    date: '2026-11-23',
    title: 'Acompanhar o pedido sem piscar',
    summary:
      'A tela em que o cliente acompanha o pedido (Pedido pronto, Na mesa, Em preparo…) ficou parada: no iPhone ela não fica mais apagando e acendendo, com as letras ora mais fortes, ora mais fracas.',
    notes: [
      {
        tag: 'correção',
        text: 'Acompanhamento do pedido no celular do cliente (pedido da mesa e pedido online): os desenhos de cada etapa ficaram parados e nada na tela se mexe sozinho. O movimento do desenho (o vapor subindo e sumindo) fazia o Safari do iPhone esmaecer a tela inteira sem parar. A bolinha verde de "Esta página se atualiza sozinha" continua, e a tela segue se atualizando a cada poucos segundos.',
      },
    ],
  },
  {
    version: '0.240.0',
    date: '2026-11-23',
    title: 'Atalhos nos cartões do Salão no PDV',
    summary:
      'Cada mesa ocupada e cada comanda no Salão do PDV agora mostra o número e o total à esquerda e quatro atalhos à direita: ver os pedidos, mais ações, imprimir a conta e fechar a conta. Um toque e já está na ação certa.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cartões do Salão no PDV com atalhos em 2 × 2: em cima, Ver pedidos (abre a comanda com os pedidos) e os três pontinhos (Renomear, Transferir); embaixo, Imprimir a conta e o $ vermelho para fechar a conta. Com comprovante do Pix esperando, o $ abre a conferência do Pix.',
      },
    ],
  },
  {
    version: '0.239.0',
    date: '2026-11-23',
    title: 'Aprovar o Pix da mesa fecha a conta',
    summary:
      'Aprovou o comprovante do Pix da conta da mesa, a conta fecha na hora e a mesa fica livre: o cliente já pagou e pode ir embora. O Pix entra no caixa aberto e vai para o Financeiro junto com o fechamento do caixa. E o comprovante continua guardado no pedido e na comanda para rever depois.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Aprovar o comprovante do Pix da conta inteira fecha a conta da mesa na hora. Pedidos prontos são concluídos; o que ainda está na cozinha segue até sair, já pago, sem prender a mesa.',
      },
      {
        tag: 'novo',
        text: 'No detalhe do pedido e na comanda, a parte Comprovante do Pix da conta mostra cada comprovante que a mesa mandou (aprovado ou recusado, quem conferiu e quando). Tocar abre o comprovante grande, com Baixar.',
      },
    ],
  },
  {
    version: '0.238.0',
    date: '2026-11-23',
    title: 'Comprovante do Pix aparece na mesa',
    summary:
      'Quando o cliente manda o comprovante do Pix da conta pelo celular, a mesa avisa no Salão e no PDV, e ao abrir a mesa o comprovante já aparece lá dentro, com Recusar e Conferir e aprovar. Assim ninguém deixa o cliente esperando para sair.',
    notes: [
      {
        tag: 'novo',
        text: 'No Salão, a mesa fica verde com o selo Pix enquanto o comprovante espera. No PDV, o cartão da mesa (e da comanda) ganha contorno verde e a linha Pix para conferir.',
      },
      {
        tag: 'novo',
        text: 'Dentro da mesa, um quadro no alto mostra a foto do comprovante, o valor e há quanto tempo chegou, com Recusar e Conferir e aprovar. O botão principal do rodapé vira Conferir Pix.',
      },
      {
        tag: 'melhoria',
        text: 'No PDV, o botão de fechar a conta de uma mesa com comprovante esperando abre direto a conferência do Pix.',
      },
    ],
  },
  {
    version: '0.237.0',
    date: '2026-11-23',
    title: 'QR Code das mesas com a cara do restaurante',
    summary:
      'Os QR Codes das mesas viraram cartões prontos para imprimir: com a logo, o nome e a cor do restaurante, o número da mesa em destaque, desenhos de comida no fundo e o convite para o cliente apontar a câmera. São três estilos e dois tamanhos, e o código continua lendo de primeira.',
    notes: [
      {
        tag: 'novo',
        text: 'Salão › QR das mesas: três estilos de cartão. Moderno (branco, código na cor da casa e desenhos clarinhos de comida), Colorido (cartão inteiro na cor da casa) e Clássico (preto no branco, gasta pouca tinta).',
      },
      {
        tag: 'novo',
        text: 'O código tem bolinhas e cantos arredondados na cor do restaurante e a logo da Loja online no meio, que pode ser tirada. Com a logo, o código usa a correção de erro mais alta, então lê mesmo com o meio coberto.',
      },
      {
        tag: 'melhoria',
        text: 'Escolha 4 cartões grandes ou 9 pequenos por folha A4. O estilo e o tamanho escolhidos ficam lembrados neste aparelho.',
      },
    ],
  },
  {
    version: '0.236.1',
    date: '2026-11-23',
    title: 'Funcionamento mais organizado no notebook',
    summary:
      'Na Loja online › Funcionamento, os liga/desliga ficaram agrupados por assunto, com o botão colado no nome e uma frase dizendo o que cada um faz. Fica mais fácil de ler no notebook, mesmo com a prévia do celular ao lado.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Pedidos pelo cardápio em dois grupos: Loja (cardápio ligado, loja aberta, aceitar pedidos automaticamente) e Como o cliente recebe (entrega e retirada), cada um com uma linha explicando.',
      },
      {
        tag: 'melhoria',
        text: 'O liga/desliga agora fica do lado esquerdo do nome, e não lá no fim da linha. Vale também no horário de funcionamento e no Pedido pela mesa, que ficou em duas colunas.',
      },
    ],
  },
  {
    version: '0.236.0',
    date: '2026-11-23',
    title: 'Conta da mesa paga pelo PagBank',
    summary:
      'Fechar a conta pelo celular agora segue as formas que a loja liberou: com o PagBank conectado, o cliente da mesa paga a conta inteira no Pix que confirma sozinho ou no cartão de crédito, sem precisar entrar numa conta. O valor entra no caixa nos pedidos da mesa e, sem nada em preparo, a mesa fica livre.',
    notes: [
      {
        tag: 'novo',
        text: 'Conta da mesa pelo PagBank: Pix automático (sem comprovante) e cartão de crédito para a mesa inteira, com nome, CPF e e-mail de quem paga, que vão só para o PagBank.',
      },
      {
        tag: 'novo',
        text: 'Pago, o valor entra no caixa como Pix ou crédito nos pedidos da comanda, do mais antigo ao mais novo, e a mesa fecha sozinha quando tudo já saiu da cozinha. Sem caixa aberto, entra quando um caixa abrir.',
      },
      {
        tag: 'melhoria',
        text: 'Como no cardápio online, o Pix do PagBank fica no lugar do Pix com comprovante. Sem PagBank, a conta da mesa segue com o Pix da loja e o comprovante.',
      },
      {
        tag: 'melhoria',
        text: 'Enquanto a mesa está pagando pelo PagBank, o caixa e o garçom não conseguem cobrar a comanda de outro jeito. O Pix vale 10 minutos e o cliente pode tocar em "Pagar de outro jeito".',
      },
      {
        tag: 'melhoria',
        text: 'Se a conta mudou enquanto o cliente olhava a tela, nada é cobrado e o valor novo aparece. Item cancelado enquanto ele pagava: entra o saldo e a sobra volta sozinha pelo PagBank.',
      },
      {
        tag: 'segurança',
        text: 'Pix pago depois que a mesa já pagou com o garçom (aviso atrasado do banco) é devolvido sozinho, e o estorno no caixa de um pagamento da conta da mesa vai ao PagBank antes.',
      },
    ],
  },
  {
    version: '0.235.0',
    date: '2026-11-22',
    title: 'Mesa chama o garçom e fecha a conta pelo celular',
    summary:
      'No cardápio do QR Code da mesa entrou a aba Garçom, com dois botões: chamar o garçom e fechar a conta. O chamado aparece no PDV, no Salão e no app do garçom; a conta pode ser paga pelo Pix da loja, com o comprovante que o caixa confere. O pedido pela mesa agora pede o CPF.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápio da mesa: aba Garçom no meio, com "Chamar o garçom" e "Fechar a conta". O cliente vê há quanto tempo chamou e pode cancelar.',
      },
      {
        tag: 'novo',
        text: 'Mesa chamando aparece no topo do sistema (PDV, Salão, Pedidos) e do app do garçom, com som e o botão Atender.',
      },
      {
        tag: 'novo',
        text: 'Fechar a conta pelo celular: o cliente vê os itens e o saldo da mesa inteira (pedidos do garçom e de outros celulares também), paga pelo Pix da loja e manda o print ou o PDF do comprovante.',
      },
      {
        tag: 'novo',
        text: 'O caixa confere o comprovante (Conferir, no topo da tela): aprovado, o Pix entra no caixa nos pedidos da mesa e, com tudo servido, a mesa fica livre; recusado, o cliente vê o motivo e manda outro. Enquanto o comprovante espera, a mesa não é cobrada de novo.',
      },
      {
        tag: 'novo',
        text: 'Sem Pix ligado (ou se o cliente preferir cartão ou dinheiro), "Pagar com o garçom" chama o garçom para receber.',
      },
      {
        tag: 'melhoria',
        text: 'O pedido pelo QR Code da mesa pede o CPF do cliente, que vai para a nota fiscal da conta.',
      },
    ],
  },
  {
    version: '0.234.0',
    date: '2026-11-22',
    title: 'Pagamento da equipe e perfil do garçom',
    summary:
      'A Equipe virou cartões com o ícone da função de cada pessoa e ganhou o botão Pagamentos: quanto cada um tem a receber, quanto já recebeu e o pagamento que cai sempre no Financeiro. O garçom ganhou a aba Perfil, com quanto vai receber, e os Desafios passaram para a Conta.',
    notes: [
      {
        tag: 'novo',
        text: 'Equipe › Pagamentos: cadastre como cada pessoa ganha (salário do mês, diária, comissão sobre as vendas e parte da taxa de serviço dos pedidos que ela lançou) e veja quanto ela tem a receber agora, quanto recebeu no mês e no total.',
      },
      {
        tag: 'novo',
        text: 'Pagar alguém lança na hora em Financeiro › Salários, como conta paga ou agendada para um dia. O mesmo período não é pago duas vezes, e cancelar o lançamento agendado no Financeiro reabre o período.',
      },
      {
        tag: 'novo',
        text: 'As diárias contam sozinhas os dias em que a pessoa entrou no sistema; ao pagar, dá para corrigir o número de dias e lançar bônus ou vale.',
      },
      {
        tag: 'melhoria',
        text: 'Equipe em cartões, no computador e no celular, com o ícone e a cor da função de cada pessoa (garçom, cozinha, caixa, balcão, entregador, gerente e administrador) e quanto ela tem a receber.',
      },
      {
        tag: 'novo',
        text: 'App do garçom: aba Perfil com quanto vai receber desde o último pagamento, a conta linha a linha, os números do mês, os dias trabalhados e os pagamentos recebidos.',
      },
      {
        tag: 'melhoria',
        text: 'App do garçom: Desafios saíram das abas de baixo e ficam dentro da Conta (e no menu lateral, no tablet).',
      },
    ],
  },
  {
    version: '0.233.4',
    date: '2026-11-22',
    title: 'Busca do Salão maior',
    summary:
      'A barra de busca do Salão ficou maior e mais fácil de achar: ocupa o espaço ao lado dos filtros, com contorno e letra mais fortes.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Busca do Salão (mesas, comandas, delivery e para levar) mais larga e mais alta, com contorno, ícone e texto mais visíveis, também no tema escuro.',
      },
    ],
  },
  {
    version: '0.233.3',
    date: '2026-11-22',
    title: 'Pedido sem o botão "A receber"',
    summary:
      'O botão "A receber" saiu das ações do pedido: ele fazia praticamente o mesmo que o "Vender fiado", que continua lá.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Saiu a ação "A receber" (Concluir a receber) do detalhe do pedido. Para deixar a conta para depois, use "Vender fiado". Pedidos que já foram concluídos a receber continuam aparecendo como antes.',
      },
    ],
  },
  {
    version: '0.233.2',
    date: '2026-11-22',
    title: 'Fechar conta sem aviso por cima dos botões',
    summary:
      'Ao fechar a conta, o aviso verde "Conta fechada" aparecia em cima dos botões Imprimir e Concluir. Ele saiu: o próprio painel já mostra que a conta foi fechada e o troco.',
    notes: [
      {
        tag: 'correção',
        text: 'Fechar conta não mostra mais o aviso flutuante que cobria os botões do rodapé, principalmente em telas de notebook.',
      },
      {
        tag: 'melhoria',
        text: 'Depois de fechar, o rodapé do painel mostra o troco (no lugar do "Recebendo: R$ 0,00") e o aviso dentro do painel diz "Conta fechada. Troco: …".',
      },
    ],
  },
  {
    version: '0.233.1',
    date: '2026-11-22',
    title: 'Topo do sistema mais limpo',
    summary:
      'O botãozinho de tela cheia que ficava em cima da busca saiu, e com o menu aberto o nome do restaurante aparece uma vez só, ao lado do logo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Saiu a abinha "Tela cheia" do meio do topo, no sistema e no Super Admin. A Cozinha continua com o próprio botão de tela cheia, e o F11 do navegador segue funcionando.',
      },
      {
        tag: 'melhoria',
        text: 'Com o menu lateral aberto, o topo mostra só a versão: o nome do restaurante fica ao lado do logo. Com o menu recolhido, o nome volta para o topo.',
      },
    ],
  },
  {
    version: '0.233.0',
    date: '2026-11-22',
    title: 'IA que monta o papel da impressora',
    summary:
      'Na tela Impressão, a conversa com a IA agora fica no canto da tela: você diz como quer a conferência, a via de entrega, a comanda da cozinha ou o rodapé do cupom, e ela muda o modelo, com a prévia ao lado antes de salvar.',
    notes: [
      {
        tag: 'novo',
        text: 'Impressão: botão "Montar o papel com IA" no canto da tela (e "Montar com IA" nos Modelos de impressão). A conversa segue o papel aberto no editor, guarda uma conversa por papel e a mudança entra no editor com a prévia e o Desfazer. Salvar continua com você.',
      },
      {
        tag: 'melhoria',
        text: 'A IA conhece os pedidos mais comuns dos restaurantes (nome, número e total em letra grande, observação em destaque, itens grandes na cozinha, tirar os preços, Wi-Fi, Instagram, valor a cobrar na entrega, sugestão de 10% e mais), cada um já testado na bobina de 42 colunas.',
      },
      {
        tag: 'correção',
        text: 'Quando a IA está desligada, a conversa não some mais da tela: ela abre e diz o porquê (chave do OpenRouter não cadastrada, IA desligada para o restaurante ou limite do mês).',
      },
    ],
  },
  {
    version: '0.232.0',
    date: '2026-11-22',
    title: 'Fila de impressão igual à do computador',
    summary:
      'A fila da tela Impressão passou a mostrar o que está parado na fila do Windows do computador da impressora, na hora. Impressora desligada não acumula mais comandas para despejar quando volta, e o que espera demais vence. O aplicativo Comandou Impressão (1.12.0) cabe na tela sem rolar.',
    notes: [
      {
        tag: 'correção',
        text: 'Impressora desligada: o aplicativo não manda mais comandas para a fila do Windows. Elas esperam na fila do Comandou (aparecem em Na fila) e saem quando ela liga. Antes, o Windows guardava tudo e, ao ligar, saía um monte de papel de uma vez.',
      },
      {
        tag: 'novo',
        text: 'Impressão: a fila mostra "Na fila do Windows de <computador>", com cada documento parado lá (do Comandou e dos outros programas), a situação (sem papel, desligada, com erro) e o botão Apagar as do Comandou.',
      },
      {
        tag: 'novo',
        text: 'Nova situação Enviado: a comanda que o Windows recebeu e ainda não saiu. Vira Impresso quando sai da fila do Windows; se for apagada de lá, vira Tirado da fila com o motivo.',
      },
      {
        tag: 'novo',
        text: 'Validade da fila (padrão 30 min, dá para mudar ou desligar): o que espera mais que isso não sai sozinho quando a impressora volta, nem no Comandou nem na fila do Windows. Fica em Tirados, com Voltar para a fila.',
      },
      {
        tag: 'melhoria',
        text: 'Comandou Impressão 1.12.0 (já com o ícone do restaurante da 1.11.1): tela principal sem rolar (linhas mais baixas, impressoras virtuais como PDF, XPS, OneNote e Fax escondidas numa linha, setores numa linha só) e o quadro Fila do Windows. Testar com a impressora desligada avisa em vez de deixar a folha parada para sair depois.',
      },
    ],
  },
  {
    version: '0.231.5',
    date: '2026-11-22',
    title: 'A logo do restaurante no lugar do panda',
    summary:
      'Onde o restaurante já colocou a logo na Loja online, as telas mostram só ela: telas vazias, avisos, cardápio do cliente, rastreio e o aplicativo Comandou Impressão. O panda fica de reserva para quem ainda não tem logo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Telas vazias do sistema, do garçom e do entregador, Sem acesso, Restaurante suspenso, Mudamos de endereço e a apresentação do sistema mostram a logo do restaurante.',
      },
      {
        tag: 'melhoria',
        text: 'Para o cliente: rastreio do pedido, conversa com a loja, reservas, cardápio e site fora do ar mostram a logo do restaurante, não o panda.',
      },
      {
        tag: 'melhoria',
        text: 'Notificação de mensagem de cliente no computador sai com o ícone do restaurante.',
      },
      {
        tag: 'correção',
        text: 'Comandou Impressão (aplicativo 1.11.1): o ícone da barra de tarefas, dos atalhos e das notificações volta a ser o do restaurante, também depois de o aplicativo se atualizar.',
      },
    ],
  },
  {
    version: '0.231.4',
    date: '2026-11-22',
    title: 'Aplicativos de delivery com o logo de cada um',
    summary:
      'Os cartões da tela Aplicativos de delivery ficaram mais limpos: cada aplicativo aparece com o logo oficial, o nome e a situação, sem a mesma frase repetida em todos.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Aplicativos de delivery: iFood, Keeta, 99Food, Rappi, aiqfome e Open Delivery com o logo oficial no formato do ícone do app.',
      },
      {
        tag: 'melhoria',
        text: 'Cartões mais enxutos: logo, nome e situação em cima e "O que funciona" no pé. O aviso de falar com o suporte para liberar aparece uma vez só, no título do grupo.',
      },
    ],
  },
  {
    version: '0.231.3',
    date: '2026-11-22',
    title: 'Logo da loja já abre redonda',
    summary:
      'No cardápio online, ao abrir ou recarregar a página inicial, a logo do restaurante aparecia quadrada por um instante e depois ficava redonda. Agora ela já nasce redonda.',
    notes: [
      {
        tag: 'correção',
        text: 'Cardápio online: a logo da loja não aparece mais quadrada ao abrir a página. A própria foto passou a ser arredondada, e não só o quadro em volta, o que vale também para as outras fotos redondas do cardápio.',
      },
      {
        tag: 'melhoria',
        text: 'A logo do celular não faz mais a animação de entrada: ela aparece parada no mesmo lugar da tela de carregamento, sem pulo.',
      },
    ],
  },
  {
    version: '0.231.2',
    date: '2026-11-22',
    title: 'Janela da mesa mais simples',
    summary:
      'Tocar numa mesa ocupada no Salão abre uma janela mais limpa: o quanto falta receber em destaque, a conta explicada linha por linha (consumo, taxa de serviço, total e já pago) e os pedidos com um item por linha.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Salão: a janela da mesa ficou em duas partes no computador, com os pedidos à esquerda e a conta à direita. No celular vem primeiro quanto falta, depois os pedidos.',
      },
      {
        tag: 'melhoria',
        text: 'A taxa de serviço aparece como uma linha da conta, com o valor, a porcentagem e o aviso de que é opcional, e o Tirar taxa ou Cobrar ao lado.',
      },
      {
        tag: 'melhoria',
        text: 'Sem botões repetidos: Receber fica só no rodapé (a divisão por pessoa continua na tela de receber) e Pediu a conta, Transferir mesa e Comprovante ficam em Mais opções, cada um com uma frase do que faz.',
      },
    ],
  },
  {
    version: '0.231.1',
    date: '2026-11-22',
    title: 'Topo da Cozinha numa linha só',
    summary:
      'Na tela da Cozinha, as abas Todos, Delivery, Mesa, Balcão e Retirada subiram para a mesma linha do nome da cozinha, do tempo médio e dos botões. Sobra mais espaço para os pedidos.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cozinha no computador: nome, abas por tipo de pedido, tempo médio e botões numa linha só. Em tela mais estreita as abas descem para a linha de baixo, e no celular continuam embaixo dos contadores.',
      },
    ],
  },
  {
    version: '0.231.0',
    date: '2026-11-22',
    title: 'Quantidade em estoque na lista de itens',
    summary:
      'A lista de itens do cardápio ganhou a coluna Estoque, com quanto ainda tem de cada item. Dá para informar a quantidade ali mesmo ou no cadastro do item: cada venda baixa sozinha e, quando chega a zero, o item sai do cardápio até você informar mais.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápio › Itens: coluna Estoque com a quantidade de cada item. Toque no número (ou em Informar) para mudar.',
      },
      {
        tag: 'novo',
        text: 'Cadastro do item: campo Quantidade em estoque. Vazio, o item não controla estoque; com número, cada venda baixa 1 (ou o peso vendido).',
      },
      {
        tag: 'melhoria',
        text: 'A quantidade usa o Estoque: item sem ficha ganha o controle simples com o nome dele, e item com ficha de vários insumos mostra quanto dá para vender pela ficha.',
      },
    ],
  },
  {
    version: '0.230.1',
    date: '2026-11-22',
    title: 'Cardápio do cliente sem piscar',
    summary:
      'As telas do cardápio do cliente abrem paradas, sem esmaecer nem deslizar. No iPhone a entrada suave voltava a rodar sozinha e a tela do pedido ficava piscando entre um tom mais claro e um mais escuro.',
    notes: [
      {
        tag: 'correção',
        text: 'Acompanhamento do pedido no cardápio do cliente: a tela fica parada, sem piscar mais clara e mais escura no iPhone.',
      },
      {
        tag: 'melhoria',
        text: 'Trocar de tela ou de aba no cardápio do cliente agora é na hora, sem a animação de entrada.',
      },
    ],
  },
  {
    version: '0.230.0',
    date: '2026-11-22',
    title: 'Destravar a atualização pelo painel',
    summary:
      'No Super Admin › Infra, a atualização que para no meio agora se destrava ali mesmo, sem ir ao Portainer: cada serviço mostra há quanto tempo está trocando e, se passar do normal, aparecem Destravar e continuar e Reiniciar.',
    notes: [
      {
        tag: 'novo',
        text: 'Destravar e continuar: larga a troca parada, refaz o serviço que ficou no meio e segue com os que faltam, na mesma versão.',
      },
      {
        tag: 'novo',
        text: 'Reiniciar o serviço parado direto do quadro da atualização, o mesmo que reiniciar no Portainer.',
      },
      {
        tag: 'melhoria',
        text: 'Cada serviço mostra há quanto tempo está atualizando, e fica em amarelo com "parado há X min" quando passa de 3 minutos (10 na migração).',
      },
      {
        tag: 'correção',
        text: 'O agente se destrava sozinho: se o serviço já está de pé na versão nova mas o Swarm não marcou "concluído", segue em frente; se travou de verdade, reinicia o serviço uma vez antes de desistir.',
      },
      {
        tag: 'correção',
        text: 'O andamento da atualização fica guardado no servidor: se o agente reiniciar no meio, a tela mostra onde parou e oferece Continuar, em vez de perder a atualização.',
      },
    ],
  },
  {
    version: '0.229.1',
    date: '2026-11-22',
    title: 'Foto do item parada ao rolar',
    summary:
      'No cardápio pelo celular, a foto do item fica parada no topo e a folha com os detalhes sobe por cima dela enquanto o cliente rola.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Tela do item no celular: a foto não sobe mais junto com a página. A folha branca vai cobrindo a foto, que escurece de leve conforme some.',
      },
    ],
  },
  {
    version: '0.229.0',
    date: '2026-11-22',
    title: 'Edição do item no app do garçom',
    summary:
      'No app do garçom, tocar num produto abre a tela do item: escolhas obrigatórias, adicionais, o que retirar, observação e quantidade, com atalhos na lateral e o total no botão.',
    notes: [
      {
        tag: 'novo',
        text: 'Tela de edição do item no garçom: nome e preço no topo, uma seção por grupo (escolha única, adicionais com +, Retirar) e a observação com contador. O botão de baixo mostra quantidade e total; enquanto falta uma escolha obrigatória, ele diz qual e leva até ela.',
      },
      {
        tag: 'novo',
        text: 'Atalhos na lateral para cada seção, com visto verde quando a escolha está feita e um ponto laranja no que ainda é obrigatório.',
      },
      {
        tag: 'melhoria',
        text: 'Tocar num item do pedido reabre a mesma tela para mudar as escolhas, a quantidade e a observação. As escolhas aparecem embaixo do nome, como "Ao ponto, + Bacon extra, sem Cebola".',
      },
      {
        tag: 'correção',
        text: 'Janelas e folhas que sobem no celular: rolar dentro delas não rola mais a página de trás, nem quando a lista chega ao fim ou o dedo começa no topo ou no rodapé da folha.',
      },
    ],
  },
  {
    version: '0.228.5',
    date: '2026-11-22',
    title: 'Rolagem elástica no celular',
    summary:
      'No navegador do celular, as telas do sistema, o site e os apps da equipe passam um pouco do fim ao rolar e voltam sozinhos, com o efeito do próprio celular, sem pesar a página.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Rolagem no celular: ao chegar no começo ou no fim da tela, o conteúdo estica um pouco e volta, como nos aplicativos. O topo e o menu de baixo ficam parados, e com uma janela aberta a tela de trás não se mexe.',
      },
      {
        tag: 'melhoria',
        text: 'No app instalado, o elástico e o puxar para atualizar continuam como antes.',
      },
    ],
  },
  {
    version: '0.228.4',
    date: '2026-11-22',
    title: 'Pedido do cliente sem esmaecer',
    summary:
      'No cardápio do cliente, a aba Pedidos e a tela de acompanhamento do pedido abrem já com a cor certa, sem aparecer mais clara por um instante.',
    notes: [
      {
        tag: 'correção',
        text: 'Pedidos e acompanhamento no cardápio do cliente: a tela não entra mais esmaecida e depois escurece. As outras telas do cardápio seguem com a entrada suave.',
      },
    ],
  },
  {
    version: '0.228.3',
    date: '2026-11-22',
    title: 'Equipe no celular em cartões',
    summary:
      'No celular, a Equipe virou uma lista de cartões: cada pessoa com a inicial, o nome e o e-mail no topo, o papel numa escolha larga, como entra (PIN ou senha) e o último acesso numa linha só, e as ações Abrir, Link e Desativar num rodapé.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Equipe no celular: um cartão por pessoa, no jeito dos cartões de Entregadores, em vez da tabela espremida com rótulos soltos. Novo PIN, Nova senha e Trocar senha ficam ao lado de como a pessoa entra.',
      },
      {
        tag: 'melhoria',
        text: 'Pessoa desativada aparece apagada, com o selo e um botão Reativar na largura toda. No computador a tabela continua igual.',
      },
    ],
  },
  {
    version: '0.228.2',
    date: '2026-11-22',
    title: 'Conversas no celular: teclado sem quebrar a tela',
    summary:
      'No celular, ao tocar para escrever numa conversa, a tela não pula mais para cima antes de se ajeitar, e os menus de baixo saem da frente enquanto o teclado está aberto.',
    notes: [
      {
        tag: 'correção',
        text: 'Chat (Conversas, Pessoas, Mural, Avisos, Clientes, Suporte e IA), conversa do cliente no cardápio e conversas do Super Admin: ao abrir o teclado no iPhone, a conversa já encolhe para o espaço acima dele, sem empurrar o topo para fora da tela e voltar depois.',
      },
      {
        tag: 'correção',
        text: 'Com o teclado aberto, as abas de baixo do chat e os menus de baixo do app, do garçom, do entregador e do cardápio somem e voltam ao fechar o teclado. Antes elas subiam junto e ocupavam o espaço da conversa.',
      },
    ],
  },
  {
    version: '0.228.1',
    date: '2026-11-22',
    title: 'Delivery com um botão só: despachar',
    summary:
      'No pedido de delivery que ainda não foi entregue, o botão grande agora é só o próximo passo (Despachar entregador e, depois, Entregue). O Fechar conta saiu dali, porque o pagamento é acertado na entrega.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Pedido de delivery: o Fechar conta não aparece mais ao lado do Despachar entregador. Entregue com valor em aberto continua indo para o acerto do entregador, com a forma de pagamento que o cliente escolheu.',
      },
      {
        tag: 'melhoria',
        text: 'Cliente que já pagou antes da entrega (Pix na hora, por exemplo): use Receber agora, na barra de Cobrança do pedido. Retirada, balcão e mesa continuam com o Fechar conta grande.',
      },
    ],
  },
  {
    version: '0.228.0',
    date: '2026-11-22',
    title: 'Equipe: abrir a tela de cada pessoa e copiar o link dela',
    summary:
      'Na Equipe, cada pessoa tem agora dois botões: Abrir, que leva você direto à tela de trabalho dela sem sair da sua conta, e Copiar link, para mandar o acesso. O quadro Links de acesso, embaixo da lista, saiu.',
    notes: [
      {
        tag: 'novo',
        text: 'Equipe › Abrir (ícone de abrir em outra aba, ao lado da pessoa): abre em outra aba a tela de trabalho dela com a sua conta de administrador. Garçom: o app do garçom. Cozinha, PDV e Caixa: a tela da área. Gerente: o painel.',
      },
      {
        tag: 'novo',
        text: 'Entregador: o Abrir mostra a prévia do app dele, só para ver, com as corridas na rua, os pedidos disponíveis (com o ganho pela regra dele), o histórico, o perfil e os ganhos. A prévia não manda GPS e não pega nem conclui corrida.',
      },
      {
        tag: 'melhoria',
        text: 'O link de cada área ficou só no botão de copiar de cada pessoa (o endereço aparece ao parar o mouse). Saiu o quadro Links de acesso do pé da tela.',
      },
      {
        tag: 'correção',
        text: 'Com a sessão do dono ou do gerente aberta, o endereço /garcom entra direto no app do garçom em vez de pedir para sair da conta. No app, uma faixa no topo mostra com qual conta você está, com Voltar ao painel e Entrar como garçom.',
      },
    ],
  },
  {
    version: '0.227.1',
    date: '2026-11-22',
    title: 'Abas e botões na mesma linha',
    summary:
      'Sem o título no topo, Salão, Loja online e Chamados juntam abas, Tutorial e botões numa linha só, e o Tutorial da Impressão foi para o quadro Computadores conectados.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Salão: Mesas, Comandas, Delivery e Para levar ficam na mesma linha de Tutorial, Personalizar mesas, QR das mesas, Garçons e a ação principal. No celular, as abas continuam embaixo das ações.',
      },
      {
        tag: 'melhoria',
        text: 'Loja online: as abas (Aparência, Página, Banners…) sobem para a linha de Tutorial, Copiar link, Página do restaurante e Abrir cardápio.',
      },
      {
        tag: 'melhoria',
        text: 'Chamados: o resumo (em andamento, respostas novas, resolvidos) fica na mesma linha de Abrir chamado. Impressão: o Tutorial fica ao lado de Conectar computador, sem uma linha só para ele.',
      },
    ],
  },
  {
    version: '0.227.0',
    date: '2026-11-22',
    title: 'Cartões dos entregadores mais limpos, com Copiar link e cor',
    summary:
      'Em Entregas › Entregadores, cada cartão ficou mais organizado e tem só três ações: Copiar link, WhatsApp e Desativar. O link é sempre o mesmo, dá para trocar a senha de quem entra com PIN e escolher a cor do entregador no calendário de pagamento.',
    notes: [
      {
        tag: 'novo',
        text: 'Copiar link: copia o link do entregador de novo, sem gerar outro (o que ele já tem continua valendo). O WhatsApp manda esse mesmo link.',
      },
      {
        tag: 'novo',
        text: 'Alterar senha no cartão de quem entra com PIN em /entregas: escolha os 4 números ou sorteie uma.',
      },
      {
        tag: 'novo',
        text: 'Cor do entregador escolhida no cartão: vale no calendário de pagamento do Acerto e no mapa.',
      },
      {
        tag: 'melhoria',
        text: 'Cartão novo: nome sem cortar, situação e o que está fazendo numa linha, e as três ações embaixo. Novo link e Desligar link saíram; Desativar também vale para quem entra com login (desativa o acesso na Equipe).',
      },
      {
        tag: 'melhoria',
        text: 'Link criado antes desta versão não dá para copiar de novo: no primeiro Copiar link o sistema avisa e cria um novo.',
      },
    ],
  },
  {
    version: '0.226.1',
    date: '2026-11-22',
    title: 'Telas sem título repetido e lista de pedidos maior',
    summary:
      'Pedidos, Salão, Entregas, Cardápio, Loja online, Impressão, WhatsApp, Assistente de IA, Chamados, Clientes, Equipe, Financeiro, Relatórios e Aplicativos de delivery não repetem mais o nome da tela nem a frase de explicação no topo: o conteúdo começa logo embaixo da barra. Na aba Pedidos, o quadro desce até o pé da janela.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Saíram o título e a frase de explicação do topo das telas (o nome já aparece no menu). No Salão saiu também a linha "mesas ocupadas · comandas · para entregar ou levar": os números continuam nas abas Mesas, Comandas, Delivery e Para levar.',
      },
      {
        tag: 'melhoria',
        text: 'O botão Tutorial continua em cada tela, agora à direita, junto das ações. No Cardápio, a explicação de cada seção aparece ao parar o mouse na aba.',
      },
      {
        tag: 'melhoria',
        text: 'Pedidos: o quadro da lista vai até o pé da janela e começa direto nas abas Hoje, Em andamento, A receber…, cabendo mais pedidos na tela.',
      },
    ],
  },
  {
    version: '0.226.0',
    date: '2026-11-22',
    title: 'Impressão no estilo cupom, com logo, negrito e IA no editor',
    summary:
      'A conferência de conta, a via de entrega e a comanda da cozinha saem no jeito de cupom: logo da loja no topo, nome em letra grande, campos alinhados, observação em destaque, tabela de itens e o total grande. E o editor de modelos ganhou uma conversa com a IA, que muda o papel pelo restaurante.',
    notes: [
      {
        tag: 'novo',
        text: 'Modelos padrão no estilo cupom: logo e nome grande no topo, PEDIDO/DATA/TIPO/CLIENTE/ENDEREÇO em coluna, OBSERVAÇÃO em negrito, tabela QTDE/DESCRIÇÃO/VALOR (nome comprido quebra sem perder o preço) e TOTAL em letra grande.',
      },
      {
        tag: 'novo',
        text: 'Negrito, letra grande e a logo da Loja online na térmica: ajudantes negrito, grande, campo e coluna nos modelos, e a variável loja.logo. A prévia da tela, a impressão pelo navegador e o histórico de impressões do pedido mostram igual ao papel.',
      },
      {
        tag: 'novo',
        text: 'Impressão › Modelos de impressão: conversa com a IA ao lado do editor. Peça "deixe o total maior" ou "tire o telefone" e ela muda o código; a mudança entra no editor com a prévia, dá para desfazer e só vale depois de Salvar modelo.',
      },
      {
        tag: 'melhoria',
        text: 'Aplicativo Comandou Impressão 1.11.0: imprime a logo (em pontos pretos e brancos, com pontilhado para logo colorida), o negrito e a letra grande. Quem ainda está no aplicativo antigo recebe o papel sem esses estilos, alinhado e legível, até atualizar sozinho.',
      },
      {
        tag: 'segurança',
        text: 'Texto do cliente (observação, nome) nunca vira marca de impressão: "@@" escrito por alguém não imprime QR Code nem letra grande. A IA do editor só propõe: o modelo é conferido no servidor (sintaxe e largura) e nada é salvo sem a pessoa.',
      },
    ],
  },
  {
    version: '0.225.0',
    date: '2026-11-22',
    title: 'Entregas: pagar os entregadores ficou todo no Acerto',
    summary:
      'A aba Repasses saiu e o que importava dela foi para o Acerto: quanto falta pagar a cada entregador, com o botão Pagar, o calendário de ganhos, o dinheiro recebido na porta e os pagamentos feitos com recibo. Tocar num dia explica cada valor.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Entregas › Acerto agora tem, nesta ordem: A pagar agora (valor de cada entregador, corridas, Pagar, ajustar e Regras de pagamento), Calendário de ganhos, Acerto do dinheiro da porta e Pagamentos feitos no mês do calendário, com o recibo.',
      },
      {
        tag: 'melhoria',
        text: 'Saíram os números que pareciam não bater ("Pago no mês" maior que os ganhos, porque contava pagamentos de corridas de outro mês), o "Custo para a loja" repetido e o gráfico por dia, que o calendário já mostra.',
      },
      {
        tag: 'melhoria',
        text: 'Detalhe do dia (no celular sobe de baixo): frase de resumo, quanto já foi pago e quanto falta, a conta de cada entregador (corridas + diária = ganhou no dia) e o aviso de que o dinheiro cobrado na porta é da loja.',
      },
      {
        tag: 'melhoria',
        text: 'A explicação dos impostos (MEI, autônomo, CLT) foi para dentro de Regras de pagamento. Links antigos da aba Repasses abrem o Acerto.',
      },
    ],
  },
  {
    version: '0.224.1',
    date: '2026-11-22',
    title: 'Botões com a cor da loja de letra branca no modo escuro',
    summary:
      'Com uma cor própria clara (verde, amarelo…), o botão principal no modo escuro vinha com letra escura. Agora ele fica um tom mais fechado e a letra é sempre branca, como no laranja do Comandou.',
    notes: [
      {
        tag: 'correção',
        text: 'Modo escuro: botões cheios na cor do restaurante (Nova venda, Salvar, Confirmar…) com letra branca e contraste de pelo menos 4,5:1, para qualquer cor escolhida.',
      },
      {
        tag: 'melhoria',
        text: 'Selos e etiquetas cheios na cor do restaurante também escurecem um pouco no modo escuro para a letra branca ler bem.',
      },
    ],
  },
  {
    version: '0.224.0',
    date: '2026-11-22',
    title: 'Calendário de ganhos dos entregadores',
    summary:
      'A aba Acerto, em Entregas, ganhou um calendário do mês com quanto cada entregador fez em cada dia, cada um na sua cor, com o total do dia, da semana e do mês.',
    notes: [
      {
        tag: 'novo',
        text: 'Calendário de ganhos em Entregas › Acerto: em cada dia, a barra dividida entre os entregadores e o valor de cada um (corridas + diária), na mesma cor do mapa.',
      },
      {
        tag: 'novo',
        text: 'Toque num dia para ver o detalhe: entregas, km, horário, corridas, diária, o que recebeu na porta e cada corrida com a situação do pagamento.',
      },
      {
        tag: 'novo',
        text: 'Toque no nome de um entregador para ver só os dias e os ganhos dele; no topo, ganhos do mês, entregas, dias com entrega e o melhor dia.',
      },
    ],
  },
  {
    version: '0.223.0',
    date: '2026-11-22',
    title: 'Entregadores em cartões, com a situação de cada um',
    summary:
      'Em Entregas › Entregadores, cada entregador ganhou um cartão com a situação dele agora (na rua, disponível, offline, sem acesso ao app ou desativado), o que fez hoje, como entra no app e se o link já foi aberto.',
    notes: [
      {
        tag: 'novo',
        text: 'Um cartão por entregador com a situação em bolinha: na rua (com os pedidos), disponível (app aberto agora), offline (com quando foi visto), sem acesso ao app ou desativado. Em cima, quantos estão em cada situação.',
      },
      {
        tag: 'novo',
        text: 'O cartão mostra as entregas de hoje, se a pessoa entra com PIN e como está o link: ativo e aberto há quanto tempo, ainda não aberto, ou pausado.',
      },
      {
        tag: 'correção',
        text: 'Entregador desativado aparecia com "link ativo", mas o link não abria: agora aparece como pausado.',
      },
      {
        tag: 'correção',
        text: 'O campo Login do cadastro oferecia quem já estava na lista e dava erro de registro duplicado; agora só mostra quem falta.',
      },
    ],
  },
  {
    version: '0.222.1',
    date: '2026-11-22',
    title: 'WhatsApp só por QR Code',
    summary: 'A opção API oficial da Meta saiu da tela do WhatsApp: a conexão é só pelo QR Code.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Tela WhatsApp sem a aba "API oficial da Meta" e sem o formulário de token e modelos; a conexão é sempre pelo QR Code.',
      },
      {
        tag: 'melhoria',
        text: 'Restaurante que ainda estava na API oficial vê um aviso com o botão Usar QR Code.',
      },
    ],
  },
  {
    version: '0.222.0',
    date: '2026-11-21',
    title: 'App do entregador de cara nova',
    summary:
      'O app do entregador no celular ganhou um Início em forma de painel, a corrida aceita ficou mais clara, o histórico ficou separado por dia e o perfil mostra o score num anel. O topo traz o ícone da loja.',
    notes: [
      {
        tag: 'novo',
        text: 'Início com os ganhos de hoje, o gráfico dos últimos 7 dias, semana, mês e a receber, os pedidos prontos para pegar e os números do dia.',
      },
      {
        tag: 'melhoria',
        text: 'Corrida aceita: andamento em três passos, tempo na rua, ligar e WhatsApp ao lado do cliente, endereço que abre a rota e um quadro com quanto cobrar e quanto você ganha.',
      },
      {
        tag: 'melhoria',
        text: 'Histórico agrupado por dia (Hoje, Ontem…) com o total do dia, uma linha por corrida.',
      },
      {
        tag: 'melhoria',
        text: 'Perfil com o score num anel, os números num quadro só e, em Este aparelho, o tema escuro e o Sair.',
      },
      {
        tag: 'melhoria',
        text: 'Topo com o ícone da loja (favicon, senão o logo) e só o som e o chat; abas de baixo numa barra solta com a aba ativa destacada.',
      },
    ],
  },
  {
    version: '0.221.0',
    date: '2026-11-21',
    title: 'Foto do item maior e em tela cheia',
    summary:
      'No cardápio online, a foto do item ficou maior no notebook e no tablet e acompanha a rolagem ao lado dos detalhes. Tocar na foto abre ela em tela cheia, e a foto do "Adicionar" voa até a sacola que está à vista.',
    notes: [
      {
        tag: 'correção',
        text: 'Cardápio online no notebook e no iPad: ao adicionar um item pela tela dele, a foto voava para baixo, até um botão da sacola que sumia na volta ao cardápio. Agora ela voa até a sacola que aparece na tela (no alto, à direita, no notebook largo).',
      },
      {
        tag: 'novo',
        text: 'Tocar na foto do item abre ela inteira em tela cheia, com arrastar ou setas para ver as outras fotos. Esc, o X ou tocar fora fecham.',
      },
      {
        tag: 'melhoria',
        text: 'No notebook e no tablet, a foto do item ficou maior e fica presa na tela enquanto as opções e avaliações rolam ao lado, sem o espaço vazio embaixo dela.',
      },
    ],
  },
  {
    version: '0.220.4',
    date: '2026-11-21',
    title: 'Colunas de Pedidos até o fim da tela no PDV',
    summary:
      'Saiu a frase de boas-vindas embaixo do quadro de Pedidos do PDV: as colunas Em análise, Em produção, Prontos e Saiu para entrega agora vão até o fim da tela.',
    notes: [
      {
        tag: 'melhoria',
        text: 'PDV: sem o texto "Olá, … Pedidos do … em tempo real." no pé da tela; o quadro de Pedidos usa a altura toda, no computador e no celular, e a alça entre Salão e Pedidos segue ajustando o tamanho.',
      },
    ],
  },
  {
    version: '0.220.3',
    date: '2026-11-21',
    title: 'Entregador ativo na Equipe recebe pedidos',
    summary:
      'O entregador que está ativo na Equipe não aparece mais como desativado no app: ele vê os pedidos prontos e pode ser escolhido pelo PDV, sem nenhum passo a mais.',
    notes: [
      {
        tag: 'correção',
        text: 'App do entregador: quem estava ativo na Equipe podia ver "Entregador desativado" e não receber pedido nenhum, porque o cadastro em Entregas tinha sido desligado à parte. Os cadastros foram acertados com a Equipe.',
      },
      {
        tag: 'melhoria',
        text: 'Entregador com login: ativar e desativar agora é só na Equipe, e a tela Entregas segue o que está lá. Entregador pelo link (sem login) continua com o botão em Entregas.',
      },
    ],
  },
  {
    version: '0.220.2',
    date: '2026-11-21',
    title: 'Senha e PIN separados na Equipe',
    summary:
      'Na Equipe, cada pessoa mostra como entra: garçom e entregador só com PIN, sem botão de senha; o resto com e-mail e senha.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Equipe: nova coluna Como entra, com PIN (Criar PIN ou Novo PIN) para garçom e entregador e Senha (Nova senha) para os outros papéis. Quem entra com PIN não tem mais o botão Nova senha.',
      },
      {
        tag: 'melhoria',
        text: 'Adicionar pessoa: garçom e entregador são criados só com o PIN, sem e-mail nem senha.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin: na pessoa da equipe que entra com PIN, Redefinir senha não aparece mais e a tela diz que o PIN é trocado pelo restaurante.',
      },
    ],
  },
  {
    version: '0.220.1',
    date: '2026-11-21',
    title: 'Pedido de entrega com muitas cozinhas na mesma impressora',
    summary:
      'Um pedido de entrega com cinco cozinhas ou mais saindo na mesma impressora não conseguia ser criado. Agora ele entra normalmente e sai numa ficha só.',
    notes: [
      {
        tag: 'correção',
        text: 'Pedido de entrega ou retirada com cinco ou mais cozinhas na mesma impressora entra normalmente e imprime tudo numa ficha.',
      },
    ],
  },
  {
    version: '0.220.0',
    date: '2026-11-21',
    title: 'Delivery numa ficha só e histórico de impressões',
    summary:
      'O pedido de entrega e de retirada sai numa ficha só na impressora, em vez de um papel para cada cozinha, e cada pedido mostra tudo o que já foi impresso dele, com a hora e a prévia do papel.',
    notes: [
      {
        tag: 'correção',
        text: 'Pedido de entrega e de retirada: as cozinhas que usam a mesma impressora saem juntas numa ficha só, com o nome de cada cozinha antes dos itens dela. Cozinha com impressora própria continua recebendo só a parte dela. O salão segue com uma comanda por cozinha.',
      },
      {
        tag: 'novo',
        text: 'Impressões no pedido: a lista mostra cada papel que saiu (comanda da cozinha, conferência, via de entrega, cupom fiscal, item cancelado), com a hora, a impressora, quem mandou e se já imprimiu. Tocando na linha, aparece a prévia do papel.',
      },
    ],
  },
  {
    version: '0.219.0',
    date: '2026-11-21',
    title: 'Ícone de cada restaurante no Super Admin',
    summary:
      'O Super Admin mostra o ícone que cada restaurante pôs na Loja online, na lista, no detalhe e em Conversas, e acompanha sozinho o que o restaurante muda do lado dele.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin: no lugar das iniciais, aparece o ícone da aba (favicon) que o restaurante colocou na Loja online; sem ele, o logo. Vale na lista de Restaurantes, no detalhe e em Conversas.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin: a lista e o detalhe do restaurante se atualizam sozinhos a cada 20 segundos e ao voltar para a aba. Ícone, nome e cadastro que o restaurante muda aparecem sem recarregar a página.',
      },
      {
        tag: 'segurança',
        text: 'O painel só lê a imagem que é o ícone ou o logo atual do restaurante, nenhuma outra foto, e só com a sessão do Super Admin.',
      },
    ],
  },
  {
    version: '0.218.0',
    date: '2026-11-21',
    title: 'Link de acesso para cada área da equipe',
    summary:
      'A tela Equipe agora mostra o link certo de cada área (garçom, entregador, cozinha, PDV, caixa e gerência) com o botão Copiar, para mandar à pessoa e ela já cair no login dela.',
    notes: [
      {
        tag: 'novo',
        text: 'Equipe › Links de acesso: o link de cada área com o botão Copiar. Garçom e entregador abrem direto no PIN; cozinha, PDV e caixa abrem o login da área e, depois de entrar, a tela de trabalho.',
      },
      {
        tag: 'novo',
        text: 'Equipe: botão de link em cada pessoa, que copia o link da área do papel dela.',
      },
      {
        tag: 'melhoria',
        text: 'O login de /pdv e /caixa diz qual área está abrindo, e a cozinha que perde a sessão numa tela de dentro volta para o login da cozinha.',
      },
    ],
  },
  {
    version: '0.217.4',
    date: '2026-11-21',
    title: 'Pedido pronto aparece na hora para o entregador',
    summary:
      'Quando um pedido de entrega fica pronto, ele aparece na hora na aba Disponíveis do app do entregador, para quem quiser pegar. O caixa e o PDV continuam podendo escolher quem leva.',
    notes: [
      {
        tag: 'correção',
        text: 'App do entregador: a aba Disponíveis se atualiza sozinha no instante em que o pedido fica pronto, sai com outro entregador ou é cancelado. Antes ela só consultava a cada 15 segundos e podia parecer vazia.',
      },
      {
        tag: 'melhoria',
        text: 'App do entregador: se o login não estiver ligado a um entregador (ou o cadastro estiver desativado), a aba Disponíveis mostra o motivo, em vez de dizer que não há pedido.',
      },
      {
        tag: 'melhoria',
        text: 'Link do entregador sem login: a lista de pedidos para pegar é consultada a cada 8 segundos.',
      },
    ],
  },
  {
    version: '0.217.3',
    date: '2026-11-21',
    title: 'Pedidos, caixa e iFood mais certos',
    summary:
      'Pedido do iFood não se perde mais por falta de insumo, a equipe é avisada quando o cliente muda o pedido ou o endereço no aplicativo, o Pix em análise não é cobrado de novo e a comanda com fiado consegue fechar.',
    notes: [
      {
        tag: 'correção',
        text: 'Aplicativos de delivery: faltar insumo da ficha técnica não derruba mais o pedido. Ele entra normalmente, sem a baixa, e o gerente recebe um aviso para conferir o estoque.',
      },
      {
        tag: 'novo',
        text: 'iFood: quando o cliente altera itens ou pede outro endereço depois de confirmar, o aviso aparece no pedido e no sino da equipe para conferir no portal.',
      },
      {
        tag: 'correção',
        text: 'iFood: a taxa de pedido mínimo é do iFood e saiu da venda e da nota da loja, e o preço dos complementos agora inclui o valor adicional.',
      },
      {
        tag: 'correção',
        text: 'Caixa e entregas: pedido com comprovante de Pix em análise não pode ser cobrado de novo. Comprovante de pedido que já está pago não é aprovado sem aviso.',
      },
      {
        tag: 'correção',
        text: 'Comandas: pedido fiado ou "a receber" não impede mais de fechar a conta. A dívida continua registrada no pedido.',
      },
      {
        tag: 'correção',
        text: 'Salão: pedido entregue que volta para a cozinha aparece de novo em Prontos para levar, mover pedido segue a taxa de serviço da comanda de destino e dois primeiros pedidos juntos na mesma mesa entram na mesma comanda.',
      },
      {
        tag: 'segurança',
        text: 'Garçom só vê e imprime a conferência e a via de entrega dos pedidos que ele enxerga. Dois estornos em dinheiro ao mesmo tempo não tiram da gaveta mais do que ela tem.',
      },
      {
        tag: 'correção',
        text: 'Produto de categoria desativada não entra no pedido, o troco da conferência não muda depois de um estorno, prêmio de fidelidade em produto por quilo desconta só o que o cliente leva e pedido de aplicativo não ganha pontos.',
      },
    ],
  },
  {
    version: '0.217.2',
    date: '2026-11-21',
    title: 'Itens do cardápio abrem com um clique na linha',
    summary:
      'No cardápio, clicar em qualquer parte da linha do item já abre a edição dele, sem precisar mirar no lápis.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cardápio › Itens no cardápio: a linha inteira abre o item para editar. O campo de preço e a chave de ligar e desligar continuam funcionando como antes.',
      },
    ],
  },
  {
    version: '0.217.1',
    date: '2026-11-21',
    title: 'Sistema protegido contra páginas maliciosas e WhatsApp sem aviso repetido',
    summary:
      'Um link de cardápio feito de propósito não consegue mais deixar o sistema lento para os outros restaurantes. O aviso de pedido no WhatsApp não sai mais em dobro quando o envio demora, e a IA entende melhor as respostas sobre reservas.',
    notes: [
      {
        tag: 'segurança',
        text: 'Importar cardápio por link: páginas montadas para travar a leitura agora são lidas em instantes, sem afetar os outros restaurantes. Só links verdadeiros do Google Maps são aceitos como Maps.',
      },
      {
        tag: 'correção',
        text: 'WhatsApp: quando o envio demora e não dá para saber se saiu, o aviso fica como "Envio incerto" e não é repetido sozinho, para o cliente não receber duas vezes.',
      },
      {
        tag: 'correção',
        text: 'Reservas pelo WhatsApp: responder "cancela" ao pedido de confirmação agora cancela a reserva. Horário depois da meia-noite mostra o dia certo, e conversa sem número visível recebe a explicação antes de confirmar.',
      },
      {
        tag: 'correção',
        text: 'Assistente de IA da equipe: resposta que demora demais agora para com um aviso, e o consumo de uma resposta interrompida entra na conta do mês.',
      },
    ],
  },
  {
    version: '0.217.0',
    date: '2026-11-21',
    title: 'Saúde do computador no aplicativo de impressão',
    summary:
      'O aplicativo Comandou Impressão 1.10.0, no Windows, ganhou Verificar e limpar: faz uma checagem completa do computador, limpa temporários e caches e conserta arquivos corrompidos do Windows, sempre mostrando antes o que vai fazer.',
    notes: [
      {
        tag: 'novo',
        text: 'Aplicativo de impressão 1.10.0: checagem de disco, memória, antivírus e reinício pendente, sem mudar nada no computador.',
      },
      {
        tag: 'novo',
        text: 'Aplicativo de impressão 1.10.0: limpeza de temporários, caches e atualizações antigas, e reparo de arquivos do Windows, com relatório no final. Documentos, downloads, Lixeira, senhas e favoritos nunca são tocados.',
      },
    ],
  },
  {
    version: '0.216.0',
    date: '2026-11-21',
    title: 'Setinha no endereço do pedido abre o Google Maps',
    summary:
      'Nos detalhes do pedido, a setinha ao lado do endereço abre no Google Maps o lugar onde o cliente mora: o pino confirmado por ele ou, sem pino, o endereço escrito.',
    notes: [
      {
        tag: 'novo',
        text: 'Detalhes do pedido: botão de seta no Endereço abre o local do cliente no Google Maps em outra aba. Usa o pino do mapa quando existe; sem pino, busca pela rua, bairro, cidade e CEP, sem o complemento e a referência.',
      },
    ],
  },
  {
    version: '0.215.2',
    date: '2026-11-21',
    title: 'Assinatura usa a tela inteira no computador',
    summary:
      'Na tela Assinatura, o conteúdo agora ocupa toda a largura no notebook e no computador, sem a faixa vazia à direita.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Assinatura: em telas largas, o preço e o que está incluso ficam lado a lado, e a forma de pagamento e as faturas usam a largura toda. No celular continua igual.',
      },
    ],
  },
  {
    version: '0.215.1',
    date: '2026-11-21',
    title: 'Abas da Cozinha mais organizadas',
    summary:
      'As abas de cima da tela da Cozinha (Todos, Delivery, Mesa, Balcão, Retirada) agora ficam num trilho só, todas da mesma largura, com o número sempre no mesmo canto.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cozinha: abas por tipo de pedido num bloco único, alinhado às colunas, com tamanhos iguais e contadores em coluna. No celular, o bloco ocupa a largura toda e rola de lado.',
      },
    ],
  },
  {
    version: '0.215.0',
    date: '2026-11-21',
    title: 'Busca geral com favoritos e salão do PDV no tamanho que você arrastar',
    summary:
      'A busca do topo (Ctrl K), que acha tudo no sistema, ficou maior e ganhou as abas Recentes e Favoritos. No PDV, a alça entre o Salão e os Pedidos se segura e arrasta para cima ou para baixo, e a busca do PDV vale para a tela toda: pedidos, mesas e comandas.',
    notes: [
      {
        tag: 'novo',
        text: 'Busca do topo: abas Recentes (o que você abriu por último) e Favoritos; a estrela em qualquer resultado (tela, pedido, mesa, cliente…) guarda nos favoritos deste aparelho.',
      },
      {
        tag: 'melhoria',
        text: 'PDV: no lugar das setas, uma alça entre o Salão e os Pedidos; segure e arraste para baixo para ver mais mesas ou para cima para dar espaço aos pedidos (até recolher o salão). Ao soltar, para numa linha inteira e fica guardado no aparelho.',
      },
      {
        tag: 'melhoria',
        text: 'PDV: a busca de baixo procura só nesta tela (pedidos, mesas e comandas) e ficou menor que a busca geral do topo; saiu o campo "Buscar mesa" do Salão.',
      },
    ],
  },
  {
    version: '0.214.0',
    date: '2026-11-21',
    title: 'Botão de buscar atualização no aplicativo de impressão',
    summary:
      'O aplicativo Comandou Impressão 1.9.0 tem um botão fixo no topo: Buscar atualização. Quando há versão nova, ele vira Atualizar para a versão tal, baixa, fecha e abre de novo sozinho.',
    notes: [
      {
        tag: 'novo',
        text: 'Aplicativo de impressão 1.9.0: botão Buscar atualização sempre visível no topo, que vira Atualizar quando há versão nova.',
      },
      {
        tag: 'melhoria',
        text: 'Aplicativo de impressão 1.9.0: confere se há versão nova ao abrir a janela, ao voltar da suspensão e a cada hora (antes, só a cada 6 horas).',
      },
    ],
  },
  {
    version: '0.213.1',
    date: '2026-11-21',
    title: 'Fechar a conta pergunta antes',
    summary:
      'Fechar a conta de uma mesa ou comanda agora sempre pergunta antes, mostrando o total e o que já foi pago. Antes, no cartão do PDV, uma comanda já paga fechava direto no clique.',
    notes: [
      {
        tag: 'correção',
        text: 'PDV e Salão: o botão Fechar conta (no cartão, nos três pontinhos e na janela da comanda) abre a pergunta "Fechar a conta da comanda?" com total e pago; só fecha ao confirmar. Com saldo, o recebimento abre antes e a pergunta vem depois de receber. Nenhum pagamento é lançado sem você escolher.',
      },
    ],
  },
  {
    version: '0.213.0',
    date: '2026-11-21',
    title:
      'PDV: ações da comanda no cartão, busca com favoritos e salão do tamanho que você quiser',
    summary:
      'No salão do PDV, cada mesa ocupada e cada comanda tem imprimir, fechar conta e os três pontinhos com Ver pedidos, Renomear, Transferir e Fechar conta. Setas entre o Salão e os Pedidos deixam um ou outro maior, a busca ficou larga e guarda as recentes e os favoritos, e o Nova venda ganhou destaque.',
    notes: [
      {
        tag: 'novo',
        text: 'PDV › Salão: o cartão da mesa ocupada e da comanda mostra total, comanda e mesa, com os botões de imprimir a conta e fechar a conta e o menu de três pontinhos (Ver pedidos, Renomear, Transferir, Fechar conta). Fechar conta com saldo abre o recebimento e fecha sozinha quando o saldo zera.',
      },
      {
        tag: 'novo',
        text: 'Comanda: dá para renomear (nome do cliente ou apelido) pelo menu do cartão; a mudança fica no histórico.',
      },
      {
        tag: 'novo',
        text: 'PDV: setas entre o Salão e os Pedidos aumentam ou diminuem as linhas de mesas (para cima até recolher o salão); o tamanho fica guardado no aparelho.',
      },
      {
        tag: 'melhoria',
        text: 'PDV: a busca ficou mais larga e, ao tocar nela, mostra as últimas buscas (Recentes) e as marcadas com a estrela (Favoritos), guardadas por pessoa neste aparelho.',
      },
      {
        tag: 'melhoria',
        text: 'PDV: Nova venda maior e em destaque; saíram o botão Mensagens (as conversas com clientes seguem no ícone do topo) e o filtro "Todos os tipos" dos Pedidos.',
      },
    ],
  },
  {
    version: '0.212.1',
    date: '2026-11-21',
    title: 'Personalizar salão sem janela em cima de janela',
    summary:
      'A tela de personalizar as mesas ficou mais limpa: no notebook o salão fica à esquerda e o formulário de adicionar ou editar mesa fica ao lado, sem abrir outra janela por cima. No celular, um de cada vez, com Voltar no rodapé.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Salão › Personalizar mesas: adicionar mesas e editar uma mesa abrem num painel ao lado do salão (notebook) ou no lugar dele (celular); a mesa escolhida fica marcada no mapa.',
      },
      {
        tag: 'melhoria',
        text: 'Formatos Quadrada, Redonda e Retangular com o nome inteiro, quantidade e lugares lado a lado, atalhos de 1 a 30 mesas e números do salão num quadro só.',
      },
      {
        tag: 'correção',
        text: 'No notebook de tela baixa (1366 × 768) os botões do rodapé não ficam mais cortados.',
      },
    ],
  },
  {
    version: '0.212.0',
    date: '2026-11-21',
    title: 'Aviso de impressora desligada, no sistema e no aplicativo',
    summary:
      'O aplicativo Comandou Impressão 1.8.0 confere a cada 30 segundos, sem imprimir nada, se as impressoras escolhidas estão ligadas. Se uma desligar, o aviso aparece no aplicativo e no sistema, e some sozinho quando ela voltar. O aplicativo também ganhou a opção de receber ou não as notificações.',
    notes: [
      {
        tag: 'novo',
        text: 'Impressão: impressora desligada ou desconectada aparece em vermelho no ícone do topo, na tela Impressão e num aviso na hora em que ela para de responder.',
      },
      {
        tag: 'novo',
        text: 'Aplicativo de impressão 1.8.0: faixa vermelha e notificação quando a impressora desliga, e outra notificação quando ela volta.',
      },
      {
        tag: 'novo',
        text: 'Aplicativo de impressão 1.8.0: botão Receber notificações, no rodapé.',
      },
    ],
  },
  {
    version: '0.211.4',
    date: '2026-11-21',
    title: 'Vender fiado ocupa o pedido todo',
    summary:
      'Ao clicar em Vender fiado (e em Desconto, Cancelar, Despachar, A receber ou Estornar), o formulário toma a área toda do pedido, com o título no alto e um Voltar ao pedido, sem precisar rolar para achar os campos e o botão.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Pedido: os formulários de ação abrem no lugar das colunas do pedido, centralizados; no notebook, nome e WhatsApp do fiado ficam lado a lado e o botão de confirmar aparece sem rolar.',
      },
    ],
  },
  {
    version: '0.211.3',
    date: '2026-11-20',
    title: 'Ícones próprios na barra do pedido',
    summary:
      'Cada botão da barra do pedido tem um ícone que diz o que ele faz, maior e num círculo com leve degradê: impressora, chapéu de cozinheiro, selo de porcentagem, caderneta do fiado, mão com moedas e o X de cancelar.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Pedido: Desconto / Acréscimo com selo de porcentagem e Vender fiado com a caderneta; os ícones da barra ficaram maiores, num círculo com degradê e contorno que acende ao passar o mouse.',
      },
    ],
  },
  {
    version: '0.211.2',
    date: '2026-11-20',
    title: 'Cardápio do cliente abre mais rápido e sem peças trocando de lugar',
    summary:
      'Ao abrir ou recarregar o cardápio, a tela não mostra mais desenhos diferentes um depois do outro: um esqueleto só, no formato da loja, até o cardápio aparecer. O cardápio também chega antes, e quem já abriu uma vez vê a loja na hora ao recarregar.',
    notes: [
      {
        tag: 'correção',
        text: 'Cardápio online: ao recarregar, apareciam três telas de carregamento diferentes (uma delas parecida com o painel da equipe) antes do cardápio, e as peças pulavam de lugar. Agora o esqueleto tem o formato da loja no celular, no tablet e no notebook (capa, logo, entrega, busca, categorias e pratos) e não muda até o cardápio aparecer no mesmo lugar.',
      },
      {
        tag: 'melhoria',
        text: 'O cardápio é pedido ao servidor logo que a página abre, junto com os arquivos do app (antes só depois de todos eles chegarem).',
      },
      {
        tag: 'melhoria',
        text: 'O último cardápio aberto fica guardado no aparelho: ao recarregar, a loja aparece na hora e o cardápio do servidor toma o lugar assim que chega (preços e loja aberta ou fechada sempre do servidor). Limpar o cache do restaurante pelo painel apaga essa cópia.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio com tema escuro escolhido pela loja já abre escuro, sem piscar claro antes.',
      },
      {
        tag: 'melhoria',
        text: 'A lista "Mais pedidos" do cardápio fica guardada por 5 minutos no servidor, em vez de somar 30 dias de pedidos a cada visita.',
      },
    ],
  },
  {
    version: '0.211.1',
    date: '2026-11-20',
    title: 'Todo botão do pedido com ícone, em duas linhas',
    summary:
      'O rodapé do pedido ficou em duas linhas: a barra de ícones em cima e, embaixo, os passos e o Fechar conta lado a lado, todos com ícone. Pedido fechado mostra os botões que sobram grandes, ocupando a largura.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Pedido: Aceitar, Iniciar preparo, Marcar pronto, Concluir, Entregue, Despachar entregador, Entregue na mesa, Recusar e Manter pedido ganharam ícone.',
      },
      {
        tag: 'melhoria',
        text: 'Pedido: no notebook, os passos e o Fechar conta ficam numa linha só, do mesmo tamanho, embaixo da barra de ícones; o resumo de valores acompanha a altura das duas linhas.',
      },
      {
        tag: 'melhoria',
        text: 'Pedido fechado ou cancelado: Imprimir pedido e Imprimir cozinha viram botões grandes, com ícone ao lado do nome, dividindo a largura.',
      },
    ],
  },
  {
    version: '0.211.0',
    date: '2026-11-20',
    title:
      'Endereço de entrega certo no mapa, mesmo em outra cidade, e pino confirmado pelo cliente',
    summary:
      'A busca do endereço do cliente não cai mais no ponto da loja quando o endereço fica em outra cidade ou a mais de 80 km da loja: vale a cidade digitada ou a do CEP, e as áreas de entrega também contam. Ao adicionar um endereço, o cliente confirma o local no mapa antes de valer.',
    notes: [
      {
        tag: 'correção',
        text: 'Cardápio online: endereço em outra cidade (por exemplo, loja marcada em São Paulo e cliente em Campinas) mostrava "Não achamos esse endereço no mapa" e o pino na loja. A busca descartava tudo a mais de 80 km do ponto da loja; agora vale o resultado na cidade do cliente (digitada ou do CEP) e o que fica perto de qualquer área de entrega.',
      },
      {
        tag: 'correção',
        text: 'Com a cidade informada pelo cliente, a mesma rua em outra cidade vizinha não é mais aceita por engano.',
      },
      {
        tag: 'melhoria',
        text: 'Endereço novo (na sacola e em Conta › Endereços): o mapa aparece logo e o cliente confirma o local com "É aqui, confirmar local", arrastando o pino ou tocando no mapa. A taxa só é calculada depois disso.',
      },
      {
        tag: 'novo',
        text: 'Conta › Endereços: o endereço salvo guarda o ponto confirmado no mapa, e com áreas de entrega ele só é salvo depois de confirmar o local. O próximo pedido já abre com o pino certo.',
      },
    ],
  },
  {
    version: '0.210.2',
    date: '2026-11-20',
    title: 'Nova barra de ações do pedido',
    summary:
      'O rodapé do pedido ganhou uma barra arredondada com botões de ícone e o nome embaixo (Imprimir pedido, Imprimir cozinha, Desconto / Acréscimo, Vender fiado, A receber e Cancelar pedido) e um Fechar conta grande e verde.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Pedido: as ações de apoio viraram uma barra com ícones em círculo e o nome embaixo, em três grupos (Impressão, Cobrança e Cancelar em vermelho).',
      },
      {
        tag: 'melhoria',
        text: 'Pedido: Fechar conta ficou maior, em verde e com a seta no fim, ao lado de Iniciar preparo e Marcar pronto; o resumo de valores segue à direita no notebook.',
      },
      {
        tag: 'melhoria',
        text: 'Pedido: no celular, a barra de ícones corre de lado e o Fechar conta ocupa a largura toda.',
      },
    ],
  },
  {
    version: '0.210.1',
    date: '2026-11-20',
    title: 'Comprovante de fechamento só depois de fechar a conta e retirada sem taxa e frete',
    summary:
      'No Fechar conta, o comprovante só é liberado depois que a conta fecha e sai com tudo o que foi lançado: taxa de serviço, frete, desconto, pagamentos, troco e CPF/CNPJ. Pedido de retirada não tem mais taxa de serviço nem frete, e o desconto não vira troco.',
    notes: [
      {
        tag: 'correção',
        text: 'Fechar conta: o botão Imprimir só fica liberado depois de fechar a conta. Antes, o comprovante saía com o total antigo, sem o desconto, a taxa e o frete que ainda não estavam gravados, e com a forma de pagamento que o cliente escolheu no cardápio em vez da que foi recebida.',
      },
      {
        tag: 'correção',
        text: 'Fechar conta: mudar o desconto, a taxa de serviço ou o frete refaz o valor do pagamento pelo total novo. Antes, o valor digitado sobre o total antigo podia virar troco (R$ 2,00 de desconto aparecendo como R$ 2,00 de troco).',
      },
      {
        tag: 'melhoria',
        text: 'Comprovante de fechamento: mostra o CPF/CNPJ na nota quando o cliente pediu (variável pedido.cpf_cnpj nos modelos de impressão).',
      },
      {
        tag: 'correção',
        text: 'Retirada não tem taxa de serviço nem frete: os campos somem do Fechar conta e o sistema zera os dois ao lançar ou ajustar um pedido de retirada.',
      },
    ],
  },
  {
    version: '0.210.0',
    date: '2026-11-20',
    title: 'Endereço de entrega pelo bairro, editar endereço na sacola e CEP pelo bairro',
    summary:
      'Na loja com taxa por bairro, o endereço do cliente vale pelo nome do bairro mesmo quando o pino fica um pouco fora da área desenhada. Na sacola dá para editar o endereço salvo, o CEP entra sozinho ao digitar o bairro e a tela de acompanhar o pedido ganhou a seta de voltar e ficou maior no notebook.',
    notes: [
      {
        tag: 'correção',
        text: 'Cardápio online: "Ainda não entregamos neste ponto" aparecia para endereços dentro da área quando o pino caía fora do desenho. Agora, se o ponto não está em nenhuma área, vale a área com o nome do bairro do endereço ("Parque São Martinho" acha "Loteamento Parque São Martinho", "Pq. S. Martinho"…). A API confere igual ao fechar o pedido.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio online: fora da área, o aviso mostra os bairros onde a loja entrega, para o cliente conferir o nome do bairro.',
      },
      {
        tag: 'novo',
        text: 'Sacola: botão Editar em cada endereço salvo, para corrigir rua, número, bairro ou CEP ali mesmo. Mudou o endereço, o mapa procura o ponto de novo (o ponto antigo é apagado, também em Conta › Endereços).',
      },
      {
        tag: 'melhoria',
        text: 'Endereço: com a rua preenchida, digitar o bairro já coloca o CEP do trecho daquele bairro (e a busca pela rua escolhe sozinha o CEP do bairro já digitado).',
      },
      {
        tag: 'melhoria',
        text: 'Acompanhar pedido: seta de voltar no topo e, no notebook e no monitor grande, letras, ícones, etapas, fotos e botões maiores.',
      },
    ],
  },
  {
    version: '0.209.4',
    date: '2026-11-20',
    title: 'Mais espaço entre os botões do pedido',
    summary:
      'Os botões do rodapé do pedido estavam muito juntos. Agora têm mais folga entre si, entre as linhas e até a barra de Cancelar pedido e Fechar conta.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Pedido: botões de Impressão e Cobrança um pouco maiores e mais afastados, com mais espaço entre os dois grupos e antes da barra que decide o pedido.',
      },
    ],
  },
  {
    version: '0.209.3',
    date: '2026-11-20',
    title: 'Botões do pedido todos embaixo',
    summary:
      'Imprimir pedido, Desconto ou acréscimo, Vender fiado e Reimprimir na cozinha saíram do topo do pedido e agora ficam no rodapé, logo acima de Cancelar pedido e Fechar conta, separados em Impressão e Cobrança.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Pedido: as ações de apoio (Imprimir pedido, Via de entrega, Reimprimir na cozinha, Desconto ou acréscimo, Vender fiado, Concluir a receber) moram no rodapé, numa fileira própria acima dos botões que decidem o pedido, em dois grupos: Impressão e Cobrança.',
      },
      {
        tag: 'melhoria',
        text: 'Pedido: no celular, a fileira de ações corre de lado no rodapé, sem deixar o rodapé alto; no notebook, os botões descem para a linha de baixo quando não cabem.',
      },
    ],
  },
  {
    version: '0.209.2',
    date: '2026-11-20',
    title: 'Prato em 3D só no celular e leitor de QR mais firme',
    summary:
      'O botão do prato em 3D no cardápio agora aparece só no celular e no tablet, onde a câmera coloca o prato na mesa. O leitor de QR Code da mesa ficou mais firme em aparelhos que diziam ler QR e não liam.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cardápio: "Ver na sua mesa" e "Ver em 3D" aparecem só para quem abre o cardápio no celular ou no tablet. No computador e no notebook o botão não aparece.',
      },
      {
        tag: 'correção',
        text: 'Escanear mesa: quando o leitor de QR do próprio navegador não lê QR Code (comum no computador), o Comandou usa o leitor dele, em vez de deixar a câmera aberta sem ler nada.',
      },
      {
        tag: 'melhoria',
        text: 'Escanear mesa: também lê o QR com o link do cardápio da mesa (/pedir?mesa=...), além do QR colado na mesa.',
      },
    ],
  },
  {
    version: '0.209.1',
    date: '2026-11-20',
    title: 'Tela Impressão arrumada no notebook e no celular',
    summary:
      'A fila de impressão quebrava no notebook: os botões de cada trabalho caíam para baixo e sumiam pela esquerda. Agora cada linha se ajeita ao espaço da lista, com os botões embaixo do texto quando não cabem.',
    notes: [
      {
        tag: 'correção',
        text: 'Impressão: no notebook e no celular, os botões de cada trabalho da fila (Imprimir de novo, Voltar para a fila, Apagar) ficam embaixo do texto e inteiros, sem cortar.',
      },
      {
        tag: 'correção',
        text: 'Impressão: nome comprido da impressora não passa mais da borda no celular, os botões dos computadores descem para a linha de baixo quando falta espaço e o filtro de destino ocupa a largura toda no celular.',
      },
    ],
  },
  {
    version: '0.209.0',
    date: '2026-11-20',
    title: 'Fila de impressão com apagar e filtros, e aplicativo que se atualiza sozinho',
    summary:
      'A fila da tela Impressão agora deixa apagar trabalhos (um, os escolhidos ou o histórico inteiro), escolher vários de uma vez, buscar pelo número do pedido e filtrar por destino. O aplicativo Comandou Impressão 1.7.0 ganhou o botão Atualizar, que baixa a versão nova, fecha e abre de novo sozinho, e uma tela mais simples: impressoras de um lado, onde cada coisa imprime do outro.',
    notes: [
      {
        tag: 'novo',
        text: 'Impressão: apagar trabalhos da fila, um por um pela lixeira ou vários de uma vez (escolha e toque em Apagar). O que ainda ia imprimir não sai mais.',
      },
      {
        tag: 'novo',
        text: 'Impressão: botão Apagar histórico, que limpa os impressos, os que falharam e os tirados da fila (a fila de espera fica).',
      },
      {
        tag: 'melhoria',
        text: 'Impressão: aba Impressos, busca pelo número do pedido, destino ou computador, filtro por destino, "Mostrar mais" e contagem de cada aba pela fila inteira (não só pelos últimos 100).',
      },
      {
        tag: 'melhoria',
        text: 'Impressão: escolher vários trabalhos e tirar da fila ou imprimir de novo todos juntos.',
      },
      {
        tag: 'correção',
        text: 'Trabalhos tirados da fila antes da versão anterior apareciam como "Falhou": agora aparecem como "Tirado da fila".',
      },
      {
        tag: 'novo',
        text: 'Aplicativo de impressão 1.7.0: botão Atualizar no topo quando há versão nova (e "Procurar atualização" no rodapé). No Windows e no Linux ele baixa, fecha e abre de novo sozinho; no Mac abre o download. Depois desta, não precisa mais reinstalar na mão.',
      },
      {
        tag: 'melhoria',
        text: 'Aplicativo de impressão 1.7.0: impressoras deste computador de um lado e onde cada coisa imprime do outro, com o botão Desconectar em cada impressora escolhida. "Últimas impressões" saiu do aplicativo: o histórico fica na tela Impressão do Comandou.',
      },
    ],
  },
  {
    version: '0.208.0',
    date: '2026-11-20',
    title: 'Impressão sem cópias repetidas, excluir computador e trabalhos de cada impressora',
    summary:
      'Uma impressora comum (jato de tinta) ligada pelo Windows podia imprimir a mesma comanda várias vezes e continuar imprimindo mesmo depois de limpar a fila. Agora o que pode ter saído não é mandado de novo sozinho, tirar da fila vale também para o que já estava com o computador e a fila do Windows é limpa junto. A tela Impressão ganhou excluir computador, tirar impressora e a lista do que vai sair e do que já saiu em cada impressora. Atualize o aplicativo Comandou Impressão para a 1.6.0.',
    notes: [
      {
        tag: 'correção',
        text: 'Comanda que o Windows já tinha recebido não é mais mandada de novo quando a impressora responde "falhou" ou demora: aparece como falha com o aviso "confira se saiu" e o botão Imprimir de novo.',
      },
      {
        tag: 'correção',
        text: 'Falha de impressão espera um pouco antes de tentar de novo (10 s, 20 s, 40 s...), em vez de repetir a cada 3 segundos.',
      },
      {
        tag: 'correção',
        text: 'Tirar da fila agora vale também para o que já estava imprimindo, e Limpar fila apaga as comandas paradas na fila do Windows dos computadores conectados. O que foi tirado aparece como "Tirado da fila", não como falha.',
      },
      {
        tag: 'correção',
        text: 'Aplicativo de impressão 1.6.0: se a impressora comum parou com comandas acumuladas na fila do Windows, não manda mais nenhuma até ela voltar (antes saía tudo de uma vez quando ela voltava).',
      },
      {
        tag: 'correção',
        text: 'Aplicativo de impressão 1.6.0: impressora jato de tinta escolhida como térmica pela rede passa sozinha a imprimir pelo Windows, numa folha.',
      },
      {
        tag: 'novo',
        text: 'Impressão: botão para excluir um computador conectado e botão Limpar fila do Windows em cada computador.',
      },
      {
        tag: 'novo',
        text: 'Impressão: toque numa impressora para ver o que ainda vai sair nela e o que já saiu, e para tirá-la do computador.',
      },
    ],
  },
  {
    version: '0.207.0',
    date: '2026-11-20',
    title:
      'Auditoria completa: segurança das contas, nota fiscal, DRE e valores digitados com ponto',
    summary:
      'Revisão do sistema inteiro, com testes de ponta a ponta e uma leitura do código por área. Esta versão traz as correções já conferidas: a conta de quem trabalha em dois restaurantes ficou protegida, a nota fiscal não é mais recusada por endereço longo, as notas paradas voltam sozinhas para a fila, o DRE não conta a mesma taxa duas vezes e valores digitados com ponto valem o que se espera.',
    notes: [
      {
        tag: 'segurança',
        text: 'Quem usa a mesma conta em outro restaurante não recebe PIN, e para trocar a senha dela é preciso digitar a senha atual: o dono de um restaurante não consegue mais tomar a conta que a pessoa usa em outro.',
      },
      {
        tag: 'segurança',
        text: 'Muitas tentativas de PIN ao mesmo tempo não passam mais do limite de erros do restaurante.',
      },
      {
        tag: 'segurança',
        text: 'Os registros do servidor não guardam mais tokens de links nem os cabeçalhos com a chave do Asaas e as assinaturas dos aplicativos.',
      },
      {
        tag: 'novo',
        text: 'Nota fiscal parada em "pendente", "processando" ou "cancelando" há mais de 15 minutos (por exemplo, depois de o servidor reiniciar) volta sozinha para a fila, sem ninguém precisar tocar em Atualizar.',
      },
      {
        tag: 'correção',
        text: 'Nota fiscal com endereço do cliente longo (rua, bairro, complemento ou cidade com mais de 60 letras) era recusada pela SEFAZ: agora o endereço vai no tamanho que o leiaute aceita, e e-mail longo demais fica fora da nota.',
      },
      {
        tag: 'correção',
        text: 'DRE: a diferença da conciliação de um repasse que junta vendas de dias diferentes (sexta a domingo, que caem na segunda) contava nos dois meses; agora conta uma vez só, no mês do último dia.',
      },
      {
        tag: 'correção',
        text: 'Extrato OFX com valor sem o zero antes da vírgula ("-.50") deixava a linha de fora sem avisar; agora entra.',
      },
      {
        tag: 'correção',
        text: 'Valor digitado com ponto (ex.: 12.90, em teclado que só mostra ponto) agora vale R$ 12,90, e não mais R$ 1.290,00: troco, taxa de entrega, valor entregue, fidelidade, cobrança, quantidade e custo do estoque.',
      },
      {
        tag: 'correção',
        text: 'Fechar conta: se um dos pagamentos divididos falhar, dá para tentar de novo sem erro e sem cobrar duas vezes.',
      },
      {
        tag: 'correção',
        text: 'Fila sem internet: mudanças seguidas no mesmo pedido não travam mais em "Conflito" depois de uma sincronização que parou no meio.',
      },
      {
        tag: 'correção',
        text: 'Cardápio online: se o pedido já tinha chegado à loja e o cliente mudou a sacola antes de reenviar, não cria um segundo pedido; mostra o pedido que já está na loja.',
      },
      {
        tag: 'correção',
        text: 'Aplicativos de delivery: um aplicativo que demora a mandar a resposta não segura mais a busca de pedidos além do tempo limite.',
      },
    ],
  },
  {
    version: '0.206.0',
    date: '2026-11-20',
    title: 'App abre no celular mesmo quando algo falha, e carregamento em esqueleto',
    summary:
      'O app instalado no celular não fica mais em branco: a tela já chega desenhada e, se uma parte guardada no aparelho estiver quebrada, ele se conserta sozinho. Em todo o sistema, o que está carregando aparece no formato do conteúdo (esqueleto), no lugar do ícone girando.',
    notes: [
      {
        tag: 'correção',
        text: 'App instalado (celular e computador) que abria em branco: quando um arquivo do app guardado no aparelho não chega, o Comandou limpa a cópia guardada e abre de novo sozinho. Se ainda assim não abrir, aparece o botão Tentar de novo (sem apagar dados).',
      },
      {
        tag: 'melhoria',
        text: 'A abertura do app mostra a tela desenhada desde o primeiro instante, no tema claro ou escuro escolhido, em vez de uma tela branca enquanto os arquivos baixam. Internet lenta mostra o aviso com Tentar de novo.',
      },
      {
        tag: 'melhoria',
        text: 'Carregamento em esqueleto em todas as telas: listas, tabelas, números, produtos do PDV e do garçom, formulários, cozinha, conversas, QR Codes e o cardápio do cliente aparecem no formato do que vai chegar, sem pular quando os dados chegam.',
      },
    ],
  },
  {
    version: '0.205.0',
    date: '2026-11-20',
    title: 'Tela de pagamento nova: Pix, boleto e cartão automático',
    summary:
      'Pagar a assinatura agora abre uma tela própria, limpa e direta: o resumo da fatura de um lado e, do outro, Pix, boleto ou cartão. No cartão, o pagamento já deixa a cobrança automática ligada para os próximos vencimentos.',
    notes: [
      {
        tag: 'novo',
        text: 'Tela de pagamento em Assinatura › Pagar: valor, vencimento e o que a fatura cobre à esquerda, e as três formas lado a lado à direita. Funciona no celular, com o Copia e Cola antes do QR Code.',
      },
      {
        tag: 'novo',
        text: 'Pix com espera automática: depois de pagar no app do banco, a tela confere sozinha e mostra "Pagamento confirmado" assim que o Pix cai, sem precisar atualizar.',
      },
      {
        tag: 'novo',
        text: 'Cartão de crédito: pague a fatura e deixe o cartão salvo no Asaas; as próximas mensalidades saem sozinhas no dia do vencimento. Com cartão já salvo, é um toque só. Também dá para pagar só uma vez, sem salvar.',
      },
      {
        tag: 'melhoria',
        text: 'Boleto com a linha digitável para copiar e o PDF a um toque.',
      },
    ],
  },
  {
    version: '0.204.0',
    date: '2026-11-20',
    title: 'Aplicativo de impressão vê qualquer impressora',
    summary:
      'O Comandou Impressão (versão 1.5.0) agora mostra todas as impressoras do computador e da rede, de qualquer tipo, e conta tudo sobre cada uma: tipo, modelo, como está ligada, situação, tinta ou toner, páginas impressas e mais.',
    notes: [
      {
        tag: 'novo',
        text: 'Reconhece o tipo de cada impressora: térmica de cupom, jato de tinta, laser, matricial, etiqueta (Zebra, Argox, Elgin L42…) e virtual (PDF, OneNote). Cada tipo imprime do jeito certo.',
      },
      {
        tag: 'novo',
        text: 'Botão Detalhes em cada impressora: modelo, driver, ligação (USB, rede, Bluetooth, compartilhada, serial), porta, IP e MAC, número de série, páginas impressas, trabalhos na fila do sistema, colorida, frente e verso, resolução, papéis e local.',
      },
      {
        tag: 'novo',
        text: 'Nível de tinta e toner de cada cartucho, e avisos de sem papel, tampa aberta, papel enroscado e offline, lidos da própria impressora (IPP e SNMP na rede, e o que o sistema informa).',
      },
      {
        tag: 'novo',
        text: 'Impressora comum de rede (jato de tinta ou laser no Wi-Fi) aparece na lista e instala com um clique, sem baixar driver do fabricante.',
      },
    ],
  },
  {
    version: '0.203.0',
    date: '2026-11-20',
    title: 'Impressão com a cara do restaurante',
    summary:
      'O aplicativo Comandou Impressão agora usa a cor, o tema e o ícone do restaurante, procura todas as impressoras sozinho ao abrir e imprime também em impressora comum (jato de tinta ou laser). No sistema, a tela Impressão mostra na hora se está imprimindo e o que fazer quando não está.',
    notes: [
      {
        tag: 'novo',
        text: 'Aplicativo de impressão (versão 1.4.0) com a cor, o tema claro/escuro e o ícone do restaurante: na janela, na barra de tarefas, perto do relógio e nos atalhos do Windows.',
      },
      {
        tag: 'novo',
        text: 'Ao abrir, o aplicativo procura todas as impressoras ao mesmo tempo (instaladas, cabo USB, Bluetooth e rede/Wi-Fi) e mostra a lista com o botão Usar.',
      },
      {
        tag: 'novo',
        text: 'Impressora comum (Epson EcoTank, HP, Canon, Brother…) imprime a comanda numa folha, sem abrir janela. Antes ela recebia comandos de impressora térmica e não imprimia.',
      },
      {
        tag: 'novo',
        text: 'Bolinha no ícone do aplicativo perto do relógio e na impressora do topo do sistema: verde conectado, amarela sem impressora escolhida, vermelha desconectado.',
      },
      {
        tag: 'melhoria',
        text: 'Tela Impressão nova: a situação no topo com o que fazer, as impressoras escolhidas em cada computador, a fila com filtro e o motivo de cada trabalho estar esperando.',
      },
      {
        tag: 'novo',
        text: 'Tirar da fila: comanda antiga que não precisa mais sair não imprime de uma vez quando o computador voltar.',
      },
    ],
  },
  {
    version: '0.202.1',
    date: '2026-11-20',
    title: 'Pedido aberto pelo chat sem quebrar',
    summary:
      'O pedido aberto pela conversa com o cliente aparecia espremido, com os dados quebrando letra por letra. Agora ele abre numa janela larga, igual ao da tela de Pedidos.',
    notes: [
      {
        tag: 'correção',
        text: 'Pedido aberto pelo botão do pedido na conversa (Mensagens de clientes) volta a mostrar cliente, status, pagamento e itens sem quebrar, em qualquer tamanho de tela.',
      },
      {
        tag: 'correção',
        text: 'Abrir um pedido por cima de outra gaveta (chat, ficha do cliente) não muda mais a largura da gaveta de baixo.',
      },
    ],
  },
  {
    version: '0.202.0',
    date: '2026-11-19',
    title: 'Avisos que somem ao abrir',
    summary:
      'Na aba Avisos do chat, clicar num aviso já abre o que ele aponta e tira o aviso da lista na hora. Os avisos que ficarem somem sozinhos depois de 7 dias.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Aviso aberto sai da lista na mesma hora, sem esperar o servidor; o botão "Limpar todos" esvazia a lista.',
      },
      {
        tag: 'novo',
        text: 'Avisos da equipe (menções, grupos, mural e IA) são apagados sozinhos 7 dias depois de chegar.',
      },
    ],
  },
  {
    version: '0.201.1',
    date: '2026-11-19',
    title: 'Detalhe do pedido mais fácil de usar',
    summary:
      'A janela do pedido ficou um pouco menor e os botões ganharam lugar certo: as ações de apoio numa fileira no topo e, embaixo, só Cancelar à esquerda e o próximo passo à direita.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Imprimir, desconto, fiado, a receber e reimprimir na cozinha agora ficam numa fileira de botões pequenos no topo do pedido (no celular, uma fileira que corre de lado).',
      },
      {
        tag: 'melhoria',
        text: 'Rodapé do pedido com os botões do tamanho do texto: Cancelar pedido sozinho à esquerda e Fechar conta (ou o próximo passo) à direita, ao lado do total.',
      },
      {
        tag: 'melhoria',
        text: 'A janela do pedido no computador ficou mais estreita (até 1040 px) e o Editar fica só ao lado de Itens do pedido, sem botão repetido.',
      },
    ],
  },
  {
    version: '0.201.0',
    date: '2026-11-19',
    title: 'Perfil do cliente com gráficos',
    summary:
      'A ficha do cliente ficou mais larga e organizada: cada dado numa linha, números num quadro só e gráficos do que ele mais pede do cardápio, quando pede, por onde pede e como paga.',
    notes: [
      {
        tag: 'novo',
        text: 'Ficha do cliente: "O que mais pede" com os 8 itens do cardápio em barras (quantas vezes, em quantos % dos pedidos e quanto gastou), gasto por categoria, canal (Delivery, Retirada, Balcão, Mesa) e forma de pagamento.',
      },
      {
        tag: 'novo',
        text: 'Ficha do cliente: pedidos por mês nos últimos 12 meses, dia da semana e horário em que mais pede, com o destaque em laranja e o detalhe ao passar o mouse.',
      },
      {
        tag: 'novo',
        text: 'Ficha do cliente: "Em poucas palavras" resume o cliente em frases ("Costuma pedir no sábado, das 19h às 20h", "Prefere Delivery") e os números mostram de quantos em quantos dias ele pede e há quanto tempo não pede.',
      },
      {
        tag: 'melhoria',
        text: 'Ficha do cliente: contato, cadastro e endereços um por linha com ícone; no computador, gráficos à esquerda e pedidos, endereços e dados à direita.',
      },
      {
        tag: 'melhoria',
        text: 'Lista de clientes: coluna "Mais pede", valor por pedido embaixo do total, "há X dias" no último pedido e os números do topo num quadro só, com total gasto e ticket médio.',
      },
    ],
  },
  {
    version: '0.200.0',
    date: '2026-11-19',
    title: 'Assistente de IA conhece todas as telas e a IA do WhatsApp diz onde está o pedido',
    summary:
      'O assistente do botão IA agora conhece a Agenda, a Conta, os Aplicativos de delivery, os Chamados e o novo jeito do Estoque, e leva a pessoa ao lugar certo. A IA do WhatsApp responde "cadê meu pedido?" com a situação do pedido daquele número.',
    notes: [
      {
        tag: 'novo',
        text: 'IA do WhatsApp: quando o cliente pergunta do pedido, ela conta em que pé está (em preparo, pronto, saiu para entrega…) pelos pedidos das últimas 24 horas feitos com aquele número. Só do próprio número; problema com o pedido continua indo para a equipe.',
      },
      {
        tag: 'melhoria',
        text: 'Assistente de IA (botão IA do topo): passou a conhecer Agenda pessoal, Conta, Aplicativos de delivery, Chamados e Precificação, as abas novas do Financeiro, Pedidos, Entregas, Loja online e Relatórios, o Fiado e onde ficam Assinatura e Ajustes (na Conta).',
      },
      {
        tag: 'melhoria',
        text: 'Assistente de IA: além do botão que leva à tela, diz o caminho pelo menu, para a pessoa aprender onde fica.',
      },
      {
        tag: 'correção',
        text: 'Assistente de IA: link para uma tela que não existe vira texto, em vez de abrir "Página não encontrada".',
      },
      {
        tag: 'melhoria',
        text: 'Busca do topo: acha a Agenda pessoal e a Precificação do estoque.',
      },
    ],
  },
  {
    version: '0.199.2',
    date: '2026-11-19',
    title: 'Botões do restaurante cabem no celular (Super Admin)',
    summary:
      'No Super Admin pelo celular, os botões do restaurante (Abrir sistema, Conversar, Limpar cache e os outros) agora descem para a linha de baixo em vez de ficarem cortados.',
    notes: [
      {
        tag: 'correção',
        text: 'Detalhe do restaurante no celular: a linha de ações quebra em duas quando não cabe, e nenhum botão fica escondido fora da tela.',
      },
      {
        tag: 'melhoria',
        text: 'As abas do restaurante esmaecem na direita no celular, para mostrar que dá para arrastar e ver as outras.',
      },
    ],
  },
  {
    version: '0.199.1',
    date: '2026-11-19',
    title: 'Logo do Comandou dentro do e-mail',
    summary:
      'A capa e o ícone do Comandou agora vão dentro do próprio e-mail, pelo Resend, e aparecem mesmo quando o programa de e-mail bloqueia imagens de fora.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Capa e logo embutidas no e-mail: aparecem no Outlook e em quem bloqueia imagens de links, sem depender do site estar no ar.',
      },
    ],
  },
  {
    version: '0.199.0',
    date: '2026-11-19',
    title: 'E-mails com capa do Comandou e botão de copiar o código',
    summary:
      'Os e-mails do Comandou abrem com uma capa nova, com a marca e o panda de cada assunto. No e-mail de nova senha, o código vem logo no começo, com o botão Copiar código.',
    notes: [
      {
        tag: 'novo',
        text: 'Botão Copiar código nos e-mails de nova senha (equipe, Super Admin e cliente do cardápio online): abre uma página que já copia o código; é só voltar e colar na tela de nova senha.',
      },
      {
        tag: 'melhoria',
        text: 'O código aparece logo no começo do e-mail, antes de qualquer explicação.',
      },
      {
        tag: 'melhoria',
        text: 'Capa nova no topo dos e-mails do Comandou, com o nome do sistema e o panda de cada assunto (chave na senha, relógio no vencimento, confete no pagamento).',
      },
    ],
  },
  {
    version: '0.198.5',
    date: '2026-11-19',
    title: 'Aplicativos de delivery com cara nova',
    summary:
      'A tela Aplicativos de delivery ficou mais clara: números no topo, um cartão por aplicativo ligado com os ajustes de cada loja em interruptores e os que faltam ligar separados.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Aplicativos de delivery: no topo, quantos aplicativos estão recebendo pedidos, quantas lojas estão ligadas, quantas estão pausadas e o que falhou na semana.',
      },
      {
        tag: 'melhoria',
        text: 'Cada aplicativo ligado ganhou um cartão com o nome na cor da marca, a situação da loja, o último pedido e os ajustes (Receber pedidos, Aceitar sozinho, Fechar junto com a loja) em interruptores, lado a lado no computador.',
      },
      {
        tag: 'melhoria',
        text: 'Os aplicativos ainda sem loja ficam num grupo separado, cada um dizendo o que fazer para ligar; os que ainda vão chegar aparecem numa linha só. "O que funciona" mostra com visto o que cada aplicativo oferece e numa frase o que ele não oferece.',
      },
    ],
  },
  {
    version: '0.198.4',
    date: '2026-11-19',
    title: 'Site: começo e aplicativos de delivery redesenhados',
    summary:
      'O topo do comandou.com ficou mais limpo: o celular da loja num quadro só, com os pedidos chegando ao lado. A seção dos aplicativos de delivery ganhou a faixa com os nomes e uma fila de pedidos mais caprichada.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Topo do site: saiu a tela da cozinha cortada na borda e os avisos amontoados. Agora o celular da loja (que mostra o que você digita) fica num quadro de tom quente, com o cartão "Pedidos agora" ao lado: a cada poucos segundos chega um pedido de um canal diferente (mesa, balcão, cardápio online, iFood, 99Food…) e as vendas do dia sobem junto.',
      },
      {
        tag: 'melhoria',
        text: 'Seção Aplicativos do site: os nomes dos aplicativos numa faixa só, a fila de pedidos com o aplicativo de cada um, cliente, tempo, Aceitar nos novos e a situação dos outros, e a lista do que dá para fazer sem abrir o portal, com ícones.',
      },
      {
        tag: 'correção',
        text: 'Menu do site em notebook estreito: os links não quebram mais em duas linhas nem empurram o botão para fora da tela (vira o botão de menu abaixo de 1080 px).',
      },
    ],
  },
  {
    version: '0.198.3',
    date: '2026-11-19',
    title: 'Acabamento: linhas, cores e fotos mais limpas',
    summary:
      'Linhas finas que se ajustam a qualquer fundo, misturas de cor mais limpas, cantos que acompanham o cartão e fotos de produto sem o retângulo branco no cardápio.',
    notes: [
      {
        tag: 'melhoria',
        text: 'As linhas que separam cartões, listas e campos agora são levemente transparentes: ficam do mesmo jeito sobre o branco e acompanham fotos, cor da loja e cartões sobre cartões, no claro e no escuro.',
      },
      {
        tag: 'melhoria',
        text: 'As misturas e degradês de cor (fundos suaves, selos, a cor da loja) passaram a ser calculados em OKLCH/OKLab, que segue o olho humano: os tons claros da cor da loja ficam mais limpos, sem puxar para o cinza.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio online: foto de produto com fundo branco não aparece mais como um retângulo branco; ela se mistura ao cinza do quadro (só no modo claro).',
      },
      {
        tag: 'melhoria',
        text: 'Cantos concêntricos: a foto dentro do cartão do cardápio, as opções do seletor e o submenu do menu lateral agora têm cantos que acompanham o de fora.',
      },
    ],
  },
  {
    version: '0.198.2',
    date: '2026-11-19',
    title: 'Cartão pelo app não cobra duas vezes quando o PagBank demora',
    summary:
      'Quando o PagBank não responde a tempo, o Comandou repete o mesmo envio sem risco de cobrar de novo e não deixa o cliente passar outro cartão enquanto a primeira cobrança não se resolve.',
    notes: [
      {
        tag: 'correção',
        text: 'Pagamento pelo app: se o PagBank demorava a responder, o cliente podia tentar outro cartão e pagar duas vezes. Agora o envio sem resposta é repetido na hora com a mesma chave, e o PagBank devolve o pedido que já tinha criado em vez de cobrar de novo.',
      },
      {
        tag: 'correção',
        text: 'Se o PagBank continuar sem responder, outro cartão fica bloqueado nesse pedido e o cliente pode pagar com Pix. Se o cartão tiver passado, o valor é devolvido sozinho.',
      },
    ],
  },
  {
    version: '0.198.1',
    date: '2026-11-19',
    title: 'Auditoria das integrações e da nota fiscal',
    summary:
      'Revisão da nota fiscal, do pagamento pelo app, da cobrança e dos aplicativos de delivery. Cinco falhas corrigidas, com testes, e o relatório completo em docs/auditoria-integracoes-2026-11.md.',
    notes: [
      {
        tag: 'correção',
        text: 'Pagamento pelo app: o cliente que gerava o Pix, trocava para o cartão e depois pagava o Pix antigo tinha o Pix ignorado (o dinheiro entrava e não aparecia no Comandou). Agora ele aparece e é devolvido sozinho quando o pedido já estava pago ou cancelado. A conferência também procura esse Pix por 10 minutos depois do vencimento, caso o aviso do PagBank se perca.',
      },
      {
        tag: 'correção',
        text: 'Nota fiscal: uma NF-e recusada e emitida de novo podia ficar parada em "processando" até alguém tocar em Atualizar, e um cancelamento com a Focus fora do ar podia ficar parado em "cancelando". A fila descartava a nova consulta por ter o mesmo nome da anterior.',
      },
      {
        tag: 'correção',
        text: 'Nota fiscal: uma nota recusada em homologação não é mais reaproveitada depois que a emissão passa para produção (sairia sem valor fiscal). A NFC-e nova sai no ambiente atual; a NF-e pede para apagar o rascunho antigo e emitir outra.',
      },
      {
        tag: 'correção',
        text: 'Nota fiscal: tocar em Atualizar enquanto a nota ainda estava sendo enviada podia imprimir o cupom e mandar o e-mail duas vezes.',
      },
      {
        tag: 'correção',
        text: 'Aplicativos de delivery: pedir o cancelamento de novo depois que o aplicativo negou o primeiro pedido não chegava ao aplicativo, e o pedido ficava parado em "Cancelamento solicitado".',
      },
    ],
  },
  {
    version: '0.198.0',
    date: '2026-11-19',
    title: 'Aplicativo de impressão acha a impressora sozinho: rede, USB e Bluetooth',
    summary:
      'O Comandou Impressão 1.3 encontra impressoras pela rede (até pelo nome de fábrica), instala a USB que está sem driver, liga as Bluetooth que não criam porta e mostra se cada impressora está pronta. Agora também em notebooks com processador ARM.',
    notes: [
      {
        tag: 'novo',
        text: 'Rede e Wi-Fi: a procura usa a porta 9100 e o Bonjour (mostra o nome e o modelo), cobre redes maiores de roteador e tem o botão Testar este IP, que descobre a porta sozinho.',
      },
      {
        tag: 'novo',
        text: 'Se o roteador der outro IP para a impressora, o aplicativo acha ela pelo endereço físico, continua imprimindo e salva o IP novo em todos os setores.',
      },
      {
        tag: 'novo',
        text: 'USB sem driver: a impressora ligada no cabo aparece com o botão Instalar, que usa o driver do próprio sistema (Windows, macOS e Linux).',
      },
      {
        tag: 'novo',
        text: 'Bluetooth: impressora pareada sem porta aparece com Criar porta (Windows abre a tela certa; Linux cria e deixa fixa), e as portáteis só BLE ligam sem parear, pelo botão Procurar por BLE.',
      },
      {
        tag: 'melhoria',
        text: 'Cada impressora ganha uma bolinha verde ou vermelha com o motivo, conferida a cada 2 minutos sem imprimir; em rede, Ver situação avisa se falta papel ou se a tampa está aberta.',
      },
      {
        tag: 'melhoria',
        text: 'Instaladores para Windows em ARM (no mesmo instalador) e Linux em ARM; no Mac, o aplicativo pede as permissões de Bluetooth e rede local.',
      },
    ],
  },
  {
    version: '0.197.0',
    date: '2026-11-19',
    title: 'Cada cardápio com as suas regras: o da mesa é só pedir',
    summary:
      'O cardápio aberto pelo QR Code da mesa mostra só o que o cliente sentado precisa: escolher, enviar e acompanhar. Conversa, entrega, reserva, favoritos, fidelidade e conta ficam no cardápio online.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápio da mesa: bloco de boas-vindas com o número da mesa em destaque e os três passos (Escolha, Envie, Chega na mesa ou Busque no balcão), que acendem conforme o cliente avança, com a taxa de serviço e como pagar.',
      },
      {
        tag: 'novo',
        text: 'Aba "Minha mesa" no lugar de Pedidos: os pedidos que o celular mandou para a mesa, com o andamento de cada um (atualiza sozinho), o total já pedido e o botão Pedir mais.',
      },
      {
        tag: 'melhoria',
        text: 'Na mesa saem a aba Conversa, Favoritos, Conta, a fidelidade, a reserva, o aviso de instalar o app e o "Falar com a loja" do acompanhamento: quem resolve é o garçom. A conta só aparece quando o cliente escolhe pagar pelo Pix no app.',
      },
      {
        tag: 'melhoria',
        text: 'As regras de cada cardápio (mesa e online) ficam num lugar só, lido pela API e pelo cardápio, e o endereço de uma tela que o cardápio não tem volta para o início.',
      },
    ],
  },
  {
    version: '0.196.0',
    date: '2026-11-19',
    title: 'Limpar o cache do restaurante pelo Super Admin',
    summary:
      'Um botão no Super Admin apaga tudo que fica guardado de um restaurante, no servidor e em todas as telas abertas dele, que recarregam sozinhas direto do servidor.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › restaurante › Limpar cache: com confirmação, limpa o cache da API (em todas as réplicas) e manda o sistema, o app instalado, a cozinha, o garçom, o entregador e o cardápio online apagarem os arquivos do app e as leituras guardadas e recarregarem.',
      },
      {
        tag: 'melhoria',
        text: 'Aparelho que estava fechado ou sem internet na hora limpa sozinho quando abrir de novo. As vendas feitas sem internet que ainda não subiram, o login e os ajustes do aparelho ficam.',
      },
      {
        tag: 'segurança',
        text: 'Só o Super Admin limpa, com limite por minuto, e cada limpeza fica no Histórico do restaurante com quantas telas recarregaram.',
      },
    ],
  },
  {
    version: '0.195.0',
    date: '2026-11-19',
    title: 'Sinal da conexão no topo e mais telas ao vivo',
    summary:
      'O topo do sistema ganhou as barrinhas de sinal, como as do Wi-Fi, que dizem a todo momento se a conexão está excelente, boa, lenta ou ruim. Financeiro, Clientes, Equipe e Agenda passam a se atualizar sozinhos, sem recarregar a tela.',
    notes: [
      {
        tag: 'novo',
        text: 'Sinal da conexão no topo: as barrinhas medem a cada 5 segundos quanto o Comandou demora para responder a este aparelho e ficam verdes, amarelas ou vermelhas. Tocando nelas, aparecem o tempo de resposta, as últimas medições, o tipo de rede e o botão Testar agora.',
      },
      {
        tag: 'melhoria',
        text: 'Financeiro ao vivo: contas, resumo, visão geral, DRE, fechamentos e conciliação se atualizam sozinhos quando alguém lança uma conta, fecha o caixa ou recebe um pedido, sem piscar a tela.',
      },
      {
        tag: 'melhoria',
        text: 'Clientes, Equipe e Agenda também se atualizam sozinhos quando algo muda em outro aparelho.',
      },
    ],
  },
  {
    version: '0.194.0',
    date: '2026-11-19',
    title: 'Todos os aplicativos de delivery num lugar só',
    summary:
      'Uma aba Aplicativos em Pedidos junta os pedidos do iFood, 99Food, Keeta, Rappi, aiqfome e dos outros aplicativos, e o relatório Vendas por aplicativo mostra quanto cada um vendeu, cobrou de taxa e deixou de líquido.',
    notes: [
      {
        tag: 'novo',
        text: 'Relatórios › Delivery › Vendas por aplicativo: pedidos, vendido, ticket médio, cancelados, taxas e líquido de cada aplicativo, com a venda própria e o período anterior para comparar.',
      },
      {
        tag: 'novo',
        text: 'Pedidos › aba Aplicativos: os pedidos de todos os aplicativos de delivery de hoje juntos, com o filtro e a coluna Aplicativo para ver um só.',
      },
      {
        tag: 'melhoria',
        text: 'A busca de Pedidos acha pelo nome do aplicativo e pelo código do pedido nele.',
      },
      {
        tag: 'correção',
        text: 'Aplicativo Open Delivery cadastrado no painel aparece com o nome dado (ex.: Anota AI) no selo dos pedidos, na cozinha, nas entregas e nos relatórios.',
      },
      {
        tag: 'melhoria',
        text: 'Guia novo para ligar cada aplicativo de delivery, com o que cada um faz e o que fazer nos problemas mais comuns.',
      },
    ],
  },
  {
    version: '0.193.0',
    date: '2026-11-19',
    title: 'Site novo: começo, fim e os aplicativos de delivery',
    summary:
      'O site do Comandou ganhou um começo mais direto (o celular da loja aparece ao lado do cadastro e muda enquanto você digita), um final com rodapé de verdade e uma seção mostrando os pedidos do iFood, 99Food, Keeta, Rappi e aiqfome entrando na mesma fila da cozinha.',
    notes: [
      {
        tag: 'novo',
        text: 'Site: seção Aplicativos, com a fila de pedidos de cada aplicativo e o que dá para fazer sem abrir o portal deles.',
      },
      {
        tag: 'melhoria',
        text: 'Site: topo em duas colunas no computador, com o cadastro de um lado e o celular da loja do outro, já mostrando o que você escreve.',
      },
      {
        tag: 'melhoria',
        text: 'Site: final com um convite só e o rodapé com links de Produto e Ajuda, no lugar das frases gigantes.',
      },
      {
        tag: 'melhoria',
        text: 'Site: nova pergunta sobre os pedidos do iFood e dos outros aplicativos.',
      },
    ],
  },
  {
    version: '0.192.3',
    date: '2026-11-19',
    title: 'Campos menores e alinhados nas telas de ajuste',
    summary:
      'Loja online › Funcionamento ficou mais arrumada: campos menores e na mesma altura, agrupados por assunto, e os liga/desliga lado a lado. Ajustes também ganhou campos do tamanho certo.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Funcionamento da loja online dividido em blocos (Pedidos pelo cardápio, Entrega e endereço, Horário, Pedido pela mesa), com campos compactos e liga/desliga no lugar das caixinhas.',
      },
      {
        tag: 'melhoria',
        text: 'Horário de funcionamento: um dia por linha, com os horários alinhados.',
      },
      {
        tag: 'melhoria',
        text: 'Ajustes: nome do setor, avisos e taxa de serviço com largura certa, sem campo esticado na tela toda.',
      },
      {
        tag: 'correção',
        text: 'Campo ao lado de outro com dica mais longa não fica mais alto que os vizinhos.',
      },
    ],
  },
  {
    version: '0.192.2',
    date: '2026-11-19',
    title: 'Detalhe do pedido mais largo e organizado',
    summary:
      'No computador, a gaveta que abre ao clicar num pedido ficou bem mais larga: o pedido e os itens à esquerda, pagamentos, nota fiscal e histórico à direita, e os totais ao lado dos botões.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Gaveta do pedido ocupa boa parte da tela no computador, em duas colunas, com o histórico já aberto. No celular e no tablet segue como antes.',
      },
      {
        tag: 'melhoria',
        text: 'Cada item mostra quantidade, preço e total na mesma linha, e quando entrou em preparo ou ficou pronto.',
      },
      {
        tag: 'novo',
        text: 'O detalhe mostra quem lançou o pedido, há quanto tempo foi feito, o horário agendado e quando foi entregue na mesa. Telefone sai formatado e some quando não foi informado.',
      },
    ],
  },
  {
    version: '0.192.1',
    date: '2026-11-19',
    title: 'Nota fiscal de pedido do iFood com o intermediador',
    summary:
      'A NFC-e e a NF-e de pedidos que chegam pelo iFood agora informam que a venda foi intermediada pelo aplicativo, com o CNPJ do iFood e o código da sua loja nele, como pede a SEFAZ.',
    notes: [
      {
        tag: 'correção',
        text: 'Pedido do iFood: a nota sai com o intermediador (CNPJ do iFood e o código da loja no iFood), como exige a nota técnica 2020.006.',
      },
      {
        tag: 'correção',
        text: 'NF-e de pedido de aplicativo sai como venda pela internet (presença 2).',
      },
    ],
  },
  {
    version: '0.192.0',
    date: '2026-11-19',
    title: 'Pedidos do aiqfome e de outros aplicativos Open Delivery',
    summary:
      'A loja do aiqfome liga com a autorização no ID Magalu e os pedidos chegam sozinhos. Outros aplicativos que falam o padrão Open Delivery passam a funcionar só com o cadastro no Super Admin.',
    notes: [
      {
        tag: 'novo',
        text: 'Sistema › Aplicativos de delivery › aiqfome: "Ligar uma loja" pede o código da loja e leva ao ID Magalu; a pessoa autoriza e volta com a loja ligada. Os pedidos chegam a cada 30 segundos, e aceitar, pronto (na retirada), saiu e entregue voltam para o aiqfome.',
      },
      {
        tag: 'novo',
        text: 'Pedido cancelado no gestor do aiqfome cancela aqui também. Recusar e cancelar continuam no gestor do aiqfome, que não oferece isso para o sistema.',
      },
      {
        tag: 'novo',
        text: 'Super Admin › Credenciais › Outros aplicativos Open Delivery: com nome, endereço da API e chaves, o aplicativo ganha um cartão em Aplicativos de delivery em até um minuto, sem atualizar o sistema.',
      },
      {
        tag: 'segurança',
        text: 'A autorização do aiqfome usa um código de uso único, com prazo de 15 minutos e preso a quem começou. Os tokens de cada loja ficam cifrados e a renovação é travada para nunca se perder.',
      },
    ],
  },
  {
    version: '0.191.0',
    date: '2026-11-19',
    title: 'Pedidos da Rappi chegando no Comandou',
    summary:
      'A loja liga o id dela na Rappi e os pedidos chegam sozinhos. Aceitar, recusar e pronto voltam para a Rappi, e o cancelamento feito na Rappi cancela o pedido aqui na hora, por um aviso assinado.',
    notes: [
      {
        tag: 'novo',
        text: 'Em Aplicativos de delivery, o cartão da Rappi tem "Ligar uma loja": cole o id da loja na Rappi.',
      },
      {
        tag: 'novo',
        text: 'O pedido da Rappi entra com itens e complementos, taxa de entrega, gorjeta, cupom de quem pagou e o dinheiro a cobrar na entrega. Recusar mostra os motivos que a Rappi aceita.',
      },
      {
        tag: 'segurança',
        text: 'Os avisos da Rappi só entram com a assinatura certa e recente; o segredo fica cifrado no painel da equipe. Pedido novo nunca se perde se o sistema do restaurante estiver fora por alguns minutos.',
      },
    ],
  },
  {
    version: '0.190.0',
    date: '2026-11-19',
    title: 'Pedidos da 99Food chegando no Comandou',
    summary:
      'Com a loja vinculada ao Comandou na 99Food, os pedidos chegam sozinhos e aceitar, pronto, saiu, entregue, retirado e cancelar voltam para a 99Food. Quando o cliente pede para cancelar, uma pessoa da loja aceita ou recusa.',
    notes: [
      {
        tag: 'novo',
        text: 'Em Aplicativos de delivery, o cartão da 99Food tem "Ligar uma loja": cole o número da loja na 99Food e o Comandou confere se ela já está vinculada.',
      },
      {
        tag: 'novo',
        text: 'O pedido da 99Food entra com itens, taxa de entrega, gorjeta, cupom de quem pagou e dinheiro com troco. O localizador do telefone do cliente e o código de retirada aparecem no pedido.',
      },
      {
        tag: 'novo',
        text: 'Pedido de retirada concluído no Comandou avisa a 99Food que o cliente já retirou. Quando o cliente pede para cancelar, o pedido mostra o pedido e uma pessoa aceita ou recusa.',
      },
      {
        tag: 'melhoria',
        text: 'Os avisos agora falam "da Keeta", "na 99Food" e "da Rappi", com o artigo certo.',
      },
    ],
  },
  {
    version: '0.189.0',
    date: '2026-11-19',
    title: 'Pedidos da Keeta chegando no Comandou',
    summary:
      'A loja liga o cadastro da Keeta em Aplicativos de delivery e os pedidos passam a chegar sozinhos, com aceitar, pronto, saiu para entrega, cancelar e pedido de reembolso feitos daqui. Aplicativos que seguem o padrão Open Delivery entram pelo mesmo caminho.',
    notes: [
      {
        tag: 'novo',
        text: 'Em Aplicativos de delivery, o cartão da Keeta tem "Ligar loja": cole o código da loja que aparece no portal da Keeta e o Comandou faz o cadastro lá. Se a loja ainda não autorizou o Comandou, o aviso diz o que fazer.',
      },
      {
        tag: 'novo',
        text: 'O pedido da Keeta entra como os do iFood: itens, taxa de entrega, cupom de quem pagou (aplicativo ou loja), pagamento no app fora do caixa e dinheiro com troco. Aceitar, pronto, saiu, entregue e cancelar voltam para a Keeta.',
      },
      {
        tag: 'novo',
        text: 'Quando o cliente pede reembolso na Keeta, o pedido mostra o pedido de reembolso e uma pessoa da loja aceita ou recusa.',
      },
      {
        tag: 'segurança',
        text: 'Toda chamada à Keeta vai assinada com a chave do Comandou, guardada cifrada no painel da equipe. Nome e telefone do cliente que vierem cifrados não são guardados.',
      },
    ],
  },
  {
    version: '0.188.0',
    date: '2026-11-19',
    title: 'Comandou pronto para a homologação do iFood',
    summary:
      'A equipe do Comandou acompanha, num painel, se o uso do iFood está dentro das regras (para o iFood nunca bloquear a integração) e segue o roteiro oficial de homologação, passo a passo.',
    notes: [
      {
        tag: 'novo',
        text: 'O Comandou conta, hora a hora, as confirmações dos pedidos do iFood, os erros em cada chamada e quantas vezes cada pedido foi consultado. Nada de loja, pedido ou cliente vai junto: só os números.',
      },
      {
        tag: 'novo',
        text: 'No painel da equipe, a tela Aplicativos de delivery mostra esses números contra as regras do iFood (confirmação de 95% ou mais, erro de até 1%, até 10 consultas por pedido) e o roteiro de homologação para marcar o que já foi feito.',
      },
      {
        tag: 'segurança',
        text: 'Os números ficam guardados por 35 dias e só a equipe do Comandou vê. Cada passo marcado fica no registro do painel.',
      },
    ],
  },
  {
    version: '0.187.0',
    date: '2026-11-19',
    title: 'Avaliações do iFood no Comandou',
    summary:
      'As avaliações dos clientes no iFood chegam ao Comandou, ligadas ao pedido, com a nota da loja. Dá para responder daqui: a resposta é escrita por alguém da equipe e aparece no iFood.',
    notes: [
      {
        tag: 'novo',
        text: 'Em Aplicativos de delivery, o cartão "Avaliações dos clientes" mostra a nota da loja no iFood, a média dos últimos 30 dias e as avaliações, com as que estão sem resposta primeiro.',
      },
      {
        tag: 'novo',
        text: 'Toque em "Responder", escreva e publique: a resposta aparece no iFood junto com a avaliação. Nada é respondido sozinho.',
      },
      {
        tag: 'novo',
        text: 'Na gaveta do pedido concluído do iFood aparece a nota e o comentário que o cliente deixou.',
      },
    ],
  },
  {
    version: '0.186.0',
    date: '2026-11-19',
    title: 'Repasse do iFood no Financeiro',
    summary:
      'O Comandou lê o financeiro do iFood: quanto cada pedido rende depois das taxas, quando cada repasse cai na conta e se o extrato já conferiu. A venda paga no aplicativo entra no DRE, com a comissão do iFood como despesa.',
    notes: [
      {
        tag: 'novo',
        text: 'Financeiro › Aplicativos: o que foi vendido nos aplicativos no mês, quanto o iFood descontou, o que fica com a loja e cada repasse, com a data em que cai e a situação (a cair, pago pelo iFood, conferido no extrato).',
      },
      {
        tag: 'novo',
        text: 'Cada repasse do iFood vira uma conta a receber "Repasse de vendas", e a Conciliação bancária confere com o extrato sozinha. Se o iFood muda o valor ou antecipa, a conta acompanha.',
      },
      {
        tag: 'novo',
        text: 'Na gaveta do pedido do iFood, quem vê o Financeiro enxerga quanto a venda rende: o que fica com a loja, o que foi descontado e cada taxa (comissão, pagamento, promoção).',
      },
      {
        tag: 'melhoria',
        text: 'O DRE agora conta as vendas pagas dentro do aplicativo e a comissão e as taxas do iFood. Antes, a venda paga no iFood não aparecia no resultado.',
      },
      {
        tag: 'melhoria',
        text: 'O resumo do caixa mostra quanto foi pago no iFood durante o turno, separado e fora da gaveta, para conferir sem confundir o dinheiro contado.',
      },
    ],
  },
  {
    version: '0.185.0',
    date: '2026-11-19',
    title: 'Cardápio do iFood conferido e trazido para o Comandou',
    summary:
      'O Comandou avisa quando alguém muda preço, pausa ou nome no portal do iFood e põe de volta o que está aqui com um toque. Itens criados direto no iFood podem ser trazidos para o Comandou, com complementos.',
    notes: [
      {
        tag: 'novo',
        text: 'Em Cardápio › Cardápios › iFood, a "Conferência com o portal do iFood" mostra o que foi mudado lá (preço, pausa, nome ou item apagado). "Mandar o do Comandou" põe de volta no iFood o que está aqui.',
      },
      {
        tag: 'novo',
        text: 'Itens que só existem no iFood aparecem na lista: escolha e toque em "Trazer para o Comandou". Eles vêm com o preço do iFood, a categoria e os complementos, e os pedidos do iFood com esses itens já chegam ligados ao cardápio.',
      },
      {
        tag: 'melhoria',
        text: 'Item que acaba no estoque pela ficha técnica sai do iFood sozinho, e volta quando chega mercadoria. Antes só saía quando marcado como esgotado à mão.',
      },
    ],
  },
  {
    version: '0.184.0',
    date: '2026-11-19',
    title: 'Entregador do iFood no pedido',
    summary:
      'Veja quem é o entregador do iFood, onde ele está e quando chega, com o código de coleta em destaque. Na entrega da loja, chame um entregador do iFood com o valor na tela antes de confirmar.',
    notes: [
      {
        tag: 'novo',
        text: 'No pedido do iFood com entrega, um cartão mostra o entregador: a caminho, chegou na loja, saiu com o pedido, chegou no cliente. Aparece o primeiro nome, o veículo, a previsão de chegada e o código de coleta para conferir antes de entregar o pedido.',
      },
      {
        tag: 'novo',
        text: 'Entrega da loja: "Chamar entregador do iFood" mostra o valor, o tempo e a distância antes de confirmar. Dá para cancelar o chamado com o motivo e, se o iFood não achar ninguém, o pedido avisa para chamar de novo ou mandar o seu motoboy.',
      },
      {
        tag: 'melhoria',
        text: 'No PDV, o pedido do iFood mostra em que pé está o entregador. Em Entregas, o pedido que o entregador do iFood leva aparece como "Quem leva é o entregador do iFood" e não pode sair com o motoboy da loja por engano.',
      },
      {
        tag: 'segurança',
        text: 'Do entregador, só o primeiro nome e o veículo ficam guardados, e saem depois de 30 dias. A taxa do entregador chamado é sempre a da cotação do iFood, nunca um valor vindo da tela.',
      },
    ],
  },
  {
    version: '0.183.0',
    date: '2026-11-19',
    title: 'WhatsApp no Super Admin',
    summary:
      'O painel ganhou a tela WhatsApp: conecte o número do Comandou pelo QR Code e converse com quem escreve para ele, sem sair do Super Admin.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › WhatsApp: conecte o número do Comandou lendo o QR Code no celular (o mesmo serviço de WhatsApp dos restaurantes, numa conexão só do painel).',
      },
      {
        tag: 'novo',
        text: 'Conversas em tela cheia: lista à esquerda com busca por nome ou telefone, conversa à direita e resposta com Enter. Mensagens novas aparecem com número no menu e um aviso em qualquer tela.',
      },
      {
        tag: 'novo',
        text: 'Nova conversa por telefone e, quando o número é de um restaurante cadastrado, o nome dele aparece na conversa com o atalho para abrir o cadastro.',
      },
      {
        tag: 'segurança',
        text: 'As mensagens do número do painel nunca passam pela IA dos restaurantes; conectar e desconectar entram no Registro do painel.',
      },
    ],
  },
  {
    version: '0.182.1',
    date: '2026-11-19',
    title: 'Modo escuro mais nítido e janelas mais largas no notebook',
    summary:
      'No modo escuro os campos e as bordas ficaram mais claros e fáceis de ver. No notebook, as janelas (como a do padrão fiscal) abrem mais largas, para caber sem rolar. No Super Admin, a tela de Conversas usa a tela toda para o chat.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Modo escuro: campos um tom mais claros que o cartão, com borda visível e texto em branco; bordas, divisórias e textos secundários também ficaram mais claros.',
      },
      {
        tag: 'melhoria',
        text: 'No notebook, as janelas grandes abrem mais largas e os formulários vão até 4 campos por linha. A janela do padrão fiscal mostra PIS/COFINS e Outros lado a lado e cabe na tela sem rolar.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin › Conversas: saiu o título do topo e o chat ocupa quase a tela toda no computador.',
      },
    ],
  },
  {
    version: '0.182.0',
    date: '2026-11-19',
    title: 'Cardápio salva sozinho',
    summary:
      'Na tela de cada cardápio não tem mais botão Salvar: ligar ou desligar um item, mudar um preço ou o nome do cardápio grava sozinho, e um cartão pequeno embaixo da tela diz o que foi alterado.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Cardápios: cada mudança é gravada em instantes (ou na hora, ao sair do campo de preço ou do nome). O cartão embaixo mostra "Salvando…" e depois o que mudou, por exemplo "Chopp: R$ 15,90" ou "IPA entrou no cardápio".',
      },
      {
        tag: 'melhoria',
        text: 'Preço digitado errado (ex.: "12,,9") não é gravado: o cartão avisa qual item corrigir. Se a internet cair, o cartão mostra "Não foi salvo" com o botão Tentar de novo.',
      },
      {
        tag: 'melhoria',
        text: 'Abrir um item ou sair da tela não pergunta mais "Sair sem salvar?": o que estiver esperando é gravado antes.',
      },
    ],
  },
  {
    version: '0.181.1',
    date: '2026-11-19',
    title: 'Nota fiscal revisada: menos recusas da SEFAZ',
    summary:
      'Revisamos as regras e os campos da NFC-e e da NF-e. O sistema agora avisa antes de enviar quando o padrão fiscal tem algo que a SEFAZ recusaria, e corrige sozinho alguns campos que geravam recusa.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Antes de enviar, a nota avisa quando o CFOP ou o CSOSN/CST não serve para a NFC-e, quando falta alíquota do ICMS, do PIS ou da COFINS, e quando um item com substituição tributária está sem CEST.',
      },
      {
        tag: 'correção',
        text: 'NFC-e com CNPJ de empresa no cupom não é mais recusada por "destinatário contribuinte": ela sai sempre como consumidor final.',
      },
      {
        tag: 'correção',
        text: 'NF-e de delivery não usa mais "entrega a domicílio" (opção só da NFC-e), e a NF-e para outro estado usa o CFOP certo para consumidor final (6107/6108) e para bebidas com substituição tributária (6404).',
      },
      {
        tag: 'correção',
        text: 'Reforma tributária: a classificação de bares e restaurantes (200047, redução de 40%) entrou na lista, a de "alimentos" estava com o código errado, e a alíquota reduzida agora vai na nota com o valor certo.',
      },
      {
        tag: 'correção',
        text: 'Nota denegada pela SEFAZ não fica mais tentando reenviar com o mesmo número; a venda pode receber uma nota nova.',
      },
    ],
  },
  {
    version: '0.181.0',
    date: '2026-11-19',
    title: 'E-mails com visual novo, mais profissional',
    summary:
      'Todos os e-mails do sistema ganharam um desenho mais limpo e sóbrio: código de nova senha, boas-vindas do teste, acesso ao restaurante, lembretes e avisos de mensalidade, pagamento recebido, contratos e o e-mail do cardápio online.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Visual novo em todos os e-mails: cabeçalho com a marca e o assunto, texto alinhado à esquerda, dados no jeito de uma comanda (rótulo de um lado, valor do outro) e o panda pequeno na assinatura, sem a ilustração grande no topo.',
      },
      {
        tag: 'melhoria',
        text: 'O código de nova senha aparece numa caixa discreta com a validade logo embaixo, fácil de ler e de copiar. Os avisos usam uma bolinha de cor no lugar de emojis.',
      },
      {
        tag: 'melhoria',
        text: 'Modo escuro no mesmo azul-ardósia do sistema e leitura melhor no celular e no Outlook do Windows.',
      },
    ],
  },
  {
    version: '0.180.0',
    date: '2026-11-19',
    title: 'Loja aberta, fechada ou pausada no iFood',
    summary:
      'Veja se a sua loja está aberta, fechada ou pausada no iFood sem sair do Comandou, pause só o iFood quando a cozinha apertar e, ao fechar a loja no PDV, o iFood fecha junto.',
    notes: [
      {
        tag: 'novo',
        text: 'Em Aplicativos de delivery, cada loja mostra a situação no iFood (aberta, fechada, pausada, com aviso), o motivo que o iFood dá e os horários cadastrados lá.',
      },
      {
        tag: 'novo',
        text: 'Pausar só no iFood: escolha por quanto tempo (15 minutos a "até eu reabrir") e o motivo. O cardápio online e o salão continuam funcionando. "Reabrir no iFood" tira a pausa.',
      },
      {
        tag: 'novo',
        text: '"Loja fechada" no PDV também pausa o iFood, e "Loja aberta" tira a pausa. Dá para desligar por loja em "Fechar junto com a loja do Comandou". Pausa feita no portal do iFood aparece aqui e não é mexida.',
      },
      {
        tag: 'melhoria',
        text: 'No PDV, ao lado de "Loja aberta", uma pílula por loja de aplicativo mostra se ela está aberta ou pausada (e até quando).',
      },
      {
        tag: 'segurança',
        text: 'A situação é lida com calma (no máximo uma vez por minuto pela tela e a cada 5 minutos sozinha) e falha não se repete na hora, para o iFood não bloquear o Comandou.',
      },
    ],
  },
  {
    version: '0.179.0',
    date: '2026-11-19',
    title: 'Cancelamento e negociação com o cliente do iFood',
    summary:
      'Cancelar ou recusar um pedido do iFood agora usa os motivos que o iFood aceita para aquele pedido. Se o iFood negar o cancelamento, o pedido volta para onde estava. Quando o cliente pede para cancelar, quer reembolso ou o app pede mais tempo, o pedido mostra o pedido do cliente com o prazo, e você aceita, recusa ou faz uma proposta ali mesmo.',
    notes: [
      {
        tag: 'novo',
        text: 'Negociação com o cliente: no pedido aparece o que o cliente pediu, a mensagem dele, quanto tempo falta para responder e o que acontece se ninguém responder. Botões Aceitar, Recusar e as propostas que o iFood oferece (reembolso parcial até o valor permitido, cupom ou mais tempo).',
      },
      {
        tag: 'novo',
        text: 'No PDV, o pedido com o cliente esperando resposta mostra "Responda ao cliente em N min" e o som de cancelamento fica tocando até alguém responder.',
      },
      {
        tag: 'melhoria',
        text: 'Cancelar ou recusar pedido do iFood: escolha o motivo na lista que o iFood aceita para aquele pedido (o cliente vê). O pedido fica "Cancelamento solicitado" até o iFood confirmar.',
      },
      {
        tag: 'melhoria',
        text: 'Se o iFood negar o cancelamento, o pedido volta sozinho para onde estava (em produção, pronto...) e a cozinha continua.',
      },
      {
        tag: 'segurança',
        text: 'A resposta ao cliente é sempre de uma pessoa (como o iFood recomenda) e só vale dentro do prazo e do que o iFood ofereceu. Fotos e dados do cliente da reclamação não são guardados.',
      },
    ],
  },
  {
    version: '0.178.0',
    date: '2026-11-18',
    title: 'Menu lateral que recolhe e abre ao encostar o mouse',
    summary:
      'No computador, o menu lateral recolhe para só os ícones e abre de novo deslizando, com a tela crescendo e encolhendo junto. Recolhido, basta encostar o mouse nele para ver os nomes, sem tirar a tela do lugar. A tela Conta usa melhor a largura do notebook.',
    notes: [
      {
        tag: 'novo',
        text: 'Menu recolhido: só os ícones, sem nomes. Encoste o mouse no menu e ele abre por cima da tela; tire o mouse e ele volta. O botão ao lado do nome do restaurante deixa o menu fixo aberto ou recolhido, e o sistema lembra a escolha neste navegador.',
      },
      {
        tag: 'melhoria',
        text: 'Abrir e fechar o menu agora desliza suave, e a tela ganha ou devolve o espaço junto. Os grupos (Cardápio, Estoque, Fiscal, Gestão, Sistema) também abrem e fecham deslizando.',
      },
      {
        tag: 'melhoria',
        text: 'Tela Conta no notebook: blocos maiores, lado a lado, ocupando a largura da tela (até quatro por linha), para achar tudo de relance.',
      },
    ],
  },
  {
    version: '0.177.0',
    date: '2026-11-18',
    title: 'Mude os seus dados e os do restaurante pela Conta',
    summary:
      'Na tela Conta tem agora "Meus dados" (seu nome e o e-mail com que você entra) e, para o administrador, "Dados do restaurante" (nome, razão social, CPF ou CNPJ, responsável, telefone, e-mail de cobrança, cidade e UF). O que você muda chega na hora para a equipe do Comandou.',
    notes: [
      {
        tag: 'novo',
        text: 'Conta › Dados do restaurante (só o administrador): o mesmo cadastro que o Comandou usa para falar com você e para a cobrança. Trocar o nome do restaurante já muda o topo do sistema.',
      },
      {
        tag: 'novo',
        text: 'Conta › Meus dados: troque o seu nome e o e-mail de entrada. Para trocar o e-mail, o sistema pede a sua senha atual.',
      },
      {
        tag: 'melhoria',
        text: 'Painel do Comandou: o cadastro do restaurante mostra quando foi atualizado, e o histórico diz quem do restaurante mudou e quais campos.',
      },
      {
        tag: 'segurança',
        text: 'Só o administrador muda os dados do restaurante, cada um só o do seu; e-mail novo pede a senha atual e não pode ser o de outra conta. As observações internas do Comandou não aparecem nem mudam por aqui.',
      },
    ],
  },
  {
    version: '0.176.0',
    date: '2026-11-18',
    title: 'Pedidos do iFood chegando sozinhos no Comandou',
    summary:
      'Os pedidos do iFood agora entram sozinhos: aparecem em Pedidos e no PDV com o selo do iFood, tocam um som próprio, mostram quanto falta para aceitar e seguem para cozinha, impressão, entrega e estoque. Aceitar, preparo, pronto, saiu e cancelamento feitos no Comandou vão para o iFood. O que o cliente pagou no iFood fica fora da gaveta do caixa.',
    notes: [
      {
        tag: 'novo',
        text: 'Ligue a loja do iFood em Cardápio › Cardápios (como já fazia para o cardápio) e marque "Receber pedidos" em Sistema › Aplicativos de delivery. A loja que já estava ligada aparece lá sozinha.',
      },
      {
        tag: 'novo',
        text: 'Pedido do iFood em análise mostra "Aceite em X min" no PDV e no pedido (o iFood cancela depois de 8 minutos) e toca o som "Pedido de aplicativo" até alguém aceitar. Dá para trocar o som em Sons.',
      },
      {
        tag: 'novo',
        text: 'Pago no iFood vira "Pago no iFood · Cartão de crédito" no pedido, na impressão e na nota fiscal, sem entrar no dinheiro esperado do caixa. Dinheiro ou maquininha na entrega continua sendo cobrado no caixa como sempre, e o cupom pago pelo iFood já conta como pago.',
      },
      {
        tag: 'novo',
        text: 'No pedido do iFood aparecem a forma de pagamento com a bandeira, o troco que o entregador deve levar, o cupom e quem paga (iFood ou loja), o código de retirada e o CPF/CNPJ da nota.',
      },
      {
        tag: 'melhoria',
        text: 'Recusar ou pedir cancelamento no Comandou avisa o iFood com o motivo. Quando o iFood cancela, o pedido cancela aqui, o estoque volta e o valor pago no iFood some do pedido, sem estorno no caixa (quem devolve ao cliente é o iFood).',
      },
      {
        tag: 'segurança',
        text: 'Itens e valores de pedido de aplicativo não mudam no Comandou (desconto, troca de itens, fiado e estorno no caixa ficam travados), para nunca ficar diferente do que o cliente pagou e do repasse.',
      },
    ],
  },
  {
    version: '0.175.0',
    date: '2026-11-18',
    title: 'Sua conta agora é uma tela, com tudo em botões grandes',
    summary:
      'Tocar no seu nome, no pé do menu, abre a tela Conta em vez do menuzinho: assinatura, ajustes, novidades, falar com a Comandou, primeiros passos, rever apresentação, tema, instalar o app, trocar senha e sair, cada um num bloco grande. Assinatura e Ajustes saíram de Sistema e moram aqui.',
    notes: [
      {
        tag: 'novo',
        text: 'Tela Conta: seus dados no topo e os blocos por assunto (Seu restaurante, Ajuda e novidades, Este aparelho, Segurança). A Assinatura mostra a situação na hora (em dia, teste grátis, precisa de atenção). Cada bloco só aparece para quem tem acesso: o caixa, por exemplo, não vê Assinatura nem Primeiros passos.',
      },
      {
        tag: 'melhoria',
        text: 'Assinatura e Ajustes saíram do menu Sistema e ficam em Conta (o menu acende a Conta quando você está nelas). A busca acha as duas como antes.',
      },
      {
        tag: 'melhoria',
        text: 'No celular e no app instalado: o cartão com seu nome, no topo da tela Mais, abre a Conta; os blocos ficam em duas colunas com alvo grande para o dedo. Com o app instalado, aparece "App instalado" no lugar de "Instalar o app".',
      },
    ],
  },
  {
    version: '0.174.0',
    date: '2026-11-18',
    title: 'Base dos pedidos do iFood e dos outros aplicativos de delivery',
    summary:
      'Começou a integração com os aplicativos de delivery. Ainda não chega pedido de nenhum aplicativo de verdade (o iFood vem na próxima versão), mas a base está pronta: a tela Sistema › Aplicativos de delivery, o selo do aplicativo em todo lugar onde o pedido aparece e o caminho que cada pedido de aplicativo vai seguir dentro do Comandou.',
    notes: [
      {
        tag: 'novo',
        text: 'Sistema › Aplicativos de delivery: um cartão por aplicativo (iFood, Keeta, 99Food, Rappi, aiqfome e Open Delivery) com a situação, as lojas ligadas, o último evento e o último pedido, e os ajustes "Receber pedidos" e "Aceitar sozinho" de cada loja.',
      },
      {
        tag: 'novo',
        text: 'Pedido de aplicativo vai entrar como os outros: número do Comandou, cozinha, impressão, baixa de estoque, entrega e caixa. O preço é o que o aplicativo cobrou, e o desconto pago pelo aplicativo não diminui o seu pedido (ele volta no repasse).',
      },
      {
        tag: 'novo',
        text: 'Item do aplicativo que não bate com o cardápio nunca faz o pedido ser recusado: ele entra com o nome e o preço do aplicativo, marcado "sem vínculo", e aparece na tela para você ligar a um produto. O vínculo vale para os próximos pedidos.',
      },
      {
        tag: 'novo',
        text: 'Aceitar, pronto, saiu para entrega e pedido de cancelamento feitos no Comandou vão para o aplicativo sozinhos, em ordem. No pedido aparece "enviando…", "enviado" ou "falhou" com o motivo, e o que falhou tem "Tentar de novo" na tela do aplicativo.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin › Credenciais: as credenciais do iFood e dos outros aplicativos ficam no painel, cifradas. As variáveis antigas do iFood no servidor continuam valendo como reserva.',
      },
      {
        tag: 'segurança',
        text: 'Proteções contra bloqueio pelos aplicativos: busca de pedidos no máximo a cada 30 segundos e por um servidor só, confirmação de recebimento só depois de guardar o pedido, no máximo 10 consultas por pedido, sem repetir chamada recusada e alertas antes de chegar perto dos limites.',
      },
    ],
  },
  {
    version: '0.173.0',
    date: '2026-11-18',
    title: 'Reservas com tags de situação no topo e cartões que mudam na hora',
    summary:
      'O painel do lado das Reservas ficou só com Nova reserva e o calendário. A situação virou tags em cima da agenda (Todas, Aguardando, Confirmada, Chegou...) com a contagem de cada uma, e o cartão da reserva muda na hora quando o cliente, o sistema ou outra pessoa mexe nela.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Reservas: as caixinhas de Situação viraram tags acima da agenda. Toque numa tag para ver só aquelas reservas (dá para escolher mais de uma); Todas volta para todas, menos as canceladas e as que não vieram. No celular as tags ficam embaixo de Dia/Semana/Mês/Lista e rolam de lado.',
      },
      {
        tag: 'melhoria',
        text: 'Reservas pelo cardápio e Copiar link foram para a barra de cima (botão com a bolinha verde quando estão ligadas). O resumo do dia continua no cabeçalho dos cartões e, no celular, na folha aberta pelo título.',
      },
      {
        tag: 'novo',
        text: 'Quando uma reserva muda sem você mexer (cliente confirmou ou cancelou, a IA do WhatsApp reservou, outra pessoa da equipe mudou), o cartão ganha um contorno laranja por dois segundos para chamar o olho.',
      },
      {
        tag: 'correção',
        text: 'Quando a comanda fechava sozinha (Pix do cardápio pago e pedido entregue), a reserva sentada naquela mesa era concluída mas a tela de Reservas só mostrava isso depois de recarregar. Agora atualiza na hora.',
      },
    ],
  },
  {
    version: '0.172.1',
    date: '2026-11-18',
    title: 'Cartões das comandas do Salão inteiros de novo',
    summary:
      'No PDV, a aba Comandas do Salão mostrava os cartões cortados em cima, com o texto vazando e uma barra de rolagem sobrando. Agora cada cartão cabe inteiro, no computador e no celular.',
    notes: [
      {
        tag: 'correção',
        text: 'Salão › Comandas: o cartão mostra "#número · Mesa" numa linha só e o valor com o tempo ou o nome do cliente na outra; o que não couber termina em reticências, sem empurrar o cartão para fora da linha nem criar barra de rolagem.',
      },
    ],
  },
  {
    version: '0.172.0',
    date: '2026-11-18',
    title: 'Instale o Comandou no computador e fim do aviso de atualizar que voltava sempre',
    summary:
      'No menu do seu perfil tem agora "Instalar o app": o sistema vira um programa no notebook ou no computador, com ícone e janela própria, e também no celular. E o aviso "Nova versão disponível" parou de aparecer toda vez que você entrava sem ter versão nova.',
    notes: [
      {
        tag: 'novo',
        text: 'Perfil › Instalar o app: no Chrome e no Edge abre a instalação do próprio navegador com um clique; no iPhone, no Safari do Mac e nos outros navegadores mostra o passo a passo. Instalado, o PDV abre direto na janela do app, sem a barra do navegador. O item some quando você já está no app.',
      },
      {
        tag: 'correção',
        text: 'O aviso "Nova versão disponível" voltava a cada entrada (e depois de clicar em Atualizar) quando o navegador guardava uma atualização interna do app esperando. Agora, se a tela já está na versão mais nova, essa atualização entra sozinha, sem aviso, e o aviso só aparece quando há versão nova de verdade.',
      },
    ],
  },
  {
    version: '0.171.0',
    date: '2026-11-18',
    title: 'Uma chave do OpenRouter a menos: sites com IA usam a dos restaurantes',
    summary:
      'A chave própria dos sites com IA saiu de Credenciais: o site montado pela IA no comandou.com passa a gastar da chave dos restaurantes (e, sem ela, da sua). Os limites e o modelo dos sites continuam em Site › Site com IA.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Super Admin › Credenciais: "OpenRouter · chave dos sites com IA" saiu. Os sites usam a chave dos restaurantes; sem ela, a sua chave. A chave antiga dos sites deixa de ser usada e é apagada no primeiro salvar da aba Site com IA.',
      },
      {
        tag: 'melhoria',
        text: 'Site › Site com IA mostra qual chave está pagando os sites (a dos restaurantes ou a sua) e Tokens de IA chama de "antiga chave dos sites" o gasto que ainda saiu dela neste mês.',
      },
    ],
  },
  {
    version: '0.170.0',
    date: '2026-11-18',
    title: 'Filtro escolhido fica na barra e detalhe do pedido mais colorido',
    summary:
      'O campo que você escolhe no "+ Filtro" agora fica na barra da lista e continua lá depois de trocar de aba, limpar os filtros ou recarregar. O detalhe do pedido ganhou cores suaves para achar cada informação e cada botão de relance.',
    notes: [
      {
        tag: 'correção',
        text: '"+ Filtro" em todas as listas: o campo escolhido entra na barra e fica salvo neste navegador (antes sumia ao trocar de aba, limpar os filtros ou recarregar). O alfinete do seletor agora fixa ou tira o campo da barra, e cada filtro tem "Tirar da barra" na caixa dele.',
      },
      {
        tag: 'melhoria',
        text: 'Detalhe do pedido: ícones de cliente, telefone, data, status, pagamento e endereço em tons suaves; tipo do pedido colorido no topo; situação de cada item (pendente, em preparo, pronto) com cor; observação escrita em destaque; valor pago em verde e falta pagar em vermelho.',
      },
      {
        tag: 'melhoria',
        text: 'Botões de baixo do pedido: cada ação (imprimir, via de entrega, editar, desconto, fiado, a receber, cozinha) com um tom próprio e as linhas alinhadas de ponta a ponta; Cancelar pedido e Recusar em vermelho suave.',
      },
    ],
  },
  {
    version: '0.169.0',
    date: '2026-11-18',
    title: 'Novo jeito de escolher o filtro nas listas',
    summary:
      'O "+ Filtro" abre uma caixa larga para escolher o campo: dá para procurar pelo nome, os mais usados ficam em cima e cada campo mostra o tipo. Em Pedidos, a ordenação ao lado da busca saiu: ordene clicando no título da coluna.',
    notes: [
      {
        tag: 'novo',
        text: '"+ Filtro" em todas as listas (Pedidos, Clientes, Estoque, Financeiro, Notas e Cardápio): busca pelo título do campo, grupo Mais usados e Demais campos, cada um com o tipo (data ou opções). O alfinete fixa ou tira um campo dos mais usados, e o campo que você usa bastante sobe sozinho.',
      },
      {
        tag: 'melhoria',
        text: 'Pedidos: saíram o botão de maior/menor e o menu de ordenar (Data, Número…) ao lado da busca. A ordem continua no título de cada coluna da tabela.',
      },
    ],
  },
  {
    version: '0.168.0',
    date: '2026-11-18',
    title: 'Super Admin mais arrumado: menu em grupos e histórico em cada restaurante',
    summary:
      'A aba Auditoria saiu: o que aconteceu com cada restaurante aparece no Histórico dele, em frases que dá para ler. O menu ficou em grupos, o Site juntou o cadastro e o Site com IA, e cada número da tela do restaurante foi conferido com o sistema.',
    notes: [
      {
        tag: 'novo',
        text: 'Restaurantes › restaurante › Histórico: troca de plano, suspensão, acesso de suporte, pagamento, contrato e tokens de IA, com filtro por assunto e quem fez. As entradas no painel e os ajustes gerais ficam em Conta › Registro do painel.',
      },
      {
        tag: 'melhoria',
        text: 'Menu do Super Admin em grupos (Clientes, Vendas, Financeiro e Sistema), também na tela Mais do celular. Site e Site com IA viraram abas da mesma tela, com o botão Abrir o site.',
      },
      {
        tag: 'correção',
        text: 'Visão geral do restaurante: CNPJ e telefone formatados, endereços e domínios num cartão só, nota fiscal e equipe com os números certos (quem está online agora, último acesso) e nada repetido entre os cartões. Os gráficos de Uso contam o dia no fuso do restaurante e o Consumo vem do maior para o menor.',
      },
      {
        tag: 'correção',
        text: 'Conversas no celular: a busca, as abas e a lista ocupam a largura toda, sem a coluna vazia que sobrava à direita.',
      },
      {
        tag: 'correção',
        text: 'Avisos com texto e link não quebram mais a linha no meio, o plano deixou de repetir item na tela Preço e textos que apontavam para telas antigas foram acertados.',
      },
    ],
  },
  {
    version: '0.167.0',
    date: '2026-11-18',
    title: 'Tokens de IA com o saldo de verdade do OpenRouter',
    summary:
      'A aba Tokens do Super Admin passa a mostrar o saldo da conta no OpenRouter (com a nova chave de gerenciamento) e separa direitinho quanto o sistema gastou de cada chave.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › Credenciais: nova chave opcional "OpenRouter · chave de gerenciamento (saldo)". O OpenRouter só mostra os créditos da conta para esse tipo de chave; com ela, o quadro Saldo no OpenRouter mostra quanto sobra de quanto foi comprado e avisa quando estiver baixo.',
      },
      {
        tag: 'correção',
        text: 'Sem a chave de gerenciamento, o quadro do topo diz "Sobra no limite da chave" e mostra o limite da chave dos restaurantes (ou da sua), em vez de "sem dados" ou de um aviso de permissão que não tinha como resolver.',
      },
      {
        tag: 'correção',
        text: 'Quando você não tem a sua chave, a esteira e os testes gastam da chave dos restaurantes: agora esse gasto conta para a chave certa, e o "Fora do Comandou" deixa de acusar como gasto de fora o que foi o próprio sistema. O gasto dos sites com IA com chave própria também deixou de aparecer como sendo da sua chave.',
      },
      {
        tag: 'melhoria',
        text: 'O extrato mostra com qual chave saiu cada chamada do sistema, e ganharam nome as origens Foto do cardápio, Busca no Google Maps e Teste do assistente do WhatsApp. O "Hoje" dos cartões de chave diz que é o dia do OpenRouter (UTC).',
      },
    ],
  },
  {
    version: '0.166.0',
    date: '2026-11-18',
    title: 'A IA manda no WhatsApp o cardápio que o restaurante sobe',
    summary:
      'O cardápio que a IA manda no WhatsApp agora é o arquivo do próprio restaurante: suba o PDF ou as fotos do cardápio na tela Assistente de IA e a IA manda esses arquivos quando o cliente pedir. O sistema não gera mais um PDF de cardápio sozinho; o calendário de reservas em PDF continua.',
    notes: [
      {
        tag: 'novo',
        text: 'Cardápio para mandar no WhatsApp, na tela Assistente de IA: envie o PDF (até 10 MB) ou fotos em JPG ou PNG (até 10 arquivos). A IA manda todos, na ordem da lista, quando o cliente pede o cardápio. Dá para abrir cada arquivo para conferir e apagar.',
      },
      {
        tag: 'melhoria',
        text: 'Sem arquivo enviado, a IA não manda cardápio: responde pelos itens liberados e manda o link da loja online.',
      },
      {
        tag: 'segurança',
        text: 'O tipo do arquivo do cardápio é conferido pelo conteúdo (PDF, JPEG ou PNG de verdade), na API e no serviço do WhatsApp, e só gerente e dono sobem, veem ou apagam.',
      },
    ],
  },
  {
    version: '0.165.0',
    date: '2026-11-18',
    title: 'Segurança reforçada: links externos, senhas e exclusão de restaurante',
    summary:
      'Revisão de segurança com uma varredura automática de todas as rotas do sistema. Fechamos um jeito de um link "disfarçado" chegar na rede interna do servidor, as senhas novas ficaram mais fortes e excluir um restaurante agora pede o código do autenticador.',
    notes: [
      {
        tag: 'segurança',
        text: 'Links informados no sistema (cardápio por link, site com IA, fotos) não chegam mais na rede interna do servidor com endereço IPv6 que esconde um IPv4 (como [::ffff:169.254.169.254]) nem com DNS que muda de resposta entre a conferência e a conexão: o endereço é conferido na hora de conectar.',
      },
      {
        tag: 'segurança',
        text: 'Super Admin: excluir restaurante pede o código do autenticador (mesmo em navegador confiável) e já vem com "Guardar um backup final" marcado quando o backup está ligado. Código errado fica na auditoria.',
      },
      {
        tag: 'segurança',
        text: 'Senha nova do cliente do cardápio com pelo menos 8 caracteres (antes 6). Em todas as senhas novas (cliente, equipe e painel), senhas óbvias como 12345678, senha123, o nome da loja, o e-mail ou o telefone são recusadas. Quem já tem senha continua entrando normalmente.',
      },
      {
        tag: 'segurança',
        text: 'Respostas da API não ficam guardadas no cache do navegador ou de proxy e saem com uma política de conteúdo fechada; a prévia do link do cardápio só roda o próprio script.',
      },
      {
        tag: 'segurança',
        text: 'Planilhas exportadas (produtos e DRE): nome que começa com =, +, - ou @ não vira fórmula no Excel ou no Google Planilhas.',
      },
      {
        tag: 'correção',
        text: 'Envio grande demais ou mal formado responde com aviso claro em vez de "Erro interno", e as telas mostram o motivo de um campo recusado (como "Essa senha é fácil de adivinhar") em vez de só "Dados inválidos".',
      },
      {
        tag: 'melhoria',
        text: 'Teste automático que varre as mais de 670 rotas a cada mudança: sem login, com a sessão de outro restaurante, com cada perfil da equipe, pelo endereço errado e com entradas hostis (injeção, protótipo, ids de outro restaurante). Rota pública nova só entra depois de revisada.',
      },
    ],
  },
  {
    version: '0.164.1',
    date: '2026-11-18',
    title: 'Modo escuro em azul-ardósia',
    summary:
      'O modo escuro trocou o grafite quase preto por um cinza-azulado mais suave, com campos, cartões e linhas em tons de azul que se separam melhor. A cor da sua loja continua sendo o destaque.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Fundo, moldura, cartões, campos e linhas do modo escuro em azul-ardósia, com mais diferença entre um nível e outro para enxergar melhor onde termina cada bloco.',
      },
      {
        tag: 'melhoria',
        text: 'Azul, verde, amarelo e vermelho dos avisos e situações ajustados ao novo fundo, todos com leitura confortável (contraste de 4,5:1 ou mais).',
      },
    ],
  },
  {
    version: '0.164.0',
    date: '2026-11-18',
    title: 'Credenciais com o guia completo e "Chave em uso" nas outras telas',
    summary:
      'A aba Credenciais agora traz o guia inteiro para subir o sistema: como funciona, a ordem dos passos e, em cada chave, o que vai em cada campo e como saber que deu certo. As outras telas mostram só qual chave está em uso.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › Credenciais: "Como funciona", "Para subir o sistema, na ordem" (DNS, instalador, chave mestra, as necessárias e as opcionais, com a situação de cada uma e atalho para o cartão) e o passo a passo para mudar o deploy.env do servidor.',
      },
      {
        tag: 'novo',
        text: 'Em cada credencial: o que colar em cada campo, como saber que deu certo e, depois de salva, o final da chave em uso ("termina em 4f2a"), sem nunca mostrar a chave inteira.',
      },
      {
        tag: 'melhoria',
        text: 'Tokens de IA, Cobrança, Pagamentos pelo app, E-mail, Backups, Sites com IA e Chamados mostram só a linha "Chave em uso" (nome, ambiente ou conta e o final da chave), com o nome levando ao cartão em Credenciais.',
      },
      {
        tag: 'correção',
        text: 'A primeira chave do Resend salva mesmo antes de definir o remetente, e os campos do PagBank não passam mais da tela no celular.',
      },
    ],
  },
  {
    version: '0.163.0',
    date: '2026-11-18',
    title: 'Vender fiado, com cobrança no WhatsApp',
    summary:
      'Na Nova venda, o Tipo de atendimento ganhou a opção Fiado: a venda vai para a sua Agenda pessoal com a tag Fiado e, no dia e hora combinados, o WhatsApp do restaurante manda a cobrança para quem está devendo. A aba Agenda virou Agenda pessoal, e Novidades foi para o menu do seu perfil.',
    notes: [
      {
        tag: 'novo',
        text: 'Fiado na Nova venda: ao lado de Retirada, escolha Fiado e informe quem está devendo, o WhatsApp dele e o dia e a hora para pagar (o nome e o telefone vêm do cliente escolhido). O botão vira Vender fiado.',
      },
      {
        tag: 'novo',
        text: 'Num pedido já lançado, o menu de ações ganhou Vender fiado (e Editar fiado). Pedido fiado é concluído com o saldo em aberto sem pedir o motivo de novo: vira "a receber" sozinho.',
      },
      {
        tag: 'novo',
        text: 'Cada fiado vira um compromisso na sua Agenda pessoal, com a tag Fiado (criada sozinha). No dia e hora do compromisso, o WhatsApp do restaurante (conectado pelo QR Code) manda a cobrança para o cliente. Se o pedido já foi pago, a mensagem não sai e o compromisso fica concluído. Arrastar o compromisso para outro dia muda a cobrança junto.',
      },
      {
        tag: 'melhoria',
        text: 'A aba Agenda agora se chama Agenda pessoal, para não confundir com os calendários do sistema, e ficou sozinha no pé do menu.',
      },
      {
        tag: 'melhoria',
        text: 'Novidades saiu da barra lateral e foi para o menu que abre ao clicar no seu perfil. Quando tem novidade, aparece um ponto no perfil e a marca "novo" ao lado de Novidades.',
      },
    ],
  },
  {
    version: '0.162.0',
    date: '2026-11-18',
    title: 'Todas as chaves num lugar só: Super Admin › Credenciais',
    summary:
      'Uma aba nova no Super Admin junta todas as chaves, tokens e senhas que o Comandou usa, com o passo a passo e os links para conseguir cada uma. As do painel se cadastram ali mesmo; as do servidor e do GitHub mostram o nome e o comando. A aba Fiscal saiu: da Focus NFe, você só cadastra o Token Master, agora pelo painel.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › Credenciais: situação de cada chave (configurada, faltando ou para conferir fora daqui), o que falta para subir o sistema e, em cada uma, para que serve, como conseguir, os links e o formulário para colar, testar e salvar.',
      },
      {
        tag: 'novo',
        text: 'Token Master da Focus NFe cadastrado pelo painel (cifrado), com botão Testar. Vale na hora para o cadastro das empresas dos restaurantes; a variável FOCUS_NFE_MASTER_TOKEN do servidor continua valendo enquanto não houver um salvo no painel.',
      },
      {
        tag: 'melhoria',
        text: 'As chaves saíram das outras telas: OpenRouter (Tokens e Sites com IA), Asaas (Cobrança), PagBank (Pagamentos pelo app), Resend (E-mail), Backblaze B2 (Backups) e GitHub (Chamados) agora ficam só em Credenciais. Cada tela mostra a situação da chave e o atalho Abrir em Credenciais.',
      },
      {
        tag: 'melhoria',
        text: 'A aba Fiscal saiu do menu (o endereço antigo leva para a Focus NFe em Credenciais). A nota fiscal de cada restaurante continua no cartão Nota fiscal da ficha dele.',
      },
    ],
  },
  {
    version: '0.161.0',
    date: '2026-11-18',
    title: 'IA do WhatsApp faz reserva e manda cardápio e calendário em PDF',
    summary:
      'A IA que atende no WhatsApp agora faz reservas de mesa pela conversa (só grava depois que o cliente responde SIM), manda o cardápio e o calendário de reservas em PDF, lembra das conversas antigas com cada cliente e se protege melhor de golpe, assunto indevido e tentativas de tirá-la do papel.',
    notes: [
      {
        tag: 'novo',
        text: 'Reserva pelo WhatsApp: a IA vê os dias e horários livres, pergunta o que falta (dia, horário, pessoas e nome) e pede a confirmação. Só depois do SIM a reserva entra na aba Reservas, com o código, pelas mesmas regras do cardápio online (antecedência, lotação, até 3 reservas em aberto por número). O cliente também cancela a própria reserva pela conversa.',
      },
      {
        tag: 'novo',
        text: 'Cardápio e calendário de reservas em PDF: quando o cliente pede, a IA manda o arquivo na conversa. O calendário mostra o mês com os dias que têm horário livre e a lista dos horários. O gerente vê a prévia dos dois na tela da IA e pode desligar o envio.',
      },
      {
        tag: 'melhoria',
        text: 'Memória da conversa: além das últimas mensagens, a IA guarda um resumo do que importa de cada cliente (nome, preferências, alergias, o que ficou combinado) e sabe as reservas que ele tem.',
      },
      {
        tag: 'segurança',
        text: 'Proteções da IA: recusa assunto fora do restaurante, não muda de papel nem mostra as instruções, não passa dados de outros clientes, tira da resposta links que não são do restaurante e nunca manda chave Pix ou confirma pagamento. Tentativas de tirar do papel, golpe ou ofensa contam; na terceira em 24 horas a IA para de responder o número por 24 horas e avisa a equipe. Mensagens demais do mesmo número também ficam sem resposta da IA.',
      },
    ],
  },
  {
    version: '0.160.0',
    date: '2026-11-18',
    title: 'Reservas em calendário, no jeito da Agenda',
    summary:
      'A tela de Reservas virou um calendário com as visões Dia, Semana, Mês e Lista, painel do lado com o resumo do dia e o filtro por situação, e as reservas podem ser remarcadas arrastando.',
    notes: [
      {
        tag: 'novo',
        text: 'Visões Dia, Semana, Mês e Lista. No Dia, a grade de horários mostra cada reserva do tamanho do tempo na mesa e, ao lado, os cartões com Confirmar, Chegou, Não veio, mesa e WhatsApp. A Lista mostra os próximos 60 dias com os cartões.',
      },
      {
        tag: 'novo',
        text: 'Painel do lado: Nova reserva, minicalendário, resumo do dia escolhido (reservas, pessoas, aguardando e no salão), filtro por situação com a cor de cada uma e o atalho para as reservas pelo cardápio (ligar, configurar e copiar o link).',
      },
      {
        tag: 'novo',
        text: 'Arrastar para remarcar (dia e horário, em passos de 15 minutos) e puxar a borda de baixo para mudar o tempo na mesa. Clicar num horário vazio já abre a nova reserva naquele dia e hora.',
      },
      {
        tag: 'melhoria',
        text: 'Tempo na mesa por reserva (no formulário e arrastando), levado em conta para não marcar a mesma mesa em horários que se cruzam. A mesa pequena para o grupo aparece marcada na lista.',
      },
      {
        tag: 'melhoria',
        text: 'Botão "aguardando" no topo mostra só as reservas que esperam confirmação; busca por nome, celular, código ou mesa; o mês mostra quantas pessoas estão reservadas em cada dia.',
      },
    ],
  },
  {
    version: '0.159.0',
    date: '2026-11-18',
    title: 'Financeiro com gráficos e leituras do mês',
    summary:
      'O Financeiro abre numa Visão geral nova: os números do mês comparados com o mês anterior, o saldo acumulado com a previsão até o fim do mês e frases curtas que dizem o que merece atenção. Fechamentos, Fluxo de caixa, DRE, Contas e Conciliação também ganharam gráficos.',
    notes: [
      {
        tag: 'novo',
        text: 'Visão geral do Financeiro: saldo do mês, entradas, saídas e lucro líquido com a tendência e a variação contra os mesmos dias do mês anterior; gráfico do saldo acumulado (ou entradas e saídas por dia) com a previsão para o fim do mês e a comparação com o mês anterior.',
      },
      {
        tag: 'novo',
        text: 'Leituras do mês: o sistema lê os números e avisa em português simples. Contas vencidas, quanto o mês deve fechar de vendas no ritmo atual, quanto falta para o ponto de equilíbrio, CMV ou pessoal acima da referência, a despesa que mais subiu, o dia da semana mais forte, a maquininha mais cara e faltas nas gavetas. Tocar numa leitura abre a aba do assunto.',
      },
      {
        tag: 'novo',
        text: 'Para onde vai o dinheiro (despesas por grupo, em % da receita), Como os clientes pagam (vendas e taxa de cada forma de pagamento), Vendas por dia da semana e Próximos vencimentos, tudo na Visão geral.',
      },
      {
        tag: 'melhoria',
        text: 'Fechamentos: gráfico de vendas (ou líquido) por dia com a média e o melhor dia, e as vendas por forma de pagamento ao lado. Fluxo de caixa: gráfico do saldo acumulado com previsão ou de entradas e saídas, e a opção de esconder os dias sem movimento.',
      },
      {
        tag: 'melhoria',
        text: 'DRE: cascata "Do faturamento ao lucro" mostra quanto o CMV, as despesas variáveis e as fixas levam da receita. Contas e Conciliação ganharam um resumo mais limpo no topo, com a parte das contas do mês já paga.',
      },
    ],
  },
  {
    version: '0.158.1',
    date: '2026-11-18',
    title: 'Chamado mais claro, e a conversa pelo chat',
    summary:
      'A tela de um chamado aberto ficou mais simples de ler: a situação no topo com as etapas, o que você contou com as fotos e vídeos, e o histórico do andamento. Para conversar sobre o chamado, o botão Falar no chat abre o chat de Suporte com o chamado já anexado.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Sem a conversa no meio da tela do chamado: em Sistema › Chamados, cada chamado mostra a situação atual com a barra das seis etapas, a descrição e os anexos em tamanho bom, e um histórico do mais novo para o mais antigo (com as respostas da equipe).',
      },
      {
        tag: 'melhoria',
        text: 'Falar no chat ganhou um cartão próprio, logo ao lado (no celular, logo abaixo da situação): abre o Suporte com o chamado já anexado, é só escrever.',
      },
      {
        tag: 'correção',
        text: 'No chat, o "Sobre o chamado #CH-0000" não quebra mais em três linhas no celular: o título do chamado é que encurta.',
      },
    ],
  },
  {
    version: '0.158.0',
    date: '2026-11-18',
    title: 'Agenda, no jeito do Google Agenda',
    summary:
      'Nova aba Agenda no menu, ao lado de Novidades: cada pessoa da equipe anota o que precisa fazer em cada dia, organiza com as próprias tags e vê tudo por dia, semana, mês ou lista. Se quiser, o assistente lembra pelo WhatsApp na hora escolhida.',
    notes: [
      {
        tag: 'novo',
        text: 'Agenda pessoal com as visões Dia, Semana, Mês e Lista: minicalendário do lado, botão Criar, clicar num horário vazio cria ali e dá para arrastar o compromisso para outro dia ou hora (e puxar a borda de baixo para mudar a duração).',
      },
      {
        tag: 'novo',
        text: 'Tags criadas por você (nome e cor), que também servem de filtro: desmarque uma tag no painel e os compromissos dela somem da tela. Cada compromisso tem anotações e pode ser marcado como concluído.',
      },
      {
        tag: 'novo',
        text: 'Lembrete pelo WhatsApp: permita uma vez (com o seu número) e escolha em cada compromisso quando avisar: na hora, minutos ou horas antes, na véspera ou num dia e hora à sua escolha. A mensagem sai pelo WhatsApp do restaurante conectado pelo QR Code.',
      },
      {
        tag: 'melhoria',
        text: 'No celular, o mês mostra bolinhas nos dias com compromisso e a lista do dia tocado logo abaixo; tags, busca e lembretes ficam no botão do topo.',
      },
    ],
  },
  {
    version: '0.157.1',
    date: '2026-11-18',
    title: 'Trocar a senha sem digitar a atual',
    summary:
      'Quem já entrou no sistema troca a senha só escolhendo a nova: não precisa mais digitar a senha atual.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Trocar minha senha (equipe): a janela pede só a nova senha e a confirmação. Os outros aparelhos continuam saindo da conta.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio online: na conta do cliente, Trocar senha também pede só a nova.',
      },
    ],
  },
  {
    version: '0.157.0',
    date: '2026-11-18',
    title: 'Calendário de recebimentos mais simples',
    summary:
      'No Super Admin › Cobrança, o calendário ficou no jeito de agenda: o mês à esquerda com o total de cada dia e, ao lado, as cobranças do dia escolhido. Clicar numa cobrança abre todos os dados dela.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Calendário de recebimentos: grade do mês mais limpa (total do dia e uma bolinha por cobrança, com fundo leve na cor da situação) e filtro por situação (recebido, fatura enviada, vencida ou prevista).',
      },
      {
        tag: 'novo',
        text: 'Ao clicar num dia, as cobranças aparecem ao lado em cartões (no celular, logo abaixo da grade). Clicar no cartão abre os dados da cobrança: situação, valor e líquido, descrição, tipo, plano, forma, vencimento, quando foi paga e emitida, se foi para o Asaas, e os links da fatura, do boleto e do restaurante.',
      },
      {
        tag: 'melhoria',
        text: 'Marcar como pago e Desfazer pagamento agora ficam na janela da cobrança.',
      },
    ],
  },
  {
    version: '0.156.0',
    date: '2026-11-18',
    title: 'Calendário novo em todo campo de data',
    summary:
      'Clicar em qualquer campo de data abre o calendário do Comandou: o mês inteiro, setas para trocar o mês, o dia de hoje marcado e o botão Hoje. Os filtros de período das listas ficaram mais fáceis de usar e foram conferidos um a um.',
    notes: [
      {
        tag: 'novo',
        text: 'Todo campo de data (contas, estoque, reservas, relatórios, notas, Super Admin) abre um calendário logo embaixo do campo, no computador, e numa folha grande, no celular. Clique no nome do mês para pular para outro mês ou ano; Hoje e Limpar ficam no rodapé. Dá para continuar digitando a data, e pelo teclado Alt + seta para baixo abre o calendário.',
      },
      {
        tag: 'melhoria',
        text: 'Filtro de período das listas: no De/Até, o calendário marca os dias do período (com prévia ao passar o mouse) e, escolhido o De, já abre o Até. Agora também vale só o De (dali em diante) ou só o Até (até aquele dia).',
      },
      {
        tag: 'melhoria',
        text: 'Agendar atualização no Super Admin: data no calendário e hora ao lado.',
      },
      {
        tag: 'correção',
        text: 'NFC-e e NF-e: o filtro de período usa a mesma data da coluna Quando (a da emissão), e não mais a da criação da nota.',
      },
      {
        tag: 'correção',
        text: 'Clientes: buscar pelo CPF ou CNPJ mostrava o cliente por um instante e o escondia logo depois.',
      },
      {
        tag: 'correção',
        text: 'Limpar filtros com uma aba aberta volta para os filtros da aba (antes apagava os da aba também e a lista não batia com a aba marcada). A nota do filtro de data não diz mais "Filtra pela período".',
      },
    ],
  },
  {
    version: '0.155.0',
    date: '2026-11-18',
    title: 'Conversas do suporte mais claras e chamados pelo chat',
    summary:
      'A conversa com a Comandou ganhou balões como nos Chamados, e a conversa de cada chamado foi para o chat: o restaurante escolhe qual chamado quer mostrar e ele vai junto na mensagem, como um cartão que abre o chamado. No Super Admin, Conversas mostra o número de conversas com mensagem nova.',
    notes: [
      {
        tag: 'novo',
        text: 'Chat › Suporte: pelo clipe, "Um chamado" cita um chamado do restaurante na mensagem. O cartão mostra o número, o título e em que pé está, e abre o chamado com um toque, dos dois lados.',
      },
      {
        tag: 'melhoria',
        text: 'Chamados: a conversa saiu de dentro do chamado. A tela mostra o andamento e o botão Falar no chat, que abre o Suporte com o chamado já citado.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin › Conversas: mensagens em balões (as suas à direita), coluna com o restaurante (situação, plano, assinatura, cliente desde e Entrar no sistema) e cabeçalho com a situação da conversa.',
      },
      {
        tag: 'novo',
        text: 'Super Admin: número de conversas com mensagem nova na frente de Conversas (no menu e nas abas do celular), no título da aba do navegador e um aviso quando chega mensagem com outra tela aberta.',
      },
      {
        tag: 'melhoria',
        text: 'Super Admin › Chamados: a aba Conversa virou Notas (só para a equipe) e ganhou Conversar sobre este chamado, que abre a conversa do restaurante com o chamado citado.',
      },
      {
        tag: 'melhoria',
        text: 'Chat do sistema: fecha ao clicar fora dele ou no Esc, e o botão Chat lá em cima abre e fecha.',
      },
    ],
  },
  {
    version: '0.154.1',
    date: '2026-11-18',
    title: 'Esqueci minha senha confere o e-mail',
    summary:
      'Ao pedir o código da senha nova, o sistema confere o e-mail digitado. Se não for de nenhuma conta do restaurante, avisa na hora embaixo do campo, em vez de mandar esperar um código que nunca chega.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Esqueci minha senha (painel, PDV, cozinha, entregas e Super Admin): se o e-mail não é de nenhuma conta do restaurante, o aviso aparece embaixo do campo e pede para conferir o que foi digitado. Com o e-mail certo, a tela diz para onde o código foi.',
      },
      {
        tag: 'melhoria',
        text: 'Quem pede mais de 5 códigos em uma hora vê o aviso para usar o último que chegou, em vez de ficar esperando.',
      },
    ],
  },
  {
    version: '0.154.0',
    date: '2026-11-18',
    title: 'PDV mais arrumado e com botão de silenciar',
    summary:
      'A tela inicial do PDV ficou mais limpa: os atalhos da loja viraram um grupo só, os totais do dia subiram para o lado do título Pedidos (o quadro ganhou altura) e o salão mostra só linhas inteiras de mesas. Ganhou também o botão Silenciar, e o atalho da página do restaurante só aparece quando ela foi criada.',
    notes: [
      {
        tag: 'novo',
        text: 'PDV: botão Silenciar ao lado de Mensagens. Um toque desliga todos os avisos sonoros deste aparelho e o botão fica vermelho (Silenciado) até ligar de novo. No celular, só o ícone.',
      },
      {
        tag: 'melhoria',
        text: 'PDV: o botão da página do restaurante (o globo) só aparece depois que a página /site é criada em Loja online.',
      },
      {
        tag: 'melhoria',
        text: 'PDV: concluídos e cancelados de hoje ficam ao lado do título Pedidos, e o pedido de cancelamento do cliente aparece como aviso vermelho só quando existe. O rodapé de três botões saiu e o quadro ficou mais alto.',
      },
      {
        tag: 'melhoria',
        text: 'PDV: a legenda das mesas fica ao lado do título Salão, a busca e o Recolher à direita, e a grade de mesas não mostra mais uma linha cortada pela metade.',
      },
    ],
  },
  {
    version: '0.153.0',
    date: '2026-11-18',
    title: 'Novo topo do site',
    summary:
      'O começo do site do Comandou foi refeito: título grande no centro, a barra de criar o restaurante num cartão só e, embaixo, a tela da cozinha com o celular da loja na frente, que se endireita conforme a pessoa rola.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Título, frase e selo do teste grátis centralizados, com pontinhos leves ao fundo. Sem espaço vazio sobrando no topo.',
      },
      {
        tag: 'melhoria',
        text: 'Criar o restaurante virou um cartão só: a escolha (site, Google Maps ou descrever), o campo com o botão na mesma linha e a dica embaixo. O cartão inteiro acende no foco. Descrevendo, a dica explica como escrever os itens.',
      },
      {
        tag: 'melhoria',
        text: 'Embaixo, a tela de verdade da cozinha com o celular da loja na frente (que continua mostrando o que a pessoa digita). No computador o conjunto chega deitado, fica reto ao rolar e o celular anda mais rápido que a tela de trás. Os avisos não cobrem mais o botão da sacola.',
      },
    ],
  },
  {
    version: '0.152.3',
    date: '2026-11-18',
    title: 'Tela de entrada mais limpa',
    summary:
      'A tela de entrada ficou minimalista: saíram a aurora, a grade e o brilho, e no lugar ficaram poucos pontinhos flutuando devagar, na cor da loja e em cinza, longe dos campos.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Fundo da tela de entrada trocado por pontinhos discretos (Particles), em todas as entradas: restaurante, garçom, cozinha, entregas e Super Admin.',
      },
    ],
  },
  {
    version: '0.152.2',
    date: '2026-11-18',
    title: 'Liga e desliga dos itens no cardápio volta a funcionar',
    summary:
      'Em Cardápio › Cardápios, clicar na chavinha verde de um item não fazia nada, então não dava para tirar um item do cardápio. Agora a chavinha responde ao clique; depois é só tocar em Salvar.',
    notes: [
      {
        tag: 'correção',
        text: 'Cardápios: a chave de cada item liga e desliga com o clique (o desenho da chave ficava por cima e engolia o clique).',
      },
    ],
  },
  {
    version: '0.152.1',
    date: '2026-11-18',
    title: 'Colar um valor no campo troca o valor todo',
    summary:
      'Depois da 0.150.5, colar ou preencher um valor inteiro (como 50,00) num campo de valor entrava só na parte antes da vírgula e virava 50,00,00. Agora o valor colado substitui o campo inteiro; digitar continua começando antes da vírgula.',
    notes: [
      {
        tag: 'correção',
        text: 'Campos de valor: colar ou preencher 50,00 dá 50,00 (antes ficava 50,00,00). Digitar 3 em 0,00 continua dando 3,00.',
      },
    ],
  },
  {
    version: '0.152.0',
    date: '2026-11-18',
    title: 'Chamados com cara de conversa',
    summary:
      'Em Sistema › Chamados, o chamado aberto agora ocupa a tela toda e funciona como um chat: suas mensagens à direita, as do suporte à esquerda, separadas por dia, com o andamento passo a passo ao lado. A lista mostra quantos chamados estão em andamento e quantas respostas novas chegaram.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Chamado aberto em tela cheia, no jeito de um chat: balões com horário, mensagens seguidas juntas, separador de dia e os avisos do andamento no meio da conversa.',
      },
      {
        tag: 'melhoria',
        text: 'Caixa de escrever sempre embaixo, com clipe para foto ou vídeo; Enter envia e Shift + Enter pula linha. A conversa desce sozinha quando chega mensagem nova.',
      },
      {
        tag: 'melhoria',
        text: 'Ao lado da conversa, o andamento em passos (com o que cada um quer dizer) e os detalhes do chamado: número, assunto, quanto atrapalha, quem abriu e a última novidade.',
      },
      {
        tag: 'melhoria',
        text: 'Lista de chamados com o resumo no topo (em andamento, respostas novas e resolvidos), o assunto com ícone em cada cartão, aviso de resposta nova e há quanto tempo mudou. No celular, só aparecem as etapas que têm chamado.',
      },
    ],
  },
  {
    version: '0.151.0',
    date: '2026-11-18',
    title: 'Orçamento vira proposta comercial formal',
    summary:
      'O PDF do Super Admin › Orçamento agora é uma proposta comercial completa e em tom formal: apresentação, escopo, investimento, implantação com etapas e prazo, nota fiscal, condições comerciais, nível de serviço, validade e aceite com assinatura das duas partes. Em cada orçamento você escolhe a validade, os dias de teste grátis, a vigência do contrato e o prazo de implantação.',
    notes: [
      {
        tag: 'novo',
        text: 'Orçamento: novos campos de prazo por cliente (validade com atalhos de 7, 15, 30 e 60 dias, teste grátis, vigência do contrato e prazo de implantação em dias úteis), com a data de validade mostrada na hora.',
      },
      {
        tag: 'melhoria',
        text: 'PDF do orçamento reescrito como proposta comercial: quadro com mensalidade, implantação, teste e validade, seções numeradas, cláusulas formais (multa, juros, reajuste, rescisão, LGPD) e campo de aceite.',
      },
    ],
  },
  {
    version: '0.150.5',
    date: '2026-11-18',
    title: 'Campos de valor começam antes da vírgula',
    summary:
      'Nos campos de valor que já vêm com 0,00 (Implantação, Mensalidade, preços, frete, desconto e os demais), o número digitado ia para depois do último zero. Agora, ao entrar no campo, o cursor fica antes da vírgula: digitar 3 dá 3,00. Para os centavos, é só digitar a vírgula.',
    notes: [
      {
        tag: 'correção',
        text: 'Campos de valor: ao entrar, a parte antes da vírgula já vem selecionada, então digitar 3 em 0,00 dá 3,00 (antes ficava 0,003). Vale no painel do restaurante e no Super Admin.',
      },
      {
        tag: 'melhoria',
        text: 'Digitar a vírgula (ou o ponto) no meio do valor pula para os centavos, já selecionados: 3, vírgula, 50 dá 3,50.',
      },
    ],
  },
  {
    version: '0.150.4',
    date: '2026-11-18',
    title: 'Menu lateral mais fácil de ler',
    summary:
      'O menu lateral aberto ficou mais limpo: letras e ícones um pouco maiores, itens bem separados e o encontro do menu com a barra de cima agora é reto, sem a curvinha.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Menu lateral aberto com letra de 15 px, ícones maiores e um pouco mais largo, para nomes como "Grupos de complementos" caberem inteiros.',
      },
      {
        tag: 'melhoria',
        text: 'Com o menu aberto, o painel encosta reto no menu e na barra de cima (sem o canto arredondado).',
      },
    ],
  },
  {
    version: '0.150.3',
    date: '2026-11-18',
    title: 'Respostas do contrato chegam na sua caixa',
    summary:
      'Os e-mails do contrato saem pelo Resend, de um remetente sem caixa de entrada. Agora cada um leva o "Responder para": quando o cliente responde, a resposta vai para o e-mail de aviso da contratada; quando você responde o aviso de assinatura, vai direto para o cliente.',
    notes: [
      {
        tag: 'melhoria',
        text: 'E-mails do contrato (envio, recibo, via final e cancelamento) respondem para o e-mail de aviso da contratada, e os avisos para a contratada respondem para quem assinou pelo cliente.',
      },
      {
        tag: 'correção',
        text: 'Via final do contrato: um endereço recusado não impede mais os outros de receberem o PDF, e o erro mostra qual endereço falhou. Falha passageira do Resend fica na fila e sai sozinha.',
      },
      {
        tag: 'correção',
        text: 'O número do contrato usa o ano no horário de Brasília (na noite de 31/12 não pula para o ano seguinte).',
      },
    ],
  },
  {
    version: '0.150.2',
    date: '2026-11-18',
    title: 'Período pago mudado à mão some com a fatura vencida',
    summary:
      'Quando o Super Admin estende o "Período pago até" de um restaurante, a mensalidade em aberto que o novo prazo já cobre é cancelada sozinha. O aviso "Há fatura vencida" some do sistema e as datas batem em todas as telas.',
    notes: [
      {
        tag: 'correção',
        text: 'Estender o período pago no Super Admin cancela as mensalidades em aberto cujo período inteiro fica dentro do novo prazo (no Asaas também). Antes elas seguiam vencidas e o restaurante via "Há fatura vencida" mesmo liberado.',
      },
      {
        tag: 'correção',
        text: 'Super Admin › Assinatura: o campo "Período pago até" mostra o dia de Brasília (antes aparecia um dia a mais, e cada Salvar empurrava a data), e o "Liberado até" logo abaixo atualiza na hora em que você salva.',
      },
    ],
  },
  {
    version: '0.150.1',
    date: '2026-11-18',
    title: 'Recibo do entregador volta a imprimir',
    summary:
      'Em Entregas › Pagamento aos entregadores, o botão Imprimir do recibo abria uma folha em branco. Agora sai a folha com o nome da loja, o entregador, o período, a conta do repasse e a linha de assinatura.',
    notes: [
      {
        tag: 'correção',
        text: 'Imprimir o recibo de pagamento ao entregador não sai mais em branco: o recibo é impresso numa folha própria, sem o resto da tela.',
      },
    ],
  },
  {
    version: '0.150.0',
    date: '2026-11-17',
    title: 'E-mails com o panda e nova senha por código',
    summary:
      'Todos os e-mails do Comandou ganharam visual novo, com o panda de cada assunto, no claro e no escuro. Esqueceu a senha? Em qualquer tela de entrada (painel, PDV, cozinha, entregas e Super Admin) chega um código por e-mail, que aparece já no assunto: dá para copiar da notificação sem abrir. O restaurante também recebe sozinho os avisos de fim do teste grátis e de mensalidade.',
    notes: [
      {
        tag: 'novo',
        text: 'Esqueci minha senha em todas as telas de entrada: digite o e-mail, confira o código de 6 números e crie a senha nova. O código vale 15 minutos, aceita 5 tentativas e a conta sai dos outros aparelhos. No restaurante você já entra; no Super Admin o login continua pedindo o autenticador.',
      },
      {
        tag: 'novo',
        text: 'O código vem no começo do assunto e na linha de prévia do e-mail: aparece na notificação do celular e na lista da caixa de entrada. As 6 caixas aceitam colar e o preenchimento automático do celular.',
      },
      {
        tag: 'novo',
        text: 'Avisos automáticos por e-mail: o teste grátis acaba amanhã, o teste terminou, a mensalidade vence em 3 dias, venceu, o sistema foi pausado e o pagamento foi recebido. Cada aviso sai uma vez só; liga e desliga em Super Admin › E-mail › Modelos.',
      },
      {
        tag: 'melhoria',
        text: 'E-mails redesenhados com o panda (acenando nas boas-vindas, com a chave no código, com o relógio no vencimento, dormindo no fim do teste, de chapéu de festa no pagamento): boas-vindas, código de senha do cliente da loja, contratos e o e-mail de teste.',
      },
      {
        tag: 'novo',
        text: 'Super Admin › E-mail › Modelos: a prévia de cada e-mail do sistema no tamanho do computador e do celular, com o botão de mandar um teste para você.',
      },
      {
        tag: 'segurança',
        text: 'Depois de trocar a senha pelo código chega o aviso "sua senha foi trocada". O pedido responde igual exista a conta ou não, e cada conta recebe no máximo 5 códigos por hora.',
      },
    ],
  },
  {
    version: '0.149.0',
    date: '2026-11-17',
    title: 'Criar restaurante em tela própria, com passos',
    summary:
      'No Super Admin, criar restaurante agora abre uma tela só para isso, em cinco passos, em vez de uma janela que fechava com um clique fora e perdia tudo. No fim, o login e a senha vão para o e-mail do dono e a tela avisa para onde foram.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Restaurantes › Novo abre uma tela própria com os passos Restaurante, Acesso do dono, Plano, Contato e cobrança (opcional) e Conferir e criar. Dá para voltar a qualquer passo e o que foi digitado fica guardado (menos a senha) se você sair da tela.',
      },
      {
        tag: 'novo',
        text: 'O endereço, o login e a senha inicial vão por e-mail para o dono do restaurante novo (pode desligar no passo Acesso do dono). A tela final diz para qual e-mail foi, ou por que não saiu.',
      },
    ],
  },
  {
    version: '0.148.0',
    date: '2026-11-17',
    title: 'A IA acha o restaurante no Google Maps e monta a loja',
    summary:
      'Nos primeiros passos, escolha Achar no Google Maps: a IA procura o restaurante no Maps e na internet (site, iFood, Instagram) e já traz endereço, telefone, horário, logo, cores e o cardápio que encontrar, para você só conferir. Não achou: mande o PDF, fotos ou o link do cardápio e a IA monta tudo do mesmo jeito.',
    notes: [
      {
        tag: 'novo',
        text: 'Primeiros passos: opção Achar no Google Maps. A IA pesquisa o restaurante pelo nome e a cidade (ou pelo link do Maps), preenche a loja e lê o cardápio do site ou do app de delivery que achar. Se não achar, a conversa pede o PDF, as fotos ou o link do cardápio.',
      },
      {
        tag: 'melhoria',
        text: 'Link do Google Maps (no cardápio ou no teste criado pelo site) agora traz telefone, horário, foto e o cardápio de verdade, não só o nome e o endereço.',
      },
      {
        tag: 'melhoria',
        text: 'Site com IA no comandou.com: quem escolhe o Google Maps ganha a loja com os dados e o cardápio reais do restaurante, pesquisados na internet, em vez de itens sugeridos.',
      },
      {
        tag: 'melhoria',
        text: 'Com a IA desligada, os primeiros passos explicam por que só dá para escrever os itens e o que muda quando a IA é ligada.',
      },
    ],
  },
  {
    version: '0.147.0',
    date: '2026-11-17',
    title: 'WhatsApp pronto para muitos clientes ao mesmo tempo',
    summary:
      'O WhatsApp por QR Code foi preparado para muitos restaurantes e muitas conversas ao mesmo tempo: cada conversa segue na ordem certa, um restaurante movimentado não atrasa os outros, as mensagens saem num ritmo de gente e, depois de uma queda da internet, os números voltam aos poucos em vez de todos juntos.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Mensagens recebidas vão para o atendimento numa fila por conversa: as de um mesmo cliente chegam na ordem e conversas diferentes andam em paralelo, sem que um restaurante lento segure os outros.',
      },
      {
        tag: 'melhoria',
        text: 'A mesma mensagem nunca é respondida duas vezes, mesmo com mais de um servidor da API atendendo.',
      },
      {
        tag: 'melhoria',
        text: 'Mensagens do mesmo número saem com um pequeno intervalo entre elas (menos risco de bloqueio). Uma rajada de avisos espera a vez e é tentada de novo, em vez de falhar.',
      },
      {
        tag: 'melhoria',
        text: 'Depois de uma queda da internet ou de reiniciar o serviço, os WhatsApps dos restaurantes reconectam espalhados no tempo, e não todos no mesmo instante.',
      },
      {
        tag: 'melhoria',
        text: 'Mais memória para o serviço do WhatsApp e um resumo de carga (quantos conectados, fila de mensagens e memória) para acompanhar o crescimento.',
      },
    ],
  },
  {
    version: '0.146.0',
    date: '2026-11-17',
    title: 'Tela de entrada com fundo animado',
    summary:
      'A tela de entrada ganhou um fundo vivo: uma aurora na cor do restaurante descendo do topo, uma grade de pontinhos e um brilho suave atrás dos campos. Vale para o login da equipe, do garçom, da cozinha, das entregas e do Super Admin, no claro e no escuro.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Fundo animado na tela de entrada, sempre na cor da marca da loja (a logo e o botão continuam iguais).',
      },
      {
        tag: 'melhoria',
        text: 'Leve no celular: desenha em resolução reduzida, para quando a aba some e fica parado para quem pediu menos movimento no aparelho. Sem suporte a WebGL, aparece um degradê parado.',
      },
    ],
  },
  {
    version: '0.145.0',
    date: '2026-11-17',
    title: 'Fechamento de caixa, conciliação bancária e DRE',
    summary:
      'Fechou o caixa, o dia vai sozinho para o financeiro: o que entrou em cada forma de pagamento, a taxa da maquininha e o dia em que o dinheiro cai na conta. Importe o extrato do banco (OFX) e o Comandou confere os repasses sozinho. O DRE mostra do faturamento ao lucro, com CMV, despesas e os indicadores do restaurante. O assistente de IA responde sobre tudo isso.',
    notes: [
      {
        tag: 'novo',
        text: 'Fechamentos: cada dia com os caixas, vendas por forma de pagamento, taxa, líquido, quando cai na conta e sobra ou falta da gaveta. Fechar o caixa lança o dia no financeiro sozinho; caixas antigos têm o botão Lançar no financeiro.',
      },
      {
        tag: 'novo',
        text: 'Taxas e prazos das maquininhas: taxa e dias de cada forma (crédito, débito, PIX, vale-refeição com as regras novas do PAT). Fim de semana passa para a segunda.',
      },
      {
        tag: 'novo',
        text: 'Conciliação bancária: cadastre a conta, importe o extrato em OFX (linhas repetidas são puladas) e o que bater com os repasses dos caixas e as contas é conciliado sozinho. O resto vem com sugestão; dá para criar a despesa a partir da linha (tarifa, compra no débito), marcar transferência ou ignorar, e desfazer.',
      },
      {
        tag: 'novo',
        text: 'A receber das maquininhas: o que ainda vai cair, o que já devia ter caído (atrasado) e o botão Recebi para quem não importa extrato. Diferença entre o que caiu e o previsto entra no DRE como ajuste de taxa.',
      },
      {
        tag: 'novo',
        text: 'DRE gerencial por competência ou por caixa, comparado com o mês anterior: receita por canal, CMV pelas fichas técnicas (ou pelas compras), taxas, despesas pelo plano de contas e lucro. Indicadores com referência: CMV, pessoal, ocupação, CMV + pessoal, margem, ponto de equilíbrio e ticket médio. Baixa em planilha.',
      },
      {
        tag: 'melhoria',
        text: 'Contas: a categoria sugere o plano de contas e mostra em que linha do DRE a conta entra; o novo Repetir lança a mesma conta para os próximos meses. Totais e fluxo de caixa descontam as taxas das maquininhas.',
      },
      {
        tag: 'melhoria',
        text: 'Assistente de IA: responde sobre fechamentos, recebíveis atrasados, conciliação pendente, DRE e indicadores do mês.',
      },
    ],
  },
  {
    version: '0.144.0',
    date: '2026-11-17',
    title: 'Site com rolagem animada',
    summary:
      'O site do Comandou ganhou uma rolagem mais caprichada: suave no computador, com a tela do sistema que se endireita ao chegar, uma frase que acende palavra por palavra, os três passos em pilha e a marca enorme no rodapé.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Rolagem suave no computador (no celular continua a rolagem do aparelho). Os links do menu deslizam até a seção.',
      },
      {
        tag: 'melhoria',
        text: 'A tela do sistema chega deitada e se endireita com a rolagem, com um brilho que passa ao apontar o mouse. Depois vem uma frase grande que acende conforme a pessoa desce.',
      },
      {
        tag: 'melhoria',
        text: 'Os três passos viraram cartões que se empilham, cada um com o seu desenho. As faixas que passam aceleram com a rolagem e o rodapé tem a marca Comandou em letras grandes.',
      },
      {
        tag: 'melhoria',
        text: 'Detalhes novos: títulos que sobem palavra por palavra, borda com luz no quadro do preço, vistos que se desenham, botões com seta e perguntas com o + que vira −. Com "reduzir movimento" ligado, tudo fica parado.',
      },
    ],
  },
  {
    version: '0.143.0',
    date: '2026-11-17',
    title: 'Custo das fichas recalculado sozinho',
    summary:
      'Mudou o preço de uma matéria-prima, o Comandou recalcula na hora o custo de todo preparo da casa e de todo item do cardápio que a usa, mostra o impacto na margem e guarda o histórico. O assistente de IA passou a conhecer os custos e responde por que a margem mudou.',
    notes: [
      {
        tag: 'novo',
        text: 'Custo automático: entrada ou recebimento com preço, produção ou o novo botão Mudar preço recalculam sozinhos os preparos (em cascata, preparo dentro de preparo) e os itens do cardápio e complementos que usam o insumo.',
      },
      {
        tag: 'novo',
        text: 'Mudar preço no detalhe do insumo: mostra antes quanto cada item do cardápio vai custar e quanto do preço o custo passa a comer, e só depois aplica.',
      },
      {
        tag: 'novo',
        text: 'Mudanças de custo na Precificação e no insumo: o antes e depois de cada insumo e de cada item recalculado. No insumo, a aba Onde é usado lista os preparos e itens que o levam.',
      },
      {
        tag: 'melhoria',
        text: 'Compra que encarece o custo avisa gerentes e administradores, com os itens em que o custo mais pesa no preço. O preço de venda nunca muda sozinho.',
      },
      {
        tag: 'melhoria',
        text: 'A ficha de preparo define o custo do preparo na hora de salvar, e ficha circular (um preparo levando o outro) é recusada.',
      },
      {
        tag: 'melhoria',
        text: 'Assistente de IA: sabe como o custo automático funciona e vê as últimas mudanças de custo e os itens com custo mais alto no preço.',
      },
    ],
  },
  {
    version: '0.142.0',
    date: '2026-11-17',
    title: 'E-mail só pelo Resend',
    summary:
      'A aba E-mail do Super Admin ficou enxuta: só a configuração do Resend e o histórico de envios. Boas-vindas do teste, código de nova senha e contratos continuam saindo normalmente pelo Resend.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Super Admin › E-mail: só as abas Resend (chave, remetente e e-mail de teste) e Envios (reenviar e cancelar).',
      },
      {
        tag: 'melhoria',
        text: 'Saíram as caixas de e-mail do domínio, o recebimento pela Cloudflare, a agenda, a página pública de agendamento e os envios pela Cloudflare e por SMTP.',
      },
      {
        tag: 'segurança',
        text: 'Menos superfície exposta: a rota de recebimento de e-mail e a página pública de agendamento não existem mais, e as chaves antigas da Cloudflare e do SMTP são apagadas ao salvar o Resend.',
      },
    ],
  },
  {
    version: '0.141.0',
    date: '2026-11-17',
    title: 'E-mail próprio no Super Admin, sem n8n',
    summary:
      'O Comandou passou a mandar os próprios e-mails, sem o n8n: boas-vindas do teste, código de nova senha, contratos e convites saem por uma fila que tenta de novo sozinha. O Super Admin ganhou a aba E-mail, com caixas do domínio, agenda, página de agendamento e o histórico de envios. O site ficou sempre claro, com menu solto e animações.',
    notes: [
      {
        tag: 'novo',
        text: 'Super Admin › E-mail: caixas do seu domínio (contato@, vendas@...) para ler, responder, encaminhar e anexar arquivos, com busca, estrela, pastas, regras, contatos e resposta automática. O que chega vem pela Cloudflare (Email Routing + um Worker deste repositório).',
      },
      {
        tag: 'novo',
        text: 'Super Admin › E-mail › Agenda: eventos com repetição e convidados. O convite vai com o arquivo da agenda e a resposta (Sim, Não, Talvez) volta para o evento.',
      },
      {
        tag: 'novo',
        text: 'Página pública de agendamento (/agendar/<endereço>): a pessoa escolhe um horário livre e recebe o convite. Dois visitantes nunca ficam com o mesmo horário.',
      },
      {
        tag: 'melhoria',
        text: 'E-mails do sistema (boas-vindas do teste, código de nova senha do cliente, contratos) saem pelo próprio Comandou, por Cloudflare, Resend ou SMTP, com novas tentativas. E-mail com senha ou código fica cifrado na fila e é apagado assim que sai. O n8n não é mais usado.',
      },
      {
        tag: 'melhoria',
        text: 'Site: sem modo escuro, menu superior solto que acompanha a rolagem, menu próprio no celular, faíscas no clique, botões que seguem o ponteiro e afundam ao apertar, e holofote nos cartões.',
      },
      {
        tag: 'correção',
        text: 'O e-mail de boas-vindas do teste se perdia se o envio falhasse na hora: agora fica na fila e sai quando o provedor voltar.',
      },
      {
        tag: 'correção',
        text: 'Dois cadastros de teste ao mesmo tempo com o mesmo e-mail criavam dois restaurantes. Agora só um é criado.',
      },
      {
        tag: 'segurança',
        text: 'Os webhooks do n8n saíram: o painel não chama mais endereços livres, e senha e código não passam mais por outro sistema.',
      },
    ],
  },
  {
    version: '0.140.0',
    date: '2026-11-16',
    title: 'Página do restaurante criada pela IA',
    summary:
      'Cada restaurante ganhou uma página de apresentação em seu endereço com /site. A IA escreve os textos no fim dos primeiros passos, com o que foi cadastrado; a página mostra logo, cores, alguns itens, endereço, horário e o botão para pedir.',
    notes: [
      {
        tag: 'novo',
        text: 'Página do restaurante (landing page) em seurestaurante.comandou.com/site: título, frase, destaques, sobre, itens do cardápio, endereço com mapa, horário, WhatsApp e o botão que leva ao cardápio online.',
      },
      {
        tag: 'novo',
        text: 'Primeiros passos: no fim da conversa a IA cria a página com o que foi cadastrado. Sem IA disponível, a página nasce com um texto padrão montado com os mesmos dados.',
      },
      {
        tag: 'novo',
        text: 'PDV: botão do globo no topo abre a página do restaurante. Em Loja online, a aba Página permite corrigir os textos à mão ou refazer com a IA.',
      },
    ],
  },
  {
    version: '0.139.0',
    date: '2026-11-16',
    title: 'App do entregador com abas, corridas para pegar e score',
    summary:
      'O app do entregador ganhou cinco abas: Início, Disponíveis, Entregas, Histórico e Perfil. O entregador pega sozinho o pedido que ficou pronto, e o restaurante continua podendo despachar pelo painel. O perfil mostra um score calculado pelo sistema.',
    notes: [
      {
        tag: 'novo',
        text: 'Entregador: aba Disponíveis com os pedidos de entrega prontos e ainda sem entregador. Mostra o endereço, a distância da loja, quanto cobrar e quanto ele ganha. Tocou em Pegar corrida, o pedido sai para entrega com ele. Se dois tocarem ao mesmo tempo, só o primeiro leva.',
      },
      {
        tag: 'novo',
        text: 'Entregador: aba Perfil com o score de 0 a 5, calculado sozinho com as corridas dos últimos 90 dias (concluir a entrega e chegar no prazo), e os números dele: entregas concluídas, tempo médio e distância rodada. O score aparece a partir de 5 corridas.',
      },
      {
        tag: 'novo',
        text: 'Entregador: aba Histórico com todas as corridas encerradas e o valor de cada uma, e os ganhos ao lado. A aba Início resume o dia e leva para as entregas e para os pedidos disponíveis.',
      },
      {
        tag: 'melhoria',
        text: 'Entregador: pedido novo para pegar toca o som de chamada. Vale para o app com login e para o link do entregador. No painel, despachar para um entregador continua igual.',
      },
    ],
  },
  {
    version: '0.138.0',
    date: '2026-11-16',
    title: 'Excluir restaurante em dois cliques',
    summary:
      'No painel do Comandou, excluir um restaurante ficou direto: menu do restaurante, Excluir restaurante, confirmar. Não precisa suspender antes, digitar o endereço nem dar motivo, e nenhum backup é guardado, a não ser que se peça.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Painel do Comandou: "Excluir restaurante" agora fica no menu de três pontinhos do restaurante (e continua na aba Banco de dados). Abre uma confirmação com o nome do restaurante e o botão Excluir de vez.',
      },
      {
        tag: 'melhoria',
        text: 'Painel do Comandou: a exclusão não exige mais suspender o restaurante, digitar o endereço nem escrever o motivo. O restaurante sai do ar assim que a exclusão é pedida.',
      },
      {
        tag: 'melhoria',
        text: 'Painel do Comandou: a exclusão não guarda backup. Quem quiser guardar marca "Guardar um backup final antes" na confirmação (precisa do backup configurado).',
      },
    ],
  },
  {
    version: '0.137.0',
    date: '2026-11-16',
    title: 'Primeiros passos: jogue o cardápio e confira',
    summary:
      'A conversa de primeiros passos pergunta se o cardápio já está pronto. Quem tem joga as fotos, o PDF ou o link e a IA monta tudo para conferir na tela seguinte. A conversa ficou maior e ganhou o botão Voltar, que guarda as respostas.',
    notes: [
      {
        tag: 'novo',
        text: 'Primeiros passos: a primeira pergunta agora é se o cardápio já está pronto. Quem tem pode arrastar as fotos ou o PDF para a tela, colar um print ou informar o link. A IA lê os itens, os preços e as fotos, e pega o logo, as cores, o ícone do site, o contato, o endereço e o horário.',
      },
      {
        tag: 'novo',
        text: 'Primeiros passos: botão Voltar no topo da conversa e na conferência. Voltar não apaga nada: o cardápio lido, as correções e as respostas já dadas continuam guardados.',
      },
      {
        tag: 'melhoria',
        text: 'Primeiros passos: a conferência abre com o título "Confira antes de aplicar" e mostra também o ícone do site. Nada entra na loja antes de aplicar.',
      },
      {
        tag: 'melhoria',
        text: 'Primeiros passos: conversa mais larga, com letras, botões e campos maiores, do começo ao fim.',
      },
      {
        tag: 'correção',
        text: 'Primeiros passos: no tema escuro, a resposta de quem está configurando a loja aparecia quase invisível. Agora fica legível nos dois temas.',
      },
    ],
  },
  {
    version: '0.136.0',
    date: '2026-11-16',
    title: 'Reservas sem conflito de mesa',
    summary:
      'A mesma mesa não fica mais com duas reservas no mesmo horário, nem quando duas pessoas marcam ao mesmo tempo. O Salão mostra a reserva na mesa livre e avisa antes de sentar outro cliente ali.',
    notes: [
      {
        tag: 'correção',
        text: 'Reservas: marcar uma mesa já reservada em horário que se cruza agora é barrado, com o nome e a hora da outra reserva. Vale para reserva nova, troca de mesa, troca de horário e reserva reaberta.',
      },
      {
        tag: 'correção',
        text: 'Reservas: duas pessoas da equipe marcando a mesma mesa ao mesmo tempo não ficam as duas com ela. Só a primeira passa.',
      },
      {
        tag: 'melhoria',
        text: 'Salão: a mesa livre mostra o horário e o nome da próxima reserva. Faltando até 1 hora, fica em laranja e o sistema pergunta antes de sentar outro cliente nela.',
      },
      {
        tag: 'melhoria',
        text: 'Reservas: ao tocar em Chegou, se a mesa marcada tem comanda aberta, o sistema avisa e pergunta se a comanda é do grupo. Ao fechar a conta da mesa, a reserva é concluída sozinha.',
      },
    ],
  },
  {
    version: '0.135.0',
    date: '2026-11-16',
    title: 'Esqueci minha senha também por e-mail',
    summary:
      'No cardápio online, quem esqueceu a senha recebe o código também no e-mail da conta, com o nome do restaurante. Funciona mesmo quando a loja não tem o WhatsApp conectado.',
    notes: [
      {
        tag: 'novo',
        text: 'Esqueci minha senha: o código de 6 dígitos vai para o e-mail cadastrado na conta do cliente, pelo n8n, além do WhatsApp da loja quando ele está conectado.',
      },
      {
        tag: 'segurança',
        text: 'Sai um código, nunca uma senha nova: a senha só muda quando o dono da conta digita o código. O código vale 15 minutos e só uma vez.',
      },
      {
        tag: 'novo',
        text: 'Super Admin › Site: campos do webhook de e-mail para os clientes, prévia do e-mail e botão de enviar um código de teste.',
      },
    ],
  },
  {
    version: '0.134.0',
    date: '2026-11-16',
    title: 'Chat do topo redesenhado e barra do item no lugar',
    summary:
      'O Chat do topo abre direto nas conversas, já dentro da mais recente, sem a tela de escolher com quem falar. A IA abre sozinha, num painel só dela. No cardápio online, a barra de adicionar do item não sobe mais ao rolar até o fim.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Chat: abre numa tela só, com Conversas, Pessoas, Mural, Avisos, Clientes (mensagens do cardápio online) e Suporte ao lado. No computador já entra na conversa mais recente, começando pelas não lidas.',
      },
      {
        tag: 'melhoria',
        text: 'IA: o botão do topo abre só o assistente, direto, num painel mais estreito.',
      },
      {
        tag: 'melhoria',
        text: 'No computador o painel fica preso à direita, logo abaixo do topo e até o fim da tela.',
      },
      {
        tag: 'correção',
        text: 'Cardápio online: no iPhone, depois de escrever a observação do item, a barra de adicionar subia ao rolar até o fim. Agora ela fica presa embaixo.',
      },
    ],
  },
  {
    version: '0.133.2',
    date: '2026-11-16',
    title: 'Teste do Super Admin com o teste grátis do valor único',
    summary:
      'O teste automático do Super Admin agora espera o restaurante novo começar "Em teste", como acontece no valor único com dias de teste grátis.',
    notes: [
      {
        tag: 'correção',
        text: 'Teste do Super Admin: restaurante criado no valor único aparece "Em teste" (antes o teste esperava "Ativa", de um plano sem dias de teste).',
      },
    ],
  },
  {
    version: '0.133.1',
    date: '2026-11-16',
    title: 'Testes automáticos com o sistema como em produção',
    summary:
      'Os testes no navegador que rodam a cada atualização passam a usar o sistema compilado, como em produção, com o modo sem internet ligado. Assim o teste de ficar sem rede confere o que o restaurante usa de verdade.',
    notes: [
      {
        tag: 'correção',
        text: 'Teste sem rede: o ambiente de teste agora tem o service worker (o servidor de desenvolvimento não tinha), então o teste de abrir, salvar e sincronizar sem internet roda de verdade.',
      },
      {
        tag: 'correção',
        text: 'Teste da tela Preço do Super Admin procura só o cartão "Mensalidade" (antes também pegava "Mudando na próxima mensalidade").',
      },
    ],
  },
  {
    version: '0.133.0',
    date: '2026-11-16',
    title: 'Painel da VM no Super Admin',
    summary:
      'Na Infraestrutura do Super Admin entrou a aba VM: dá para ver o sistema do servidor e as versões de tudo que roda nele, procurar e instalar atualizações, limpar caches e reiniciar o Docker ou a VM inteira, tudo com confirmação. O instalador passou a deixar tudo no lugar padrão do servidor.',
    notes: [
      {
        tag: 'novo',
        text: 'Aba VM: sistema operacional, kernel, fuso e relógio, se a VM precisa reiniciar e há quanto tempo está ligada.',
      },
      {
        tag: 'novo',
        text: 'Atualizações do sistema: quantas são, quais são de segurança e se incluem o Docker. Botões para procurar agora, instalar só as de segurança ou todas.',
      },
      {
        tag: 'novo',
        text: 'Componentes e versões: Comandou, PostgreSQL, Redis, Nginx, Node.js, Traefik, CrowdSec, Docker Engine, containerd, OpenSSH e OpenSSL. Postgres, Redis e Traefik ganham botão de atualizar quando sai uma correção da mesma versão.',
      },
      {
        tag: 'novo',
        text: 'Limpeza da VM: cache de pacotes, diário do sistema, logs antigos e cache de memória, com o tamanho de cada um. A limpeza do Docker também fica à mão aqui.',
      },
      {
        tag: 'novo',
        text: 'Reiniciar o Docker ou a VM pelo painel, digitando REINICIAR para confirmar. Cada ação mostra o andamento e o registro e fica na auditoria.',
      },
      {
        tag: 'melhoria',
        text: 'Instalador: programa em /opt/comandou, configuração em /etc/comandou, logs em /var/log/comandou. Rodado de outra pasta, ele se copia para /opt/comandou. O agente do servidor e o ajudante da VM já vêm ligados.',
      },
      {
        tag: 'segurança',
        text: 'O painel não executa comandos no servidor: ele pede uma ação de uma lista fixa a um ajudante do próprio servidor, que recusa qualquer outra coisa.',
      },
    ],
  },
  {
    version: '0.132.0',
    date: '2026-11-16',
    title: 'Sem internet de verdade: abre tudo, guarda a fila com segurança e avisa melhor',
    summary:
      'O modo sem internet ficou mais completo. As telas principais abrem sem conexão mesmo que ninguém as tenha aberto antes no aparelho, as fotos dos itens aparecem e a fila de alterações fica protegida contra limpeza do navegador. Quando o Wi-Fi está ligado mas o servidor não responde, o sistema percebe, avisa e envia tudo sozinho quando ele volta.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Logo depois de entrar, o sistema guarda no aparelho o PDV, o salão, as comandas, os pedidos em andamento, a cozinha e o cardápio inteiro, com o cadastro de item. Sem internet, essas telas abrem mesmo que ninguém as tenha aberto antes.',
      },
      {
        tag: 'melhoria',
        text: 'As fotos dos itens ficam guardadas no aparelho e aparecem no PDV, no garçom e no cardápio sem internet.',
      },
      {
        tag: 'melhoria',
        text: 'Wi-Fi ligado com o servidor fora: a faixa avisa "Sem conexão com o servidor", o que for salvo vai direto para o aparelho sem esperar a rede, e tudo sobe sozinho quando o servidor volta, sem precisar recarregar. Tela que demora mais de 8 segundos para carregar mostra o que está guardado.',
      },
      {
        tag: 'segurança',
        text: 'Com alterações esperando para subir, o sistema pede ao navegador para não apagar os dados do aparelho quando faltar espaço, para a fila não se perder.',
      },
      {
        tag: 'melhoria',
        text: 'Se o servidor recusar um cadastro feito sem internet, as alterações seguintes nesse mesmo registro esperam junto, com o motivo, em vez de darem erro. "Tentar de novo" envia o cadastro e depois as alterações, na ordem. Quando outra pessoa mudou o mesmo registro antes, a recusa aparece como conflito.',
      },
      {
        tag: 'melhoria',
        text: 'A faixa mostra de quando são os dados guardados na tela e a lista de pendências mostra o último envio. Com duas abas abertas, a contagem de pendências se atualiza nas duas. O app do entregador também ganhou a faixa.',
      },
    ],
  },
  {
    version: '0.131.0',
    date: '2026-11-16',
    title: 'Calendário de cobrança dá baixa sozinho',
    summary:
      'No Super Admin, o calendário de recebimentos atualiza sozinho quando o restaurante paga pelo app (Pix, boleto ou cartão do Asaas) e agora tem o botão Marcar como pago, para registrar o que você recebeu por fora.',
    notes: [
      {
        tag: 'novo',
        text: 'Cobrança → Calendário de recebimentos: confere sozinho a cada 20 segundos (e quando você volta para a aba). Quem paga pelo Asaas muda para Recebido sem recarregar a página, com aviso e a linha destacada como "Acabou de pagar". No topo do calendário aparece se a baixa sozinha está ligada e a hora da última conferência.',
      },
      {
        tag: 'novo',
        text: 'Marcar como pago em cada linha do calendário (fatura enviada, vencida ou mensalidade prevista): você escolhe o dia em que o dinheiro entrou e o cliente ganha mais 30 dias. Se a cobrança já estava no Asaas, ela é baixada lá também, para o cliente não pagar duas vezes.',
      },
      {
        tag: 'novo',
        text: 'Desfazer em pagamento marcado à mão: os 30 dias saem, a cobrança volta a ficar em aberto no Asaas e a mensalidade prevista volta para o calendário.',
      },
      {
        tag: 'melhoria',
        text: 'Aviso no calendário quando o webhook do Asaas não está cadastrado, porque sem ele a baixa não acontece sozinha na hora.',
      },
    ],
  },
  {
    version: '0.130.0',
    date: '2026-11-16',
    title: 'Cardápio instalado abre no cardápio',
    summary:
      'Quem instala o cardápio online como app (Tela de Início do iPhone ou "Baixar" no Android) agora abre direto no cardápio da loja, com o nome e o ícone dela, e não mais na tela de login da equipe.',
    notes: [
      {
        tag: 'correção',
        text: 'O app instalado a partir do cardápio abria pedindo e-mail e senha. A página já começa com o manifesto da loja (início no cardápio), que o iPhone e o Chrome leem logo na abertura.',
      },
      {
        tag: 'melhoria',
        text: 'Quem instalou antes da correção e caiu no login vê o atalho "Abrir o cardápio" na própria tela. Para ficar de vez, é só apagar o ícone e instalar de novo pelo cardápio.',
      },
    ],
  },
  {
    version: '0.129.0',
    date: '2026-11-16',
    title: 'Login minimalista com a logo do restaurante',
    summary:
      'A tela de entrada ficou só com o essencial: a logo e o nome do restaurante em cima, e-mail, senha e o botão Entrar. O ícone da aba e o nome dela passam a ser os do restaurante em todo o login, e não mais o panda do Comandou.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Login do restaurante (painel, garçom, cozinha e entregas) numa coluna só, no meio da tela: saíram o título, as frases, o painel com o mascote e o botão de tema. No garçom e no entregador, o teclado do PIN segue igual, com o link "Entrar com e-mail".',
      },
      {
        tag: 'melhoria',
        text: 'Ícone da aba com a logo do restaurante (ou o ícone escolhido na Loja online) no login e no sistema, mesmo quando as cores da loja estão desligadas para a equipe. A aba mostra o nome do restaurante.',
      },
      {
        tag: 'melhoria',
        text: 'Login do Super Admin no mesmo estilo minimalista, com o código do autenticador quando pedido.',
      },
    ],
  },
  {
    version: '0.128.1',
    date: '2026-11-16',
    title: 'Testes automáticos em dia com o valor único',
    summary:
      'Os testes que rodam a cada atualização voltaram a passar: agora conferem a tela Preço do Super Admin e o cadastro pelo site com o teste grátis do valor único.',
    notes: [
      {
        tag: 'correção',
        text: 'Teste do Super Admin confere a tela Preço (valor único) no lugar da antiga tela de planos, e cria o restaurante novo no valor único.',
      },
      {
        tag: 'correção',
        text: 'O ambiente de teste cria o plano padrão como a subida do sistema faz, então o cadastro pelo site abre com os dias de teste dele.',
      },
    ],
  },
  {
    version: '0.128.0',
    date: '2026-11-16',
    title: 'Valor único de R$ 400 para todo mundo',
    summary:
      'O Comandou passa a ter um preço só: R$ 400,00 por mês, com tudo incluso e sem limite de pessoas, produtos ou pedidos. A página de preços, o site, a tela Assinatura e o Super Admin mostram só esse valor, e quem ainda estava num plano antigo passa para ele na próxima mensalidade.',
    notes: [
      {
        tag: 'novo',
        text: 'Página de preços (/precos) com um cartão só: R$ 400,00 por mês, valor único que não muda com o número de pessoas, produtos ou pedidos. Saíram a tabela de comparação e as perguntas sobre trocar de plano.',
      },
      {
        tag: 'novo',
        text: 'Super Admin → Preço (antes Planos): o valor único, os dias de teste, quantos restaurantes já estão nele e quantos mudam na próxima mensalidade. "Mudar o valor" troca o preço, a frase e os destaques; os planos antigos ficam só como histórico.',
      },
      {
        tag: 'melhoria',
        text: 'Tela Assinatura do restaurante: no lugar dos cartões de planos, o valor único e tudo que está incluso. Sem botões de subir ou descer de plano.',
      },
      {
        tag: 'melhoria',
        text: 'Cobrança: quem está em teste paga R$ 400,00 quando o teste vencer. Quem pagava um plano antigo termina o período já pago e a próxima mensalidade sai com R$ 400,00 (a fatura em aberto do próximo período é refeita no Asaas). Plano de R$ 0 dado como cortesia continua como está.',
      },
      {
        tag: 'melhoria',
        text: 'Site do Comandou: a seção Preço diz que o valor é único, sem cobrança por pessoa, produto ou pedido.',
      },
    ],
  },
  {
    version: '0.127.0',
    date: '2026-11-16',
    title: 'Um tempo de teste só e cadastro pelo site redondo',
    summary:
      'O teste de quem se cadastra pelo comandou.com agora usa os mesmos dias do sistema, definidos num lugar só: Super Admin › Planos. E o caminho do site até o painel foi revisado de ponta a ponta.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Tempo de teste: saiu o campo "Dias de teste" de Super Admin › Site. Vale o "Dias de teste" do plano em Planos, para o site e para o sistema. A tela do Site mostra o tempo e leva para Planos.',
      },
      {
        tag: 'melhoria',
        text: 'Site: o texto "dias grátis" mostra os dias do plano. Plano sem dias de teste fecha o botão de criar no site.',
      },
      {
        tag: 'correção',
        text: 'Primeiros passos: os itens escritos no site chegam ao restaurante mesmo com a IA desligada, já separados por categoria, e dá para escrever os itens ali sem IA.',
      },
      {
        tag: 'correção',
        text: 'Primeiros passos: aplicar só os itens, sem logo nem endereço, não mostra mais o erro "Dados inválidos".',
      },
      {
        tag: 'novo',
        text: 'Teste criado pelo site: nos últimos 3 dias, o topo do sistema avisa quando o teste termina e mostra o contato para continuar.',
      },
    ],
  },
  {
    version: '0.126.0',
    date: '2026-11-16',
    title: 'IA e chat no topo, também no computador',
    summary:
      'O botão redondo do chat no canto de baixo saiu. A IA e o Chat agora ficam no topo, ao lado do sino, do mesmo jeito que já era no celular.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Topo: dois botões, IA (abre o assistente) e Chat (equipe, clientes do cardápio online e suporte da Comandou), com o número de mensagens não lidas.',
      },
      {
        tag: 'melhoria',
        text: 'No computador o chat abre logo abaixo do topo, sem tampar os pedidos no canto da tela.',
      },
    ],
  },
  {
    version: '0.125.0',
    date: '2026-11-16',
    title: 'Topo do site reorganizado, cartões novos e rolagem mais leve',
    summary:
      'O topo do comandou.com ficou mais enxuto, ocupando a primeira tela, com o título entrando palavra por palavra e avisos do sistema surgindo em volta do celular. Os cartões dos detalhes ganharam o mesmo formato, cada um com a sua animação, e a rolagem ficou mais suave.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Topo: selo do teste grátis, título em duas linhas que entra palavra por palavra, celular com avisos de pedido, Pix e cozinha, e um indicador de rolagem.',
      },
      {
        tag: 'melhoria',
        text: 'Feito para o balcão: todos os cartões com a mesma área de animação em cima e o texto embaixo. As animações só rodam com o cartão na tela.',
      },
      {
        tag: 'melhoria',
        text: 'Rolagem: menos espaço vazio entre as seções, a tela do sistema cresce de leve ao entrar e o celular do topo sobe junto com a página.',
      },
      {
        tag: 'correção',
        text: 'O título do topo quebrava em três linhas no notebook, e o aviso de teste grátis aparecia duas vezes.',
      },
    ],
  },
  {
    version: '0.124.0',
    date: '2026-11-16',
    title: 'Site do restaurante montado pela IA e site do Comandou mais animado',
    summary:
      'No comandou.com, quem cola o link do site, do Google Maps ou descreve o cardápio vê a IA montar a loja dele no celular da página: nome, frase, cores, categorias e itens. Só liga com a chave do OpenRouter, e o Super Admin ganhou a seção Sites com IA para controlar os tokens.',
    notes: [
      {
        tag: 'novo',
        text: 'Site com IA: o celular do topo mostra a IA montando a loja e o restaurante nasce com ela. Os primeiros passos abrem a conferência com esse site, sem gastar o limite de IA do restaurante.',
      },
      {
        tag: 'novo',
        text: 'Super Admin › Sites com IA: liga e desliga, chave própria opcional (sem ela vale a de Tokens), modelo, teto por site, limite de tokens por dia e por mês e de sites por visitante.',
      },
      {
        tag: 'novo',
        text: 'Consumo de cada site montado (tokens, custo, se virou restaurante), consumo por cliente, gráfico de 30 dias e um botão para testar a geração pelo painel.',
      },
      {
        tag: 'melhoria',
        text: 'Site do Comandou com menos texto e mais movimento: telas do sistema passando sozinhas, faixa de recursos em movimento, cada detalhe com a sua animação e barra de leitura no topo.',
      },
      {
        tag: 'melhoria',
        text: 'O gasto dos sites com IA também entra no total de Super Admin › Tokens.',
      },
    ],
  },
  {
    version: '0.123.0',
    date: '2026-11-15',
    title: 'Site do Comandou e teste grátis criado pelo próprio cliente',
    summary:
      'O endereço comandou.com ganhou o site do sistema. Quem chega cola o link do próprio site ou do Google Maps, ou descreve o que vende, e o restaurante de teste nasce em segundos, já com login. O teste vale por 3 dias.',
    notes: [
      {
        tag: 'novo',
        text: 'Site público com as telas de verdade do sistema, o preço e as perguntas mais comuns, no claro e no escuro.',
      },
      {
        tag: 'novo',
        text: 'Cadastro pelo site: o restaurante é criado na hora, a pessoa entra já logada e recebe o endereço, o login e a senha por e-mail.',
      },
      {
        tag: 'novo',
        text: 'Os primeiros passos começam sozinhos pelo site, pelo Google Maps ou pela descrição informados no cadastro. Também dá para escrever os itens à mão.',
      },
      {
        tag: 'novo',
        text: 'Super Admin › Site: liga o cadastro, define os dias de teste, o envio do e-mail (n8n) e mostra quem criou um teste.',
      },
      {
        tag: 'melhoria',
        text: 'Teste que vence sem contratação suspende o restaurante sozinho, sem apagar nada.',
      },
    ],
  },
  {
    version: '0.122.1',
    date: '2026-11-15',
    title: 'Ver na sua mesa abre a câmera direto',
    summary:
      'No celular, o item em 3D ganhou o botão "Ver na sua mesa": um toque abre a câmera e o prato aparece na sua frente, em tamanho real. Girar na tela continua em "Girar em 3D".',
    notes: [
      {
        tag: 'correção',
        text: 'O botão da câmera não aparecia no visualizador 3D, nem no iPhone nem no Android.',
      },
      {
        tag: 'melhoria',
        text: 'No iPhone a câmera abre pelo Quick Look e no Android pelo visualizador do Google, os dois já vêm no celular.',
      },
    ],
  },
  {
    version: '0.122.0',
    date: '2026-11-15',
    title: 'Restaurante de exemplo de cara nova, com pratos em 3D',
    summary:
      'A Fumaça Burger, restaurante de demonstração, ganhou logo nova, fotos profissionais em todos os itens, banners e capa, e quatro pratos com modelo 3D para ver o "Ver em 3D" e o "Ver na minha mesa" funcionando.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Logo nova da Fumaça Burger & Co., com a chama e a marca em destaque.',
      },
      {
        tag: 'melhoria',
        text: 'Fotos profissionais (Unsplash, uso comercial livre) nos 37 itens, nos banners e na capa do cardápio.',
      },
      {
        tag: 'novo',
        text: 'Modelos 3D de exemplo no Fumaça (o da casa), na batata frita, no milk-shake de chocolate e no brownie com sorvete.',
      },
      {
        tag: 'melhoria',
        text: 'A demonstração que já está no ar recebe as fotos, a logo e os modelos novos sozinha na próxima atualização, sem perder o ano de dados.',
      },
    ],
  },
  {
    version: '0.121.0',
    date: '2026-11-15',
    title: 'IA e chat no topo do celular',
    summary:
      'No celular, a IA e o chat ficam no topo, ao lado do sino, com o nome embaixo do ícone. O Chat junta as conversas da equipe, as mensagens dos clientes e o suporte da Comandou. No chat vazio aparece o ícone do restaurante.',
    notes: [
      {
        tag: 'novo',
        text: 'Celular: botões "IA" e "Chat" no topo. O Chat pergunta com quem falar (Equipe, Clientes ou Suporte Comandou) e mostra quantas mensagens não lidas tem cada um.',
      },
      {
        tag: 'melhoria',
        text: 'Chat da equipe sem conversa aberta mostra o ícone (favicon) do restaurante no lugar do panda.',
      },
    ],
  },
  {
    version: '0.120.1',
    date: '2026-11-15',
    title: 'Topo do menu lateral com a logo e o nome em destaque',
    summary:
      'Com o menu lateral aberto, o topo mostra a logo maior e o nome do restaurante em negrito, separados dos itens por um fio. Nome comprido termina em "…".',
    notes: [
      {
        tag: 'melhoria',
        text: 'Topo do menu lateral aberto: logo de 40 px, nome em negrito numa linha e fio separando dos itens.',
      },
    ],
  },
  {
    version: '0.120.0',
    date: '2026-11-15',
    title: 'Filtro de data com atalhos e nome do restaurante no menu',
    summary:
      'O filtro de data das listas abre uma grade de atalhos (Hoje, Ontem, Esta semana, Este mês, Mês passado, Últimos 3 e 12 meses, Este ano) com quantos pedidos cada um tem, e um De/Até com o botão Aplicar. No menu lateral, a logo fica ao lado do nome do restaurante.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Filtro de data em grade, com a contagem de cada período e o escolhido destacado. Vale para Pedidos e para as outras listas com filtro de data.',
      },
      {
        tag: 'melhoria',
        text: 'Menu lateral aberto mostra a logo e o nome do restaurante; nome comprido termina em "…" (o nome inteiro aparece ao parar o mouse). Recolhido, fica só a logo.',
      },
      {
        tag: 'melhoria',
        text: 'Pedidos avisa quando o período tem mais pedidos do que a lista mostra (os 500 mais recentes).',
      },
    ],
  },
  {
    version: '0.119.1',
    date: '2026-11-15',
    title: 'Tela do item no cardápio chega aos restaurantes',
    summary:
      'A versão 0.119.0 não chegou a ser publicada: um teste automático da venda completa procurava o campo "Opção 1" e passou a achar também a foto e a descrição da opção. O teste foi ajustado e a nova tela do item segue para os restaurantes.',
    notes: [
      {
        tag: 'correção',
        text: 'Teste de ponta a ponta do cadastro de grupo de complementos acha o campo certo da opção, agora que cada opção tem foto e descrição.',
      },
    ],
  },
  {
    version: '0.119.0',
    date: '2026-11-15',
    title: 'Tela do item no cardápio mais fácil de montar',
    summary:
      'Ao tocar num item do cardápio online, ele abre como uma folha: puxe para baixo para fechar. Cada grupo de adicionais tem uma faixa que fica presa no topo ao rolar, dizendo quantas opções escolher, e cada opção pode ter foto e descrição.',
    notes: [
      {
        tag: 'novo',
        text: 'Foto e descrição em cada opção dos complementos (Cardápio › Grupos de complementos). Aparecem na tela do item no cardápio online.',
      },
      {
        tag: 'melhoria',
        text: 'Faixa de cada grupo presa no topo ao rolar, com "Escolha até 4 opções", o contador do que já foi escolhido e o aviso de obrigatório.',
      },
      {
        tag: 'melhoria',
        text: 'Adicionais com botão + que vira ✓, no lugar do liga e desliga; o total do botão Adicionar muda na hora.',
      },
      {
        tag: 'melhoria',
        text: 'No celular, o nome do item fica no topo ao rolar e puxar a tela para baixo fecha o item.',
      },
    ],
  },
  {
    version: '0.118.3',
    date: '2026-11-14',
    title: 'Atualização não para mais na migração',
    summary:
      'A atualização parava em "migrate" com o código 137: o contêiner da migração usa a imagem da API, e a verificação de saúde dela, que procura a API, matava a migração depois de um minuto. Com a demonstração de um ano a migração passou desse tempo.',
    notes: [
      {
        tag: 'correção',
        text: 'A migração e a carga da demonstração contam como saudáveis até terminar; atualizar pelo painel volta a funcionar.',
      },
      { tag: 'correção', text: 'A stack nova desliga a verificação de saúde no serviço migrate.' },
    ],
  },
  {
    version: '0.118.2',
    date: '2026-11-14',
    title: 'Fumaça Burger termina de carregar',
    summary:
      'A Fumaça ficava "em cadastro" com os números zerados: a carga de um ano de dados parava no meio. A carga ficou mais leve, tenta de novo sozinha na próxima atualização e, se falhar, o motivo aparece no Super Admin.',
    notes: [
      {
        tag: 'correção',
        text: 'Carga da demonstração usa bem menos memória (o estoque antigo vira um lançamento por dia).',
      },
      {
        tag: 'correção',
        text: 'Uma assinatura deixada por uma tentativa anterior é trocada pela de um ano, com as 12 faturas pagas.',
      },
      {
        tag: 'melhoria',
        text: 'Se a carga falhar, o erro fica visível na parte de banco do restaurante no Super Admin.',
      },
    ],
  },
  {
    version: '0.118.1',
    date: '2026-11-14',
    title: 'Fumaça Burger aparece mesmo em quem atualiza pelo painel',
    summary:
      'Quem atualizava pelo botão do Super Admin continuava com a Casa Brasa: a stack antiga guardava o endereço "exemplo" e a Fumaça não era criada. Agora a Fumaça sobe em fumaca.<domínio> e a Casa Brasa e a Aurora saem.',
    notes: [
      {
        tag: 'correção',
        text: 'Endereço antigo da demonstração ("exemplo" ou "aurora") na stack não impede mais a Fumaça Burger de ser criada; a Casa Brasa de instalações antigas, sem a marca de demonstração, também é removida.',
      },
    ],
  },
  {
    version: '0.118.0',
    date: '2026-11-14',
    title: 'Nova demonstração: Fumaça Burger, com um ano de uso',
    summary:
      'A Casa Brasa e a Aurora saem e entra a Fumaça Burger & Co., uma hamburgueria na Vila Mariana que usa o Comandou há um ano: fotos reais, cerca de 18 mil pedidos, financeiro de 12 meses, avaliações, WhatsApp ligado e atendente IA.',
    notes: [
      {
        tag: 'novo',
        text: 'Fumaça Burger & Co. em fumaca.<domínio>: 35 itens com fotos reais (Open Images, CC BY 2.0), galeria de fotos e avaliações dos clientes, adicionais, ficha técnica, combos e cardápio de delivery com preço próprio.',
      },
      {
        tag: 'novo',
        text: 'Um ano de operação: pedidos de mesa, balcão, entrega e retirada crescendo mês a mês (com pico em dezembro), caixa todo dia, contas de 12 meses, estoque com notas e lotes, fidelidade, reservas, conversas da equipe e da loja online.',
      },
      {
        tag: 'novo',
        text: 'WhatsApp da demonstração pronto: avisos de pedido ligados com os textos da casa, histórico de mensagens enviadas e o atendente IA "Fumacinha" com conversas. Para enviar de verdade, basta ler o QR Code em Configurações › WhatsApp.',
      },
      {
        tag: 'novo',
        text: 'No Super Admin, a Fumaça aparece com cadastro, 12 meses de assinatura no plano Comandou (R$ 400) com as faturas pagas, conversa com o suporte e chamados resolvidos.',
      },
      {
        tag: 'melhoria',
        text: 'As demonstrações antigas (exemplo. e aurora.) são apagadas sozinhas na próxima subida. Só apaga o que foi criado como demonstração: um restaurante de verdade no mesmo endereço nunca é tocado.',
      },
    ],
  },
  {
    version: '0.117.0',
    date: '2026-11-14',
    title: 'Pixel do cardápio online: visitas, cliques e funil até o pedido',
    summary:
      'O cardápio online agora tem um pixel próprio do Comandou, como o da Meta: conta visitas, cliques em cada item, itens postos na sacola, sacola aberta, finalização e pedido feito. Os números aparecem em Relatórios › Cardápio online.',
    notes: [
      {
        tag: 'novo',
        text: 'Relatórios › Cardápio online: visitas, pessoas diferentes, cliques em itens, itens na sacola, pedidos online e conversão, comparados com o período anterior.',
      },
      {
        tag: 'novo',
        text: 'Funil do cardápio: quantos abriram o cardápio, clicaram num item, puseram na sacola, abriram a sacola, foram finalizar e fizeram o pedido. O relatório aponta o passo onde mais gente desiste.',
      },
      {
        tag: 'novo',
        text: 'Itens do cardápio: cliques, vezes na sacola, taxa de quem abriu e pôs na sacola, vendidos e favoritos de cada item. Muito clique e pouca sacola mostra o item que vale rever.',
      },
      {
        tag: 'novo',
        text: 'De onde vieram (Instagram, WhatsApp, Google, QR Code da mesa, direto) e de qual aparelho, com a conversão de cada um. Links com utm_source e utm_campaign separam as campanhas.',
      },
      {
        tag: 'novo',
        text: 'O que os clientes buscaram (e o que buscaram sem achar), horário das visitas, categorias e banners mais tocados e visitas por dia com os pedidos online.',
      },
      {
        tag: 'melhoria',
        text: 'Sem dado pessoal: o pixel usa só ids aleatórios do aparelho e guarda os eventos por 400 dias.',
      },
    ],
  },
  {
    version: '0.116.0',
    date: '2026-11-14',
    title: 'Primeiros passos pelo cardápio: link ou fotos e a loja fica pronta',
    summary:
      'No primeiro acesso, o dono manda o link do cardápio ou fotos dele e a IA monta a loja inteira: itens, preços, fotos, logo, cores, ícone, contato, endereço, ponto no mapa e horário. Ele confere numa tela só e aplica. Os dados do cadastro entram sozinhos.',
    notes: [
      {
        tag: 'novo',
        text: 'Primeiros passos começam pelo cardápio: tirar foto, escolher fotos, prints ou PDF da galeria (várias de uma vez) ou colar o link do cardápio (site, cardápio digital ou página da loja no app de delivery).',
      },
      {
        tag: 'novo',
        text: 'A IA lê os itens com preço e descrição e também o WhatsApp, o endereço, a cidade, o horário e as cores da marca. A foto de cada prato é recortada do próprio cardápio (ou baixada do link) e vira a foto do item.',
      },
      {
        tag: 'novo',
        text: 'Logo, cores e ícone: o logo vem do cardápio ou do site; sem cor clara, ela é tirada do logo. O ícone da aba e do app é gerado do logo. Dá para trocar o logo e as cores na conferência e escolher se o sistema da equipe também usa as cores.',
      },
      {
        tag: 'novo',
        text: 'Item sem foto: "Criar fotos com IA" faz uma foto ilustrativa para cada um (até 40 por vez, desconta do limite de IA).',
      },
      {
        tag: 'novo',
        text: 'Ao aplicar, a loja é achada no mapa pelo endereço (entregas por distância e QR da mesa já funcionam) e o horário pode ligar a abertura automática. A conversa depois só pergunta o que faltou.',
      },
      {
        tag: 'melhoria',
        text: 'Telefone, cidade e UF informados na contratação já entram na loja no primeiro acesso.',
      },
      {
        tag: 'segurança',
        text: 'O link do cardápio só é aberto se for um site público (nada da rede interna), com limite de tamanho e de redirecionamentos.',
      },
    ],
  },
  {
    version: '0.115.0',
    date: '2026-11-13',
    title: 'Garçom e entregador entram com PIN de 4 números',
    summary:
      'O garçom (/garcom) e o entregador (/entregas) agora entram só com um PIN de 4 números, num teclado grande. A corrida despachada chega na hora no app do entregador, e os dois apps ficaram certinhos no celular pequeno.',
    notes: [
      {
        tag: 'novo',
        text: 'PIN da equipe: em Equipe (ou em Meus garçons), cadastre o garçom ou o entregador só com o nome. O sistema sorteia um PIN (ou você escolhe) e mostra uma vez para passar à pessoa. "Novo PIN" troca e tira a pessoa dos aparelhos.',
      },
      {
        tag: 'segurança',
        text: 'O PIN é único no restaurante e só vale no app do papel (o do entregador não abre o salão). PINs fáceis (1111, 1234) são recusados. Com muitos PINs errados no restaurante, a entrada por PIN pausa alguns minutos; quem já está conectado continua.',
      },
      {
        tag: 'melhoria',
        text: 'Entregas: quem tem o papel Entregador já aparece na lista de quem leva o pedido. Ao despachar, a corrida chega na hora no app dele (antes podia levar até 15 segundos), e a lista avisa quem está "sem app".',
      },
      {
        tag: 'correção',
        text: 'Despachar pelo pedido não escolhe mais o primeiro entregador sozinho quando há mais de um.',
      },
      {
        tag: 'correção',
        text: 'Celular pequeno (iPhone SE): no app do entregador, os botões Entreguei, o código e a rota não vazam mais do cartão e o nome aparece no topo; na comanda do garçom os valores aparecem inteiros. "Você ganha R$ 0,00" não aparece mais quando o restaurante não paga por entrega.',
      },
    ],
  },
  {
    version: '0.114.0',
    date: '2026-11-13',
    title: 'Plano único de R$ 400 e orçamento em PDF',
    summary:
      'O Comandou passa a ter um plano só, com tudo do sistema por R$ 400,00 fixos por mês. No Super Admin, a nova tela Orçamento monta a proposta do cliente com a nota fiscal e os custos de terceiros e baixa em PDF. O contrato passa a dizer que a mensalidade é fixa e quanto custa a nota fiscal.',
    notes: [
      {
        tag: 'novo',
        text: 'Plano único "Comandou": R$ 400,00 por mês, sem limite de equipe, produtos ou pedidos, com nota fiscal, WhatsApp e domínio próprio. Os planos antigos saem da página de preços; quem já assinava continua no plano dele até a troca.',
      },
      {
        tag: 'novo',
        text: 'Super Admin → Orçamento: dados do cliente, mensalidade, implantação e estimativa de notas por mês, com o total calculado na hora. "Gerar PDF" salva o orçamento numerado e baixa o arquivo; a lista guarda os orçamentos para baixar de novo.',
      },
      {
        tag: 'novo',
        text: 'Valores padrão do orçamento: custo da nota fiscal (Focus NFe) repassado à parte ou incluído, notas no pacote, preço por nota a mais, implantação, validade e os custos de terceiros (certificado A1, WhatsApp, domínio, equipamentos).',
      },
      {
        tag: 'melhoria',
        text: 'Contrato: com o plano sem limites, diz que a mensalidade é fixa; com nota fiscal, diz quanto custa a Focus NFe para o cliente (mensalidade por CNPJ, notas incluídas e preço por nota a mais).',
      },
    ],
  },
  {
    version: '0.113.1',
    date: '2026-11-13',
    title: 'Menu lateral do computador mais bonito',
    summary:
      'O menu lateral no notebook ficou mais limpo: a logo na altura da barra de cima, as telas separadas em Operação e Retaguarda, a tela atual bem marcada e a conta no pé com seu nome.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Menu aberto: logo e botão de recolher alinhados com a barra de cima, telas agrupadas em "Operação" e "Retaguarda" e linhas mais compactas.',
      },
      {
        tag: 'melhoria',
        text: 'A tela atual agora aparece com fundo cinza e ícone laranja também no tema claro (antes quase sumia). Nos submenus, um traço laranja marca onde você está.',
      },
      {
        tag: 'melhoria',
        text: 'No pé do menu aparecem seu nome e seu papel; um clique abre a conta.',
      },
      {
        tag: 'correção',
        text: 'Menu recolhido em notebook de tela baixa (768px): todos os itens cabem sem precisar rolar.',
      },
    ],
  },
  {
    version: '0.113.0',
    date: '2026-11-13',
    title: 'Cardápio online: mais fotos e avaliações em cada item',
    summary:
      'No cardápio online, o item abre com uma animação mais suave, várias fotos para passar com o dedo e avaliações dos clientes com nota, comentário e coração. No celular, o topo da tela fica de uma cor só e as listas não sobram mais espaço vazio no fim.',
    notes: [
      {
        tag: 'novo',
        text: 'Mais fotos do item: no cadastro do item (aba Principal, "Mais fotos") envie até 8 fotos além da principal. No cardápio o cliente arrasta para o lado e as bolinhas mostram em qual está.',
      },
      {
        tag: 'novo',
        text: 'Avaliações por item: com a conta aberta no cardápio, o cliente dá de 1 a 5 estrelas e escreve um comentário se quiser. Aparecem a média, as barras por nota e o selo "Pediu este item" para quem já comprou. O coração em cada avaliação marca as mais úteis, que sobem na lista.',
      },
      {
        tag: 'novo',
        text: 'A nota do item aparece no cartão do cardápio e ao lado do nome. No cadastro do item, "Avaliações dos clientes" lista todas e deixa esconder as que não devem aparecer.',
      },
      {
        tag: 'melhoria',
        text: 'Abrir o item: a foto cresce do cartão com a mola do sistema, a ficha sobe por cima e o conteúdo chega em cascata curta. Fechar desce e some rápido.',
      },
      {
        tag: 'correção',
        text: 'iPhone: a área do relógio e da Dynamic Island no cardápio agora tem a mesma cor do fundo da página, sem a faixa laranja. O fundo do cardápio ficou neutro, uma cor só.',
      },
      {
        tag: 'correção',
        text: 'Pedidos, conta, sacola e item: o fim da tela não deixa mais um espaço vazio grande ao rolar até embaixo; a folga cresce só quando a pílula da sacola aparece.',
      },
      {
        tag: 'melhoria',
        text: 'Conta do cliente: saíram os atalhos de Pedidos e Favoritos, que repetiam as abas de baixo.',
      },
    ],
  },
  {
    version: '0.112.4',
    date: '2026-11-13',
    title: 'Desconto no pedido diz por que não aplica',
    summary:
      'Ao dar desconto ou acréscimo num pedido, o motivo de não aplicar aparece na hora, antes de tocar em Aplicar, junto com o novo total.',
    notes: [
      {
        tag: 'correção',
        text: 'Desconto ou acréscimo: quando o valor não pode ser aplicado (desconto maior que os itens, pedido já pago acima do novo total ou desconto acima de 10% sem ser gerente), o motivo aparece no próprio formulário e o Aplicar fica travado. Antes o aviso ficava escondido atrás do painel e parecia que não salvava.',
      },
      {
        tag: 'melhoria',
        text: 'O formulário mostra o novo total do pedido enquanto você digita o desconto ou o acréscimo.',
      },
    ],
  },
  {
    version: '0.112.3',
    date: '2026-11-13',
    title: 'Clique em qualquer lugar da linha para abrir',
    summary:
      'Nas listas de Estoque e Cardápio não é mais preciso acertar o nome: clicar em qualquer ponto da linha abre o insumo, o item ou o cadastro, e os botões da linha continuam fazendo só a ação deles.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Estoque: em Insumos, clicar na linha abre o detalhe e o histórico do insumo. Entrada, Perda, Contar e Editar continuam abrindo só a sua janela. Vale também para Recebimentos, Fichas técnicas, Lotes e Saídas.',
      },
      {
        tag: 'melhoria',
        text: 'Cardápio: Itens, Complementos, Cardápios e Famílias abrem ao clicar em qualquer ponto da linha. A linha fica destacada ao passar o mouse, e com Ctrl ou ⌘ o item abre em outra aba.',
      },
    ],
  },
  {
    version: '0.112.2',
    date: '2026-11-13',
    title: 'Editar pedido salva sozinho e funciona com o teclado do celular',
    summary:
      'Na edição do pedido não tem mais botão de salvar: cada mudança salva sozinha. Os avisos de erro agora aparecem por cima das janelas, e no celular o painel não quebra mais quando o teclado abre.',
    notes: [
      {
        tag: 'melhoria',
        text: 'Editar pedido salva sozinho: o − e o + salvam quando você para de tocar, tirar e acrescentar item salvam na hora e a observação salva ao sair do campo. Embaixo aparece "Salvando…" e depois "Salvo". Para tirar um item, toque duas vezes na lixeira.',
      },
      {
        tag: 'correção',
        text: 'Quando o sistema recusava uma alteração (ex.: desconto maior que o pedido ou pagamento acima do novo total), o aviso ficava escondido atrás do painel e parecia que nada acontecia. Agora o motivo aparece no próprio editor, e os avisos do sistema ficam por cima de qualquer janela aberta.',
      },
      {
        tag: 'correção',
        text: 'No celular, ao escrever a observação de um item, o painel do pedido ocupava só parte da tela e o resumo de valores ficava no meio. Agora o painel cabe certinho acima do teclado e o resumo sai da frente enquanto você digita.',
      },
    ],
  },
  {
    version: '0.112.1',
    date: '2026-11-13',
    title: 'Conversas do Super Admin mais confortáveis',
    summary:
      'No Super Admin, a conversa com o restaurante agora ocupa a tela toda no celular e vai até o pé da tela no computador.',
    notes: [
      {
        tag: 'correção',
        text: 'Celular: ao abrir a conversa com um restaurante, ela cobre a tela inteira, por cima do topo e do menu de baixo. Com o teclado aberto o menu não sobe mais junto: o nome do restaurante fica no alto e o campo de mensagem logo acima do teclado.',
      },
      {
        tag: 'melhoria',
        text: 'Computador: a lista e a conversa ocupam toda a altura da tela, sem sobra embaixo, e só as mensagens rolam.',
      },
    ],
  },
  {
    version: '0.112.0',
    date: '2026-11-12',
    title: 'Editar pedido e ações do pedido mais limpas',
    summary:
      'O pedido já lançado pode ser editado no próprio detalhe: acrescentar item, mudar quantidade e observação ou tirar item, com estoque e cozinha acompanhando. As ações de apoio do pedido viraram botões pequenos com ícone.',
    notes: [
      {
        tag: 'novo',
        text: 'Editar pedido: em Pedidos, abra o pedido e toque em Editar. Acrescente itens pela busca, mude a quantidade com o − e o +, escreva a observação do item ou do pedido e tire o que saiu errado. Só vale depois de salvar, e o total é refeito na hora.',
      },
      {
        tag: 'novo',
        text: 'A cozinha recebe o aviso do item acrescentado ou alterado, e o estoque baixa ou devolve a diferença. Se a cozinha já fez o item, o que for a mais entra como item novo e o pedido volta para a produção.',
      },
      {
        tag: 'melhoria',
        text: 'Imprimir pedido, Desconto ou acréscimo, Concluir a receber (fiado) e Reimprimir na cozinha agora são botões com ícone, organizados em grade embaixo do pedido.',
      },
      {
        tag: 'segurança',
        text: 'Acrescentar item fica com caixa, atendente e gerente; tirar item ou diminuir a quantidade continua exigindo o gerente, como no cancelamento de item. Toda edição fica registrada na auditoria.',
      },
    ],
  },
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
