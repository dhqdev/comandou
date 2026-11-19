---
name: comandou-projeto
description: Mapa do projeto Comandou e o que manter em dia a cada mudança — onde fica cada coisa (API NestJS, web React, Super Admin, site, e-mail, migrações), como versionar (package.json + Novidades), como rodar testes e telas no Windows, como mandar e-mail de qualquer módulo, e como o GitHub Actions publica. Use antes de mudar qualquer coisa no Comandou, ao terminar uma entrega (README, docs, skills, Novidades) e antes de enviar para a main.
---

# Projeto Comandou

SaaS para restaurantes: PDV, salão, cozinha, caixa, cardápio online, entregas, estoque,
financeiro, nota fiscal, WhatsApp e o painel Super Admin (`admin.<domínio>`), mais o site público
(`<domínio>`) que cria o teste grátis. Monorepo pnpm; tudo em português do Brasil, sem jargão.

## Onde fica cada coisa

| Caminho | O que é |
| --- | --- |
| `apps/api/src/<módulo>` | NestJS 11. Guards globais: limite → CSRF → restaurante (Host) → sessão → permissão → cobrança. Painel: `PlatformHostGuard` + `PlatformSessionGuard`. |
| `apps/api/db/migrations/NNNN_*.sql` | Migrações versionadas, **só aditivas**; nunca edite uma já aplicada (checksum). Tabela de restaurante: `tenant_id` + RLS. Tabela do painel: `ENABLE RLS` + política `platform_all TO comandou_platform`. |
| `apps/api/src/mail/` | E-mail próprio: fila `mail_outbox` que entrega **só pelo Resend** e a tela Super Admin › E-mail (Resend + Envios). Caixas, agenda, agendamento, Cloudflare e SMTP foram retirados na 0.142 (tabelas antigas seguem no banco, sem uso). Guia: `docs/email.md`. |
| `apps/api/src/finance/` + `packages/shared/src/finance-plan.ts` | Financeiro: contas, fechamentos (`closing.ts`, chamado no fechar do caixa), recebíveis das maquininhas, conciliação bancária (`bank.controller.ts`, `bank-match.ts`), DRE (`dre-data.ts` + `buildDre`) e o resumo para a IA (`finance-ai.ts`). Telas em `apps/web/src/pages/finance/` (Visão geral com gráficos em `charts.tsx` e leituras automáticas em `insights.ts`, testadas em `insights.test.ts`). Guia: `docs/financeiro.md`. |
| `apps/whatsapp-gateway/` + `apps/api/src/messaging/` | WhatsApp por QR Code (Baileys): uma réplica, um socket por restaurante. Fila por conversa até a API, ritmo de envio por número (429 = tente depois), religação sorteada. A API só responde ao gateway depois de tratar a mensagem (ordem entre réplicas) e marca "já recebida" no Redis. O **Super Admin › WhatsApp** usa o mesmo gateway na sessão reservada `PLATFORM_WA_ID` (`apps/api/src/platform-whatsapp/`, recebidas por `onPlatformMessage`, nunca pela IA). Guia: `docs/whatsapp.md`. |
| `apps/api/src/chat/ai-agent*.ts` + `agent-guard.ts` + `agent-pdfs.ts` | IA que atende o cliente no WhatsApp (tela Assistente de IA). Ações por marca no fim da resposta (`[[RESERVAR …]]`, `[[CANCELAR X]]`, `[[CARDAPIO]]` = arquivos que o restaurante subiu em `ai_menu_files` (nunca gere PDF de cardápio), `[[CALENDARIO_PDF]]`, `[[ATENDENTE]]`, `[[ABUSO]]`), lidas por `parseActions`. Reserva só é gravada pelo servidor depois do SIM (`ai_customer_chats.pending`), via `ReservationsService.createWhatsApp`. Memória = últimas 16 mensagens + resumo (`memory`). Proteções e bloqueio por abuso em `agent-guard.ts`. Guia: `docs/whatsapp.md` (seção IA). |
| `apps/api/src/chat/menu-import.service.ts` + `apps/web/src/features/onboarding/` | Primeiros passos com IA: lê PDF, fotos, link e texto do cardápio, e **acha o restaurante no Google Maps** (`fromPlace`: pesquisa com o plugin `web` do OpenRouter, prompt em `chat/place-research.ts`, depois lê o link do cardápio achado). Tudo cai na conferência antes de entrar na loja. |
| `apps/api/src/agenda/` + `apps/web/src/pages/agenda/` | Agenda pessoal (menu, embaixo; Novidades fica na tela Conta): compromissos e tags de cada pessoa (a API filtra por `user_id`), visões Dia/Semana/Mês/Lista e lembrete pelo WhatsApp do restaurante (`MessagingService.sendText`, só QR Code) pela varredura `AGENDA_INTERVAL_SECONDS`. **Fiado**: opção Fiado no Tipo de atendimento da Nova venda (`fiado` no `POST /orders`) ou `POST /orders/:id/fiado` no pedido já lançado; `AgendaService.fiado` cria a cobrança na agenda (tag Fiado) e a varredura manda a mensagem ao cliente (`sweepCharges`). Guia: `docs/agenda.md`. |
| `apps/api/src/reservations/` + `apps/web/src/pages/ReservationsPage.tsx` | Reservas em calendário no jeito da Agenda (reaproveita `agenda-utils.ts` e `agenda.css`): Dia com cartões ao lado, Semana, Mês e Lista, arrastar para remarcar e tempo na mesa por reserva (`durationMinutes`). Guia: `docs/reservas.md`. |
| `apps/web/src/platform/` | Super Admin (uma tela por arquivo, carregada sob demanda em `PlatformApp.tsx`; menu em `NAV`, agrupado por `section`). Sem tela de Auditoria: histórico de cada restaurante em `audit.tsx` (`TenantHistory`, `GET /platform/audit?tenantId=`) e o do painel em Conta › Registro do painel (`?scope=platform`). Dados de um restaurante na Visão geral: `TenantOverview.tsx`; Uso, Consumo e Operação: `TenantInsights.tsx` (dia no fuso do restaurante). |
| `apps/web/src/platform/credentials/` + `apps/api/src/platform/platform-credentials.service.ts` | Super Admin › **Credenciais**: o único lugar onde se cadastra chave/token (Focus NFe, OpenRouter, Resend, Asaas, PagBank, Backblaze, GitHub) e o passo a passo dos secrets do servidor. Credencial nova: entrada em `catalog.tsx`, status em `status()` e, se for do painel, um formulário em `editors.tsx`; texto de cada campo (`fields`) e o "deu certo" (`check`) no catálogo; nas outras telas, só `<KeyInUse ids={[...]} />` (a primeira salva da lista é a que vale). O final da chave (`last4`) sai de `status()`, que abre a chave só no servidor. OpenRouter tem três: restaurantes (que também paga os sites com IA, via `siteKey` de `ai-keys.ts`; desde a 0.171 não há chave própria dos sites), a sua (sistema) e a de gerenciamento, que só lê o saldo da conta (`/credits` recusa a chave comum, conferido na doc do OpenRouter: "Management key required"); o gasto do sistema grava a chave que pagou (`platform_ai_usage.key_kind`, `recordSystemUsage({ key })`). Token Master da Focus: `platform_credentials` (0082), lido por `FocusClient.masterToken()` (env de reserva). Guia: `docs/credenciais.md`. |
| `docs/decisions/0015-canais-de-delivery.md` + `docs/delivery-apps-pesquisa.md` | **Aplicativos de delivery (em construção, por fases):** pedidos do iFood, Open Delivery (99Food, Keeta) e Rappi entrando no Comandou pela camada comum `integrations/channels/` (caixa de entrada, outbox, polling com trava, ingestão única). Leia o ADR e a pesquisa antes de mexer; as travas contra bloqueio do iFood (polling ≥ 30 s, ack só depois de gravar, ≤ 10 consultas por pedido, sem repetir 4xx) são obrigatórias. Fase 1 pronta (0.174.0): canal novo = um adaptador (`ChannelAdapter`) registrado no `ChannelRegistry`; pedido entra SÓ por `ExternalOrdersService.ingest`; mudança de estado de pedido de aplicativo vai ao canal pelo gancho `onTransitionInTx` + `integration_outbox`; credencial do aplicativo em Super Admin › Credenciais (`ChannelCredentials`); teste com `test/fake-channel.ts`. Fase 2 pronta (0.176.0): pedidos do iFood pelo `IfoodOrdersAdapter` (tradução pura em `ifood-order.ts`, caminhos em `IFOOD_PATHS`); pago no aplicativo é `payments.method = 'app'` sem sessão de caixa (nunca conta na gaveta); pedido de aplicativo não muda itens nem valores; teste com `test/fake-ifood.ts`. Fase 3 pronta (0.179.0): motivo de cancelamento por pedido (`cancellationReasons` do adaptador, `channelReason` na transição), cancelamento negado volta o pedido, negociação do cliente em `channel_disputes` respondida só por uma pessoa (`ChannelDisputesService.decide`, tela `features/channels/AppDispute.tsx`). Fase 4 pronta (0.180.0): situação, pausa e horários da loja no aplicativo (`ChannelStoreStateService`, `storeStatus`/`pauseStore`/`resumeStore` do adaptador), "Loja fechada" do PDV pausa junto (`StoreService.onOpenChanged`), tela `features/channels/StoreState.tsx`. Fase 5 pronta (0.184.0): entregador do aplicativo em `channel_orders.driver_*` (`ChannelDriversService`: eventos de entrega só para a frente, rastreio no máximo a cada 30 s, Sob Demanda com a cotação guardada no servidor), despacho com motoboy da loja travado quando o aplicativo leva (`DeliveryService.dispatch`), tela `features/channels/AppDriver.tsx`. Fase 6 pronta (0.185.0): cardápio do iFood segue o estoque da ficha técnica, conferência com o portal (`IfoodCatalogService`, `menus.ifood_drift`, tradução em `ifood-catalog-read.ts`), "Mandar o do Comandou" e trazer itens do iFood (`pages/menu/IfoodDriftCard.tsx`). Fase 7 pronta (0.186.0): repasse dos aplicativos (`ChannelFinanceService`, `channel_payouts`, `channel_orders.fin_*`, tradução em `ifood-finance.ts`): cada repasse vira conta a receber "Repasse de vendas" (fora do DRE, conferida pela Conciliação), pago no app entra no DRE como venda e a taxa do app como despesa variável (`DreRaw.appSales`/`appFees`), tela Financeiro › Aplicativos (`pages/finance/AppsTab.tsx`). Fase 8 pronta (0.187.0): avaliações dos aplicativos (`ChannelReviewsService`, `channel_reviews`, tradução em `ifood-review.ts`), resposta sempre escrita por uma pessoa (`POST /channels/reviews/:id/reply`), cartão em Aplicativos de delivery (`features/channels/AppReviews.tsx`); chat com cliente sem API e promoções ficam no portal. Fase 9 pronta (0.188.0): uso dos aplicativos por hora em `channel_usage` (`ChannelMetrics.record` → `ChannelUsageService`, só pela função `app_channel_usage_add`, sem loja nem pedido) lido contra as regras do iFood por `usageReport` (`packages/shared/src/channel-usage.ts`), roteiro de homologação `IFOOD_HOMOLOGATION_STEPS` marcado em Super Admin › Aplicativos de delivery (`platform/ChannelsPage.tsx`, `platform-channels.service.ts`); chamada nova ao aplicativo passa pela `ChannelHttp` e já entra na contagem. Fase 10 pronta (0.189.0): Keeta e Open Delivery em `integrations/opendelivery/` (`OpenDeliveryAdapter` com dialeto `KEETA_DIALECT`/`OPEN_DELIVERY_DIALECT`, pedido em `od-order.ts`, assinatura `X-App-Signature` pela `ChannelSigner` da `ChannelHttp`, corpo canônico `jcs`), loja ligada pelo restaurante em Aplicativos de delivery (`ConnectStore.tsx`, `POST /channels/stores`, faz o `merchantOnboarding` da Keeta); teste com a Keeta falsa `test/fake-keeta.ts`. |teste com a Keeta falsa `test/fake-keeta.ts`. Fase 11 pronta (0.190.0): 99Food pela camada Open Delivery (`FOOD99_DIALECT`: token por loja `<App ID>_<loja>`, polling com `eventType`/`fromTime`, `pickedUp` da retirada pela ação `picked_up`, cancelamento pedido pelo cliente vira negociação `CANCELLATION`); loja ligada pelo número dela na 99Food (o app_shop_id do vínculo); artigos dos nomes por `withArticle` (shared); teste com `test/fake-99food.ts`. Fase 12 pronta (0.191.0): Rappi em `integrations/rappi/` (busca única do pedido novo, pedido na memória do adaptador + lista dos SENT, take/reject/ready-for-pickup) e o **primeiro webhook dos aplicativos** (`/api/v1/platform/channels/webhooks/rappi/:hook`, assinatura `Rappi-Signature` sobre `req.rawBody`, que vem de `rawBody: true` no `createApp`); webhook novo de aplicativo vai nesse prefixo (já liberado no CrowdSec) e na lista da varredura de segurança. |
| `apps/web/src/site/` | Site público (sempre claro, React Bits em `site/reactbits/`, rolagem em `site/motion.ts` + `scroll.css`; guia `docs/site.md`). |
| `apps/web/src/pages/AccountPage.tsx` + `app/account-tools.ts` | Tela **Conta** (`/conta`), aberta pelo nome no pé do menu (computador) e pelo cartão do topo da tela Mais (celular): Assinatura e Ajustes (saíram de Sistema; `ACCOUNT_PAGES` em `AppShell.tsx`, ligadas à Conta por `pages` do `FrameItem`, que acende o item e serve ao tutorial: "Conta › Ajustes"), ajuda, tema, instalar, senha e sair, cada bloco pela permissão. **Meus dados** e **Dados do restaurante** (`pages/account/AccountForms.tsx` + `users/account.controller.ts`, `GET/PATCH /account`): o cadastro do restaurante é o mesmo do Super Admin (`tenants` + `tenant_profiles` no banco central, gravado com `PlatformDb` como a cobrança, só o dono, sem `notes`) e entra no histórico do painel (`tenant.profile_updated`, `tenant.owner_updated`); nome e e-mail da pessoa só por `app_update_own_account` (0088), e-mail novo pede a senha atual. As janelas (senha, apresentação, primeiros passos, instalar) moram no `AppShell` e chegam pela `<Outlet context>` (`useAccountTools`). |
| `apps/web/src/pages`, `features`, `design-system` | App do restaurante e o Design System (tokens em `design-system/tokens.css`). Moldura de todos os apps (menu lateral que recolhe e abre ao encostar o mouse, abas e tela Mais do celular): `design-system/app-frame.tsx` + `app-frame.css`; o passo a passo do e2e pelo menu está em `e2e/nav.ts`. |
| `packages/shared` | Regras comuns e `releases.ts` (tela Novidades). |
| `infrastructure/` | Dockerfiles, Nginx, Traefik, Swarm, CrowdSec, monitoramento. |
| `docs/` | Arquitetura, ADRs, operação, segurança, auditorias, guias (site, e-mail, contratos, cobrança, financeiro). |

