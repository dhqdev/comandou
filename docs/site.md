# Site público e teste grátis pelo site

O domínio base (`comandou.com` e `www.comandou.com`) mostra o site público: o que o sistema faz,
com telas de verdade da demonstração, o preço (vem de Super Admin › Planos) e o cadastro em que o
dono cria o próprio restaurante de teste.

## Desenho, 3D e movimento (0.245)

Refeito na 0.245 para ficar minimalista: muito espaço, linha fina no lugar de cartão, título
grande e escuro com a segunda parte em cinza e laranja só na ação principal. O código fica em
`apps/web/src/site/` (`SiteApp.tsx`, estilos em `site.css` para menu, cadastro e celular, e em
`landing.css` para as seções):

- **Topo**: título, frase, o cartão de criar e três linhas com visto à esquerda; à direita o
  **palco 3D** (`Stage`): o celular da loja (mostra o que a pessoa digita) deitado em
  perspectiva, com o cartão "Pedidos agora" (um pedido de um canal diferente a cada 3,4 s), as
  vendas do dia e o "Pix aprovado" flutuando em camadas mais perto (`translateZ`). O conjunto
  gira de leve com o mouse (`useTilt` em `motion.ts`, escreve `--tx`/`--ty`). No celular fica
  o celular da loja e o Pix, sem os pedidos.
- **Seções, em ordem**: a faixa "Recebe os pedidos de" (nomes dos aplicativos em texto), **O
  sistema** (telas de verdade que passam sozinhas, numa moldura que chega deitada e se
  endireita com a rolagem: `--p` de `useScrollProgress('enter')`), **Módulos** (`MODULES` de
  `site-data.ts`, grade de linhas finas com ícone solto), **Prato em 3D**, **Aplicativos** (a
  fila no jeito da tela de Pedidos e o que dá para fazer sem o portal), **três passos**,
  **preço**, **perguntas** e o fim (panda, convite e rodapé).
- **Prato em 3D** (`Dish3D.tsx`): os modelos de verdade da Fumaça Burger
  (`public/site/3d/*.glb`, cópia de `apps/api/db/demo/fumaca/models/`, gerados por
  `tools/demo-images/fumaca/models/build.mjs`) no mesmo `@google/model-viewer` do cardápio. O
  visualizador e o modelo só baixam quando a seção chega a 400 px da tela; antes disso (e sem
  WebGL) aparece a foto. Prato novo: o `.glb` na pasta e uma linha em `DISHES`. Os `.glb` não
  entram no cache do app (o `globPatterns` do PWA não pega `.glb`).
- **Movimento**: Lenis no computador (no toque, a rolagem do aparelho), títulos que sobem de
  trás de uma máscara, seções que entram ao chegar (`.st-reveal`), barra de leitura no topo.
  Tudo com transform e opacity; com "reduzir movimento", parado no estado final.
- Saíram na 0.245 (deixavam o site carregado): faíscas no clique, botão que segue o mouse,
  holofote nos cartões, borda com luz no preço, brilho na tela, frase que acende palavra por
  palavra, faixa que passa sozinha e a pilha dos três passos (a pasta `site/reactbits/` foi
  apagada).

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
- **Chave.** Os sites usam a chave dos restaurantes (Super Admin › Credenciais); sem ela, a sua
  chave. Desde a 0.171 não existe mais chave própria dos sites: a antiga sai no primeiro salvar
  da aba Site com IA. Para segurar o gasto, use os limites abaixo.
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

Tabelas: `platform_site_ai_settings` e `site_ai_generations` (migração 0071).
