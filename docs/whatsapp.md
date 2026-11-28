# WhatsApp por QR Code (Baileys) com muitos restaurantes

Como o serviço `whatsapp-gateway` aguenta muitos restaurantes conectados e muitos clientes
conversando ao mesmo tempo, o que já está pronto e onde fica o limite.

## Como funciona

```
cliente no WhatsApp ──► gateway (1 socket por restaurante) ──► API (2 réplicas) ──► IA
                                  ▲                                 │
                                  └──────── envio / digitando ──────┘
```

- **Um socket por restaurante**, todos no mesmo processo Node. O WhatsApp só aceita uma conexão
  por aparelho vinculado: por isso o serviço tem **uma réplica só** (duas réplicas abririam duas
  conexões do mesmo número e o WhatsApp derrubaria uma com o código 440).
- As credenciais ficam cifradas em `comandou_wadata` (uma pasta por restaurante).

### Duas coisas que a stack do gateway precisa ter

Quem monta a stack à mão (Portainer, outro nome de serviço) precisa repetir do
`infrastructure/swarm/comandou-stack.yml`:

1. **`INBOUND_URL`** apontando para a API na mesma rede, por exemplo
   `http://api:3000/api/v1/internal/whatsapp/inbound` (troque `api` pelo nome do serviço da API).
   Sem ela o gateway conecta e envia, mas **descarta toda mensagem que os clientes mandam**: a IA
   nunca responde e o Super Admin › WhatsApp não recebe nada. Desde a 0.278.2 isso aparece no log
   ao subir, uma vez por restaurante quando chega mensagem, e em vermelho nas telas WhatsApp,
   Assistente de IA e Super Admin › WhatsApp (`inboundOff` na situação da sessão).
2. **Volume com nome em `/data`** (`comandou_wadata:/data`). Sem ele cada atualização do serviço
   cria um volume vazio e todas as sessões caem: o log mostra o gateway subindo sem a linha
   "N sessões salvas reabertas" e cada restaurante precisa ler o QR Code de novo.

## Como aparece no celular

Em **Aparelhos conectados** o Comandou aparece como **Mac OS**, um computador, igual ao WhatsApp
para Mac e às integrações comuns do Baileys (`Browsers.macOS('Desktop')`, em
`apps/whatsapp-gateway/src/device.ts`). Vale para o WhatsApp de cada restaurante e para o do
Super Admin, que passam pelo mesmo gateway.

- O WhatsApp só lê esse nome **no pareamento** (quando o QR Code é lido). Quem já estava conectado
  antes da 0.278.1 segue com o nome antigo ("Ubuntu") até tocar em Desconectar e ler o QR de novo;
  a conexão em si não muda (o login de todo dia não manda o nome).
- Até a 0.278.0 era `Browsers.ubuntu('Comandou')`: o nome ia "Ubuntu" e o tipo ("Comandou", que o
  Baileys não reconhece) já caía em computador. Só o nome mudou; o jeito de conectar é o mesmo.
- O teste `gateway.test.ts` monta o mesmo pedido de pareamento do Baileys e confere "Mac OS" +
  computador. Só existe conexão por QR Code (sem código de pareamento por número).

## O que já protege a operação com muitos clientes