## Regras que quebram o CI se esquecer

1. **Versão**: toda entrega sobe a versão em `package.json` (raiz) **e** `packages/shared/package.json`
   (o teste confere) — e os de `apps/api` e `apps/web` juntos — e acrescenta a entrada no topo de
   `packages/shared/src/releases.ts` (mesma versão, data, título, resumo e notas com as tags
   `novo`, `melhoria`, `correção` ou `segurança`). Funcionalidade nova sobe o número do meio.
2. **Prettier**: `pnpm format:check` roda no CI. Rode `pnpm exec prettier --write <arquivos>`.
   No Windows, use `git config core.autocrlf input` neste repositório, senão o Prettier acusa
   centenas de arquivos só por causa do fim de linha.
3. **Tipos e testes**: `pnpm typecheck`, `pnpm test`, `pnpm build`, `shellcheck` dos scripts e
   `pnpm audit --prod --audit-level high`.
4. **Dependência nova**: versão fixa ou `^` com lockfile atualizado (`pnpm install`), e conferir
   o `pnpm audit`.
5. **Rota pública nova** (`@Public()`, `@SkipTenant()` ou `@SkipCsrf()`) quebra
   `apps/api/test/security-sweep.e2e.test.ts` até entrar na lista revisada do teste. Antes,
   siga o checklist da skill `comandou-seguranca` (limite, token, dono). Link informado por alguém
   só por `safeFetch`; senha nova só por `newPassword()` de `common/schemas.ts`.

