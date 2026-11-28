# Site público e teste grátis pelo site

O domínio base (`comandou.com` e `www.comandou.com`) mostra o site público: o que o sistema faz,
com o sistema de exemplo para clicar (`/experimente`), o preço (vem de Super Admin › Planos) e o cadastro em que o
dono cria o próprio restaurante de teste.

## Desenho, 3D e movimento (0.245, refeito na 0.253)

Minimalista desde a 0.245: muito espaço, linha fina no lugar de cartão, título grande e escuro com
a segunda parte em cinza e laranja só na ação principal. Na 0.253 (pedido do dono: "minimalista,
mais legal e bonito", com os efeitos do React Bits e do Uiverse) ganhou o Shuffle nos títulos, o
cardápio de verdade no celular do topo e a lanchonete de demonstração. O código fica em `apps/web/src/site/`:

| Arquivo | O que é |
| --- | --- |
| `SiteApp.tsx` | Rota do site (`/` e `/demo`, sem o roteador do app: `useSitePath` e `SiteLink` de `fx.tsx`) e as seções do topo ao rodapé. |
| `Builder.tsx` + `create/CreatePage.tsx` | O campo do topo (texto, links, fotos e PDF) e a conversa de criar em `/criar` (0.282), com o cardápio de verdade ao lado. |
| `PhoneMock.tsx` | O celular do topo: a loja de exemplo (Fumaça Burger, `SAMPLE_STORE`/`SAMPLE_ITEMS` de `site-data.ts`) ou o que a pessoa digita. |
| `Shuffle.tsx` | Shuffle do React Bits (MIT + Commons Clause, créditos no arquivo), passado do GSAP para Web Animations. |
| `DemoStore.tsx` + `demo-data.ts` + `demo.css` | A lanchonete de demonstração (`/demo`), num arquivo à parte que só baixa quando alguém abre. |
| `../sandbox/` + `../lib/sandbox.ts` | O sistema de exemplo (`/experimente`, seção abaixo): o app da equipe com um servidor de mentira no navegador. |
| `fx.tsx` | Número que rola (`RollingValue`, `RollIn`) e a navegação entre o site e a `/demo`. |
| `site.css` / `landing.css` | Menu, cartão de criar, janela de criar, celular e efeitos / as seções. |

- **Topo**: o título troca a primeira linha ("Seu restaurante", "Sua lanchonete", "Sua pizzaria"…,
  `HERO_WORDS`) com o Shuffle; o texto de verdade fica num `cm-sr-only` (leitor de tela, busca e
  o teste e2e leem "Seu restaurante no ar em minutos."). À direita o **palco 3D** (`Stage`): o
  celular com a loja de exemplo (capa, logo, categorias, dois destaques com foto grande e
  linhas), o cartão "Pedidos agora" (um pedido de um canal diferente a cada 3,4 s), as vendas do
  dia rolando como contador e o "Pix aprovado", em camadas (`translateZ`), girando de leve com o
  mouse (`useTilt`). Enquanto
  a pessoa mexe (link, Maps, itens digitados, nome), o celular vira a loja dela.
- **Seções, em ordem**: a faixa "Recebe os pedidos de" (nomes com Shuffle), **O sistema** (o
  sistema de exemplo numa moldura que se endireita com a rolagem), **Módulos** (grade de linhas
  finas; uma luz fraca segue o mouse e acende só as linhas por perto), **Aplicativos**, **três passos**,
  **preço** (o valor rola até o certo ao aparecer), **perguntas** e o fim.
- **Prato em 3D**: saiu na 0.272 junto com o 3D dos itens do cardápio (`Dish3D.tsx`,
  `depth-photo.ts` e `public/site/3d` estão no git na 0.271.1).
- **Movimento**: Lenis no computador (no toque, a rolagem do aparelho), Shuffle nos títulos (toca
  ao chegar e de novo com o mouse em cima), seções que entram ao chegar (`.st-reveal`), barra de
  leitura no topo, exemplos que se escrevem sozinhos no campo do site vazio e a pílula que desliza
  na escolha Site/Maps/Descrever. Tudo com transform e opacity; com "reduzir movimento", parado
  no estado final.

## Sistema de exemplo (`/experimente`, 0.277)

Na seção **O sistema** do site roda o Comandou de verdade (`StaffApp`, o mesmo menu, telas e
botões), com os dados da Fumaça Burger respondidos **dentro do navegador**: nada vai para a API,
nada fica salvo e recarregar zera. Pedido do dono: "deixe o cliente clicar, como se fosse dentro
do sistema, cada tela mesmo".

- **Como liga**: `main.tsx` vê `/experimente` (`isSandboxPath` de `lib/sandbox.ts`) e baixa só
  então `sandbox/boot.tsx`, que troca o `window.fetch` das chamadas `/api/` pelo servidor de
  mentira (`sandbox/server/http.ts`: `on(método, caminho, resposta)`) e desenha o app num
  `MemoryRouter` (`SandboxApp.tsx`; trocar de tela não mexe no endereço de fora). `?tela=` escolhe
  a tela inicial (`SANDBOX_SCREENS`: pdv, pedidos, mesas, cozinha, caixa, cardapio, entregas,
  estoque, financeiro, relatorios).
- **Dados**: `server/state.ts` (loja, cardápio de `site/demo-data.ts`, clientes, mesas, caixas,
  motoboys), `seed.ts` (o dia de hoje: pedidos em cada etapa, mesas abertas, caixa aberto),
  `routes-ops.ts` (pedidos, mesas, cozinha, caixa), `routes-back.ts` (cardápio, estoque com fichas,
  entregas: o motoboy anda no mapa por `delivery.location` a cada 4 s) e `routes-reports.ts`
  (histórico sorteado e repetível por dia para Relatórios, Análise, Calendário, Financeiro, DRE e
  Acerto dos motoboys; hoje sai dos pedidos de verdade do exemplo). Fotos `demo:<chave>` viram
  `/site/food/<chave>.webp` (`mediaUrl`).
- **O que o app faz diferente no exemplo** (`inSandbox()`): sem conexão do tempo real (os avisos
  vêm do servidor de mentira por `emitLocal`), sem modo offline, a marca fica só na memória
  (`brand.ts`), e o menu mostra só as telas do exemplo, sem conversas, suporte, novidades,
  tutoriais e primeiros passos (`AppShell.tsx`, `StaffApp.tsx`).
- **Chamada que o exemplo não conhece**: GET responde 404 "Disponível no teste grátis" e o resto
  403; a lista fica em `window.__cmSandbox.unknown`. **Tela nova no app**: abra
  `/experimente?tela=…`, clique por ela e registre o que aparecer ali (o e2e
  `e2e/sandbox.spec.ts` falha com chamada desconhecida, erro na página ou pedido à API).
- **Na página** (`Tour` em `SiteApp.tsx`): no computador o exemplo roda num iframe desenhado em
  1280 × 800 e encolhido para a moldura, só carrega perto da seção e precisa de um clique para
  pegar o mouse (antes disso a rolagem passa por cima); as abas mandam `{source:'comandou-site',
  go}` e o exemplo responde `{source:'comandou-sandbox', at}` para acender a aba. No celular, a
  foto da tela e "Abrir e mexer no sistema" abrem o exemplo em tela cheia (`<dialog>`).
- **Moldura**: o Nginx serve `/experimente` com `security-headers-frame-self.conf` (só o próprio
  site emoldura) e o service worker não guarda essa página (`navigateFallbackDenylist`), senão
  viria o `index.html` com `X-Frame-Options: DENY`.

## Lanchonete de demonstração (`/demo`, fora do menu desde a 0.277)

`comandou.com/demo` abre a Fumaça Burger como o cliente vê (cardápio de `demo-data.ts`, com os
mesmos nomes, preços e fotos da demonstração do sistema): destaques, categorias que acompanham a
rolagem, item com escolhas obrigatórias (o botão diz o que falta e leva até lá), observação,
sacola com entrega ou retirada e pedido mínimo, e pagamento. Ao pedir, o cliente acompanha os
passos no topo da loja e o pedido aparece na **Cozinha** ao lado (no celular, na aba Cozinha),
junto de pedidos de exemplo do iFood, da mesa e do balcão. Aceitar, pronto e despachar andam
sozinhos (alguns segundos cada) ou no toque. Tudo roda no navegador: nada vai para a API, nada é
cobrado e recarregar a página zera. O botão "Criar a minha loja" volta para o cartão de criar.

## Campo único da criação (0.279)

Pedido do David: "ao invés de colocar uma coisa de cada vez, uma barra de texto para eu enviar o
que eu quiser sobre o restaurante, seja texto, imagem, link". O cartão do topo (`Builder.tsx`) é um
campo só, como o de uma conversa: texto (cresce), links reconhecidos em pílulas, fotos e PDF pelo
clipe, colando (Ctrl+V) ou arrastando. Cada envio manda só o que é novo:

- texto e links → `POST /public/site/compose` (`SiteAiService.compose`): abre até 3 links pela
  mesma leitura do site (Maps vira pesquisa na internet; Instagram e iFood que não abrem também),
  e a IA (modelo do Site com IA) lê pelo `COMPOSE_PROMPT` (`site-ai.ts`);
- cada arquivo → `POST /public/site/compose/file?rascunho=&sessao=&nome=` (até 3 MB, tipo pela
  assinatura; modelo "ler o cardápio"): a IA diz o que é (`logo`, `menu`, `cover`, `document`).
  Logo e capa (até 600 KB) ficam no rascunho como a própria imagem (`data:`) e viram logo, ícone e
  capa nos primeiros passos (`fetchExternal` aceita `data:`).

As partes somam num rascunho `site_ai_generations.source_kind = 'compose'` (`mergeCompose`: loja
que faltava, itens novos, sugestão sai quando chega cardápio de verdade) com o CNPJ/CPF (dígitos
conferidos) e a razão social em `draft.legal`. O celular mostra a loja; o estoque sugerido vem do
`/public/site/stock` de sempre. Sem IA, o texto segue o caminho antigo (link do site/Maps ou itens
escritos). Gasto por etapa: `conversa` e `anexo` em `CREATION_STEPS`.

### Contrato na criação

A janela de criar pede **CNPJ ou CPF** (e a razão social com CNPJ), já preenchidos pela IA; vão
para `tenant_profiles` no cadastro. Quando o restaurante fica pronto, a tela chama `POST
/public/site/trials/:token/contract` (só com o token da criação, 2 horas): `SiteService.contract`
gera o contrato pelo mesmo `ContractsService.create` do painel (ator "Site", sem administrador),
guarda em `trial_signups.contract_id` (erro em `contract_error`) e devolve um link novo de
assinatura (`/assinar/<token>` do painel). A tela final mostra **Assinar contrato**; quando o
cliente assina, a contratada recebe o aviso de sempre (e-mail e Status). Sem os dados da contratada
(Contrato › Configurar), o contrato não sai e a aba Criações mostra o motivo.

### Super Admin › Criações

`platform/CreationsPage.tsx` (`GET /platform/site/creations`, `GET
/platform/site/creations/session/:session`): números do mês (começaram, viraram restaurante,
contratos assinados, gasto de IA), a lista de cada restaurante criado pelo site (o que mandou,
itens, CNPJ/CPF, contrato, custo) e das visitas que não terminaram, com o passo a passo de cada
uma (a aba Criação do restaurante, `TenantCreation.tsx`, dentro da janela).

### Sistema de exemplo em tela cheia

O botão **Expandir** da moldura (e "Abrir em tela cheia") abre o `/experimente` grande num
`<dialog>` por cima do site também no computador (antes só abria outra aba), para mexer nos dados.

## Criar em conversa (`/criar`, 0.282)

Pedido do David: "desde o inicial seja esse chat com a IA e ela vá perguntando o que é cada coisa,
para quando criar o domínio já conseguir acessar com tudo pronto"; "quero que esse modal seja uma
página mesmo"; "faça aparecer o cardápio do lado igual o meu dentro do sistema, igualzinho, e dê a
opção de modificar"; "tira essas animações do lado".

- **Página própria** `/criar` (`site/create/CreatePage.tsx`, rota no `SiteApp`): nada de janela;
  clicar fora não perde nada e sair no meio pergunta antes (`beforeunload`). "Testar grátis" e o
  campo do topo levam para lá; o que foi escrito e anexado vai junto (`create/handoff.ts`, em
  memória) e a conversa já começa lendo.
- **A conversa** é a dos Primeiros passos do sistema (mesmos balões e botões, `onboarding.css`):
  manda o que tiver → a IA lê (texto e links por `compose`, cada arquivo por `compose/file`; o
  `COMPOSE_PROMPT` pede TODAS as páginas e todos os itens do PDF) → confirma o nome → confere o
  cardápio (`create/MenuEditor.tsx`: renomear, preço, descrição, tirar e pôr itens e categorias;
  item sem preço fica marcado e só entra com preço) → logo e cores (logo trocado vira WebP pequeno
  em `data:`, cores sugeridas pelo logo) → como vende → WhatsApp → endereço → tempo de preparo →
  nome, e-mail e CNPJ/CPF → cria. Sem IA no site, os itens escritos com preço entram pelo
  `parseItems`. "Voltar" desfaz um passo com as respostas guardadas.
- **Cardápio de verdade ao lado** (`create/StorePreview.tsx`): uma moldura de celular com
  `/experimente?tela=loja&previa=1`, que roda o `StoreApp` real (`sandbox/store-preview.tsx`) com
  `GET /store`, `/store/status` e `/store/branding` respondidos no navegador a partir do que a
  página manda por `postMessage` (`lib/store-preview.ts`, `previewMenu`). Mudou algo na conversa:
  o cardápio busca de novo pelo `runSoftRefresh` (sem remontar nem voltar ao topo). No celular,
  o botão "Ver minha loja" abre a prévia em tela cheia. Pedido feito na prévia é recusado.
- **Tudo pronto ao entrar**: a criação manda `setup` (cardápio conferido, cores, logo trocado,
  WhatsApp, endereço, como vende, tempo de preparo; `SetupBody` em `site.schemas.ts`).
  `SiteAiService.saveSetup` grava no rascunho do restaurante (troca o cardápio pelo conferido e
  devolve as fotos da IA pelo nome do item; sem rascunho, cria um só com o combinado) e põe
  `draft.setup`. No primeiro acesso, os Primeiros passos veem `trial.setup` (`/menu-import/signup`)
  e aplicam sozinhos, sem perguntar (`applySetup` em `OnboardingChat.tsx`: `readSiteSetup` →
  `storeDraft` → `applyAll` → entrega/retirada e tempo), com o andamento na tela. Falhou: volta
  para a conferência de sempre.
- A página inicial não tem mais os cartões de pedidos e vendas flutuando nem o giro do celular.

O e2e `site.spec.ts` faz o caminho inteiro: escreve no campo, a conversa, a prévia de verdade
(com o preço mudando), cria e entra no restaurante, conferindo "Tudo aplicado".

## Janela de criar o restaurante (até a 0.281)

Ao continuar no cartão do topo, a janela abre em tela cheia (no computador, um painel grande): à
esquerda a loja nascendo (o endereço que vai ficar, a capa, o nome e os módulos Cardápio, PDV e
caixa, Cozinha e Delivery), à direita os dados. O endereço aparece enquanto a pessoa digita o nome,
pela mesma regra da API (`slugPreview` em `site-data.ts` = `trialSlug` da API; se o endereço já
tiver dono, a tela final mostra o certo). Os avisos ficam no próprio campo depois do primeiro
"Criar e abrir". Ao criar: a barra do navegador da prévia carrega, os módulos acendem um a um e os
passos andam com o tempo e com cada consulta; "Seu restaurante está no ar" só aparece quando a API
diz que está pronto (e depois de a loja montar, ~2,6 s no mínimo). No celular, os dados vêm
primeiro e a loja nascendo aparece quando começa a criar; o rodapé com os botões fica preso
embaixo.

## Como o cadastro funciona

1. A pessoa informa o site que já tem, o link do Google Maps ou descreve os itens. O site mostra
   uma prévia (nome, ícone e cor do site dela), sem IA.
2. Ela informa o nome do restaurante, o próprio nome e o e-mail. O restaurante nasce pelo mesmo
   caminho do painel (banco próprio, plano padrão), com os **dias de teste do plano**: um tempo só
   para o site e para o sistema, que muda em **Super Admin › Planos** (campo "Dias de teste" do
   plano padrão). Plano sem dias de teste: o botão de criar no site fica fechado.
3. Quando fica pronto (poucos segundos), a tela mostra endereço, login e senha, e o botão abre o
   restaurante **já logado** (link de uso único, 1 hora). O mesmo login vai por e-mail.
4. No primeiro acesso, os primeiros passos começam sozinhos pelo que ela informou: a loja que a
   IA montou no site, ou leem o site, o lugar do Maps ou a descrição dos itens. Com a IA ligada, o
   link do Maps vira uma **pesquisa na internet** (plugin `web` do OpenRouter): a IA confirma o
   lugar e traz telefone, endereço, horário e os links do cardápio (cardápio digital, iFood, site),
   e o melhor link é lido em seguida (`MenuImportService.fromPlace`, prompt em
   `chat/place-research.ts`). Não achou: a conversa pede o PDF, fotos ou o link do cardápio. Nos
   primeiros passos há também a opção **Achar no Google Maps**, que pesquisa pelo nome da loja e
   a cidade do cadastro (`POST /menu-import/place`, uso "menu_place" no extrato da IA).
   Os itens escritos chegam mesmo **sem IA** (lidos linha por linha: "X-Burger 28,90"; linha sem
   preço antes dos itens vira categoria). Sem IA, a pessoa também pode escrever os itens ali. O
   PDF e as fotos do cardápio entram na conferência quando a IA está ligada. Ela confere, aplica
   e segue para o painel.
5. Nos últimos 3 dias, o topo do sistema avisa quando o teste acaba. Passou do prazo sem fechar
   (a assinatura continua "em teste"), o restaurante é **suspenso**. Nada é apagado. O contrato é
   feito depois, pelo Super Admin. Para continuar: Super Admin › Restaurantes › o cliente ›
   Reativar, e mude a assinatura para ativa (ou estenda o teste antes de vencer).

Em **Super Admin › Site**: ligar/desligar o cadastro, limite por dia, se o e-mail está pronto e a
lista de testes (quem criou, de onde veio, se o e-mail saiu, se fechou). O tempo de teste aparece
ali só para conferir, com o atalho para Planos.

Proteções: 6 tentativas de cadastro por hora por IP, limite por dia (padrão 40), um teste por e-mail e um
campo escondido contra robôs.

## Domínio

O Traefik passa a atender `comandou.com` e `www.comandou.com` sozinho (a lista de endereços que a
API entrega ao Traefik inclui os dois). Só é preciso o DNS: registros **A** de `@` e `www` para
o IP do servidor (o `@` já é pedido na instalação). Se o domínio base apontar para outro
servidor, desligue com `TRAEFIK_SITE_HOSTS=false` na API.

A página de planos continua em `/precos`.

## E-mail de boas-vindas

O Comandou monta e manda o e-mail sozinho, pelo envio configurado em **Super Admin › E-mail**
(Cloudflare, Resend ou SMTP; passo a passo em [email.md](email.md)). Em Super Admin › Site,
**Enviar boas-vindas de teste** confere antes de abrir o cadastro.

O e-mail leva o endereço do restaurante, o login e a senha inicial. A senha fica cifrada no banco
só até o restaurante ficar pronto (no máximo 1 hora) e passa, ainda cifrada, para a fila de envio
na mesma transação; sai de lá assim que o e-mail é entregue. Se o provedor estiver fora, a fila
tenta de novo sozinha (1 min, 5 min, 15 min, 1 h, 3 h) e a lista de testes mostra o erro.

Sem envio configurado o cadastro funciona igual; o login aparece só na tela.

## Esqueci minha senha do cliente por e-mail

No cardápio online, o "Esqueci minha senha" manda um código de 6 dígitos (vale 15 minutos, uma
vez só) pelo WhatsApp da loja e, se a conta do cliente tiver e-mail, também por e-mail. Assim
funciona mesmo na loja sem WhatsApp conectado. Sai um código, não uma senha nova: quem digita o
celular de outra pessoa não consegue trocar a senha dela.

O e-mail sai pelo envio do Comandou (Super Admin › E-mail) com o **nome do restaurante** como
remetente e o endereço padrão do Comandou. O código vai cifrado na fila e é apagado ao sair.
**Enviar código de teste**, em Super Admin › Site, mostra o e-mail como o cliente recebe.

Sem envio configurado, o código continua só pelo WhatsApp da loja (ou a equipe gera em Clientes).

## Site com IA

Com uma chave do OpenRouter, o site monta a loja do restaurante com IA na hora em que a pessoa
cola o link do site, do Google Maps ou descreve o cardápio. O celular do topo mostra a IA
trabalhando e, em seguida, a loja dela: nome, frase de abertura, cores, categorias e itens (com
descrição). Lugar sem cardápio (só o Maps) ganha itens sugeridos, sempre sem preço.

- **Só liga com chave.** Sem chave, desligado ou com o limite esgotado, o site funciona como
  antes, sem IA, e nada aparece de diferente para o visitante.
- **Chave (0.276).** Toda a criação pelo site sai da **chave do sistema** ("OpenRouter · chave
  do sistema (esteira)", Super Admin › Credenciais): é gasto do Comandou, não do restaurante.
  Sem ela, cai na dos restaurantes, e a aba Criação do restaurante avisa. Para segurar o gasto,
  use os limites abaixo.
- **Limites** (Super Admin › Site › aba Site com IA): teto de tokens de resposta por site, tokens por dia
  e por mês somando todos os sites (0 = sem limite) e sites por visitante (IP) em 24 horas. Além
  disso, cada IP chama a geração no máximo 6 vezes em 10 minutos.
- **Consumo.** Cada site montado fica registrado com tokens, custo, de onde veio e, se a pessoa
  criou o restaurante, qual. A tela mostra o gasto do dia e do mês, quantos viraram restaurante,
  o gasto por cliente e o que a IA montou. O total também entra em Super Admin › Tokens
  (fonte "Sites com IA").
- **Rascunho vai junto.** O cadastro leva o site montado (token de uso único, válido por 3
  horas). Nos primeiros passos, a conferência já abre com a loja e o cardápio da IA, sem gastar o
  limite de IA do restaurante. Nada entra na loja sem a pessoa conferir.

### Cardápio e estoque na janela de criar (0.276)

Com o site com IA ligado, a janela de criar tem o campo **Seu cardápio (opcional)**: a pessoa
manda a foto ou o PDF (até 3 MB, uma página por vez, até 8 páginas) e a IA separa os itens com
os preços (`POST /public/site/menu`, modelo de "ler o cardápio" de Tokens). Logo depois, a IA
sugere o **estoque para começar** de cada item, com quanto avisar para repor (`POST
/public/site/stock`, modelo da conversa, o mais barato; uma vez por item; peso, rodízio e
adicional ficam "sem controle"). Sem cardápio enviado, a mesma sugestão sai para os itens do
site montado pela IA quando a janela abre.

- O cardápio enviado vira um rascunho em `site_ai_generations` (`source_kind = 'menu'`), com o
  mesmo token de 3 horas e o mesmo limite por visitante; o cadastro leva os dois (`aiSite` e
  `aiMenu`). Nos primeiros passos, os itens do cardápio enviado valem no lugar dos do site, e a
  conferência ganha a coluna **un** (estoque sugerido, editável; vazio = não controlar). Ao
  aplicar, o estoque entra pelo controle simples do item (`PUT /stock/products/:id/quantity`
  com `minQuantity`).
- **Primeiros passos pela chave do sistema.** Nos primeiros 7 dias do restaurante criado pelo
  site, o que a IA faz nos primeiros passos (ler foto, PDF, link e texto, achar no Google Maps,
  fotos dos itens) também sai da chave do sistema, até o limite "Tokens dos primeiros passos por
  restaurante" (Site com IA; padrão 400 mil, 0 = desligado). Passou disso ou dos 7 dias, volta a
  contar no limite de IA do restaurante. Leitura do site do restaurante (página da loja) segue
  no limite dele.
- **Gasto por etapa.** Cada chamada fica em `platform_ai_usage` com a etapa (`step`), o
  restaurante (`tenant_id`) ou o rascunho (`generation_id`). A visita ao site tem um id
  (`session`, guardado na aba do navegador) que junta os "Refazer" ao restaurante criado no fim.
  Super Admin › Restaurantes › restaurante › aba **Criação** (só para quem nasceu pelo site)
  mostra o gasto de cada etapa, o limite dos primeiros passos e as chamadas; a lista de testes de
  Site mostra o total.

Tabelas: `platform_site_ai_settings` e `site_ai_generations` (migração 0071); cardápio enviado,
sessão, etapa e limite dos primeiros passos na 0131.