| Situação | O que o gateway faz |
| --- | --- |
| Muitas mensagens chegando ao mesmo tempo | Uma fila **por conversa**: mensagens do mesmo cliente vão para a API uma de cada vez e na ordem; conversas diferentes andam em paralelo (até `INBOUND_CONCURRENCY`, padrão 128 desde a 0.280). Cada restaurante usa no máximo `INBOUND_CONCURRENCY_PER_TENANT` dessas vagas (padrão 12): no jantar, o restaurante com 50 conversas e a IA demorando não deixa os outros esperando na fila. |
| Um restaurante inundado (spam, ataque) | Limite de 1000 mensagens esperando por restaurante e 20 000 no total; o excesso é descartado com aviso no log, sem afetar os outros. |
| API com 2 réplicas | A API só responde ao gateway depois de tratar a mensagem (até 45 s), então a ordem da conversa vale mesmo quando duas mensagens seguidas caem em réplicas diferentes. A mesma mensagem nunca é tratada duas vezes: a marca de "já recebida" fica no Redis e vale para todas as réplicas. |
| Rajada de envios do mesmo número | Ritmo mínimo de ~0,7 s (sorteado entre 0,56 e 0,84 s) entre mensagens do mesmo número, como gente digitando. Fila de mais de 15 s responde **429** e a API trata como "WhatsApp indisponível": a fila de avisos tenta de novo mais tarde, sem marcar como falha. |
| Queda da internet do servidor | Todas as sessões caem juntas. A religação é **sorteada** (até 5 s na detecção e metade sorteada na espera crescente), para não reconectar centenas de números no mesmo instante a partir do mesmo IP. |
| Reinício do serviço | As sessões salvas reabrem uma de cada vez, com 250 ms entre elas (300 restaurantes ≈ 75 s). |
| Conexão meio-aberta (NAT derrubou sem avisar) | Ping a cada 20 s; vigia a cada 15 s derruba e religa socket mudo há mais de 90 s; envio com a conexão parada manda um ping antes. |
| Erro de um restaurante | Exceção sem tratamento é registrada e não derruba o processo (o WhatsApp dos outros continua). |
| Religação de um restaurante | Os caches do Baileys ficam na sessão do restaurante, não no socket (`cache.ts`, 0.280): o contador de reenvio de cada mensagem (1 h, 5 mil itens) e os aparelhos de cada contato (5 min) passam para o socket novo. Antes, cada religação começava do zero: mensagem que pedia reenvio no meio ficava "aguardando" e todos os aparelhos eram consultados de novo. |
| Logo depois de ler o QR Code | O WhatsApp pede para reiniciar (515) na hora; a religação **espera a gravação das credenciais** novas antes de reabrir (sem isso, um disco lento trazia as de antes do pareamento e a tela pedia outro QR). |
| QR Code recusado (ex.: 405) | Sessão ainda não pareada tenta 3 vezes e para com "Tente de novo em alguns minutos", em vez de ficar em "Conectando..." para sempre. |
| WhatsApp recusa a versão (405) | Além da busca a cada 12 h, o gateway busca a versão atual do WhatsApp Web logo depois de um 405 (no máximo uma vez a cada 10 min). |
| Mensagem de cliente que não abriu | O Baileys pede de novo ao celular do cliente; o gateway registra no log ("chegou sem abrir") e a tela WhatsApp avisa. Comum nos primeiros minutos depois de ler o QR Code. |

## Monitorar

`GET /health` do gateway (rede interna) devolve só contagens:

```json
{
  "ok": true,
  "sessions": { "total": 120, "connected": 117, "connecting": 2, "qr": 0, "disconnected": 1, "logged_out": 0 },
  "memoryMb": 2100,
  "inbound": { "pending": 3, "inFlight": 3 }
}
```

`inbound.pending` subindo e não descendo = a API não está dando conta (ou está fora).

Por restaurante, a situação da sessão (`GET /v1/sessions/<id>`, a mesma que a tela WhatsApp mostra
e recarrega a cada 30 s quando conectada) traz `lastInboundAt` (última mensagem de cliente
repassada à API, desde que o serviço subiu) e `unreadable` (mensagens seguidas que chegaram sem
abrir). "Conectado" sem `lastInboundAt` depois de um cliente escrever = a mensagem não chegou a este
aparelho; com `lastInboundAt` e sem resposta = olhe os logs da **api** (IA).

## Capacidade e quando crescer

O limite é **memória** de um processo só. Cada socket do Baileys guarda chaves de criptografia e
caches; a estimativa (não medida em produção ainda) é de 15 a 40 MB por restaurante conectado.

