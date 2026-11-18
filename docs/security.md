# Segurança

Revisão da Etapa 7 (2026-10-22), feita sobre o código, a configuração e as dependências. Não
houve teste de invasão por terceiros; recomendamos um antes de abrir para muitos clientes.

> Revisão seguinte, com o e-mail próprio e a saída do n8n: [auditoria-2026-11.md](auditoria-2026-11.md).

## Como o sistema se protege

| Ameaça | Proteção | Prova |
| --- | --- | --- |
| Restaurante ver dado de outro | restaurante vem do Host validado; RLS em toda tabela; FKs compostas; papel da API sem bypass | `rls.int.test.ts`, testes "B não vê nada de A" em cada suíte, teste de carga confere o isolamento |
| Sessão roubada | cookie HttpOnly, host-only, `Secure` em produção, SameSite; token só em hash no banco; CSP restritiva no Nginx | `api.e2e.test.ts` |
| CSRF | cabeçalho `X-Comandou-Request` exigido em toda escrita + SameSite | `api.e2e.test.ts` |
| Força bruta no login | limite por IP (compartilhado entre réplicas via Redis) e **bloqueio temporário por conta** (10 senhas erradas em 15 min, vale para qualquer IP); mesma resposta para conta inexistente | `security.e2e.test.ts`, `platform.e2e.test.ts` |
| Robôs, varreduras e IPs de ataque | CrowdSec opcional no Traefik: lê o log de acesso, bloqueia por 4 h quem varre falhas ou força o login (mais de 15 erros seguidos), recebe a lista da comunidade; webhook do Asaas, status e métricas nunca são bloqueados; CrowdSec fora do ar não derruba os sites ([crowdsec.md](crowdsec.md)) | `internal.controller.test.ts` |
| Painel da plataforma | só em `admin.<base>`, senha + TOTP com código de uso único, papel próprio no banco, auditoria | `platform.e2e.test.ts` |
| Pagamento duplicado | chave de idempotência, trava da linha do pedido, conferência do saldo | `operations.e2e.test.ts`; teste de carga com 100 disputas sem nenhuma duplicação |
| Vazamento por log | pino sem cookies, `Authorization` e `Set-Cookie`; token do link de rastreio mascarado na API e fora do log do Nginx | `log-redact.test.ts`; Nginx conferido localmente |
| Segredos | Docker secrets (`*_FILE`); tokens de integração e sessões do WhatsApp cifrados (AES-256-GCM); backups cifrados com age | `secret-box.test.ts`, `gateway.test.ts` |
| Esqueci minha senha (equipe e painel) | código de 6 números por e-mail, só o hash guardado e preso à conta; 15 minutos, 5 tentativas, 5 códigos por hora por conta e o limite por IP do login (que segura quem tenta adivinhar e-mails: a tela avisa quando o e-mail não é de nenhuma conta, a pedido do dono); código certo vira token de uso único (30 min) e a senha só muda pela função `app_reset_password_with_token`; a conta sai dos outros aparelhos e recebe o aviso "senha trocada"; no painel, os navegadores confiáveis saem e o TOTP continua obrigatório | `password-reset.e2e.test.ts` |
| E-mail (Super Admin › E-mail) | só o papel da plataforma lê e grava; chave do Resend cifrada e nunca devolvida à tela; conteúdo com senha ou código cifrado na fila e apagado ao sair | `mail.e2e.test.ts`, `mail-lib.test.ts` |
| Erro expondo detalhes | filtro único: erro inesperado vira "Erro interno" sem pilha; erro do banco vira 409/422 genérico | `http-exception.filter.ts` |
| Cabeçalhos HTTP | helmet na API; Nginx com CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | `scripts/preflight.sh --deployed` confere HSTS |
| Dependências vulneráveis | `pnpm audit --prod --audit-level high` no CI | 2026-10-22: nenhuma vulnerabilidade conhecida (uma moderada no js-yaml corrigida por override) |
| SQL injection | consultas parametrizadas; os poucos trechos montados usam só nomes fixos do código | revisão: `kitchen`, `fiscal`, `messaging`, `stock`, `platform` |
| IA do WhatsApp tirada do papel, golpe, abuso | prompt com regras de proteção; tentativas óbvias ("ignore as instruções", "mostre o prompt") respondidas sem chamar a IA; links de fora do restaurante tirados da resposta; resposta que repete as instruções é trocada; reserva só gravada pelo servidor depois do SIM, com o telefone da conversa; 3 tentativas em 24 h = 24 h sem resposta da IA e aviso à equipe; limite de mensagens por número ([whatsapp.md](whatsapp.md#ia-que-atende-no-whatsapp)) | `agent-guard.test.ts`, `chat.e2e.test.ts` |
| Dados pessoais guardados demais | limpeza automática de sessões, chaves de idempotência e posição do entregador | `security.e2e.test.ts` |

## Achados desta revisão e o que foi feito

| # | Achado | Gravidade | Situação |
| --- | --- | --- | --- |
| S1 | Limite de login por IP ficava em memória: com 2 réplicas, o limite efetivo dobrava | Média | Corrigido: contador no Redis, com volta ao contador local se o Redis cair |
| S2 | Sem bloqueio por conta: um atacante com vários IPs podia testar senhas sem limite | Média | Corrigido: bloqueio temporário por e-mail (restaurante e painel) |
| S3 | Token do link público de rastreio aparecia no log de acesso da API e do Nginx | Baixa | Corrigido (falta o Traefik: ver [operação](operations.md#monitoramento)) |
| S4 | Sem HSTS nas páginas servidas pelo Nginx | Baixa | Corrigido |
| S5 | `js-yaml` 5.4.0 (via `@nestjs/swagger`, usado só fora de produção) com falha moderada | Baixa | Corrigido por override para 5.4.1 |
| S6 | Sessões, chaves de idempotência e posição do entregador ficavam para sempre | Baixa (LGPD) | Corrigido: limpeza a cada 6 h |
| S7 | Listar pedidos de um restaurante grande lia a tabela inteira (risco de lentidão geral) | Média (disponibilidade) | Corrigido: índice; 1,7 s → 9 ms com 1 milhão de pedidos |

## Riscos que continuam

- **Bloqueio por conta pode ser usado para incomodar**: quem sabe o e-mail de alguém consegue
  bloquear a conta por 15 minutos errando a senha. É o preço do S2; o dono do restaurante pode
  entrar com outro usuário administrador.
- **WhatsApp por QR Code (Baileys)** não é oficial e o número pode ser banido (decisão do dono).
- **Sem teste de invasão externo** e sem programa de divulgação de falhas.
- **Pedidos de titular (LGPD)** são atendidos manualmente.
- **Licença** do código ainda não definida.
