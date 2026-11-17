# E-mail do Comandou (Super Admin › E-mail)

O Comandou manda os próprios e-mails, sem n8n, pelo **Resend**. A aba E-mail tem só duas partes:
**Resend** (chave, remetente e e-mail de teste) e **Envios** (o histórico, com reenviar e cancelar).

| E-mail do sistema | Quando sai |
| --- | --- |
| Boas-vindas do teste grátis | O restaurante criado pelo site fica pronto (leva o login e a senha) |
| Código de nova senha do cliente | O cliente do cardápio online pede "Esqueci minha senha" e a loja não tem WhatsApp conectado |
| Contrato para assinar, avisos e via final | Super Admin › Restaurante › Contrato |

Tudo entra numa **fila de saída** (`mail_outbox`) na mesma transação de quem pediu e sai na hora.
Se o Resend estiver fora, o e-mail fica na fila e é tentado de novo sozinho (1 min, 5 min,
15 min, 1 h e 3 h). E-mail com senha ou código fica **cifrado** na fila e é apagado assim que sai.
Os envios aparecem em **E-mail › Envios**, com o erro de cada um e o botão de reenviar.

```
Comandou ──► fila (mail_outbox) ──► Resend ──► cliente
```

## 1. Configurar o Resend (grátis até 3.000 e-mails por mês)

1. Crie a conta em [resend.com](https://resend.com) e adicione o domínio em *Domains*.
2. O Resend mostra os registros (DKIM, SPF e MX de retorno). Crie-os no DNS (na Cloudflare,
   **sem a nuvem laranja**, só DNS). Espere o domínio ficar *Verified*.
3. Crie uma API Key com permissão **Sending access**.
4. No Comandou: Super Admin › E-mail › **Resend**: ligue "Enviar e-mails pelo Resend", cole a
   chave, informe o remetente (ex.: `nao-responda@comandou.com`, do domínio verificado) e salve.
5. Use **Enviar teste** para conferir.

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
| "O envio de e-mail não está configurado" | Super Admin › E-mail › Resend: ligue, cole a chave e o remetente |
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
  ficam em `apps/api/src/platform/site/welcome-email.ts`. Se o envio falhar, o restaurante é
  criado mesmo assim e a tela final mostra o motivo.
- Testes: `apps/api/src/mail/mail-lib.test.ts` e `apps/api/test/mail.e2e.test.ts` (o Resend é
  trocado por `test/mail-fake.ts`).
