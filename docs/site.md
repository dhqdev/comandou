# Site público e teste grátis pelo site

O domínio base (`comandou.com` e `www.comandou.com`) mostra o site público: o que o sistema faz,
com telas de verdade da demonstração, o preço (vem de Super Admin › Planos) e o cadastro em que o
dono cria o próprio restaurante de teste.

## Movimento e rolagem

O site tem mais movimento que as telas de trabalho, sempre com transform e opacity e parado com
"reduzir movimento". O código fica em `apps/web/src/site/`:

- `motion.ts`: rolagem suave no computador (Lenis; no toque fica a do aparelho, e não age dentro
  de janelas nem de campos de texto) e um único laço por quadro que escreve `--p` (0 a 1) nos
  elementos que andam com a rolagem. `scroll.css` faz o resto.
- Cenas: o topo sobe e esmaece ao sair (só no computador); a tela do sistema chega deitada e se
  endireita; a frase grande acende palavra por palavra presa no meio da tela; os três passos se
  empilham (o de baixo encolhe um pouco); as faixas aceleram e viram de lado com a rolagem; a
  marca no rodapé sobe letra por letra; a barra de leitura no topo.
- React Bits (`site/reactbits/`): `ClickSpark`, `Magnet`, `ShinyText`, `SpotlightCard`,
  `StarBorder` (luz que corre na borda do quadro do preço) e `GlareHover` (brilho na tela do
  sistema). ScrollReveal, ScrollStack e ScrollVelocity pedem gsap ou motion, então foram refeitos
  em `motion.ts` com a mesma ideia e sem dependência.
- Uiverse (em CSS): botão físico `.st-press`, seta que corre no botão (`.st-arrow`), vistos que se
  desenham no preço e o + que vira − nas perguntas.

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
   IA montou no site, ou leem o site, o lugar do Maps (nome e endereço) ou a descrição dos itens.
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
- **Chave.** Super Admin › Sites com IA aceita uma chave própria (dá para criar no OpenRouter uma
  chave com limite de gasto só para isso). Vazia, vale a sua chave de Super Admin › Tokens e,
  sem ela, a dos restaurantes.
- **Limites** (Super Admin › Sites com IA): teto de tokens de resposta por site, tokens por dia
  e por mês somando todos os sites (0 = sem limite) e sites por visitante (IP) em 24 horas. Além
  disso, cada IP chama a geração no máximo 6 vezes em 10 minutos.
- **Consumo.** Cada site montado fica registrado com tokens, custo, de onde veio e, se a pessoa
  criou o restaurante, qual. A tela mostra o gasto do dia e do mês, quantos viraram restaurante,
  o gasto por cliente e o que a IA montou. O total também entra em Super Admin › Tokens
  (fonte "Sites com IA").
- **Rascunho vai junto.** O cadastro leva o site montado (token de uso único, válido por 3
  horas). Nos primeiros passos, a conferência já abre com a loja e o cardápio da IA, sem gastar o
  limite de IA do restaurante. Nada entra na loja sem a pessoa conferir.

Tabelas: `platform_site_ai_settings` e `site_ai_generations` (migração 0071).
