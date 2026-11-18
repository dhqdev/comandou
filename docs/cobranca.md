# Cobrança da assinatura (Asaas)

A mensalidade de cada restaurante é cobrada pela conta do Asaas da Comandou: boleto, Pix ou
cartão, à escolha do cliente na hora de pagar. Este documento reúne as regras que o sistema
aplica sozinho.

## A regra

1. **Teste grátis.** Restaurante novo começa no teste do plano (padrão: **7 dias**).
2. **Fatura antes do fim.** A fatura do próximo período sai alguns dias antes do fim do acesso
   (padrão: 5) e vence no último dia liberado. O Asaas manda o aviso por e-mail, e o sistema mostra
   o aviso no topo de todas as telas.
3. **Pagou, +30 dias.** Cada pagamento confirmado libera mais 30 dias, contados do fim do período
   anterior. Se o pagamento chegou depois do fim, os 30 dias contam do dia do pagamento. O mesmo
   pagamento nunca soma duas vezes.
4. **Não pagou, bloqueia.** Terminado o período sem pagamento (mais a tolerância configurada,
   padrão 0 dia), o sistema é **bloqueado automaticamente**: a equipe ainda entra, consulta tudo e
   paga em **Assinatura**, mas nenhuma gravação passa (pedidos no sistema e na loja online, vendas,
   cadastros). A API responde `403` com `code: "billing_blocked"`. Nada é apagado.
5. **Pagou, libera na hora.** O webhook do Asaas avisa o pagamento e o bloqueio sai no mesmo
   instante (Pix e cartão em minutos; boleto quando o banco compensa).
6. **Subir de plano.** O administrador do restaurante sobe para um plano mais caro em
   **Assinatura**. O plano novo vale na hora (limites maiores já) e a diferença proporcional aos
   dias que faltam vira uma fatura à parte, com vencimento curto (padrão: 3 dias). Durante o teste
   não há cobrança. Abaixo de R$ 5,00 (mínimo do Asaas) a troca sai sem custo. A mensalidade do
   próximo período que ainda estiver aberta é refeita com o preço novo.
7. **Descer de plano.** Também em **Assinatura**, pelo administrador. No teste grátis vale na
   hora; com mensalidade, fica agendado e vale quando começa o próximo período (a mensalidade
   desse período já sai com o preço menor). Sem cobrança nem devolução. Dá para desfazer até a
   data. Plano sem mensalidade só pelo suporte.
8. **Contrato anual.** O contrato vale 12 meses e é reassinado todo ano. O painel avisa a
   renovação 30 dias antes; o botão "Gerar contrato" já começa o novo no dia seguinte ao fim do
   atual. Vencido sem o novo assinado, o sistema bloqueia depois da tolerância (padrão 15 dias),
   do mesmo jeito que a falta de pagamento, e libera assim que o contrato novo é assinado.

## Modo de cobrança por restaurante

- **Automática (Asaas):** tudo acima.
- **Manual:** sem faturas nem bloqueio por pagamento (cliente que paga por fora, demonstração).
  O bloqueio por contrato vencido vale para os dois modos.

Ao ligar a cobrança no painel, toda assinatura **nova** nasce automática. As que já existiam
continuam manuais até alguém ligar na aba Assinatura do restaurante.

## Forma de pagamento (tela Assinatura)

- **Pix** (padrão) ou **boleto**: a fatura sai sozinha antes do fim, o Asaas manda por e-mail e o
  Pix/linha digitável aparecem na tela Assinatura. A cobrança no Asaas é sempre "o cliente escolhe"
  (Pix, boleto ou cartão); a preferência só muda o que a tela mostra primeiro.
- **Cartão automático**: o administrador cadastra o cartão; os dados vão direto ao Asaas
  (`/creditCard/tokenize`) e aqui fica só o token **cifrado** (INTEGRATIONS_KEY), a bandeira e o
  final (tabela `billing_cards`, só a plataforma lê). No ciclo, toda fatura em aberto que vence
  hoje (ou já venceu) é paga com o token (`/payments/{id}/payWithCreditCard`); a diferença de
  troca de plano sai na hora. Recusou: o motivo fica na fatura, o restaurante vê o aviso, e o
  ciclo tenta de novo uma vez por dia, até 3 vezes. Pix e boleto seguem valendo.
- Para ligar: peça ao Asaas para liberar a **tokenização de cartão** na conta e marque
  **Liberar cartão automático** em Super Admin → Cobrança. Sem isso, a opção aparece como
  "Em breve".

## Página de preços (/precos)

Pública, sem login, em `www.<domínio>/precos` (e em qualquer endereço de restaurante). Lê
`GET /api/v1/public/plans`: planos **ativos** com **Mostrar na página de preços** marcado, na
ordem escolhida. Frase, destaques e "Mais escolhido" vêm de Super Admin → Planos; a tabela de
comparação usa preço, teste, limites e recursos. O botão "Falar com a gente" usa o contato de
vendas de Super Admin → Cobrança (número vira WhatsApp). No endereço do restaurante, o botão do
plano leva para Assinatura já com a troca aberta.

## Configuração (Super Admin → Cobrança)

1. No Asaas: Integrações → Chaves de API. Copie a chave do ambiente (sandbox ou produção).
2. No painel: escolha o ambiente, cole a chave, ajuste os prazos e ligue a cobrança. A chave é
   cifrada com a `INTEGRATIONS_KEY` e nunca volta para o navegador.
3. **Testar conexão** mostra o nome da conta e o saldo.
4. **Cadastrar webhook no Asaas** cria o webhook apontando para
   `https://admin.<domínio>/api/v1/platform/billing/asaas/webhook`, com um token gerado pelo
   sistema (cabeçalho `asaas-access-token`). Para cadastrar à mão, **Ver dados do webhook** mostra
   endereço e token (fica na auditoria). O e-mail de aviso vem de Contrato → Configurar.
