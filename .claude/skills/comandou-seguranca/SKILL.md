---
name: comandou-seguranca
description: Checklist de segurança do Comandou (OWASP Top 10:2025, ASVS 5.0 e Top 10 para LLM aplicados a este código) e como rodar a varredura de vulnerabilidades. Use ao criar ou mudar rota, upload, link externo, senha, cookie, exportação, prompt de IA ou tela do Super Admin, e ao fazer revisão ou auditoria de segurança.
---

# Segurança no Comandou

Base: OWASP Top 10:2025, OWASP ASVS 5.0 (nível 2) e OWASP Top 10 para aplicações com LLM,
traduzidos para as peças deste projeto. Histórico das revisões: `docs/security.md` e
`docs/auditoria-2026-11.md`. Teste sempre em banco de teste ou local, **nunca em produção**.

## Rodar a varredura

```bash
# Postgres 16 e Redis locais com os papéis do passo "Papéis do banco de teste" do ci.yml
cd apps/api && npx vitest run test/security-sweep.e2e.test.ts   # ~40 s, ~6 mil requisições
npx vitest run src/common/safe-fetch.test.ts                     # links externos (SSRF)
cd ../../packages/shared && npx vitest run src/security.test.ts  # senhas e CSV
pnpm audit --prod --audit-level high                             # dependências (CI)
pnpm audit                                                       # inclui as de build
```

`security-sweep.e2e.test.ts` descobre **todas** as rotas pelo Nest (rota nova entra sozinha) e
confere: sem sessão → 401; sessão de outro restaurante → 401; garçom, cozinha e entregador → 403
onde não têm a permissão; rotas do painel → 404 no endereço do restaurante e 401 sem a sessão do
Super Admin; rotas da equipe recusadas no site e no painel; injeção nos parâmetros e corpo hostil
nunca dão 5xx (só 501/503 de "não configurado") e não mexem no outro restaurante; cabeçalhos,
cookie, CSRF, corpo gigante e Host estranho.

**Rota pública nova faz o teste falhar** (listas `PUBLIC_TENANT_ROUTES`, `OPEN_WITHOUT_TENANT`,
`SKIP_CSRF_ROUTES`). Antes de acrescentar na lista, confira o checklist abaixo para ela.

## Checklist por tipo de mudança

### Rota nova (A01 Controle de acesso, ASVS V8)
- Sem `@Public()` a rota já exige sessão do restaurante pelo Host. Ponha `@RequirePermission(...)`
  com a permissão mínima; rota sem permissão vale para **qualquer perfil**, até o entregador.
- Ação só do dono (plano, equipe, domínio): `ownerOnly(u)` ou papel conferido no serviço.
- Dado do próprio usuário (agenda, conversa, corridas): filtre por `user_id` no SQL, não só pelo
  restaurante (o RLS separa restaurantes, não pessoas).
- Ver a tela de outra pessoa (Equipe › Abrir, prévia do app do entregador em
  `GET deliveries/preview/:userId`): só leitura, só `users:manage`, e nunca uma sessão nem uma
  ação em nome dela (pegar, concluir, GPS seguem presos ao login de cada entregador).
- Cadastro do restaurante (`tenants`/`tenant_profiles`, banco central) pela rota do restaurante:
  só o dono, só o `t.id` da sessão, nunca `notes` (observação interna do painel), e grave no
  histórico do painel (`platformAudit` com `by`). Conta da pessoa: só funções que usam
  `app_current_user()`; trocar e-mail pede a senha atual.