## Como o GitHub Actions publica

`.github/workflows/ci.yml` roda a cada push na `main` (mudança só em `*.md` ou `docs/` não roda):
1. Qualidade (formatação, tipos, testes com Postgres e Redis, build, auditoria) e Ponta a ponta
   (Playwright no navegador + backup e restauração);
2. Versão: a do `package.json` se a tag ainda não existe, senão a próxima correção;
3. Imagens `ghcr.io/<dono>/comandou-{api,web,whatsapp-gateway,backup}` (amd64 + arm64);
4. Tag e Release. **Publicar não implanta**: o deploy é o workflow manual "Deploy (produção)",
   o botão Atualizar do painel ou o instalador.

O dono pede para enviar direto na `main`, sem PR. Antes do push: tudo verde localmente.

## Testes e telas no Windows

- Banco de teste: `docker run -d --name cmd-test-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16-alpine`
  e Redis em 56379; crie os papéis como no passo "Papéis do banco de teste" do `ci.yml` e exporte
  `TEST_DATABASE_*_URL` / `TEST_REDIS_URL` apontando para essas portas.
- `cd apps/api && npx vitest run <arquivo>`; a suíte toda leva uns 20 minutos.
- Telas: banco `comandou` no mesmo contêiner, `node apps/api/dist/database/migrate-cli.js`,
  `platform-admin-cli.js --bootstrap` e um Super Admin de teste com `PLATFORM_ADMIN_PASSWORD` e
  `PLATFORM_ADMIN_TOTP_SECRET`; `node apps/api/dist/main.js` e `npx vite --port 5173` em
  `apps/web`. Painel em `http://admin.comandou.localhost:5173`, site em `http://comandou.localhost:5173`.