5. O cadastro do cliente (aba Cadastro) precisa de razão social e CPF/CNPJ: é com eles que o
   cliente é criado no Asaas na primeira cobrança.

## Como funciona por dentro

- O ciclo roda a cada `BILLING_INTERVAL_MINUTES` (padrão 30; `0` desliga), uma réplica por vez
  (trava no banco). Gera as faturas na hora certa, reenvia ao Asaas as que falharam, marca as
  vencidas e aplica ou tira o bloqueio. **Rodar ciclo agora** faz o mesmo na hora.
- A fatura é gravada primeiro no banco (uma por período, índice único) e depois enviada ao Asaas
  com `externalReference` = id da fatura. Falha de rede fica na fatura e o ciclo tenta de novo.
- O webhook confere o token em tempo constante, guarda cada evento uma vez só e **consulta o
  Asaas** para saber a situação real da cobrança (o corpo do aviso só diz qual é).
- **Sem depender só do webhook.** A cada ciclo, antes de aplicar bloqueios, o sistema consulta no
  Asaas as faturas em aberto já enviadas: pagamento cujo aviso se perdeu (servidor fora do ar, fila
  do webhook pausada) libera do mesmo jeito. Aviso que chega antes de o id da cobrança ser gravado
  é ligado à fatura pelo `externalReference`.
- **Sem cobrança em dobro.** Antes de criar uma cobrança, o sistema procura no Asaas uma já criada
  com o mesmo `externalReference` (envio anterior que caiu antes de gravar a resposta) e a
  reaproveita.
- **Estorno desfaz.** Estorno, chargeback, "recebido em dinheiro" desfeito ou cobrança apagada
  depois de paga tiram os 30 dias que aquela mensalidade liberou (auditoria
  `platform.billing_payment_reverted`); se o pagamento for confirmado de novo, os dias voltam.
  Baixa manual só é desfeita por estorno.
- O bloqueio é lido por um guard global (`BillingGuard`) com cache de 30 segundos por réplica.
  Rotas liberadas durante o bloqueio: entrar e sair (`/auth`) e as da assinatura (`/subscription`).
- No painel, cada fatura tem **Conferir** (consulta o Asaas), **Baixar** (pago fora do Asaas; dá baixa também no Asaas, para o cliente não pagar de novo) e
  **Cancelar** (cancela também no Asaas). Tudo vai para a auditoria.
- Mudar o **Período pago até** à mão (aba Assinatura) cancela as mensalidades em aberto cujo
  período inteiro (início + 30 dias) já fica dentro do novo prazo, também no Asaas (auditoria
  `platform.billing_invoice_cancelled` com `reason: covered_by_paid_period`). Prazo que cobre só
  parte do período deixa a fatura em aberto.
- Os limites do plano (equipe, produtos, pedidos no mês) são conferidos com uma trava por
  restaurante: duas criações ao mesmo tempo não passam juntas do limite.

## Testes

`apps/api/test/billing.e2e.test.ts` usa um Asaas falso (servidor HTTP local) e cobre: chave
cifrada e nunca devolvida, webhook cadastrado com o token, fatura 5 dias antes do fim do teste
(sem duplicar), Pix e boleto só do próprio restaurante, webhook sem token recusado, pagamento
soma 30 dias uma vez só, bloqueio automático (gravação recusada, leitura e login liberados) e
liberação ao pagar, troca de plano só pelo administrador com a diferença proporcional, baixa
manual e bloqueio por contrato vencido. `packages/shared/src/billing.test.ts` cobre as contas.

## Plano único e orçamento (0.114.0)

- **Um plano só por enquanto:** "Comandou", **R$ 400,00 fixos por mês**, sem limite de equipe,
  produtos ou pedidos, com nota fiscal, WhatsApp e domínio próprio, 7 dias de teste. A migração
  0065 cria o plano e inativa Essencial, Profissional e Premium (somem de `/precos` e da troca de
  plano). Quem já assinava um deles continua no plano antigo até alguém trocar na aba Assinatura
  do restaurante: nenhuma mensalidade muda sozinha.
- **Nota fiscal (Focus NFe):** o Comandou é revenda da Focus (decisão 0012). Por padrão o custo é
  **repassado à parte**, pelo preço público do plano Retail da Focus: R$ 62,90 por mês por CNPJ
  com 500 NFC-e e 100 NF-e incluídas; acima disso R$ 0,055 por NFC-e e R$ 0,16 por NF-e. Esses
  valores (e a opção "incluída na mensalidade") ficam em Super Admin → **Orçamento → Valores
  padrão** e entram no orçamento e na cláusula da NFC-e dos contratos novos. A cobrança do
  repasse ainda é feita com uma fatura avulsa na aba Assinatura do restaurante.
- **Orçamento em PDF:** Super Admin → **Orçamento**. Preencha o cliente, a mensalidade, a
  implantação e a estimativa de notas por mês; o resumo mostra o total na hora e **Gerar PDF**
  salva o orçamento (número `ORC-AAAA-NNNN`, conteúdo congelado em `platform_quotes`) e baixa o
  arquivo. A lista "Orçamentos gerados" baixa de novo. O PDF traz o que está incluído, a nota
  fiscal com a estimativa, a taxa do pagamento pelo app (se ligado), os custos de terceiros
  (certificado A1, WhatsApp, domínio, equipamentos, editáveis em Valores padrão) e as condições
  do contrato (teste, pagamento, 12 meses, reajuste, cancelamento, SLA e suporte).