| Restaurantes conectados | Memória sugerida (`WA_MEMORY_LIMIT` / `WA_HEAP_MB`) |
| --- | --- |
| até 30 | 1536M / 1280 (padrão) |
| até 80 | 3G / 2600 |
| até 150 | 6G / 5200 |

Meça com `memoryMb` do `/health` e ajuste: deixe o `WA_HEAP_MB` uns 15% abaixo do limite do
contêiner. Passando de ~150 restaurantes num servidor, o caminho é **dividir em grupos**: vários
serviços `whatsapp-gateway-N`, cada um com seu volume e uma parte dos restaurantes (por exemplo,
pelo resto do id do restaurante), e a API escolhendo o endereço do grupo certo. Isso também
espalha os números por mais de um IP, o que reduz o risco de bloqueio.

## Risco de bloqueio (não oficial)

O Baileys não é a API oficial: o WhatsApp pode bloquear números que parecem robô. O gateway já
reduz o risco (ritmo de envio, "digitando..." antes da resposta da IA, "offline" fora das
respostas, religação espalhada), mas **não manda campanhas em massa**. Para disparos para quem
nunca falou com o restaurante, o Comandou não oferece saída: a integração com a API oficial da
Meta saiu da tela na 0.222.1 e não será feita (o código antigo segue na API, sem uso).

## Atendimento por menu e pedido pelo WhatsApp (0.279)

Pedido do David: "o cliente faz toda a trajetória de compra pela IA, estilo call center, começando
por um menu com os números; ela tem que perguntar se o cliente já tem cadastro ou se deseja fazer
um; não quero que ela mande ele para o cardápio". Ligado em **Assistente de IA › Atendimento por
menu** (`ai_agent_settings.menu_mode`, padrão ligado; migração 0132).

- **Quem anda pelas telas é o servidor, sem IA** (`apps/api/src/chat/wa-flow.ts` = textos,
  formatação e leitura das respostas; `wa-flow-engine.ts` = as telas; `wa-order.service.ts` =
  banco). O estado fica em `ai_customer_chats.flow` (2 horas parado recomeça). `menu`/`oi` volta
  ao começo de qualquer tela, `sacola` mostra a sacola, `cancelar` esvazia.
- **Menu principal** (o que o dono ligou): Fazer um pedido, Acompanhar meu pedido, Ver o cardápio
  (arquivos do cardápio ou a lista em texto), Reservar uma mesa (conversa com a IA), Horários e
  endereço, Falar com uma pessoa (passa para a equipe).
- **Pedido**: cadastro (achado pelo número da conversa, DDD + 8 últimos; sem cadastro: cadastrar
  só com o nome por `CustomersService.staffCreate`, telefone já confirmado, ou pedir sem cadastro),
  entrega ou retirada, endereço (salvos ou novo "Rua, número, bairro", achado no mapa pelo
  `GeocoderService` e cobrado pela área de `ZonesService.quoteIn`; fora da área oferece retirar),
  categorias, itens, quantidade, complementos (obrigatórios sempre), observação, sacola com
  sugestão de bebida/sobremesa, pedido mínimo, pagamento (formas do dono, sempre na entrega ou
  retirada), troco e conferência. Confirmado, o pedido entra por `StoreService.placeOrder` (as
  mesmas regras do cardápio online) com `whatsapp: true` (sem Pix com comprovante nem cartão pelo
  app) e a nota "Pedido feito pelo WhatsApp".
- **Pedido escrito** ("2 smash e 1 coca sem gelo"): primeiro o leitor sem IA (`readOrderText`, casa
  cada pedaço com um item só, com folga); não entendeu e o dono deixou (`understand_text`), a IA
  devolve só códigos curtos (`ORDER_PARSE_PROMPT`, `readOrderJson`, 300 tokens de resposta).
