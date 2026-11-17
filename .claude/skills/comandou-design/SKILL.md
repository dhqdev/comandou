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
- **Dark mode:** cinzas neutros e laranja suave; escreva só com tokens e ele vem junto. Se criar token novo, defina também no bloco escuro de `tokens.css` (os dois blocos) e confira `brand.ts`.
- **Tipografia:** Inter, títulos de seção pequenos e discretos, números tabulares; sem caixa alta em rótulos.
- **Celular e PWA:** um campo por linha, alvo de toque 44px, folha que sobe de baixo (padrão Planejai: alça, rodapé fixo, botão principal ocupa o espaço que sobra).

## Modais e formulários

- Janela abre **perto de quem abriu** (`liquid.ts`): no computador e no tablet sai de dentro do botão e fica ao lado dele (botão à direita, janela à direita; embaixo se couber) e volta para ele ao fechar; no celular a folha cresce do botão. Use sempre `Modal`/`Sheet`/`useLiquidDialog`: não posicione janela na mão nem com `margin: auto` fixo.
- Campos soltos no corpo do `Modal` ou dentro de `<div className="cm-form">` seguem o padrão sozinhos: **rótulo em cima do campo**; no notebook (≥901px, mouse) o modal abre **mais largo** e os campos se distribuem em **2 colunas** (3 no `size="xl"`).
- Agrupe por assunto com `<h3 className="cm-form__section">`. Campo longo (observação, endereço) ocupa a linha toda com `wrapClass="cm-form__wide"` ou `<textarea>`.
- Liga/desliga e linhas de texto + controle: `cm-form__row`. Bloco solto que deve ocupar a linha toda: `cm-form__block`.
- Use `TextField`, `SelectField`, `CheckField`; não monte `<label>` na mão.
- Troca de tema: fade de cores (`switchTheme`), nunca captura de tela nem onda em tela cheia.

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
  teste) e `SpotlightCard` (holofote nos cartões). Copie o arquivo do repositório
  DavidHDev/react-bits (`src/ts-default/...`) com o cabeçalho de crédito; prefira os que não
  pedem gsap, motion ou three. Todos já param com "reduzir movimento".
- **Uiverse** (licença MIT): o efeito de botão físico `.st-press` (borda de baixo mais escura,
  afunda ao apertar) segue o estilo dos elementos de lá, reescrito com os tokens.
- Nada disso entra nas telas de trabalho (PDV, salão, cozinha, painel): lá continua sóbrio.

## Super Admin › E-mail

`apps/web/src/platform/mail/` (`mail.css` só com tokens): três colunas (pastas, conversas,
leitura) que no celular viram uma de cada vez. O HTML de e-mail recebido abre **só** em
`HtmlFrame` (moldura `sandbox` sem `allow-scripts`, documento montado pela API com CSP), nunca
com `dangerouslySetInnerHTML`. Ícones de ação com 36 px (44 px no celular) e `aria-label`.

## Antes de entregar

Veja a tela em claro e escuro (o site, só claro), no notebook e em 390px, com os prints do
Playwright ou no navegador do Claude Code apontando para o Vite local (passo a passo na skill
`comandou-projeto`).
