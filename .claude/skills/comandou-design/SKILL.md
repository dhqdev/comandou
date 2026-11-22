---
name: comandou-design
description: Padrão visual do Comandou (minimalista e clean, laranja #E23A00, sem enfeites, movimento de mola, modais que abrem perto do botão) e as exceções do site público (sempre claro, menu solto, React Bits e Uiverse). Use ao criar ou mudar qualquer tela, botão, cartão ou modal do app web, do painel Super Admin ou do site comandou.com.
---

# Design do Comandou

Visual de **sistema de trabalho**: sóbrio, limpo e confortável para turnos longos. Este guia manda sobre as outras skills de design desta pasta (`frontend-design`, `web-design-guidelines`, `emil-design-eng`, `impeccable`), que servem de referência de acabamento, não de estilo: aqui nada de ousadia, gradiente ou vidro.

## Regras

- **Tokens, sempre.** Cor, raio, sombra e fonte só por `var(--cm-*)` (`apps/web/src/design-system/tokens.css`). O lojista troca a cor da marca (`brand.ts`): nunca escreva `#e23a00` ou outro laranja numa tela.
- **Laranja padrão `#E23A00`** (botão `--cm-brand-600` `#D63400`, texto branco 4,8:1). Use só na ação principal da tela, item ativo e foco. O resto é neutro.
- **Sem enfeites:** nada de gradiente, brilho, sombra forte ou cartão colorido cheio. Separe com linha fina (`--cm-border`). Sombra só em camada flutuante (modal, menu). O vidro (`backdrop-filter`) só existe nas janelas e folhas, ligado por `liquid.ts`.
- **Cara de site feito por IA, nunca:** faixa colorida grossa no topo ou na esquerda de cartão/aviso, rótulo minúsculo em CAIXA ALTA com letra espaçada, ícone dentro de quadradinho colorido, cartão que "sobe" no hover. Estado é uma bolinha de cor ou o contador; título de seção é texto normal, cinza e semibold.
- **Botões:** um primário por tela (`Button variant="primary"`), o resto `secondary` ou `ghost`. Alturas 30/38/44. Cancelar/Fechar `ghost` ou `secondary`. O `ghost` com texto tem fundo cinza leve (nunca parece texto solto); só ícone fica sem fundo.
- **Movimento:** molas de `tokens.css` (`--cm-spring` para algo nascendo, `--cm-spring-snappy` para toque/liga-desliga/indicador, `--cm-spring-smooth` para folha), com as durações `--cm-spring*-dur`. Curvas geradas por `spring.ts` (o teste confere). Só `transform` e `opacity`; o que se toca afunda (`scale(.96–.98)`) e volta com a mola. **Rápido acima de tudo** (pedido do David): janela abre em ~0,25 s e fecha em ~0,16 s, mola quase sem pulo; nada passa de 300 ms. Janela nunca muda de lugar depois de aberta (carregou mais conteúdo: cresce, não desliza). Troca de tela inteira não anima (sem fade nem deslize): no cardápio do cliente a entrada de tela (`.screen`) voltava a rodar sozinha no iPhone e a tela do pedido piscava (0.230.1); a moldura do painel também troca na hora (`transition.ts`, `ENABLED = false`).
- **Dark mode:** azul-ardósia (slate) no jeito do MAX que o David mostrou (moldura `#1b2230`, fundo `#222a37`, cartão `#283141`, realce `#2e3849`, linha `#3e4a5e`; desde a 0.164.1). **Campos** no escuro saltam do cartão (pedido do David, 0.182.1): fundo `#323d50`, linha `#66728a`, texto branco, pelos tokens `--cm-input-bg/-line/-text` (campo grande) e `--cm-field-bg/-line` (campo compacto do formulário no computador); campo novo usa esses tokens, nunca `--cm-surface-sunken` direto e laranja suave; escreva só com tokens e ele vem junto. Nada de preto puro ou grafite neutro de volta. `DARK_SURFACE` em `brand.ts` acompanha o cartão. Se criar token novo, defina também no bloco escuro de `tokens.css` (os dois blocos) e confira `brand.ts`.
- **Acabamento fino (0.198.3, lista "10 ajustes finos" que o David mandou):** linhas `--cm-border`/`--cm-border-strong` são **transparentes** (preto 7%/12% no claro, azul-claro 20%/32% no escuro): não volte para cinza chapado e não sobreponha duas linhas com `margin: -1px` (escurece; tire a borda de um lado). `color-mix` sempre `in oklab` (nunca `in srgb`); degradê entre duas cores com `in oklch` numa segunda linha depois da versão comum (navegador antigo ignora a de baixo). **Raio concêntrico:** dentro de algo com folga pequena, raio de dentro = raio de fora − folga − linha (`calc(var(--cm-radius-md) - 3px)` no `.cm-seg`; submenu `.cm-flyout` = link 8px + 8px + 1px). Foto de produto em `.ph` (cardápio) usa `--cm-photo-bg` + `mix-blend-mode: var(--cm-photo-blend)` (multiply no claro, normal no escuro). Ainda **não** feitos (decidir antes): traço do ícone acompanhando o peso do texto, troca com desfoque, altura animada fora do menu lateral e máscara nas faixas que rolam do cardápio.
- **Tipografia:** Inter, títulos de seção pequenos e discretos, números tabulares; sem caixa alta em rótulos.
- **Menu lateral (computador):** uma barra só, com o mesmo desenho aberta e recolhida. Aberta: 252px, itens de 38px com letra de 15px e ícone de 20px, subitens de 14px; o painel encosta reto no menu e no topo (sem canto arredondado no encontro, pedido do David). Recolhida (0.178): 66px, **só os ícones, sem nome** (o ícone fica parado no mesmo lugar; recolher só estreita a barra e apaga os nomes), o painel mantém o canto de 18px. Abrir/fechar fixo anima a coluna do conteúdo (`grid-template-columns`, 360 ms, `--rail-ease`); recolhida, **encostar o mouse abre por cima do conteúdo** (`data-peek`, sombra de camada solta) e sair fecha. Grupos abrem embaixo deslizando (`.cm-rail__subwrap`, 0fr ↔ 1fr). Não troque o desenho entre aberta e recolhida (a animação depende de os itens serem os mesmos).
- **Carregamento é esqueleto** (pedido do David, 0.206): conteúdo que está chegando usa `Skeleton` (`design-system/skeleton.tsx`) no formato do que vem: `list` (padrão), `table`, `cards`, `grid` (produtos), `form`, `detail` (janela/gaveta), `board` (cozinha, chamados), `chat`, `page` e `qr`; formato próprio se monta com `Bone` (ex.: `MenuSkeleton` do cardápio). App inteiro abrindo: `AppSkeleton` (igual ao `#cm-boot` do `index.html`; mudou um, mude o outro). `Spinner` fica só para ação em andamento (entrar, salvar, enviar, buscar, abrir um link) e dentro de botão. Nunca "Carregando…" solto nem ícone girando no lugar de uma lista.
- **Celular e PWA:** um campo por linha, alvo de toque 44px, folha que sobe de baixo (padrão Planejai: alça, rodapé fixo, botão principal ocupa o espaço que sobra). Com janela ou folha aberta (`dialog` modal) a página de trás não rola: `html:has(dialog[open]:modal)` em `base.css` e `installModalScrollLock` (`design-system/modal-scroll-lock.ts`) barram o arrasto que não tem o que rolar dentro da janela (pedido do David, 0.229). Folha nova feita sem `<dialog>` precisa do mesmo cuidado.

## App do entregador (celular)

`driver/DriverShell.tsx` + `features/DriverPanel.tsx` + `features/DriverTabs.tsx`, estilos em
`features/driver-panel.css` (refeito na 0.222, pedido do David). Topo: ícone da loja (favicon,
senão o logo, senão a inicial na cor da marca; nunca o panda), "Olá, nome" + loja e só som e
chat numa pílula (`courier-page__tools`); tema e **Sair da conta** ficam na aba Perfil (Este
aparelho); o Sair só aparece no topo antes do painel abrir (`useDriverPanelMounted`). Abas
embaixo numa barra solta (`dnav__bar`, raio 22, sombra de camada) com a ativa numa pílula
`color-mix` 14% da marca atrás do ícone. Início é painel: ganho de hoje grande, colunas dos 7
dias (`last7` do `my-earnings`, hoje em laranja, resto cinza), Semana/Mês/A receber com linha
fina, entrega em andamento ou "Prontos para pegar", números `dkpis` (um quadro 2 × 2). Corrida
aceita (`run--live`): passos em três barrinhas, relógio, cliente com Ligar/WhatsApp redondos,
endereço que abre a rota, quadro `run__money` (cobrar em âmbar suave, ganho em verde), rota
principal na largura toda e Não consegui (ghost) + Entreguei. Corrida encerrada é sempre a linha
`RideRow` (bolinha, pedido, cliente, hora, valor) dentro de `dlist`; Histórico agrupa por dia
(`dday`). Perfil: avatar `--cm-brand-100`, score no anel `dring`.

## Entregas › Entregadores

`CouriersCard`/`CourierCard` em `pages/DeliveriesPage.tsx` (classes `dl-cour*` em
`deliveries.css`; 0.223, refeito na 0.227 a pedido do David): um cartão por entregador em grade
(`minmax(300px)`), avatar cheio na cor do entregador (`--rider`, letra branca), nome inteiro e
celular; linha da situação (pílula com bolinha, `data-state`: na rua laranja, disponível verde,
offline cinza, sem acesso âmbar, desativado cinza com o cartão apagado) + o que está fazendo;
quadro Hoje/Link/Acesso/Cor com linha fina (Cor = bolinhas `COURIER_COLORS`, a escolhida com anel)
e um rodapé cinza com **só três ações** iguais: Copiar link, WhatsApp e Desativar (vermelho). Não
volte com Novo link/Desligar link (pedido do David). Alterar senha (PIN) é um `link-btn` na linha
Acesso, só para quem entra com login. A situação sai de `features/courier-status.ts`
(`courierState`, testado): disponível = app ou link aberto há até 2 min (`couriers.link_seen_at`/
`app_seen_at`, migração 0109). A cor escolhida (`couriers.color`, 0110) vale em todo `colorOf`
(mapa, Ao vivo e calendário do Acerto).

## Equipe no celular

`MemberCard` em `pages/TeamPage.tsx` (classes `team-mc*` em `team.css`; 0.228.3, pedido do David,
que achou a tabela em "rótulo: valor" ruim no celular). Mesmo desenho dos cartões de Entregadores:
avatar com a inicial em `--cm-brand-100`, nome e e-mail (ou "Entra só com o PIN"), o papel numa
escolha na largura toda, uma linha "PIN criado/Senha · visto …" com Novo PIN/Nova senha em
`link-btn` à direita e o rodapé cinza com **Abrir, Link e Desativar** (vermelho). Desativado:
cartão apagado e só Reativar. No computador continua a tabela.

## Edição do item no garçom

`waiter/ItemEditor.tsx` (regras puras em `waiter/item-editor.ts`, testadas; classes `wt-ie*` em
`waiter.css`; 0.229, pedido do David com prints de outro sistema como ideia). Tocar no produto
abre a janela `Modal` (`className="wt-ie-modal"`, folha alta no celular) com o miolo próprio:
nome e preço (+ descrição) no título, **trilho de atalhos** à esquerda (`wt-ie__jump`: ícone e
nome em até 2 linhas, ativo com contorno laranja, visto verde quando feito, ponto laranja no
obrigatório que falta), seções que rolam com o cabeçalho preso (título semibold, frase cinza,
"Obrigatório" em pílula laranja suave que vira visto verde, contador 2/4) e o rodapé fixo com a
quantidade e o botão principal com o total. Jeito de cada grupo (`groupMode`): escolha única =
bolinha; adicional = + num círculo cinza que vira visto laranja; várias (sabores) = quadradinho;
retirar = "Retirar" em vermelho que vira a pílula "× Retirado" e a linha em vermelho suave.
Faltando escolha obrigatória, o botão diz qual ("Escolha ponto da carne") e leva até ela, sem
ficar cinza. Primeira escolha de um grupo obrigatório de uma opção segue sozinha para a próxima
seção. Item do pedido tocado reabre a mesma tela ("Salvar"); o + do contador do produto repete
direto só quando não há opções.

## Modais e formulários

- Janela abre **perto de quem abriu** (`liquid.ts`): no computador e no tablet sai de dentro do botão e fica ao lado dele (botão à direita, janela à direita; embaixo se couber) e volta para ele ao fechar; no celular a folha cresce do botão. Use sempre `Modal`/`Sheet`/`useLiquidDialog`: não posicione janela na mão nem com `margin: auto` fixo.
- Campos soltos no corpo do `Modal` ou dentro de `<div className="cm-form">` seguem o padrão sozinhos: **rótulo em cima do campo**; no notebook (≥901px, mouse) o modal abre **mais largo** e os campos se distribuem em até **3 colunas**. Em notebook largo (≥1100px, mouse) as janelas `lg`/`xl` abrem bem mais largas (1120/1360px) e os formulários vão a **4 colunas**: o David quer janela **deitada**, sem rolar a não ser que precise. Blocos que cabem lado a lado (ex.: PIS/COFINS e Outros no padrão fiscal, `.fi-pair`) ficam lado a lado.
- Agrupe por assunto com `<h3 className="cm-form__section">`. Campo longo (observação, endereço) ocupa a linha toda com `wrapClass="cm-form__wide"` ou `<textarea>`.
- **Campo de valor** (dinheiro): `inputMode="decimal"` e valor no formato `0,00`. Não precisa de máscara: `installDecimalEntry` (`design-system/decimal-entry.ts`, ligado no `main.tsx`) põe o cursor antes da vírgula ao entrar (digitar 3 em 0,00 dá 3,00) e a vírgula pula para os centavos. Campo que não é dinheiro nem número com vírgula não usa `inputMode="decimal"`.
- **Formulário de tela** (fora de janela, ex.: Loja online › Funcionamento): um cartão por
  assunto, campos compactos em `cm-form` e, em cartão largo, grade de 6 colunas por container
  query (`os-form6` + `os-span2/3` em `online-store.css`); liga/desliga com `os-toggle` (em
  colunas: `os-toggles--cols`), nunca caixinha solta. `.cm-field` já alinha no topo: o vizinho
  com dica longa não estica o campo. Linha de "adicionar" (`inline-add`): campo de texto até
  320px e número com `inline-add__num` (120px).
- Liga/desliga e linhas de texto + controle: `cm-form__row`. Bloco solto que deve ocupar a linha toda: `cm-form__block`.
- Use `TextField`, `SelectField`, `CheckField`; não monte `<label>` na mão.
- **Campo de data:** sempre `TextField type="date"` (ou `DateInput`); data e hora,
  `type="datetime-local"` (vira `DateTimeInput`: calendário + hora). Nunca `<input type="date">`
  solto: o teste `date-picker.test.tsx` acusa. O calendário (`design-system/date-picker.tsx`) abre
  embaixo do campo no computador (camada `popover`, mora dentro da janela aberta) e numa folha no
  celular: 6 semanas a partir do domingo, título do mês clicável (escolhe mês/ano), hoje com
  pontinho, Hoje e Limpar no rodapé. Período De/Até: passe `rangeWith` com a outra ponta.
- **Cadastro longo vira tela própria com passos**, não janela (janela fecha num clique fora e
  perde tudo). Modelo: Super Admin › Restaurantes › Novo (`NewTenantPage`, classes
  `adm-wizard*`): passos à esquerda no computador (em cima, só números, no celular), um passo
  por vez com Voltar/Continuar, último passo "Conferir e criar" com Alterar em cada linha,
  rascunho em `sessionStorage` (nunca a senha) e uma tela final dizendo o que aconteceu.
- Troca de tema: fade de cores (`switchTheme`), nunca captura de tela nem onda em tela cheia.
- **Tela que salva sozinha** (modelo: editor de cardápio, `pages/menu/MenuEditor.tsx`): sem
  botão Salvar; grava ~0,8 s depois da última mudança e na hora ao sair do campo (`onBlur`), uma
  gravação por vez (mudança no meio entra na seguinte), grava o que falta ao sair da tela e avisa
  no `beforeunload`. O retorno é o `SaveNote` (`design-system/save-note.tsx`), cartão pequeno
  embaixo no meio (acima das abas do celular): "Salvando…", "Salvo" + o que mudou em frases curtas
  (muitos itens viram contagem; `pages/menu/menu-changes.ts`), "Não salvo: corrija" com o campo e
  "Não foi salvo" com Tentar de novo. Campo inválido não grava. Cadastro novo (criar) continua
  com botão.

## Telas de entrada (AuthShell)

Única exceção no sistema: atrás do login (restaurante, garçom, cozinha, entregas e Super Admin) roda
o `LoginBackdrop` (`pages/LoginBackdrop.tsx`): `Particles` do React Bits
(`pages/reactbits/Particles.tsx`, passado do `ogl` para WebGL puro, sem dependência nova), poucos
pontinhos na cor `--cm-brand-500` da loja e em `--cm-text-subtle`, com máscara que os afasta dos
campos. O dono pediu **minimalista**: a aurora com grade e brilho (0.146) foi achada carregada e
saiu na 0.152.3. Não volte a pôr degradê, grade, brilho, cartão ou vidro; quadro parado com
"reduzir movimento"; sem WebGL, fundo liso.

## Site público (comandou.com) e páginas do site

O site (`apps/web/src/site`) vende o sistema, então tem mais movimento que as telas de trabalho. As
regras acima continuam valendo (tokens, laranja só no principal, nada passa de 300 ms) com estas
exceções, só no site:

- **Sempre claro.** Sem botão de tema: `applyTheme('light')` roda ao carregar `SiteApp.tsx` e
  `BookingPublic.tsx` (sem gravar escolha, para não mudar o app do restaurante). Página nova do
  site faz o mesmo.
- **Menu solto.** `.st-nav` é uma pílula flutuante (sticky, afastada do topo e das laterais),
  compacta e com sombra depois de rolar (`is-scrolled`); abaixo de 1080 px vira o botão de menu com
  a folha `.st-nav__sheet`. É o único lugar do site com fundo translúcido.
- **React Bits** (`site/reactbits/`, licença MIT + Commons Clause: usar dentro do Comandou pode,
  revender o componente não): `ClickSpark` (faíscas no clique, cobre a página inteira),
  `Magnet` (botão principal segue o ponteiro, via `CtaButton`), `SpotlightCard` (holofote nos cartões), `StarBorder` (luz na borda do quadro do preço)
  e `GlareHover` (brilho na tela do sistema). Copie o arquivo do repositório
  DavidHDev/react-bits (`src/ts-default/...`) com o cabeçalho de crédito; prefira os que não
  pedem gsap, motion ou three (os de rolagem que pedem, como ScrollReveal, ScrollStack e
  ScrollVelocity, foram refeitos em `site/motion.ts`). Todos já param com "reduzir movimento".
- **Rolagem** (`site/motion.ts` + `site/scroll.css`): Lenis no computador (no toque, a rolagem
  do aparelho) e um laço por quadro que escreve `--p` nos elementos; o CSS só usa transform e
  opacity e, sem a variável, cai no estado final parado. Cena nova: `useScrollProgress(modo)` e
  uma regra em `scroll.css`. Título de seção com `SectionHead` (título + uma frase opcional),
  **sem número nem rótulo em cima** (desde a 0.193: o "01 / O sistema" era o eyebrow que a
  skill `impeccable` proíbe e deixava o site com cara de modelo pronto).
- **Topo** (`site/hero.css`, refeito na 0.198.4 a pedido do David, que achou o anterior "feio e mal
  feito": tela da cozinha cortada na borda e avisos amontoados): no computador (≥1080px) duas
  colunas, à esquerda título, frase, cartão de criar e duas linhas com visto; à direita **um quadro
  só** (`.st-stage`, raio 32, tom quente bem fraco, círculos finos atrás) com o celular da loja
  cortado embaixo pelo quadro, o panda espiando atrás dele e, à direita, o cartão "Pedidos agora"
  (`LiveOrders` em `SiteApp.tsx`, `HERO_ORDERS` em `site-data.ts`: um pedido novo a cada 3,4 s,
  os de baixo andam com FLIP, só transform) e as vendas do dia. Nada passa da borda do quadro nem
  cobre o conteúdo do celular além da beira. No celular, só o celular da loja no quadro. Sem
  screenshot do sistema no topo, sem selo em pílula e sem fundo de pontinhos.
- **Fim** (0.193): um bloco só (convite, botões e o panda num painel claro com linha fina) e o
  rodapé de verdade (marca e o que é, colunas Produto e Ajuda, linha de baixo com o ano). Nada de
  frase gigante correndo nem a marca enorme no rodapé: foi o que deixou o final esquisito.
- **Aplicativos** (`#aplicativos`, refeito na 0.198.4): faixa com os nomes dos aplicativos entre
  duas linhas finas (texto grande, bolinha no tom `--cm-tint-*` de `APP_HUE`, sem logo de
  terceiros), embaixo a fila no jeito da tela de Pedidos (abas, selo do aplicativo no tom dele,
  cliente, tempo, Aceitar nos novos, situação em pílula fraca) e, ao lado, o que dá para fazer
  sem o portal com ícone solto. A lista sai de `DELIVERY_APPS`/`APP_FEATURES` (+ ícone em
  `APP_FEATURE_ICONS`, mesma ordem) em `site-data.ts`: aplicativo novo ligado, entra lá e em
  `APP_HUE`.
- **Impeccable** (`.claude/skills/impeccable`, Apache 2.0, de pbakaus/impeccable): no site vale o
  modo *Persuade* e o `reference/craft-floor.md` (contraste, espaçamento, nada de eyebrow, nada de
  cartões iguais como estrutura da página), sempre abaixo destas regras.
- **Uiverse** (licença MIT): o efeito de botão físico `.st-press` (borda de baixo mais escura,
  afunda ao apertar), a seta que corre no botão (`CtaButton arrow`), os vistos que se desenham e
  o + que vira − nas perguntas seguem o estilo dos elementos de lá, reescritos com os tokens.
- Nada disso entra nas telas de trabalho (PDV, salão, cozinha, painel): lá continua sóbrio.

## Listas (barra de filtros)

`features/list-view/ListToolbar.tsx` serve todas as listas (abas, busca, chips). O **"+ Filtro"**
abre o seletor de campo no jeito do MAX que o David mostrou (0.169): busca "Procurar o campo pelo
título", grupo **Mais usados** (borda e contador laranja) e **Demais campos**, em grade de 2–3
colunas (uma no celular, em folha), cada campo com o tipo (`fieldKind`: data/opções) e o alfinete
que fixa ou tira **da barra**. Desde a 0.170 (pedido do David: "o campo escolhido tem que ficar na
tela") a barra é dinâmica e salva por lista no navegador (`cm-lv-campos:<lista>`, estado em
`useListView`: `prefs`, `addField`, `removeField`, `pinField`): escolher no "+ Filtro" põe o campo
na barra e ele fica lá ao trocar de aba, limpar os filtros e recarregar; sai pelo alfinete ou pelo
"Tirar da barra" no rodapé da caixa do filtro. Ordem (`barKeys`): fixos da tela (`pinned`, que a
pessoa também pode tirar), os escolhidos na ordem da escolha e, no fim, campo fora da barra com
filtro vindo de uma aba; todos antes do traço e do "+ Filtro". Mais usados = os da barra e os
usados 3 vezes (menos os que a pessoa tirou). Tabela que ordena pelo cabeçalho (Pedidos) passa
`sortInHeader` e some o "Ordenar por" ao lado da busca (pedido do David: nada de maior/menor e
Data/Número ali).

## Detalhe do pedido (gaveta da direita)

Exceção pedida pelo David na 0.170: a gaveta do pedido (`OrderDetailModal.tsx`, estilos em
`app/ops.css`) tem **cores suaves** para achar tudo de relance. Tons de apoio `--cm-tint-*`
(azul, violeta, verde-água, verde, âmbar, rosa, ardósia; claro e escuro em `tokens.css`) ligados
por `data-hue` → `--hue`, sempre fracos: ícone ou texto pequeno na cor, fundo `color-mix` de 7–13%
e contorno de 24–30%; texto principal na cor normal. Topo: ícone e etiqueta do tipo do pedido no
tom do canal (`CHANNEL_HUE`). Dados: cada ícone redondo num tom (status e pagamento seguem os
selos). Item: situação pendente/em preparo/pronto com cor. Observação escrita em âmbar. Rodapé:
desconto e pago em verde, falta pagar em vermelho; Cancelar/Recusar em vermelho suave.
**Botões (0.210.2, pedido do David, no jeito da referência dele):** tudo no rodapé. As ações
de apoio e o Cancelar ficam numa barra arredondada (`od-tools`, fundo `--cm-surface-muted`) de
botões `od-tool`: ícone num círculo no tom do `data-hue` e o nome curto embaixo, em grupos
(`od-tools__group`) separados por traço vertical: Impressão (pedido, via de entrega, cozinha),
Cobrança (desconto, fiado, a receber) e Cancelar (vermelho, `danger`). A barra corre de lado se
não couber (no celular com a ponta esmaecida). O `od-bar` embaixo só tem Recusar, os passos e o
**Fechar conta** grande e verde (`od-bar__close`, 46px, seta no fim; no escuro o verde escurece).
Todo botão do rodapé tem ícone (passos em `STEP_ICON`). No notebook são duas linhas: a barra de
ícones e, embaixo, os passos e o Fechar conta numa fileira só, dividindo a largura (0.211.1). Sem
botões que decidem (pedido fechado), a barra vira `od-tools--solo`: cartões grandes com ícone ao
lado do nome, dividindo a largura. Nada de ações no topo do pedido.
Formulário de ação (fiado, desconto, cancelar, despachar, a receber, estorno) abre no lugar das
colunas do pedido (`od-takeover`: Voltar ao pedido, título e o formulário centralizado até 720px),
nunca embaixo dos itens; editar itens e cancelar item seguem dentro da lista (0.211.4).
Editar itens fica só no botão Editar ao lado de "Itens do pedido" (não repita na fileira). Fora dessa gaveta, o resto do sistema
segue neutro; não copie os tons para outras telas sem pedido.

Largura (0.192.2; reduzida na 0.201.1, pedido do David): a partir de 1100 px a gaveta ocupa ~66%
da tela (até 1040 px)
e, com o corpo em contêiner (`container: od`) de 820 px ou mais, vira duas colunas: `.od-main`
(dados, itens, formulários das ações) à esquerda e `.od-side` (pagamentos, nota, histórico já
aberto) à direita; o rodapé repete as colunas (botões embaixo do pedido, resumo embaixo do
dinheiro) e o item fica numa linha (nome | quantidade × preço e total). Abaixo disso, uma coluna.
Bloco novo do detalhe: decida se é do pedido (main) ou do dinheiro (side).
As duas colunas medem a **própria moldura** do pedido (`container: od` no corpo e no rodapé da
gaveta ou da janela que tem o pedido como filho direto). Nunca use `.side-panel:has(.order-detail)`
solto: aberto por cima do chat ou da ficha do cliente, o pedido mora dentro da gaveta de fora e
ela era alargada e medida no lugar dele (0.202.1, pedido espremido no chat). Aberto pelo chat
(`variant="modal"`) o pedido vem numa janela `lg`, com as mesmas duas colunas no notebook.

## Janela da mesa (Salão e PDV)

`features/salon/TabModal.tsx` (classes `tabm*` em `pages/salon.css`; 0.231.2, pedido do David:
"mais entendível e minimalista"). Título "Mesa X · comanda N · aberta às HH:MM" (no celular sem a
hora). Com o contêiner `tabm` ≥ 720px, duas partes: **Pedidos** à esquerda (lista com linha fina,
um pedido por bloco: número, hora e total na primeira linha, situação e pagamento com bolinha,
e um item por linha com a quantidade em cinza) e a **Conta** à direita, separada por linha fina:
"Falta receber" grande (vira "Conta paga" em verde), as linhas Consumo, Taxa de serviço (com a
porcentagem, a frase "Opcional…" e o Tirar taxa/Cobrar como `link-btn`), Total da conta e Já
pago, e **Mais opções** em blocos de linha fina com ícone solto, nome e o que faz (Pediu a conta,
em âmbar suave quando marcado; Transferir mesa, que troca o bloco pela escolha da mesa livre;
Comprovante). No celular uma coluna só: falta receber, a conta, os pedidos e Mais opções. O
rodapé tem só Adicionar pedido e Receber R$ X (ou Fechar conta): a divisão por pessoa fica na
tela de receber, nunca um segundo botão "Receber / dividir".

## Personalizar salão (editor de mesas)

`features/TableEditor.tsx` (`table-editor.css`, prefixo `te-`; refeito na 0.211.5 porque o David
achou ruim a janela "Adicionar mesas" por cima do "Personalizar salão"). **Nunca janela em cima de
janela:** a partir de 901px o corpo vira duas colunas (`.te[data-split]`): o salão à esquerda
(números num quadro só `te-stats`, grupos por área com título cinza, cartões `te-card` com a
mesa escolhida em `aria-current`) e à direita o painel `te-panel` (fixo, rola sozinho) com
**Adicionar mesas** por padrão ou a mesa tocada (X volta para Adicionar). O botão do formulário
fica no rodapé da janela, à direita; Concluir à esquerda. No celular, um de cada vez: salão com
Concluir + Adicionar mesas no rodapé; formulário com Voltar + o botão dele. Excluir é um botão
vermelho suave no fim do formulário, com confirmação no próprio painel.

## Clientes (lista e ficha)

`pages/CustomersPage.tsx` + `pages/customers/` (`customers.css`, prefixo `cl-`; pedido do David na
0.201). Topo e ficha usam o quadro de números `cl-kpis` (um quadro só, linha fina entre os números,
2 por linha no estreito). A lista tem a coluna **Mais pede** (`topItem` da API) e "há X dias" no
último pedido. A ficha abre na `SidePanel` larga (74% a partir de 1100px)
e, com o contêiner `cl` ≥ 820px, vira duas colunas: gráficos à esquerda (`cl-main`) e pedidos,
endereços, nota e observações à direita (`cl-side`, separada por linha fina). Contato um dado por
linha, com ícone solto. Gráficos em `CustomerInsights.tsx`, feitos à mão em HTML: ranking
`cl-rank` (trilho cinza, o 1º em laranja cheio), colunas `cl-cols` (cinza, a maior em laranja,
dica `cl-tip`) e fatias `cl-share` em degraus do laranja da loja e depois cinza (no máximo 5,
o resto vira Outros). Frases de leitura em `readings()` com bolinha laranja. Dados de
`insights` no `GET /customers/:id` (sem cancelados; mês, dia e hora no fuso do restaurante).

## Super Admin › Cobrança (calendário)

`platform/BillingCalendar.tsx` (classes `adm-cal*` e `adm-charge*` em `admin.css`), no jeito
do print do MAX que o David mandou, porém mais limpo: barra com mês, filtro de situação e "baixa
sozinha"; uma linha de totais com bolinhas (sem cartões de número); grade do mês num quadro só,
dia com o total curto e bolinhas, fundo `color-mix` de 9% na cor da situação (nada de faixa na
esquerda); cartões do dia ao lado (embaixo abaixo de 1100 px) e a janela "dados da cobrança" com
linhas rótulo/valor.

## Conta (restaurante)

Tocar no nome no pé do menu abre a **tela Conta** (`pages/AccountPage.tsx`, `account.css`, prefixo
`acc`), não um menuzinho (pedido do David na 0.175). Topo: cartão com avatar redondo
(`--cm-brand-100`), nome, e-mail, papel · restaurante. Embaixo, grupos com título cinza semibold
(Seu restaurante, Ajuda e novidades, Este aparelho, Segurança) e **blocos grandes** `acc-card`:
ícone solto (sem quadradinho colorido), título, frase curta, seta; linha fina, afunda ao tocar,
nada sobe no hover. Situação (ex.: assinatura) é bolinha + texto (`acc-card__status`). Duas colunas
em tela média; tela larga (`@container acc` ≥ 960 px, largura máx. 1400 px) põe cada grupo numa
linha só (grupo de 3+ ocupa a linha, os de 2 ficam lado a lado) com o bloco em pé (ícone em cima, seta
no canto) e no celular (bloco em pé, ícone em cima, frase em até 3
linhas, sem seta). Sair é o botão largo vermelho de linha fina no fim. Bloco novo: entrada em
`sections` com a mesma checagem de permissão do menu. No celular, o cartão do topo da tela Mais
(`account.to`) abre a Conta e a Mais só guarda o Sair da conta.

## Pagamento da assinatura

`pages/subscription/PayPage.tsx` (`pay.css`, prefixo `pay-`; pedido do David na 0.205, "bonita e
minimalista"): rota própria `/plano/pagar/:fatura`, nunca janela. À esquerda o resumo sem cartão
em volta (voltar, tipo · plano, valor grande tabular, descrição, bolinha do vencimento, linhas
rótulo/valor e a frase do Asaas com cadeado); à direita "Como você quer pagar" com Pix, Boleto e
Cartão em três blocos de rádio (escolhido com contorno laranja e fundo `color-mix` de 6%) e um
painel por forma, com um botão primário só. QR Code sempre em fundo branco (no escuro também);
no celular o Copia e Cola vem antes do QR e o resumo perde as linhas. Pago: visto verde em
círculo e "Voltar para a assinatura". O formulário do cartão é o `CardForm` (mesmo da janela de
forma de pagamento da Assinatura).

## Agenda pessoal (restaurante)

No menu se chama **Agenda pessoal** e fica no pé da barra, acima do nome; Novidades vai na tela
Conta (marca "novo" no bloco; o ponto laranja fica no avatar do perfil).

`pages/agenda/` (`agenda.css`, prefixo `ag-`), no jeito do Google Agenda: painel de 252 px com
Criar, o `Calendar` do Design System, as tags como filtros (quadradinho na cor da tag) e o cartão
"Lembretes no WhatsApp" com bolinha de situação; barra com Hoje, setas, título e `Segmented`
Dia/Semana/Mês/Lista. Cor do compromisso = cor da tag (dado do usuário, em `--ev`/`--tag`), sem
tag usa `--cm-brand-500`; fundo `color-mix` de 16–18% e texto misturado com a cor, **nunca faixa
na esquerda**. Hoje em círculo laranja e a linha da hora atual. Celular (≤860 px): mês com
bolinhas e a lista do dia tocado embaixo; semana com títulos que quebram; tags, busca e
lembretes num `Modal` aberto pelo título ou pelo botão de tags.

**Fiado**: na Nova venda é a quinta opção de `nsale__types` (ícone `HandCoins`, só para quem
pode dar fiado; a grade se ajusta a 4 ou 5 colunas) e abre os campos em `nsale__fiado`. No pedido
já lançado, `FiadoForm` (`inline-form`) e a nota `od-note[data-tone='warning']`. Não há faixa de
fiado no PDV (o dono pediu para tirar). Tag Fiado laranja `#E8710A`.

## Reservas

`pages/ReservationsPage.tsx` (`reservations.css`, prefixo `rv-`), no jeito da Agenda pessoal, mas
o painel do lado tem **só Nova reserva e o minicalendário** (pedido do David na 0.175). Situação =
tags-pílula acima da agenda (`rv-tag`: bolinha na cor da situação, contador, escolhida com fundo
`color-mix` de 12% da cor); Reservas pelo cardápio é um botão `rv-store` na barra. Cartão que mudou
por tempo real ganha o contorno `is-fresh` (pseudo-elemento, só opacity). Não volte a pôr resumo,
filtros ou atalhos no painel do lado.

## Super Admin › E-mail

`apps/web/src/platform/mail/` (`mail.css` só com tokens): três abas, **Resend** (formulário
`cm-form` com a chave, o remetente e o e-mail de teste), **Modelos** (`Templates.tsx`: lista
`mail-tpl__list` à esquerda e a prévia num `iframe` com Computador/Celular; no celular a lista
vira fileira rolável) e **Envios** (tabela `cm-table` com reenviar e cancelar).

## Esqueci minha senha (telas de entrada)

`pages/ForgotPassword.tsx` dentro do `AuthShell`: três tracinhos de passo (`forgot__steps`),
título visível curto (`forgot__head`), o código em 6 caixas (`otp`, colar e o preenchimento do
celular espalham os números; erro treme e fica vermelho) e a força da senha (`forgot__meter`).
O link "Esqueci minha senha" fica à direita, logo abaixo do campo da senha (`ForgotLink`).

## E-mails

Não seguem os tokens do app (e-mail não lê CSS variável): cores fixas em `mail/templates/kit.ts`
(`C`), fundo `#F5F4F2`, cartão branco com linha fina e raio 14, cabeçalho com a marca e o assunto
(`topic`) separado por linha, título e texto à esquerda, um botão laranja por e-mail, dados como
comanda (`rows`, tracejado), avisos com bolinha de cor (sem emoji). Topo: a capa escura
`email/hero-<pose>.jpg` (0.199, pedido do David: "imagem top com o Comandou"), não o panda
grande sobre fundo rosado de antes. Código de senha antes do texto, com o botão Copiar código
(`/codigo#…`). Modo escuro pelas
classes `em-*`, no azul-ardósia do app. Nada de imagem com
texto (cai no spam e some com imagens bloqueadas).

## Financeiro

`apps/web/src/pages/finance/` (`finance.css` só com tokens, prefixo `fin-`). Números do topo em
`KpiStrip` (`fin-kpi-strip`: um quadro só com os números separados por linha fina, variação
`Delta` e tendência `Sparkline` embaixo; 2 por linha abaixo de 900 px), nunca um cartão por número.
**Gráficos** (`charts.tsx`, desde a 0.159): SVG/HTML feitos à mão, sem biblioteca. Laranja
(`--cm-brand-500`) para o que entrou e para o destaque; cinza
(`color-mix` de `--cm-text-muted` com a superfície) para o que saiu; tracejado para previsão e mês
anterior; um eixo só (rótulos na calha da esquerda, com contorno da cor do fundo); dica
`fin-tip` ao passar o dedo/mouse; barras deitadas `HBars` com trilho cinza e só a maior/melhor em
laranja cheio. Comparação com mês correndo é sempre com os mesmos dias do mês anterior. A Visão
geral é a primeira aba: números, gráfico + Leituras do mês (`fin-insights`, bolinha de situação,
toque abre a aba do assunto; numa coluna, as leituras vêm antes do gráfico) e uma grade de dois. Fechamentos: lista
`fin-days` que abre o dia (cabeçalho em grade; no celular só data, situação e vendas).
Conciliação: extrato e "a receber" lado a lado (`fin-bank`, uma coluna abaixo de 900 px), linha
do extrato `fin-line` com a sugestão e Confirmar/Conciliar, escolha de recebíveis `fin-pick`.
Aplicativos (`AppsTab.tsx`, classes `fin-apps*`): `KpiStrip` do mês, cartão Repasses (linha da
loja com `fin-dot`, tabela `cm-table` com a situação em `Badge`) e pedidos por aplicativo.
DRE: indicadores `fin-ind` com bolinha de situação (`fin-dot`) e a tabela `fin-dre` (item
recuado, total/resultado em negrito; no celular vira lista compacta com % e mês anterior
embaixo do nome, sem as colunas). Corpo de janela sem campos soltos: envolva em `fin-modal`
(grade com espaço). Valor com sinal: `SignedBrl` (sobra verde, falta vermelha, "−" de verdade).

## Chamados (restaurante)

Chamado aberto **não é chat** desde a 0.158.1 (`features/tickets/ticket-chat.css`, prefixos
`tkv`/`tkh`; pedido do David: a conversa fica só no chat). Cartões `tkv__card` com linha fina:
situação no topo (`tkv__now`: bolinha na cor do estado, nome grande, frase curta, "Etapa N de 6" e
as barrinhas horizontais `tk-hsteps`), **O que você contou** (texto em `pre-wrap` e anexos em
miniaturas de 150 px) e **Histórico** em linha do tempo `tkh` (mais novo em cima, ícone em círculo
cinza, resposta da equipe num bloco cinza, "Ver o histórico todo" depois de 5). Coluna de 320 px
com o cartão **Falar no chat** (`tkv__talk`, botão primário largo, abre o Suporte com o chamado
anexado) e os detalhes `tk-facts`. Até 900 px vira uma coluna (`display: contents` + `order`):
situação, Falar no chat, o que contou, histórico, detalhes; até 600 px as etapas ficam só nas
barrinhas. O painel Super Admin segue com o `EventLine` de `TicketParts.tsx` na aba Notas.

## Super Admin › Credenciais

`platform/credentials/` (`credentials.css`, prefixo `adm-cred`): resumo em `Tile`s, **Como
funciona** (texto corrido num quadro), **Para subir o sistema, na ordem** (`adm-cred__order`:
número, bolinha da situação, texto e atalhos `adm-cred__jump` para os cartões), depois um grupo por
lugar (painel, instalador, servidor, GitHub) com cartões de linha fina: bolinha, título, frase de
para que serve, `Tag` (configurada/falta/opcional/confira fora daqui/cole de novo) e "Em uso:
produção · termina em 4f2a". O `<details>` (aberto quando falta) tem Como conseguir, **O que vai em
cada campo** (`fields`, `dl.adm-cred__fields`) e **Como saber que deu certo** (`check`); se a
chave é do painel, o formulário vem embaixo de uma linha fina (`Testar` secondary, `Salvar`
primário pequeno). Nas outras telas, só a linha `KeyInUse` (`.adm-keyuse` em `admin.css`): bolinha,
"Chave em uso:", o nome (link para o cartão), ambiente/conta e o final da chave; nada de
explicação nem campo.

## Super Admin › Aplicativos de delivery

`platform/ChannelsPage.tsx` (`channels-admin.css`, prefixo `adm-chs`): por aplicativo, a linha de
situação (bolinha, "dentro das regras/perto do limite/fora das regras", chave e lojas) com o
`Segmented` 24 horas/7 dias/30 dias ao lado (embaixo, largura toda, no celular); os números em
`adm-grid` + `Tile` com a regra na linha de apoio (quebra em vez de cortar); a tabela de chamadas
(`cm-table`, nome em português e o rótulo técnico embaixo, bolinha no erro, resultados em `Tag`); e o
roteiro de homologação numa lista numerada (`adm-chs__step`: número em círculo, visto verde quando
feito, abre o como fazer e a observação; o próximo passo já vem aberto).

No restaurante (Aplicativos de delivery, `pages/IntegrationsPage.tsx`, `integrations.css`, refeita
na 0.198.5 porque o David achou feia): números do topo num quadro só (`intg-overview`: recebendo,
lojas, pausadas, falhas), grupo **Ligados** com um cartão largo por aplicativo com loja (`intg-ch`:
cabeçalho `ChannelHead` = logo oficial `AppLogo` + nome + situação com bolinha embaixo, cada loja em `intg-store` com situação,
último pedido, pausa e, ao lado a partir de 760px de cartão, os ajustes em interruptores
`intg-toggle` + `.switch` num quadro afundado), grupo **Ligar mais um aplicativo** (`intg-new`,
enxuto desde a 0.231.3: `ChannelHead`, uma frase curta e o botão só quando há o que fazer, "O que
funciona" no pé com linha fina; sem liberação não tem frase, e "Para liberar um aplicativo, fale
com o suporte do Comandou." aparece uma vez, à direita do título do grupo) e **Em breve** numa linha
com `AppLogo` de 20px + nome. **Logos dos aplicativos**: `features/channels/AppLogo.tsx`, arquivos
oficiais em `features/channels/logos/` (SVG/PNG no formato do ícone do app, quadrado com cantos
`0.26 × tamanho`, fundo da marca, igual no claro e no escuro); aplicativo sem logo (Open Delivery
cadastrado) mostra a inicial na cor dele. Aplicativo novo: logo oficial na pasta + linha em `LOGOS`.
Nas listas (pedidos, falhas, vínculos) segue o selo `ChannelBadge`. "O que funciona" é um
`<details>` com contador, pílulas com visto e uma frase com o que o aplicativo não oferece. A
situação nunca fala de Super Admin para o restaurante ("Ainda não liberado"). O aplicativo em que a
própria loja liga o cadastro (Keeta, 99Food, Open Delivery: `CONNECT_HERE` em
`features/channels/ConnectStore.tsx`) tem "Ligar uma loja" secondary que abre, dentro do cartão, o
formulário `intg-connect` (frase de onde achar o código, código e nome um por linha, Cancelar e
Ligar loja embaixo à direita); o erro do aplicativo aparece em português no próprio formulário.
Nome de aplicativo no meio de uma frase vai com `withArticle` (shared): "da Keeta", "na 99Food",
"do iFood"; nunca escreva "do {label}" na mão.

## Super Admin › Conversas

`platform/SupportPage.tsx` (estilos em `admin.css`, prefixos `sinbox`/`sdesk`): lista de 320 px, a
conversa e, a partir de 1280 px, a coluna do restaurante (`sdesk`: monograma, endereço, Entrar no
sistema, Ver cadastro e os detalhes). A conversa usa o `ChatPane` com `bubbles` (classes
`scx--bubbles`/`scx-thread--bubbles` em `store-chat.css`): mesmo desenho dos Chamados, as suas à
direita em `--cm-brand-50`, hora dentro do balão, dia e aviso em pílula, caixa de escrever em
pílula com botão redondo. Sem `bubbles`, o `ChatPane` segue em linha (cardápio, chat da equipe).
Chamado citado numa mensagem é o cartão `scx-ticket` (ícone de boia, número, bolinha da situação,
título). Número de avisos num item do menu: `count` no `FrameItem` (pílula `cm-rail__count` na
frente do nome no menu aberto, `cm-rail__badge` no ícone no recolhido e nas abas); a bolinha `dot`
fica para "tem novidade" sem número.

No celular (até 760 px) a caixa é uma coluna só: lista (busca, abas e conversas) na largura toda e,
ao tocar, a conversa por cima da tela. A grade de duas colunas do painel (`.adm-support .sinbox`)
fica dentro de `@media (min-width: 761px)`; regra de painel mais específica que a do
`support-inbox.css` sem esse `@media` deixava uma coluna vazia à direita no celular.

## Super Admin › menu e histórico

O `NAV` de `PlatformApp.tsx` tem `section` (Clientes, Vendas, Financeiro, Sistema): no computador
vira título no menu lateral e, no celular, cada seção é um bloco na tela Mais (`menuBySection` no
`AppFrame`). Não existe tela de Auditoria: o que é de um restaurante aparece na aba **Histórico**
dele (`TenantHistory` de `platform/audit.tsx`, com filtro por assunto e frase legível por ação em
`describe`) e o resto (entradas, ajustes) em Conta › **Registro do painel** (`PanelLogModal`).
Ação nova no `platformAudit`: dê nome e grupo em `ACTIONS` e, se tiver detalhe, um caso em
`describe`; nunca mostre id, hash ou token cru na tela. Telas com abas no mesmo endereço base
(Infraestrutura, Site) usam `Tabs` com a rota mudando junto (`/site` e `/site/ia`).

O chat do sistema (`TeamChat`) fecha no Esc e num clique fora; os botões do topo abrem e fecham
(`openTeamChat(tab, { toggle: true })`). Camada por cima dele (foto ampliada, janela, menu) não
fecha o chat.

## Antes de entregar

Veja a tela em claro e escuro (o site, só claro), no notebook e em 390px, com os prints do
Playwright ou no navegador do Claude Code apontando para o Vite local (passo a passo na skill
`comandou-projeto`).

## Telas sem título visível (0.226.1)

As telas do app do restaurante não mostram o nome da tela nem frase de explicação no topo (o
nome já está no menu): o conteúdo começa logo abaixo da barra. Toda tela mantém um
`<h1 className="page-title cm-sr-only">Nome</h1>` (leitor de tela e testes e2e usam), o botão
Tutorial vai à direita, junto das ações (`.page-head > .tour-btn` ganha `margin-left: auto`; sem
linha de ações, entra nas ações do primeiro cartão, como na Impressão). Abas da tela sobem para a
mesma linha das ações (Salão, Loja online, Cardápio); no celular descem para baixo delas. Explicação curta de aba vira `title` da aba. Exceções que mantêm título:
Estoque e Fiscal (subtelas com trilha e voltar), Ajustes, Assinatura e Novidades. A lista de
Pedidos estica o cartão até o pé da janela (`.cm-frame__content:has(> .ord-board)`).
**Cozinha (0.231.1):** as abas por tipo de pedido (`.kds-tabs`) moram dentro da barra `.kds-bar`,
entre o nome e os contadores, tudo numa linha. A decisão é pela largura da própria tela da cozinha
(`container: kds` no `.kds-root`, com ou sem o menu do lado): até 1399px as abas descem para a
segunda linha; até 759px os contadores também descem e as abas ficam na terceira.

## Teclado do celular nas conversas (0.228.2)

Com o teclado aberto (`html.cm-kb-open`, de `design-system/viewport.ts`) nenhum menu de baixo
aparece: abas do chat (`.tc-tabs`, em `chat.css`), `.cm-tabbar`, `.wt-tabs`, `.dnav` e `.mnav`
(`base.css`). Menu de baixo novo entra nessa lista. Conversa nova presa à tela no celular entra em
`CHAT` de `viewport.ts`: ao tocar no campo, ela já encolhe para o tamanho previsto do teclado (o
último medido no aparelho, guardado em `cm-kb-h`), e o iPhone não empurra a tela para cima.

## Rolagem elástica no celular (0.228.5)

No navegador do celular, toda tela passa um pouco das pontas e volta, com o elástico do próprio
navegador (sem script, pedido do dono: "deixe o site leve"). Regras em `design-system/base.css`
(página, `overscroll-behavior-y: contain`, só toque e fora do app instalado) e no fim de
`app-frame.css` (o painel da moldura estica; a página fica parada pela classe `cm-framed` que o
`AppFrame` põe no `<html>`, senão o topo e as abas iriam junto). No app instalado e em tela cheia
quem faz o elástico e o puxar para atualizar é o `pull-refresh.ts` (o nativo brigaria com a
bolinha do topo). Caixa nova que rola por dentro: `overscroll-behavior: contain` (estica e não
leva a página), nunca `none`, a não ser que a tela precise ficar parada (conversa aberta).
Tela que trava a página: regra com `html.<classe>` já ganha da de base.css (ela vai em `:where`).