- O código do autenticador sai de `apps/api/dist/platform/totp.js` (`totpCode(segredo, totpStep())`).

## Custo do estoque (fichas técnicas)

O custo do item do cardápio é sempre lido na hora (quantidade × `stock_items.avg_cost`); nunca
copie custo para o produto. Preparos são recalculados pelo gatilho `stock_items_cost_cascade`
(migração 0076). Qualquer código novo que mude `avg_cost` deve envolver a mudança com
`StockCostsService.before()` / `.after()` na mesma transação, para gravar o histórico
(`stock_cost_changes`) e avisar os gerentes. Guia: `docs/decisions/0014-custo-automatico-fichas.md`.

## Mexer no financeiro

- Recebível do caixa (`finance_settlements`) **não é** conta (`finance_entries`): a venda já entra
  pelos pagamentos; o recebível só diz quando e quanto cai na conta (taxa à parte). Não crie conta
  a receber para repasse de cartão: o DRE deixa fora (`sales_received`) para não contar duas vezes.
- Categoria nova de conta: acrescente em `FINANCE_CATEGORIES` (grupo do DRE + palavras) e um caso
  no `finance-plan.test.ts`.
- O papel `comandou_app` tem GRANT por coluna nas tabelas novas: `SELECT … FOR UPDATE` pede UPDATE
  na tabela e dá 500 (use `DELETE … RETURNING` ou trave a linha de outra tabela).