- `@Public()`: limite próprio (`@Throttle`), token longo (`randomBytes(24+)`, guardado em hash)
  ou cookie do cliente conferido em cada chamada; nunca confie em id vindo do corpo.
  Exceção revisada: a mesa do QR Code (`/store/table/:tableId/...`, 0.235, e o pedido pela mesa).
  O id da mesa (uuid do QR colado nela) é a chave; a conta pública mostra só itens e valores da
  comanda aberta (nada de nome, CPF ou telefone), o chamado segue a conferência de localização da
  loja e o comprovante só vira dinheiro depois que o caixa aprova. Pagar a conta pelo PagBank
  (`pay/pix`, `pay/card`, `pay/cancel`, 0.236) segue a mesma conferência, cobra só o saldo do banco
  igual ao `amount` que o cliente viu, não grava CPF/e-mail e trava a comanda no máximo 10 minutos
  (qualquer um na mesa solta; o que for pago depois sem saldo é devolvido sozinho).
- PIN do cliente no balcão (0.256, `loyalty/pin/:pin`, `coupons/pin/:pin`): só a equipe com
  `orders:manage`, limite próprio por minuto (6 números se adivinham), mostra só o nome e o fim do
  celular, e troca/uso grava quem fez. Cupom do cardápio: o servidor sempre confere de novo no
  `POST /store/orders` (validade, limite total e por cliente com trava, primeiro pedido), nunca
  confia no desconto que o navegador mandou. Código de convite: o servidor recusa o próprio código
  e quem já tem pedido concluído.
- `@SkipTenant()` desliga a sessão também: só com `PlatformHostGuard` + `PlatformSessionGuard`
  (painel) ou token próprio conferido **antes** de ler o corpo (`bearerMatches`, tempo constante).
- `@SkipCsrf()` só para webhook de terceiro com token ou assinatura.
  Modelo para webhook de aplicativo de delivery: `RappiWebhookController` (admin.<base>, prefixo
  `/api/v1/platform/channels/webhooks/`, `PlatformHostGuard`, limite por minuto, HMAC sobre
  `req.rawBody` em tempo constante com prazo de 10 minutos, segredo cifrado em Credenciais e
  recusa tudo sem segredo; grava antes de responder 200). Rota nova entra em `SKIP_CSRF_ROUTES`
  da `security-sweep.e2e.test.ts`.
- Autorização OAuth de terceiro (PagBank Connect, aiqfome pelo ID Magalu): `state` longo
  (`<restaurante>.randomBytes(32)`), guardado só em hash, de uso único, com prazo (15 minutos) e
  preso a quem começou (`user_id`). A volta fixa em admin.<base> (`@Public`, `PlatformHostGuard`,
  limite por minuto) **não troca nada**: só acha o endereço do restaurante pelo state e redireciona;
  a troca do código acontece no endereço do restaurante, com a sessão da equipe e a permissão.
  Token de renovação de terceiro fica cifrado (contexto com restaurante e loja) e, se ele troca a
  cada uso, a renovação trava a linha (`FOR UPDATE`). A volta entra na exceção de
  "rota do painel sem sessão" da varredura (`channels/oauth`).
- Aviso para TODAS as conexões do restaurante (sala `tenantAllRoom`, que inclui o cliente do
  cardápio) só sem dado da operação, como o `cache.clear`; evento com dado vai em `tenantRoom`.
- Painel: ação que não volta (excluir, produção, assinar) pede `PlatformAuthService.confirmCode`
  (código do autenticador, mesmo em navegador confiável) e grava a tentativa negada na auditoria.

- Foto do perfil da equipe (0.272, `member_photos`): só a própria pessoa lê, troca e tira
  (`/account/photo`, filtro por `user_id` além do RLS); não crie rota que devolva a foto de outra
  pessoa sem decidir antes quem pode ver. Upload pelo `checkMemberPhoto` (assinatura, 1 MB).
- Dado pessoal novo de cliente (nome, telefone, endereço, CPF, conversa) numa tabela: entra no
  `app_privacy_erase` e no export da LGPD (`store/privacy.service.ts`), senão o pedido do titular
  deixa o dado para trás. Função SECURITY DEFINER filtra `app_current_tenant()` em todo comando (o
  dono ignora o RLS).

### Entrada de dados (A05 Injeção, ASVS V1/V2)
- Corpo sempre por `ZodPipe` (o Zod descarta campo desconhecido: nada de `role`, `tenantId` ou
  `price` vindos de fora). Parâmetro com `ParseUUIDPipe`. Texto com `.max()`.
