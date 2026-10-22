# ADR 0009 — SaaS: Super Admin, planos, domínios, backups e deploy

- Status: aceita (Etapa 6)
- Data: 2026-10-22

## Contexto

Até a Etapa 5 cada restaurante era criado pela linha de comando e não havia limite por cliente,
domínio próprio, backup nem um caminho de deploy. A Etapa 6 transforma o Comandou em SaaS sem
abrir mão das regras anteriores: o restaurante vem do Host validado, RLS em tudo, nada de
apagar registro financeiro e nada de deploy de produção sem aprovação.

## Decisão

1. **Super Admin é outro caminho, não um papel do restaurante.**
   - Só existe em `admin.<domínio base>` (o slug `admin` já era reservado). Nesse host nenhum
     restaurante é resolvido; em qualquer outro host as rotas `/api/v1/platform/*` respondem 404.
     Sem `PLATFORM_DATABASE_URL` configurada, também 404.
   - Usa um papel próprio no banco, `comandou_platform`: NOBYPASSRLS, políticas `TO comandou_platform`
     explícitas e permissões mínimas. Não lê `users.password_hash`, pedidos nem pagamentos e não tem
     DELETE em nada. O papel da aplicação (`comandou_app`) não enxerga as tabelas da plataforma.
   - Login com e-mail, senha e código TOTP (RFC 6238, SHA-1, 6 dígitos, ±1 passo de 30 s). Cada
     código vale uma vez (`totp_last_step`). O segredo TOTP é cifrado com `INTEGRATIONS_KEY`
     (contexto `platform-totp:<id>`). Administradores só são criados pela CLI com a conexão do dono.
   - Cookie `cm_admin` HttpOnly, SameSite=Strict, path `/api/v1/platform`; sessão de 8 h com
     expiração por inatividade de 30 min.
   - Toda ação vai para `platform_audit_log` na mesma transação, inclusive login recusado.
     Suspender ou reativar exige motivo.
2. **Planos: limite impede criar, nunca apaga.**
   - `plans` (preço em `numeric`, limites `NULL` = sem limite, recursos booleanos) e `subscriptions`
     (uma viva por restaurante). Recursos limitados: pessoas ativas na equipe, produtos ativos e
     pedidos no mês (fuso do restaurante). Recursos por plano: NFC-e, WhatsApp e domínio próprio.
   - A checagem acontece na mesma transação que cria o registro; acima do limite ou sem o recurso,
     403 com mensagem clara. O aviso de WhatsApp de um plano sem o recurso é ignorado em silêncio
     (o pedido nunca falha por isso).
   - Restaurante sem assinatura viva não tem limite de plano. Bloquear acesso é papel da suspensão,
     que já existia (tenant `suspended` → 403), não da assinatura.
   - Cobrança automática **não** está nesta etapa: a situação da assinatura (teste, ativa,
     pagamento pendente, cancelada) é ajustada no painel. Integrar um meio de pagamento exige
     escolher o provedor.
3. **Domínio próprio verificado por DNS TXT.**
   - O restaurante cadastra o domínio e publica `_comandou.<domínio>` com `comandou-verify=<token>`.
     Só depois da verificação o domínio resolve o restaurante. O nome é único apenas entre domínios
     verificados e vivos; remover é lógico (`removed_at`). No máximo 3 vivos por restaurante, e só
     com o recurso no plano.
   - O Traefik descobre os domínios pelo provider HTTP `GET /api/v1/internal/traefik` (token
     `TRAEFIK_PROVIDER_TOKEN`; sem ele, 404): um roteador por domínio, certificado HTTP-01 pelo
     resolver `TRAEFIK_CUSTOM_CERT_RESOLVER`.
4. **Monitoramento.** `GET /api/v1/metrics` no formato Prometheus (`prom-client`, Apache-2.0) com
   token `METRICS_TOKEN`; rótulos só rota, método e status (sem tenant nem id). `ready` exige o banco;
   Redis fora deixa o estado "degraded" sem derrubar a API.
5. **Backups.** Serviço `backup` (imagem própria, usuário sem privilégios): `pg_dump -Fc` → cifra
   com `age` (o destinatário é derivado da identidade) → B2/S3 pela aws-cli, conferindo o tamanho
   no bucket. Todo backup e teste fica em `backup_runs` e aparece no painel. O teste de restauração
   baixa o último backup, confere o sha256, decifra, restaura num cluster temporário dentro do
   contêiner e confere contagens e migrações. Agenda: backup diário, teste semanal. Backups antigos
   não são apagados pelo serviço: a retenção é regra de ciclo de vida do bucket.
6. **Deploy controlado.** Tag `vX.Y.Z` → workflow Release publica 4 imagens (amd64 e arm64) no GHCR,
   sem implantar. O workflow Deploy é manual (`workflow_dispatch`), pede a versão duas vezes, confere
   as imagens e espera a aprovação do ambiente `production` do GitHub; depois roda
   `scripts/install.sh --yes` no manager por SSH, que faz um backup antes e cancela a atualização
   se ele falhar.

## Consequências

- Mais um papel e mais um pool no banco; instalações existentes precisam criar o papel
  `comandou_platform` antes da migração 0007 (ver [deploy](../deploy.md)).
- Perder `INTEGRATIONS_KEY` invalida também o segundo fator dos administradores (recriar pela CLI).
- Perder a identidade `age` torna os backups ilegíveis: guarde uma cópia fora do servidor.
- Ainda **não** validado contra serviços reais: B2 de verdade (testado com arquivo local e com um
  emulador S3), DNS real, Traefik com o provider HTTP, as imagens Docker e os workflows de
  release/deploy rodando no GitHub.