- Demonstração: `seed.ts` lança os caixas (`postCashSession`) e cria o extrato de exemplo; mudou a
  regra, rode `COMANDOU_DEMO=reset` e confira a aba Conciliação.

## Imprimir um pedaço da tela

Para imprimir algo de dentro de um `Modal` (recibo, comprovante), use `printDocument` de
`apps/web/src/lib/print-doc.ts` (iframe com folha A4 e CSS próprio). Não use `window.print()`
com `@media print` escondendo o resto: o `<dialog>` mora dentro do `#root`, então a folha sai em
branco. Bobina térmica: `browserPrint` em `features/ReceiptPreview.tsx`.

## Conversa de suporte e chamados

A conversa restaurante ↔ Comandou é `support-desk/` (API) + `features/chat/HelpTab.tsx` (aba
Suporte) + `platform/SupportPage.tsx` (Super Admin › Conversas). Chamados (`tickets/`) não têm
mais conversa própria: a mensagem de suporte leva `ticketId` (coluna `ticket_id`, migração 0079,
só chamado do mesmo restaurante) e volta com `ticket` (código, título, situação do cliente). A tela do chamado no restaurante
não mostra conversa: só o botão Falar no chat. Para
abrir o Suporte já citando um chamado: `talkAboutTicket(...)` de `features/chat/TeamChat.tsx`; no
painel, `/conversas?r=<restaurante>&chamado=<id>`. Guia: `docs/chamados.md`.