- SQL só parametrizado (`$1`); nome de coluna ou tabela montado só de lista fixa do código.
- Dinheiro em string decimal (`money`), nunca float; preço sempre do banco.
- Upload: tipo pelo conteúdo (`sniff`, `sniffVideo`), limite de tamanho, `nosniff`; nunca SVG
  ou HTML servido inline.
- Planilha exportada: texto por `csvText` (`@comandou/shared`), nunca concatenado.

### Link ou URL informada por alguém (A01 SSRF, ASVS V15)
- Sempre `safeFetch` (`common/safe-fetch.ts`). Ele confere o IP **no lookup do socket** (sem
  DNS rebinding), recusa IPv6 com IPv4 dentro (`[::ffff:169.254.169.254]`), faixas reservadas,
  portas fora de 80/443, e mede o corpo depois de descompactar. Nunca `fetch(url)` direto com
  URL vinda de usuário, restaurante ou página externa.
- `fetch` direto só para endereço fixo do `env` (Asaas, PagBank, Focus, OpenRouter, gateway).

### Senha, sessão e cookie (A07 Autenticação, ASVS V6/V7)
- Senha nova: `newPassword()` (8; painel `newPassword(10)`) de `common/schemas.ts`; com e-mail,
  telefone ou nome no mesmo formulário, `.superRefine(notPersonal(...))`. Login aceita qualquer
  senha já cadastrada (não trave quem tem senha antiga).
- Hash: `hashPassword` (scrypt). Token: aleatório, só o SHA-256 no banco. Exceção revisada: o
  link do entregador (0.227) guarda também uma cópia cifrada (`couriers.access_token_enc`, `seal`
  com contexto restaurante + entregador) para o Copiar link; a entrada continua pelo hash, a cópia
  só sai por `GET /couriers/:id/link` (`delivery:manage`, auditado `courier.link_viewed`) e é
  conferida contra o hash antes de mostrar.
- Cookie: `httpOnly`, `secure: env.COOKIE_SECURE`, `sameSite`, sem `Domain` (host-only).
  Login sempre cria token novo (sem fixação); sair apaga no servidor.
- Limite por IP **e** bloqueio por conta em todo login, PIN e código de verificação.

### Resposta da API (A02 Configuração, ASVS V3/V14)
- `common/api-headers.ts` põe `Cache-Control: no-store` e CSP `default-src 'none'` em tudo.
  Rota que pode ter cache (foto, modelo 3D) define o seu. HTML de propósito: CSP própria com hash
  do script (`previewCsp` em `store/link-preview.ts`). PDF fica sem CSP (leitor do navegador).
- Erro: lance `HttpException`; o filtro esconde pilha e detalhe do banco. Nunca devolva
  `e.message` de biblioteca para o cliente.
- Segredo nunca na resposta, no log (pino já mascara cookie e Authorization) nem na auditoria;
  guarde cifrado (`seal`/`open`, AES-256-GCM, com contexto) e mostre só `last4`.

### Front (XSS, ASVS V3)
- React escapa: não use `dangerouslySetInnerHTML`. HTML de terceiros (e-mail) só em
  `<iframe sandbox="">`.
- Link vindo de dado: só `https?://` (`linkify`/`Linkified`), com `rel="noopener noreferrer"`.
- CSP do Nginx em `infrastructure/nginx/security-headers*.conf`: host novo de script ou conexão
  entra lá (e na `-frame-self`).

### IA (OWASP LLM01, LLM02, LLM05, LLM06)
- Texto do cliente, de página externa ou de PDF é **dado**, nunca instrução: proteções em
  `chat/agent-guard.ts`. Ação da IA (reserva, cancelamento) só por marca lida pelo servidor e
  confirmada pela pessoa (`pending` + SIM); a IA nunca grava direto.
