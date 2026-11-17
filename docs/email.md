# E-mail do Comandou (Super Admin › E-mail)

O Comandou tem o próprio e-mail, sem n8n: caixas do seu domínio (`contato@`, `vendas@`...),
agenda com convites, página pública para marcar horário e todos os e-mails do sistema saindo
pela mesma fila:

| E-mail do sistema | Quando sai |
| --- | --- |
| Boas-vindas do teste grátis | O restaurante criado pelo site fica pronto (leva o login e a senha) |
| Código de nova senha do cliente | O cliente do cardápio online pede "Esqueci minha senha" e a loja não tem WhatsApp conectado |
| Contrato para assinar, avisos e via final | Super Admin › Restaurante › Contrato |
| Convites e cancelamentos da agenda | Evento com convidados ou horário marcado na página de agendamento |

Tudo entra numa **fila de saída** (`mail_outbox`) na mesma transação de quem pediu e sai na hora.
Se o provedor estiver fora, o e-mail fica na fila e é tentado de novo sozinho (1 min, 5 min,
15 min, 1 h e 3 h). E-mail com senha ou código fica **cifrado** na fila e é apagado assim que sai.
Os envios aparecem em **E-mail › Envios**, com o erro de cada um e o botão de reenviar.

```
                       Envio (escolha um)                       Recebimento
Comandou ──► fila ──►  Cloudflare Email Sending  ──► cliente    Remetente ──► MX da Cloudflare
                       Resend                                   (Email Routing) ──► Worker
                       SMTP (qualquer servidor)                 comandou-email ──► Comandou
```

## 1. Antes de começar

- O domínio (ex.: `comandou.com`) precisa estar na **Cloudflare** (DNS gerenciado por ela).
- A instalação precisa da `INTEGRATIONS_KEY` (o instalador já cria): é ela que cifra as chaves
  do provedor e o segredo do Worker no banco.
- O painel (`admin.<domínio>`) precisa estar no ar com HTTPS: o Worker entrega os e-mails lá.

## 2. Envio

Escolha **um** provedor em Super Admin › E-mail › Configurar. Depois de salvar, use
**Enviar teste** para conferir.

### Cloudflare Email Sending (recomendado quando o domínio já está na Cloudflare)

1. No painel da Cloudflare: **Compute › Email Service › Email Sending** e ative o envio no
   domínio. A Cloudflare cria os registros SPF e DKIM sozinha.
2. Crie um **API Token** em *My Profile › API Tokens › Create Token › Custom token* com a
   permissão **Account › Email Sending › Edit** (só a sua conta).
3. Copie o **Account ID** (aparece na página inicial da conta, à direita).
4. No Comandou: provedor **Cloudflare**, Account ID, token e o remetente
   (ex.: `nao-responda@comandou.com`, um endereço do domínio ativado).

> O envio pela Cloudflare exige o plano Workers Paid (US$ 5/mês). Sem ele, use o Resend.

### Resend (grátis até 3.000 e-mails por mês)

