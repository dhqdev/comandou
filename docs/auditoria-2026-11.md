# Auditoria de novembro de 2026 (0.141.0)

Revisão de erros, segurança e processos sobre a versão 0.140.0, feita no código, na
configuração, nas dependências e rodando o sistema (testes automáticos e as telas no navegador).
Não substitui um teste de invasão por terceiros (continua recomendado, ver [security.md](security.md)).

## Como foi feito

| Frente | O que foi conferido |
| --- | --- |
| Rotas da API | As 77 controladoras: cada rota sem `@Public()` passa por sessão + permissão; as públicas e as do painel (`admin.<domínio>`) têm guarda própria. Toda rota pública que grava tem limite por minuto (da rota ou o geral). |
| Webhooks | Asaas (token comparado em tempo constante), PagBank (só diz qual pedido mudou; a situação é consultada no PagBank), WhatsApp interno (token), e o novo recebimento de e-mail (HMAC com prazo de 5 min). |
| Chamadas para fora | Toda URL informada por quem usa o sistema passa por `safeFetch` (bloqueia rede interna). As únicas exceções eram os webhooks do n8n: removidos (A2). |
| Dinheiro | Preço e opções do pedido online vêm sempre do banco; pagamento, estorno e caixa com chave de idempotência e travas na ordem certa (coberto por `operations.e2e`). |
| Contas | Login do restaurante, do cliente e do painel com bloqueio por conta; código de nova senha de uso único, com tentativas contadas e prazo. |
| Trabalhos de fundo | Fila de nota fiscal, WhatsApp, backups, limpeza e testes vencidos: todos tratam o erro do próprio trabalho, e `main.ts` registra promessa sem tratamento em vez de derrubar a API. |
| Infraestrutura | Nginx (CSP, HSTS, molduras), Traefik (sem limite de corpo que barre o e-mail de 25 MB), CrowdSec (as rotas `/api/` não contam como ataque). |
| Dependências | `pnpm audit --prod --audit-level high`: nenhuma vulnerabilidade conhecida, incluindo as novas (`nodemailer`, `postal-mime`). |
| Testes | API: 86 arquivos e 746 testes passando, 28 pulados aqui porque precisam dos programas do Postgres instalados no computador (rodam no CI; o único que falhava era do Windows, ver A5). Web: 46 arquivos e 195 testes. Pacote compartilhado: 105 testes. |

## Achados corrigidos nesta versão

| # | Achado | Tipo | Gravidade | O que foi feito |
| --- | --- | --- | --- | --- |
| A1 | **E-mail de boas-vindas do teste se perdia.** `deliverPending` apagava a senha guardada antes de chamar o n8n; se o n8n estivesse fora, o cliente nunca recebia o login e não havia nova tentativa. | Processo | Alta | Envio próprio com fila: a senha sai de `pending_enc` e entra cifrada na fila na mesma transação, com novas tentativas (1 min, 5 min, 15 min, 1 h, 3 h). |
| A2 | **Webhooks do n8n.** O painel aceitava qualquer URL e a API a chamava sem a proteção de rede interna (dava para apontar para serviços internos do servidor). A senha inicial e o código de nova senha iam em texto no corpo para outro sistema e ficavam no histórico de execuções do n8n. | Segurança | Média | n8n desligado de vez. O e-mail sai direto pelo provedor (Cloudflare, Resend ou SMTP); conteúdo com senha ou código fica cifrado na fila e é apagado assim que sai. |
| A3 | **Contrato com o n8n fora do ar.** O aviso de assinatura falhava sem nova tentativa visível. | Processo | Média | Envio pela fila. Quando o link novo não vale (envio recusado), o e-mail é cancelado para não sair depois com um link vencido; a tela Envios mostra o erro e reenviar. |
| A4 | **Dois cadastros simultâneos com o mesmo e-mail** (dois cliques, duas abas) passavam juntos pela conferência de "já existe" e criavam dois restaurantes de teste. | Processo | Baixa | Trava no banco por e-mail durante a criação (vale entre réplicas). Teste em `site.e2e.test.ts`. |
| A5 | Teste `demo.int.test.ts` falhava no Windows (criar link de pasta exige administrador). | Desenvolvimento | Baixa | Usa link de pasta (junction) e, se não puder, copia. |

## Riscos que continuam (decisão do dono)

| # | Risco | Recomendação |
| --- | --- | --- |
| R1 | **Excluir restaurante** (0.138.0) é uma confirmação só, sem backup por padrão e sem o código do autenticador. Uma sessão do painel aberta num aparelho perdido apaga um cliente sem volta. | Pedir o código do autenticador na exclusão (o painel já tem `confirmCode`, usado para assinar contrato) e deixar "Guardar um backup final" marcado por padrão. |
| R2 | Senha do cliente do cardápio com mínimo de 6 caracteres. | Subir para 8 quando houver a próxima mudança na tela de conta. |
| R3 | Sem teste de invasão externo e sem programa de divulgação de falhas. | Contratar antes de abrir para muitos clientes. |
| R4 | WhatsApp por QR Code (Baileys) não é oficial; o número pode ser banido. | Já registrado em [risks.md](risks.md). |

## O que entrou junto (e foi auditado do mesmo jeito)

O módulo de e-mail novo ([email.md](email.md)) foi escrito com estas proteções e cada uma tem
teste em `apps/api/test/mail.e2e.test.ts` e `apps/api/src/mail/mail-lib.test.ts`:

- só o painel (`admin.<domínio>`, sessão do Super Admin) lê e grava; a API dos restaurantes não
  enxerga nenhuma tabela de e-mail;
- chaves do provedor e segredo do Worker cifrados (AES-256-GCM) e nunca devolvidos à tela nem à
  auditoria;
- recebimento só com assinatura HMAC válida, recente (5 min) e do mesmo corpo; entrega repetida
  não duplica;
- HTML recebido numa moldura isolada, sem scripts, com imagens de fora só quando pedido; anexos
  que não são imagem ou PDF sempre baixam;
- cabeçalhos sem quebra de linha (sem injeção de destinatário);
- resposta automática nunca para listas, robôs ou outra resposta automática;
- agendamento público com trava por página (dois visitantes não ficam com o mesmo horário),
  limite por IP e por e-mail e campo-armadilha para robôs.