- **Perguntas livres** (`free_chat`) vão para a IA com só as últimas 6 mensagens (cortadas em 500
  caracteres) e a frase "Mande `menu`…" no fim. Sem IA (desligada ou sem cota) o menu segue
  funcionando, sem perguntas livres, pedido escrito pela IA nem reserva.
- **Formatação do WhatsApp** em todas as mensagens: *negrito*, _itálico_, ~riscado~,
  ```monoespaçado```, `código`, listas, citação "> " e opções 1️⃣ 2️⃣ 3️⃣ (`num`). O prompt da IA
  ensina o mesmo (`WHATSAPP_FORMAT` em `ai-agent-prompt.ts`).
- **Modelo**: `platform_ai_settings.whatsapp_model` (Super Admin › Tokens de IA, só o Super Admin
  troca; padrão `google/gemini-2.5-flash-lite`), devolvido por `app_ai_config()` e usado por
  `waModel()`.
- **Ritmo**: no menu, até 25 mensagens por minuto e 200 por hora do mesmo número (sem menu, 8 e 60).
- **Cardápio online**: com o atendimento ligado e o menu fazendo pedidos, o início do cardápio
  mostra "Pedir pelo WhatsApp" (`restaurant.waOrder`, o número conectado guardado em
  `ai_agent_settings.wa_phone` quando a tela WhatsApp lê a sessão, senão o WhatsApp da loja).
- **Tela WhatsApp**: número conectado num cartão com **Reiniciar conexão** (`POST
  /messaging/session/restart` → gateway `/v1/sessions/:id/restart`: derruba o socket e reabre com
  as credenciais salvas, sem QR), Reconectar (sessão salva que caiu), Trocar número e Desconectar;
  mensagens com filtros por situação, aviso e telefone/pedido (`GET /messaging/messages?status=&event=&q=`
  e `GET /messaging/messages/summary`).
- Testes: `src/chat/wa-flow.test.ts` (telas com dependências falsas) e o bloco "pedido pelo menu
  numerado" de `test/chat.e2e.test.ts` (pedido gravado de verdade, sem chamar a IA).

### Baileys 7, avisos formatados e fora do assunto (0.281)