1. Crie a conta em [resend.com](https://resend.com) e adicione o domínio em *Domains*.
2. O Resend mostra os registros (DKIM, SPF e MX de retorno). Crie-os no DNS da Cloudflare,
   **sem a nuvem laranja** (só DNS). Espere o domínio ficar *Verified*.
3. Crie uma API Key com permissão **Sending access** e cole no Comandou (provedor **Resend**).

### SMTP (qualquer servidor)

Servidor, porta, usuário e senha do seu provedor (Amazon SES, Mailgun, Zoho, Google Workspace...).
Porta **587** com "TLS desde o início" desligado (STARTTLS) ou **465** com ele ligado.

### DMARC (recomendado em qualquer provedor)

Crie um TXT em `_dmarc.<domínio>`:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc@seudominio.com.br
```

E-mail › Domínios › **Conferir DNS** mostra o que já está certo (MX, SPF e DMARC).

## 3. Recebimento (caixas de e-mail)

O e-mail que chega fica na Cloudflare (Email Routing) e um Worker pequeno, deste repositório,
entrega cada mensagem ao Comandou com uma assinatura.

1. **Ative o Email Routing** no domínio: Cloudflare › *Compute › Email Service › Email Routing* ›
   *Onboard Domain*. Ela cria os registros MX (`route1/2/3.mx.cloudflare.net`) e o SPF.
   > Se o domínio já recebe e-mail em outro lugar (Google, Microsoft), ativar o Email Routing
   > troca o MX: o outro serviço para de receber. Use um subdomínio (ex.: `mail.comandou.com`)
   > se quiser manter os dois.
2. **Crie o segredo**: Comandou › E-mail › Configurar › Recebimento › **Gerar segredo**. Ele
   aparece uma vez só; gerar de novo invalida o anterior.
3. **Publique o Worker** (precisa do Node 22 no seu computador):

   ```bash
   cd infrastructure/cloudflare/email-worker
   npm install
   npx wrangler login
   npx wrangler secret put COMANDOU_URL      # https://admin.seudominio.com.br
   npx wrangler secret put INBOUND_SECRET    # o segredo do passo 2
   npm run deploy
   ```

4. **Roteie para o Worker**: Email Routing › *Routing rules* › **Catch-all address** › ação
   *Send to a Worker* › `comandou-email` › Ativar. (Ou uma regra por endereço, se preferir.)
5. **Crie o domínio e as caixas** no Comandou: E-mail › Domínios › adicionar
   `seudominio.com.br` e depois as caixas (`contato`, `vendas`...). Uma caixa pode ser marcada
   como **"recebe o que não tem caixa"** (catch-all).
6. Mande um e-mail de outro lugar para `contato@seudominio.com.br`: ele aparece na Entrada.

O que acontece com cada mensagem:

| Situação | Resposta do Comandou | O remetente vê |
| --- | --- | --- |
| Caixa existe | guarda (e aplica as regras) | nada (entregue) |
| Endereço sem caixa e sem catch-all | recusa | devolução "caixa não existe" |
| Regra "Recusar" | recusa | devolução |
| Comandou fora do ar | — (o Worker falha) | nada: o servidor dele tenta de novo depois |
| Caixa com "encaminhar cópia" | guarda e manda o Worker encaminhar | nada |

Encaminhar cópia só funciona para endereços verificados em Email Routing › *Destination addresses*.

## 4. Caixas, regras e contatos

- **Entrada, Enviados, Rascunhos, Arquivo, Spam e Lixeira**, com busca, estrela e conversas
  (a resposta cai na mesma conversa pelo `In-Reply-To`).
- **Escrever e responder** com anexos (até 15 MB por e-mail) e assinatura da caixa.
- **Resposta automática** (férias, fora do horário): uma por remetente a cada 24 h, nunca para
  listas, robôs ou outra resposta automática.
- **Regras**: remetente, destinatário ou assunto → arquivar, spam, lixeira, estrela, marcar como
  lida ou recusar.
- **Contatos** guardados sozinhos ao enviar e receber, editáveis.
- **Segurança da leitura**: o HTML recebido abre numa moldura isolada, sem scripts; imagens de
  fora só carregam quando você clica em *Mostrar imagens* (senão o remetente saberia que você
  abriu). Anexos fora de imagem e PDF sempre baixam, nunca abrem no navegador. O SPF, DKIM e
  DMARC informados pela Cloudflare aparecem na mensagem.

## 5. Agenda e agendamento

- **Agenda**: eventos com horário ou dia inteiro, repetição (diária, semanal, mensal, anual) e
  convidados. Convidado recebe o convite com o arquivo `.ics` (Gmail, Outlook e Apple Mail
  mostram os botões *Sim/Não/Talvez*); a resposta volta para a caixa e atualiza o evento.
  Cancelar o evento manda o cancelamento.
- **Página de agendamento** (`https://<domínio>/agendar/<endereço>`): duração, folga entre
  horários, antecedência mínima, até quantos dias à frente e as janelas de cada dia da semana.
  A página mostra só horários livres na agenda; dois visitantes nunca ficam com o mesmo horário.
  Quem marca recebe a confirmação com o convite e a caixa escolhida recebe o aviso.

## 6. Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "O envio de e-mail não está configurado" | Super Admin › E-mail › Configurar: provedor, chave e remetente |
| Cloudflare `E_SENDER_NOT_VERIFIED` / `E_SENDER_DOMAIN_NOT_AVAILABLE` | Ative o Email Sending no domínio do remetente |
| Resend `403` / domínio não verificado | Confira os registros do Resend no DNS (sem a nuvem laranja) |
| E-mail cai no spam | Crie o DMARC; confira SPF e DKIM em *Conferir DNS* |
| Nada chega na Entrada | Worker publicado? Rota catch-all ativa? `npx wrangler tail` mostra os erros. `403` = segredo diferente do painel (gere de novo e rode `wrangler secret put INBOUND_SECRET`) |
| E-mail ficou "Na fila" | Veja o erro em E-mail › Envios; ele sai sozinho quando o provedor voltar |

## Para quem mantém o código

- `apps/api/src/mail/`: `mail.service.ts` (fila e provedores), `mailbox.service.ts` (caixas e
  recebimento), `calendar.service.ts` (agenda e agendamento), `inbound.ts` (assinatura e regras),
  `ics.ts` (convites), `html.ts` (texto ⇄ HTML e moldura segura).
- Migração `0075_email_proprio.sql`. Só o papel `comandou_platform` lê e grava essas tabelas.
- Mandar e-mail de qualquer módulo: injete `MailService` e chame `enqueue(c, ...)` dentro da sua
  transação e `deliver(id)` depois do COMMIT (ou `send(...)` fora de transação). Conteúdo com
  senha ou código: `sensitive: true`.
- Testes: `apps/api/src/mail/mail-lib.test.ts` e `apps/api/test/mail.e2e.test.ts` (o provedor é
  trocado por `test/mail-fake.ts`).
- Inspiração de recursos: [Mailflare](https://github.com/hieunc229/mailflare) (licença AGPL-3.0).
  Nenhum código dele foi copiado; o Comandou implementa os recursos do zero no próprio stack.
