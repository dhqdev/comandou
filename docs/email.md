# E-mail do Comandou (Super Admin › E-mail)

O Comandou manda os próprios e-mails, sem n8n, pelo **Resend**. A aba E-mail tem três partes:
**Resend** (chave, remetente e e-mail de teste), **Modelos** (a prévia de cada e-mail no tamanho do
computador e do celular, o teste de cada um e a chave dos avisos automáticos) e **Envios** (o
histórico, com reenviar e cancelar).

| E-mail do sistema | Quando sai |
| --- | --- |
| Boas-vindas do teste grátis | O restaurante criado pelo site fica pronto (leva o login e a senha) |
| Código de nova senha do cliente | O cliente do cardápio online pede "Esqueci minha senha" e a loja não tem WhatsApp conectado |
| Código de nova senha da equipe e do Super Admin | "Esqueci minha senha" no painel, PDV, cozinha, entregas, garçom (com e-mail) ou Super Admin |
| Senha trocada | Logo depois de trocar a senha com o código (aviso de segurança) |
| Teste grátis acaba amanhã / terminou | Na véspera do fim do teste e quando ele acaba sem plano (avisos automáticos) |
| Mensalidade vence em breve / venceu / sistema pausado | 3 dias antes do vencimento, depois de vencer e quando a cobrança pausa o sistema (avisos automáticos) |
| Pagamento recebido | Até 2 dias depois da baixa da fatura (avisos automáticos) |
| Contrato para assinar, avisos e via final | Super Admin › Restaurante › Contrato |

Tudo entra numa **fila de saída** (`mail_outbox`) na mesma transação de quem pediu e sai na hora.
Se o Resend estiver fora, o e-mail fica na fila e é tentado de novo sozinho (1 min, 5 min,
15 min, 1 h e 3 h). E-mail com senha ou código fica **cifrado** na fila e é apagado assim que sai.
Os envios aparecem em **E-mail › Envios**, com o erro de cada um e o botão de reenviar.

```
Comandou ──► fila (mail_outbox) ──► Resend ──► cliente
```

## Esqueci minha senha (código por e-mail)

Em toda tela de entrada há o link **Esqueci minha senha**, em três passos: e-mail → código de 6
números → senha nova (`apps/web/src/pages/ForgotPassword.tsx`; abre direto com `/?nova-senha`).

- O código vem **no começo do assunto** (`482915 é o seu código do Comandou`) e na **linha de
  prévia** do e-mail: aparece na notificação do celular e na lista da caixa de entrada, dá para
  copiar sem abrir, e o iPhone e o Mac oferecem preencher sozinhos. No corpo ele fica numa caixa
  só, sem espaço no meio (dois toques copiam os 6 números).
- Confere o e-mail digitado: se não for de uma conta daquele restaurante (ou do Super Admin), a
  tela avisa embaixo do campo na hora (404) e nada sai. Quem entra só com PIN não tem e-mail e
  recebe o mesmo aviso.
- Vale **15 minutos**, aceita **5 tentativas**, no máximo **5 códigos por hora** por conta (o
  sexto pedido recebe 429 com o aviso) e o limite por aparelho do login. Código certo vira um
  token de uso único (30 minutos) para gravar a senha nova.
- Restaurante (`auth/password-reset.service.ts`, tabela `staff_password_resets` no banco do
  restaurante, função `app_reset_password_with_token`): a conta sai dos outros aparelhos, o
  bloqueio por senhas erradas zera e a pessoa já entra. Conta só de PIN não recebe código.
- Super Admin (`platform/platform-password-reset.service.ts`, tabela `platform_password_resets`):
  todas as sessões e os navegadores confiáveis saem, e o login continua pedindo o código do
  autenticador.
- Sem o Resend configurado, o pedido responde que é preciso falar com o administrador (equipe) ou
  usar o `platform-admin-cli` no servidor (Super Admin).

## Avisos automáticos de teste grátis e cobrança

`billing/lifecycle-mail.service.ts` roda a cada 30 minutos (uma réplica por vez) e manda, uma vez
só por restaurante, assunto e fatura ou dia (`platform_lifecycle_mails`): teste acaba amanhã
(2 a 26 horas antes), teste terminou (até 3 dias depois, sem pagamento), mensalidade vence (a
partir de 3 dias antes), venceu (até 7 dias depois; com o dia em que o sistema pausa), sistema
pausado e pagamento recebido (até 2 dias depois). Vai para o e-mail de cobrança do cadastro do
restaurante, senão para quem criou o teste pelo site, senão para o administrador. Liga e desliga
em **E-mail › Modelos** (`mail_settings.lifecycle_enabled`).

