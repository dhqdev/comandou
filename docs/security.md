# Segurança

Revisão da Etapa 7 (2026-10-22), feita sobre o código, a configuração e as dependências. Não
houve teste de invasão por terceiros; recomendamos um antes de abrir para muitos clientes.

> Revisão seguinte, com o e-mail próprio e a saída do n8n: [auditoria-2026-11.md](auditoria-2026-11.md).
> Revisão com varredura automática de todas as rotas: [abaixo](#revisão-de-2026-11-18-0165).

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
| Erro expondo detalhes | filtro único: erro inesperado vira "Erro interno" sem pilha; erro do banco vira 409/422 genérico; corpo grande ou JSON quebrado vira 413/400 | `http-exception.filter.ts`, `security-sweep.e2e.test.ts` |
| Cabeçalhos HTTP | helmet na API, mais `Cache-Control: no-store` e `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` em toda resposta (`common/api-headers.ts`; a prévia do link libera só o próprio script pelo hash); Nginx com CSP (`object-src 'none'`), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | `security-sweep.e2e.test.ts`; `scripts/preflight.sh --deployed` confere HSTS |
| Dependências vulneráveis | `pnpm audit --prod --audit-level high` no CI | 2026-10-22: nenhuma vulnerabilidade conhecida (uma moderada no js-yaml corrigida por override) |
| SQL injection | consultas parametrizadas; os poucos trechos montados usam só nomes fixos do código | revisão: `kitchen`, `fiscal`, `messaging`, `stock`, `platform`; varredura com injeção em todo parâmetro de rota (`security-sweep.e2e.test.ts`) |
| Rota nova esquecida sem proteção | varredura descobre todas as rotas sozinha: sem sessão, outro restaurante, cada perfil, endereço errado e entradas hostis; lista revisada de rotas públicas, sem restaurante e sem CSRF | `security-sweep.e2e.test.ts` |
| Link que leva à rede interna (SSRF) | `safeFetch`: só http(s) nas portas 80/443, IP conferido **na hora de conectar** (lookup próprio do socket, sem segunda consulta de DNS), IPv6 com IPv4 dentro e faixas reservadas recusados, cada redirecionamento conferido, tamanho medido depois de descompactar | `safe-fetch.test.ts`, `chat.e2e.test.ts` |
| Senha fraca | mínimo de 8 (equipe e cliente) e 10 (painel); senha nova óbvia (lista de vazamentos, sequência, repetição, e-mail, telefone ou nome) recusada; quem já tem senha continua entrando | `packages/shared/src/security.test.ts` |
| Fórmula em planilha exportada | texto que começa com `=`, `+`, `-`, `@` ganha `'` na frente (`csvText`) | `security.test.ts`, `reports-insights.test.ts` |
| Excluir restaurante por engano ou com sessão roubada | código do autenticador sempre (mesmo em navegador confiável; código usado não repete), tentativa errada na auditoria, backup final marcado quando o backup está ligado | `platform.e2e.test.ts` |
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

## Revisão de 2026-11-18 (0.165)

Guiada pelo OWASP Top 10:2025, OWASP ASVS 5.0 e OWASP Top 10 para LLM, com a skill
`comandou-seguranca` (`.claude/skills/comandou-seguranca/`). Feita no código e rodando a API com
Postgres e Redis reais: a varredura `security-sweep.e2e.test.ts` mandou cerca de 6 mil
requisições pelas 671 rotas (sem login, outro restaurante, garçom, cozinha, entregador, painel,
site e entradas hostis).

| # | Achado | Gravidade | Situação |
| --- | --- | --- | --- |
| V1 | **SSRF por IPv6**: o Node escreve `[::ffff:169.254.169.254]` como `::ffff:a9fe:a9fe`, e a conferência de rede interna só reconhecia a forma com pontos. Um link assim passava como "site público" no cardápio por link, nas fotos por link e no **site com IA da página pública (sem login)**. Com IPv6 ligado no servidor, chegaria nos metadados da nuvem ou em serviços internos. | Alta | Corrigido: IPv6 lido grupo a grupo; IPv4 dentro do IPv6 (mapeado, compatível, NAT64, 6to4, Teredo) e faixas de documentação recusados |
| V2 | **DNS rebinding**: o DNS era consultado uma vez para conferir e outra pelo `fetch` para conectar; um domínio com resposta trocada entre as duas chegava na rede interna. | Média | Corrigido: o socket usa o lookup que confere (uma consulta só) |
| V3 | Gzip medido antes de descompactar: uma página pequena podia virar centenas de MB na memória. | Baixa | Corrigido: o limite vale para o conteúdo já descompactado |
| V4 | Respostas da API sem `Cache-Control`: dado de cliente e caixa podia ficar no cache do navegador ou de um proxy. | Baixa | Corrigido: `no-store` em toda resposta (fotos e modelos 3D seguem com cache próprio) |
| V5 | Respostas da API sem CSP; a prévia do link é HTML com script. | Baixa | Corrigido: CSP fechada em toda resposta; a prévia libera só o próprio script pelo hash; prévias de e-mail sem script |
| V6 | Corpo JSON acima de 256 KB virava **500 "Erro interno"** (agora qualquer erro do leitor do corpo vira 4xx). | Baixa | Corrigido: 413/400 com mensagem própria |
| V7 | Rota interna do WhatsApp conferia o formato antes do token (dizia o que esperava a quem não tinha o token). | Baixa | Corrigido: token primeiro, 404 igual a rota inexistente |
| V8 | Planilhas de produtos e DRE: nome que começa com `=` virava fórmula (nome pode vir do iFood ou da importação por IA). | Baixa | Corrigido (`csvText`) |
| V9 | Senha do cliente com 6 caracteres e senhas óbvias aceitas em todo lugar (R2 da auditoria). | Média | Corrigido |
| V10 | Excluir restaurante sem o código do autenticador (R1 da auditoria). | Média | Corrigido |
| V11 | Ferramentas de build (`workbox-build`) com `glob`, `minimatch` e `serialize-javascript` vulneráveis. | Baixa (só build) | Corrigido por override; `picomatch` (via `unplugin-swc`, só testes) ainda sem versão corrigida |

O que foi conferido e **não** tinha falha: isolamento entre restaurantes em todas as rotas,
permissões por perfil, rotas do painel fora do endereço do restaurante, cookies (HttpOnly,
SameSite, host-only, sem fixação de sessão, sair invalida), CSRF por cabeçalho e Origin, Host
estranho, poluição de protótipo, upload (assinatura do arquivo, `nosniff`), tokens públicos
(16 a 32 bytes aleatórios), PIN com limite por restaurante, WebSocket, saída da IA (JSON validado,
sem HTML), links clicáveis só http(s), `pnpm audit --prod` limpo.

Aceitos (registrados): o teste de "Sites" do painel faz um GET sem a proteção de rede interna,
mas só no caminho fixo `/api/v1/health/site` de domínios já verificados e mostra só o código HTTP;
o PIN de 4 números é guardado como hash rápido (quem roubar o banco descobre os PINs, que só
valem com o limite por restaurante).

## Riscos que continuam

- **Bloqueio por conta pode ser usado para incomodar**: quem sabe o e-mail de alguém consegue
  bloquear a conta por 15 minutos errando a senha. É o preço do S2; o dono do restaurante pode
  entrar com outro usuário administrador.
- **WhatsApp por QR Code (Baileys)** não é oficial e o número pode ser banido (decisão do dono).
- **Sem teste de invasão externo** e sem programa de divulgação de falhas. A varredura automática
  ajuda, mas não substitui uma pessoa de fora tentando invadir.
- **Pedidos de titular (LGPD)** são atendidos manualmente.
- **Licença** do código ainda não definida.
