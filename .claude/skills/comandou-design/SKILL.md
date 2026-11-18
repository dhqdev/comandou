---
name: comandou-design
description: Padrão visual do Comandou (minimalista e clean, laranja #E23A00, sem enfeites, movimento de mola, modais que abrem perto do botão) e as exceções do site público (sempre claro, menu solto, React Bits e Uiverse). Use ao criar ou mudar qualquer tela, botão, cartão ou modal do app web, do painel Super Admin ou do site comandou.com.
---

# Design do Comandou

Visual de **sistema de trabalho**: sóbrio, limpo e confortável para turnos longos. Este guia manda sobre as outras skills de design desta pasta (`frontend-design`, `web-design-guidelines`, `emil-design-eng`), que servem de referência de acabamento, não de estilo: aqui nada de ousadia, gradiente ou vidro.

## Regras

- **Tokens, sempre.** Cor, raio, sombra e fonte só por `var(--cm-*)` (`apps/web/src/design-system/tokens.css`). O lojista troca a cor da marca (`brand.ts`): nunca escreva `#e23a00` ou outro laranja numa tela.
- **Laranja padrão `#E23A00`** (botão `--cm-brand-600` `#D63400`, texto branco 4,8:1). Use só na ação principal da tela, item ativo e foco. O resto é neutro.
- **Sem enfeites:** nada de gradiente, brilho, sombra forte ou cartão colorido cheio. Separe com linha fina (`--cm-border`). Sombra só em camada flutuante (modal, menu). O vidro (`backdrop-filter`) só existe nas janelas e folhas, ligado por `liquid.ts`.
- **Cara de site feito por IA, nunca:** faixa colorida grossa no topo ou na esquerda de cartão/aviso, rótulo minúsculo em CAIXA ALTA com letra espaçada, ícone dentro de quadradinho colorido, cartão que "sobe" no hover. Estado é uma bolinha de cor ou o contador; título de seção é texto normal, cinza e semibold.
- **Botões:** um primário por tela (`Button variant="primary"`), o resto `secondary` ou `ghost`. Alturas 30/38/44. Cancelar/Fechar `ghost` ou `secondary`. O `ghost` com texto tem fundo cinza leve (nunca parece texto solto); só ícone fica sem fundo.
- **Movimento:** molas de `tokens.css` (`--cm-spring` para algo nascendo, `--cm-spring-snappy` para toque/liga-desliga/indicador, `--cm-spring-smooth` para folha), com as durações `--cm-spring*-dur`. Curvas geradas por `spring.ts` (o teste confere). Só `transform` e `opacity`; o que se toca afunda (`scale(.96–.98)`) e volta com a mola. **Rápido acima de tudo** (pedido do David): janela abre em ~0,25 s e fecha em ~0,16 s, mola quase sem pulo; nada passa de 300 ms. Janela nunca muda de lugar depois de aberta (carregou mais conteúdo: cresce, não desliza).
- **Dark mode:** azul-ardósia (slate) no jeito do MAX que o David mostrou (moldura `#1b2230`, fundo `#222a37`, cartão `#283141`, campo/realce `#2e3849`, linha `#354052`; desde a 0.164.1) e laranja suave; escreva só com tokens e ele vem junto. Nada de preto puro ou grafite neutro de volta. `DARK_SURFACE` em `brand.ts` acompanha o cartão. Se criar token novo, defina também no bloco escuro de `tokens.css` (os dois blocos) e confira `brand.ts`.
- **Tipografia:** Inter, títulos de seção pequenos e discretos, números tabulares; sem caixa alta em rótulos.
- **Menu lateral aberto (computador):** 252px, itens de 38px com letra de 15px e ícone de 20px, subitens de 14px; o painel encosta reto no menu e no topo (sem canto arredondado no encontro, pedido do David). Recolhido mantém o canto de 18px.
- **Celular e PWA:** um campo por linha, alvo de toque 44px, folha que sobe de baixo (padrão Planejai: alça, rodapé fixo, botão principal ocupa o espaço que sobra).

## Modais e formulários

- Janela abre **perto de quem abriu** (`liquid.ts`): no computador e no tablet sai de dentro do botão e fica ao lado dele (botão à direita, janela à direita; embaixo se couber) e volta para ele ao fechar; no celular a folha cresce do botão. Use sempre `Modal`/`Sheet`/`useLiquidDialog`: não posicione janela na mão nem com `margin: auto` fixo.
- Campos soltos no corpo do `Modal` ou dentro de `<div className="cm-form">` seguem o padrão sozinhos: **rótulo em cima do campo**; no notebook (≥901px, mouse) o modal abre **mais largo** e os campos se distribuem em **2 colunas** (3 no `size="xl"`).
- Agrupe por assunto com `<h3 className="cm-form__section">`. Campo longo (observação, endereço) ocupa a linha toda com `wrapClass="cm-form__wide"` ou `<textarea>`.
- **Campo de valor** (dinheiro): `inputMode="decimal"` e valor no formato `0,00`. Não precisa de máscara: `installDecimalEntry` (`design-system/decimal-entry.ts`, ligado no `main.tsx`) põe o cursor antes da vírgula ao entrar (digitar 3 em 0,00 dá 3,00) e a vírgula pula para os centavos. Campo que não é dinheiro nem número com vírgula não usa `inputMode="decimal"`.
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
  compacta e com sombra depois de rolar (`is-scrolled`); abaixo de 860 px vira o botão de menu com
  a folha `.st-nav__sheet`. É o único lugar do site com fundo translúcido.
- **React Bits** (`site/reactbits/`, licença MIT + Commons Clause: usar dentro do Comandou pode,
  revender o componente não): `ClickSpark` (faíscas no clique, cobre a página inteira),
  `Magnet` (botão principal segue o ponteiro, via `CtaButton`), `ShinyText` (brilho no selo do
  teste), `SpotlightCard` (holofote nos cartões), `StarBorder` (luz na borda do quadro do preço)
  e `GlareHover` (brilho na tela do sistema). Copie o arquivo do repositório
  DavidHDev/react-bits (`src/ts-default/...`) com o cabeçalho de crédito; prefira os que não
  pedem gsap, motion ou three (os de rolagem que pedem, como ScrollReveal, ScrollStack e
  ScrollVelocity, foram refeitos em `site/motion.ts`). Todos já param com "reduzir movimento".
- **Rolagem** (`site/motion.ts` + `site/scroll.css`): Lenis no computador (no toque, a rolagem
  do aparelho) e um laço por quadro que escreve `--p` nos elementos; o CSS só usa transform e
  opacity e, sem a variável, cai no estado final parado. Cena nova: `useScrollProgress(modo)` e
  uma regra em `scroll.css`. Seções numeradas (`01 / O sistema`) com `SectionHead`.
- **Topo** (`site/hero.css`): tudo centralizado (selo, título, frase, cartão de criar) e o palco
  embaixo com a tela da cozinha e o celular da loja na frente. Aviso flutuante nunca cobre o
  celular. O efeito "deitado que fica reto" é só do palco do topo; não repita em outra seção.
- **Uiverse** (licença MIT): o efeito de botão físico `.st-press` (borda de baixo mais escura,
  afunda ao apertar), a seta que corre no botão (`CtaButton arrow`), os vistos que se desenham e
  o + que vira − nas perguntas seguem o estilo dos elementos de lá, reescritos com os tokens.
- Nada disso entra nas telas de trabalho (PDV, salão, cozinha, painel): lá continua sóbrio.

## Super Admin › Cobrança (calendário)

`platform/BillingCalendar.tsx` (classes `adm-cal*` e `adm-charge*` em `admin.css`), no jeito
do print do MAX que o David mandou, porém mais limpo: barra com mês, filtro de situação e "baixa
sozinha"; uma linha de totais com bolinhas (sem cartões de número); grade do mês num quadro só,
dia com o total curto e bolinhas, fundo `color-mix` de 9% na cor da situação (nada de faixa na
esquerda); cartões do dia ao lado (embaixo abaixo de 1100 px) e a janela "dados da cobrança" com
linhas rótulo/valor.

## Agenda pessoal (restaurante)

No menu se chama **Agenda pessoal** e fica sozinha no pé da barra; Novidades vai no menu do perfil
(`account__action` com a marca `account__new` "novo"; o ponto laranja fica no avatar do perfil).

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
(`C`), fundo creme `#F4F1EE`, cartão branco com raio 20, panda no topo sobre `#FFF4EE`, um botão
laranja por e-mail, título centralizado. Modo escuro pelas classes `em-*`. Nada de imagem com
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

## Super Admin › Conversas

`platform/SupportPage.tsx` (estilos em `admin.css`, prefixos `sinbox`/`sdesk`): lista de 320 px, a
conversa e, a partir de 1280 px, a coluna do restaurante (`sdesk`: monograma, endereço, Entrar no
sistema, Ver cadastro e os detalhes). A conversa usa o `ChatPane` com `bubbles` (classes
`scx--bubbles`/`scx-thread--bubbles` em `store-chat.css`): mesmo desenho dos Chamados, as suas à
direita em `--cm-brand-50`, hora dentro do balão, dia e aviso em pílula, caixa de escrever em
pílula com botão redondo. Sem `bubbles`, o `ChatPane` segue em linha (cardápio, chat da equipe).
Chamado citado numa mensagem é o cartão `scx-ticket` (ícone de boia, número, bolinha da situação,
título). Número de avisos num item do menu: `count` no `FrameItem` (pílula `cm-rail__count` na
frente do nome no menu largo, `cm-rail__badge` no ícone no estreito e nas abas); a bolinha `dot`
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