## Desenho dos e-mails

`apps/api/src/mail/templates/`: `kit.ts` (moldura e blocos: botão, código, tabela, passos, aviso,
valores grandes), `emails.ts` (cada e-mail, com assunto, HTML e texto) e `samples.ts` (os dados de
exemplo da aba Modelos). Tabelas e estilo na própria tag; o modo escuro vem de
`prefers-color-scheme` (Apple Mail, iOS, Outlook.com com `[data-ogsc]`). O panda de cada assunto é
um PNG em `apps/web/public/email/panda-*.png` (servido pelo site), desenhado por
`node tools/email-pandas/render.mjs`: e-mail não mostra SVG.

## 1. Configurar o Resend (grátis até 3.000 e-mails por mês)

1. Crie a conta em [resend.com](https://resend.com) e adicione o domínio em *Domains*.
2. O Resend mostra os registros (DKIM, SPF e MX de retorno). Crie-os no DNS (na Cloudflare,
   **sem a nuvem laranja**, só DNS). Espere o domínio ficar *Verified*.
3. Crie uma API Key com permissão **Sending access**.
4. No Comandou: Super Admin › **Credenciais** › Resend: cole a chave e salve (a primeira chave já
   liga o envio).
5. Super Admin › E-mail › **Resend**: informe o remetente (ex.: `nao-responda@comandou.com`, do
   domínio verificado) e salve.
6. Use **Enviar teste** (em Credenciais) para conferir.

A instalação precisa da `INTEGRATIONS_KEY` (o instalador já cria): é ela que cifra a chave do
Resend no banco. A chave nunca volta para a tela; deixe o campo vazio para manter a salva.

### DMARC (recomendado)

Crie um TXT em `_dmarc.<domínio>`:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc@seudominio.com.br
```

## 2. Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "O envio de e-mail não está configurado" | Chave em Super Admin › Credenciais; ligue e ponha o remetente em Super Admin › E-mail › Resend |
| Resend `403` / domínio não verificado | Confira os registros do Resend no DNS (sem a nuvem laranja) |
| E-mail cai no spam | Crie o DMARC; confira SPF e DKIM no painel do Resend |
| E-mail ficou "Na fila" | Veja o erro em E-mail › Envios; ele sai sozinho quando o Resend voltar |

## O que saiu na versão 0.142

As caixas de e-mail do domínio, o recebimento pela Cloudflare (Email Routing + Worker), a agenda,
a página pública de agendamento (`/agendar/...`) e os provedores Cloudflare Email Sending e SMTP
foram retirados. As tabelas antigas (`mail_domains`, `mail_mailboxes`, `mail_messages`,
`mail_rules`, `mail_contacts`, `mail_events`, `mail_booking_pages`) ficaram no banco, sem uso,
porque as migrações são só aditivas; nada é apagado. Ao salvar a tela do Resend, as chaves
antigas da Cloudflare, do SMTP e do recebimento são apagadas. Se o Worker `comandou-email` foi
publicado na Cloudflare, ele pode ser removido lá (e a regra do Email Routing também).

## Para quem mantém o código

- `apps/api/src/mail/`: `mail.service.ts` (fila e entrega), `providers.ts` (chamada ao Resend),
  `mail-admin.service.ts` (tela: configuração, teste e envios), `address.ts` (endereços).
- Migração `0075_email_proprio.sql`. Só o papel `comandou_platform` lê e grava essas tabelas.
- Mandar e-mail de qualquer módulo: injete `MailService` e chame `enqueue(c, ...)` dentro da sua
  transação e `deliver(id)` depois do COMMIT (ou `send(...)` fora de transação). Conteúdo com
  senha ou código: `sensitive: true`.
- E-mails com senha: `trial.welcome` (teste criado pelo site) e `tenant.access` (restaurante
  criado em Super Admin › Restaurantes › Novo; desliga no passo Acesso do dono). Os dois moldes
  são `welcomeEmail` e `accessEmail`, em `apps/api/src/mail/templates/emails.ts`. Se o envio
  falhar, o restaurante é criado mesmo assim e a tela final mostra o motivo.
- E-mail novo: crie a função em `templates/emails.ts` usando `shell(...)` e os blocos do `kit.ts`,
  acrescente o exemplo em `samples.ts` (aparece na aba Modelos) e, se tiver código ou senha,
  `sensitive: true`.
- Testes: `apps/api/src/mail/mail-lib.test.ts`, `apps/api/src/mail/templates/emails.test.ts`,
  `apps/api/test/mail.e2e.test.ts` e `apps/api/test/password-reset.e2e.test.ts` (o Resend é
  trocado por `test/mail-fake.ts`).