- **Baileys 7.0.0-rc14** (o "latest" do npm, o mesmo do Planejai; a 6.7 virou "legacy"): abre as
  mensagens de contas com LID (número escondido), que na 6.7 chegavam como CIPHERTEXT ("mensagem
  que não abriu") e faziam a sessão religar. O número real da conversa em LID vem em
  `key.remoteJidAlt` (7) ou `senderPn` (6) e vira o `from` da mensagem (`inbound.ts`). O
  `auth-store` deixa de fora as chaves que não existem (o 7 lê `null` de `lid-mapping` como
  achado), como o Planejai. A parte nova do Baileys (`whatsapp-rust-bridge`) é WebAssembly: o
  Dockerfile não muda. Sessões pareadas na 6.7 seguem valendo.
- **Avisos de pedido** (`EVENTS` em `messaging.service.ts`, migração 0134): título em negrito com
  o número, linha em branco e recado em citação; o código de entrega vai como
  "🔑 Código de entrega: *1234*" + citação. `{cliente}` é o primeiro nome. A migração troca só quem
  estava com o texto padrão antigo (ou o do restaurante de exemplo).
- **Fora do assunto** (`looksOffTopic` em `agent-guard.ts`): código, redação, tradução, conta,
  política e "você é o ChatGPT?" recebem `offTopicReply` sem chamar a IA (não conta como abuso).
  O prompt pede respostas de até 6 linhas e proíbe listar o cardápio inteiro.

### Cardápio com fotos, PIN, pontos e sacola no cardápio (0.280)

Pedido do David: "a forma que está mostrando os itens está muito feia, uma sequência muito grande
de coisas"; "quando perguntar quem é o cliente sempre pegue pelo número de telefone e confirme e,
caso não for, pegue o PIN"; "que o cliente consiga ver os pontos e as recompensas"; "quero que vá
adicionando ao pedido do cliente lá no cardápio"; "não tenha como pedir pelo WhatsApp estando na
loja".

- **Cartão da categoria**: escolhida a categoria, vai uma imagem (`wa-menu-card.ts` monta o SVG,
  `wa-media.ts` desenha com o resvg da arte de aniversário e grava em JPEG pelo `@jsquash/jpeg`,
  tudo WebAssembly) com a foto de cada item (até 12), o número para responder, nome, preço e selo,
  na cor da loja; a lista curta vai de legenda (`itemsText`: um item por linha, números `` `1` ``
  a `` `99` `` iguais, sem descrição). Escolhido o item, vai a foto dele (miniatura de 640 px →
  JPEG de até 900 px) com a legenda `itemCardText` (descrição, nota, selo, a pergunta da
  quantidade). `FlowOut.image` diz qual; `AgentReply.image` leva o JPEG e o `onWhatsApp` manda pelo
  `/document` do gateway com o texto de legenda (até 1000 caracteres; acima, foto e texto
  separados). Sem foto na categoria, fila cheia (uma imagem por vez, até 4 esperando) ou erro: vai
  só o texto. Imagens prontas ficam em memória pela "cara" do cardápio (48 cartões, 120 fotos) e
  saem na limpeza de cache do restaurante.
- **Quem é**: o cadastro do número da conversa aparece para o cliente confirmar ("Este número está
  no cadastro de Maria. É você?"). Não sendo, ou sem cadastro no número, entra pelo **PIN de 6
  números** (`loyalty_members.pin`, o mesmo do balcão): `WaOrderService.byPin` conta os erros em
  `ai_customer_chats.pin_fails`/`pin_fail_at` (migração 0133), `PIN_MAX_FAILS` = 5 por número em 24
  horas, no banco (mandar `menu` não zera). Entrou pelo PIN (`flow.viaPin`): os endereços salvos
  não aparecem, o PIN não é mostrado e o link de entrada não vai.
- **Meus pontos e recompensas** (com o programa ligado): saldo, nível e quanto falta para o
  próximo, pontos dos pedidos em andamento, validade, PIN (só para o dono do número) e cada
  recompensa com "já dá para trocar" ou quanto falta (`pointsText`, dados de
  `LoyaltyService.publicView`). Na conferência do pedido, **Usar meus pontos** lista as recompensas
  que o saldo paga e que servem na sacola (`usableRewards`; produto grátis só com ele na sacola) e
  manda `rewardId` no `placeOrder`, que confere de novo.
- **Sacola no cardápio**: depois de cada mensagem, a diferença entre a sacola do WhatsApp antes e
  depois vai para `customers.online_cart` (`mirrorLines`, chave igual à do cardápio:
  `produto:opções em ordem:observação`); só mexe no que o WhatsApp pôs, e o pedido feito tira essas
  linhas. A primeira sacola da conversa leva um link de entrada (`?entrar=`, `customer_login_links`:
  uso único, 30 minutos, hash, até 6 por hora por conta; `POST /store/account/link`), e o cardápio
  logado confere a sacola da conta a cada 15 s e ao voltar para a aba (só em loja com o pedido pelo
  WhatsApp ligado).
- **Na loja não**: com a comanda de uma mesa aberta com o telefone do cliente nas últimas 6 horas
  (`WaOrderService.atTable`), "Fazer um pedido" e o pedido escrito respondem que é pelo QR Code da
  mesa ou com o garçom; "Ver o cardápio" fica só para olhar (foto e detalhes, sem quantidade). O
  cardápio da mesa não recebe `waOrder`.

## IA que atende no WhatsApp

O gerente liga em **Assistente de IA** (menu) (`apps/web/src/pages/AiAgentPage.tsx`); o
código fica em `apps/api/src/chat/` (`ai-agent.service.ts`, `ai-agent-prompt.ts`,
`agent-guard.ts`, `agent-pdfs.ts`).

**Ações por marca.** O modelo não chama ferramentas: termina a resposta com uma marca que o
servidor lê e tira antes de enviar.

| Marca | O que o servidor faz |
| --- | --- |
| `[[ATENDENTE]]` | Passa para a equipe (aviso no chat) e a IA fica quieta 12 h nessa conversa. |
| `[[CARDAPIO]]` | Manda os arquivos do cardápio que o restaurante subiu (`ai_menu_files`: PDF até 10 MB ou fotos JPEG/PNG até 3 MB, até 10 arquivos e 20 MB), na ordem, depois do texto. Sem arquivo, o prompt nem oferece mandar cardápio. O sistema **não gera** PDF de cardápio. |
| `[[CALENDARIO_PDF]]` | Gera o PDF do calendário de reservas (dias e horários livres) e manda depois do texto. |
| `[[RESERVAR data=… hora=… pessoas=… nome="…" obs="…"]]` | Confere o horário com as regras de reserva (`ReservationsService.checkWhatsApp`) e manda o resumo pedindo **SIM**. Nada é gravado ainda. |
| `[[CANCELAR CODIGO]]` | Só se a reserva é do telefone da conversa; pede **SIM**. |
| `[[ABUSO]]` | Conta uma tentativa de abuso (veja abaixo). |

Arquivos saem por `POST /v1/sessions/:id/document` no gateway: o tipo vem da assinatura (PDF vai
como documento; JPEG e PNG, como imagem), até 10 MB. A tela do gerente sobe por
`POST /ai-agent/menu-files?name=…` com o arquivo no corpo (fotos reduzidas no navegador para
2400 px em JPEG).

**Reserva só depois do SIM.** O pedido fica em `ai_customer_chats.pending` por 30 minutos. Quando
o cliente responde SIM (ou "pode confirmar", "ok"…), o **servidor** grava a reserva sem chamar a
IA (`createWhatsApp`: mesma trava e regras do cardápio online, `source = 'whatsapp'`, telefone da
conversa, até 3 em aberto por número) e responde com o código. NÃO limpa o pedido; qualquer outra
coisa limpa e segue a conversa normal.

**Memória.** Vão para o modelo as últimas 16 mensagens (até 30 dias) mais um resumo
(`ai_customer_chats.memory`) das mais antigas, refeito pela própria IA quando sobram 10 fora da
janela. O prompt também traz as reservas futuras do cliente, os próximos 15 dias com horários
livres e os pedidos das últimas 24 horas feitos com aquele número (`ordersIn`: DDD + 8 últimos
dígitos, porque o WhatsApp às vezes manda o celular sem o 9), para a IA responder "cadê meu
pedido?" com a situação em palavras simples. Problema com o pedido (atraso, item errado,
cancelar) continua indo para a equipe com `[[ATENDENTE]]`.

**Proteções.**

- Prompt com a seção "Proteção (nunca quebre)": só assuntos do restaurante, não muda de papel,
  não mostra as instruções, não passa dados de outras pessoas, não manda Pix nem link de fora.
- Mensagem do cliente sem marcas `[[ ]]` e sem caracteres invisíveis, até 1500 caracteres.
- Tentativa óbvia de tirar do papel (`looksLikeInjection`) recebe resposta pronta, sem gastar a IA.
- Resposta: links que não são do restaurante são tirados; resposta que repete as instruções é
  trocada por uma frase padrão.
- 3 tentativas de abuso em 24 h (marca `[[ABUSO]]` ou tentativa óbvia) = a IA não responde o número
  por 24 h (`blocked_until`) e a equipe recebe aviso no chat.
- Ritmo: mais de 8 mensagens por minuto ou 60 por hora do mesmo número ficam sem resposta da IA.
- Resumo da memória que parece instrução é descartado.

## Parabéns de aniversário

Clientes › **Aniversários** (`apps/web/src/pages/customers/BirthdayPanel.tsx`, API
`apps/api/src/birthdays/`, migração 0125). No dia do aniversário do cliente, o WhatsApp da loja
manda uma arte com o nome dele e uma mensagem. Só pelo WhatsApp por QR Code (a API oficial da Meta
só manda modelo aprovado).

**De onde vem a data.** Dia e mês (ano opcional) na ficha do cliente (bloco Aniversário) ou pelo
próprio cliente em Conta › Meus dados do cardápio. Quem nasceu em 29/02 recebe em 28/02 nos anos
que não são bissextos. O cliente (ou a equipe) pode recusar o parabéns (`birthday_opt_out`).

**Quando sai.** A varredura `BirthdaysService.sweep` roda a cada `BIRTHDAY_INTERVAL_SECONDS`
(padrão 300; 0 desliga; nas cópias de versão antiga fica desligada). Para cada restaurante com o
parabéns ligado e a sessão do WhatsApp conectada, no fuso da loja, entre a hora escolhida (7h a
20h) e as 22h, cria um registro por aniversariante em `birthday_greetings` (único por cliente e
ano: nunca manda duas vezes) e põe na fila `birthday.send`, um a cada 25 s. Fica de fora quem
recusou e quem está bloqueado. Se o WhatsApp cair, a fila tenta de novo; o que não saiu até as 22h
fica como falha no histórico, com "Tentar de novo".

**Arte.** Desenhada pelo servidor (não é IA), em SVG virando PNG 1080 × 1350 pelo
`@resvg/resvg-wasm`, com as fontes em `apps/api/assets/fonts` (Inter, Pacifico e Playfair Display,
licença OFL). Quatro estilos (Festa, Bolo, Elegante e Simples) com a cor da loja e a logo (ou o
favicon) da Loja online; logo em WebP é lida pelo `@jsquash/webp`. O primeiro nome encolhe até
caber, emoji e letra que a fonte não tem saem do desenho. Prévia ao vivo em
`GET /birthdays/preview` e teste para um número em `POST /birthdays/test` (não dá presente).

**Mensagem e presente.** Texto com `{cliente}`, `{restaurante}` e `{presente}` (vai como legenda
da foto, até 1000 caracteres). Presente opcional: pontos (ou carimbos) da fidelidade, lançados
como ajuste "Presente de aniversário" na mesma transação que cria o registro, ou um presente
escrito ("Sobremesa grátis") com validade, que a equipe confere na ficha do cliente. Depois do
envio, a IA que atende no WhatsApp sabe do parabéns daquele número por 20 horas e responde ao
"obrigado!" sabendo do presente.

**LGPD.** O aniversário e os parabéns enviados entram no arquivo do cliente; apagar o cliente
apaga os parabéns junto.

## WhatsApp do Super Admin

O painel tem um número próprio (Super Admin › **WhatsApp**, `apps/web/src/platform/WhatsAppAdminPage.tsx`),
no **mesmo gateway**, numa sessão reservada: `PLATFORM_WA_ID` (`00000000-0000-4000-8000-000000000000`,
em `messaging/whatsapp-inbound.service.ts`). O gateway não muda nada: para ele é só mais uma sessão.

- **Recebidas**: `WhatsAppInboundService` manda as mensagens dessa sessão só para quem se registra em
  `onPlatformMessage` (nunca para a IA dos restaurantes, que usa `onMessage`).
- **API**: `apps/api/src/platform-whatsapp/` (`/platform/whatsapp/...`, com `PlatformHostGuard` +
  `PlatformSessionGuard`). Conversas em `platform_wa_chats` e `platform_wa_messages` (migração 0091,
  banco central, só `comandou_platform`). Mesma pessoa escrevendo por um JID `@lid` cai na conversa
  que já tem o mesmo telefone. Conectar e desconectar entram no `platform_audit_log`.
- **Nova conversa por telefone**: o gateway devolve o JID de verdade (`{ id, jid }` no envio, com
  ou sem o 9) e é ele que vira a conversa. Número sem WhatsApp devolve 422 e não cria conversa.
- **Restaurante da conversa**: achado na hora pelo telefone do cadastro (`tenant_profiles.phone`),
  comparando DDD + 8 últimos dígitos.
- Só texto por enquanto (foto, áudio e outros chegam como "Foto", "Áudio"...). Teste:
  `apps/api/test/platform-whatsapp.e2e.test.ts`.

### Menu do Super Admin pelo WhatsApp

Super Admin › WhatsApp › **Menu do admin** (`apps/web/src/platform/AdminMenuModal.tsx`) cadastra os
números (`platform_wa_operators`, migração 0115, cada um de um Super Admin) que recebem o menu.
Mensagem de texto de um desses números, depois de gravada na conversa, vai para
`PlatformWaBot.handle` (`admin-bot.service.ts`); qualquer outro número segue só na conversa, sem
resposta automática. A conversa do menu não fica como "não lida".

- **Menu**: 1 resumo do sistema, 2 escolher restaurante, 3 saúde do servidor, 4 varredura geral,
  5 backups (fazer agora, teste de restauração), 6 bancos e servidores, 7 restaurantes novos e
  testes grátis, 8 cobrança, 9 ligar/desligar os próprios avisos. Texto solto busca um restaurante
  pelo nome (um só encontrado já abre); `r` volta ao último; `menu` ou `0` ao começo; `ajuda`.
- **Restaurante escolhido**: 1 visão geral, 2 movimento de 30 dias, 3 varredura completa, 4 equipe,
  5 histórico do painel, 6 banco e backup, 7 limpar cache, 8 trocar.
- **Onde parou**: `platform_wa_bot_state` (tela, restaurante, lista numerada, ação esperando o SIM);
  30 min parado volta ao começo e esquece o SIM.
- **Ações** (backup agora, teste de restauração, limpar cache) pedem SIM e chamam os mesmos serviços
  das telas (`PlatformBackupService.request`, `PlatformCacheService.clear`) no nome do Super Admin
  dono do número, mais a linha `whatsapp.menu_action` no histórico do painel. O menu não suspende,
  não exclui e não mexe em senha: isso fica no painel.
- **Dados**: `PlatformWaChecks` (`admin-checks.service.ts`) lê pelos serviços das telas
  (`PlatformService.overview/tenant/insights/team`, `PlatformDatabasesService`,
  `PlatformDbServersService`, `PlatformVersionsService`), então os números batem com o painel.
  Textos e formatos puros em `admin-menu.ts` (teste `admin-menu.test.ts`).
- **Avisos automáticos** (`PlatformWaAlerts`, a cada `PLATFORM_WA_ALERTS_SECONDS`, padrão 120; 0
  desliga): os itens com `alert` da varredura geral (`PlatformWaChecks.issues`) e restaurante novo.
  Cada aviso é reservado em `platform_wa_alerts` pela chave antes de sair (uma vez só, em qualquer
  réplica); problema que some por 6 h é esquecido e, se voltar, avisa de novo. Com o WhatsApp do
  painel desconectado nada é reservado (sai quando voltar). Problema novo na varredura: um `add`
  com chave estável enquanto o problema dura.
- **Resumo do dia**: na hora escolhida (`platform_wa_bot_settings.summary_hour`, Brasília) ou na
  hora seguinte, uma vez por dia (`last_summary_on` travado no UPDATE).
- Envio e registro na conversa: `PlatformWaOutbox.deliver` (o mesmo da tela; mensagem do menu fica
  sem autor). Teste: `apps/api/test/platform-wa-menu.e2e.test.ts`.