## Mandar e-mail de qualquer módulo

Injete `MailService` (módulo global). Dentro da sua transação: `mail.enqueue(c, {...})` (o
e-mail só existe se a transação valer) e, depois do COMMIT, `mail.deliver(id)`. Fora de
transação: `mail.send({...})`. Conteúdo com senha ou código: `sensitive: true` (fica cifrado e
é apagado ao sair). Remetente com o nome do restaurante: `from: { name }`. Nos testes, use
`test/mail-fake.ts` (troca a internet por uma função e liga o provedor Resend falso).

O **desenho** de todo e-mail sai de `apps/api/src/mail/templates/`: `shell(...)` + blocos do
`kit.ts` (botão, código, tabela, passos, aviso), uma função por e-mail em `emails.ts` e o exemplo
em `samples.ts` (vira prévia na aba Super Admin › E-mail › Modelos). Nunca monte HTML de e-mail
solto no módulo. O panda de cada assunto é PNG (`apps/web/public/email/panda-*.png`, gerado por
`node tools/email-pandas/render.mjs`); endereços com `siteUrlOf`/`tenantUrlOf` (`templates/urls.ts`).
Código de verificação: no começo do assunto e no preheader (copiável da notificação).
Avisos de teste grátis e cobrança: `billing/lifecycle-mail.service.ts` (uma vez só por
`platform_lifecycle_mails`). Esqueci minha senha: `auth/password-reset.service.ts` (equipe) e
`platform/platform-password-reset.service.ts` (Super Admin); tela `pages/ForgotPassword.tsx`.

## Ao terminar uma entrega, atualize

- `packages/shared/src/releases.ts` e as versões (acima);
- `README.md` (o que o sistema faz, documentação, estrutura) quando mudar algo que o cliente vê;
- o guia em `docs/` do assunto (e `docs/security.md` se mexer em proteção);
- `comandou-seguranca` quando mexer em rota, login, upload, link externo, IA ou painel;
- **estas skills**: `comandou-design` (padrão visual e exceções) e esta (mapa, regras, como
  testar). Skill desatualizada ensina o próximo a errar.