- Saída da IA validada por Zod e mostrada como texto (nada de HTML ou link de fora).
- IA que mexe em código do restaurante (modelos de impressão, `printing/template-ai.service.ts`) só
  propõe: o servidor confere a proposta (sintaxe, largura) e a pessoa aplica e salva.
- IA das fotos e do 3D dos itens (`catalog/item-ai.*`): o nome do item vai entre aspas sem aspas
  nem quebras (`itemName`); a resposta passa por `readTips`/`normalizeShape` (números presos em
  faixas, textos curtos) e a foto que volta é conferida por `sniff`. Nada é gravado pela IA: a tela
  mostra e a pessoa usa a foto ou publica o 3D pelas rotas de sempre. Foto de entrada até 3 MB,
  conferida pela assinatura; GLB montado até 12 MB.
- O que entra no prompt respeita a permissão de quem pergunta (`roleHas` antes de montar o
  contexto): dado que o perfil não vê na tela também não vai para a IA dele. Vale para o retrato
  (`moreLines` + `ai-snapshot.ts`) e para os achados da pergunta (`lookup` usa o `runSearch` com o
  papel de quem pergunta). Telefone, e-mail e CPF de cliente nunca entram no contexto (`foundLine`
  leva título, valor e link; cliente, pedido, comanda, pessoa e entregador vão sem o detalhe,
  `NO_DETAIL`); o que a pessoa escreveu e o que veio do banco vão como dado, no
  `contextPrompt`, separado das regras fixas do `systemPrompt`.
- Problemas agora (`chat/ai-problems.ts`, 0.271): cada parte só com a permissão dela, sem
  telefone, e-mail ou CPF de cliente; texto que vem de fora (motivo da SEFAZ, erro de aplicativo,
  recado do cliente) passa por `cleanText` e vai como dado. Link que a IA escreve só vira botão se
  for caminho do app que existe e que o perfil abre (`safeAppPath` + `pathAllowed` de
  `ai-places.ts`): `//outro.site`, `javascript:` e `..` são recusados, e endereço de fora fica só
  como texto.
- Menu do Super Admin pelo WhatsApp (`platform-whatsapp/admin-bot.service.ts`) só responde a
  número cadastrado de Super Admin ativo (`operatorFor`); opção nova que muda algo pede SIM
  (`PendingAction`), chama o serviço da tela com o `Actor` do dono do número e grava
  `whatsapp.menu_action`. Nada destrutivo (suspender, excluir, senha, acesso de suporte) pelo
  WhatsApp.
- IA do WhatsApp só vê dados do **próprio número** que escreveu (reservas por `upcomingByPhone`,
  pedidos das últimas 24 h por `AiAgentService.ordersIn`, que compara DDD + 8 últimos dígitos).
- Link que o assistente da equipe manda só vira botão para tela que existe (`isKnownAppPath` de
  `packages/shared/src/nav-catalog.ts`, usado por `safeAppPath`); tela nova entra em
  `APP_ROUTE_ROOTS`. O `?foco=` só faz rolar e piscar um elemento com aquele `data-search-id`
  (busca por atributo com `CSS.escape`), nunca executa nada.
- Chave do sistema × chave dos restaurantes: o gasto do Comandou (esteira, testes do painel) vai
  para `platform_ai_usage` com a chave que pagou; nunca para o `ai_usage` do restaurante, que é o
  que o limite e a tela Conta › Uso de IA somam.

### Dependência (A03 Cadeia de suprimentos)
- Versão fixa ou `^` com lockfile; `pnpm audit --prod --audit-level high` no CI.
- Falha só em ferramenta de build: override em `pnpm-workspace.yaml` com o GHSA no comentário,
  e confira que `pnpm --filter @comandou/web build` continua gerando o `sw.js`.

## Ao terminar

- Teste de regressão para cada falha achada (no arquivo do módulo ou na varredura).
- Linha nova em `docs/security.md` (tabela "Como o sistema se protege" e a revisão do dia).
- Nota `segurança` em `packages/shared/src/releases.ts`.
