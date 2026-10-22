# Deploy (Docker Swarm + Portainer + Traefik)

> Para instalar do zero em um comando, veja [install.md](install.md). Este guia é o detalhe da stack.

> Nada foi implantado. Este guia foi escrito sem acesso ao servidor; os nomes do entrypoint e do certresolver do Traefik existente estão **pendentes de validação** (R5 em [riscos](risks.md)).

## Topologia

- Rede pública **existente** `network_public` (Traefik). Não criar outra.
- Rede overlay `comandou_internal` com `internal: true` para Postgres.
- Serviços: `postgres` (1 réplica, volume local fixado em nó manager), `migrate` (one-shot), `api` (2 réplicas, `start-first`, rollback automático), `web` (2 réplicas).
- Traefik: `HostRegexp(^[a-z0-9-]+\.comandou\.com$) && PathPrefix(/api)` → API (prioridade 100); restante → web (prioridade 10). Health check de load balancer em `/api/v1/health/ready`.

## Compose × Swarm

| Recurso | Compose (dev) | Swarm (prod) |
| --- | --- | --- |
| `build` | sim | não: imagens versionadas no GHCR |
| `depends_on: condition` | sim | não existe: migração é serviço one-shot e a API tolera banco indisponível no `ready` |
| labels Traefik | `labels` | `deploy.labels` |
| segredos | `.env` | `docker secret` + variáveis `*_FILE` |
| TLS | não | certresolver do Traefik existente |

## Secrets

Crie no manager (os valores não aparecem em logs nem no Portainer):

```bash
printf '%s' 'senha-superuser'  | docker secret create comandou_pg_password -
printf '%s' 'senha-owner'      | docker secret create comandou_owner_password -
printf '%s' 'senha-app'        | docker secret create comandou_app_password -
printf '%s' 'postgres://comandou_app:senha-app@postgres:5432/comandou'     | docker secret create comandou_db_app_url -
printf '%s' 'postgres://comandou_owner:senha-owner@postgres:5432/comandou' | docker secret create comandou_db_owner_url -
# Etapa 5: chave que cifra tokens da Focus NFe e do WhatsApp (guarde uma cópia fora do servidor)
openssl rand -base64 32 | tr -d '\n' | docker secret create comandou_integrations_key -
# WhatsApp por QR Code: token interno API ↔ gateway e chave das sessões
openssl rand -hex 32       | tr -d '\n' | docker secret create comandou_wa_gateway_token -
openssl rand -base64 32    | tr -d '\n' | docker secret create comandou_wa_session_key -
# Etapa 6: painel Super Admin, métricas, domínios dos clientes e backups
printf '%s' 'senha-platform'   | docker secret create comandou_platform_password -
printf '%s' 'postgres://comandou_platform:senha-platform@postgres:5432/comandou' | docker secret create comandou_db_platform_url -
openssl rand -hex 32       | tr -d '\n' | docker secret create comandou_metrics_token -
openssl rand -hex 32       | tr -d '\n' | docker secret create comandou_traefik_provider_token -
printf '%s' '<keyID do B2>'          | docker secret create comandou_backup_s3_key_id -
printf '%s' '<applicationKey do B2>' | docker secret create comandou_backup_s3_secret -
age-keygen 2>/dev/null               | docker secret create comandou_backup_age_identity -
# Super Admin criado no primeiro deploy (ver install.md#super-admin)
printf '%s' 'senha-com-12-ou-mais-caracteres' | docker secret create comandou_platform_admin_password -
head -c 20 /dev/urandom | base32 | tr -d '=\n' | docker secret create comandou_platform_admin_totp -
```

A partir da 0.4.0 a stack inclui um Redis interno (filas BullMQ e tempo real entre réplicas),
sem porta exposta e com volume próprio (`comandou_redisdata`), e o serviço `whatsapp-gateway`
(Baileys): uma réplica só, sessões cifradas no volume `comandou_wadata`, sem porta publicada; só a
API fala com ele. Ele usa a rede `comandou_egress` para sair para a internet (WhatsApp).
Perder `comandou_wa_session_key` obriga cada restaurante a ler o QR Code de novo.

## Etapa 6 (0.5.0): o que muda numa instalação existente

1. **Papel do painel no banco.** O script de init do Postgres só roda em volume novo. Numa
   instalação que já existe, crie o papel antes de atualizar (a migração 0007 recusa rodar sem ele):

   ```bash
   docker exec -it $(docker ps -q -f label=com.docker.swarm.service.name=comandou_postgres) \
     psql -U postgres -d comandou -c "CREATE ROLE comandou_platform LOGIN PASSWORD '<a mesma do secret>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 10" \
     -c "GRANT CONNECT ON DATABASE comandou TO comandou_platform"
   ```

   (digite a senha no prompt interativo em vez de deixá-la no histórico, se preferir: `\password comandou_platform`).
2. **Secrets novos** (lista acima) e o arquivo `/etc/comandou/deploy.env` (abaixo).
3. **Primeiro administrador** do painel, pela CLI (o painel não cria administradores). A rede
   interna não aceita contêineres avulsos, então a CLI roda dentro de um contêiner da API, que já
   tem a `INTEGRATIONS_KEY`; a URL do dono e a senha são digitadas sem eco e não ficam no histórico:

   ```bash
   read -rsp 'URL do dono: ' OWNER_URL; echo; read -rsp 'Senha do admin: ' ADMIN_PW; echo
   docker exec -it \
     -e DATABASE_OWNER_URL="$OWNER_URL" -e PLATFORM_ADMIN_PASSWORD="$ADMIN_PW" \
     -e INTEGRATIONS_KEY_FILE=/run/secrets/comandou_integrations_key \
     $(docker ps -q -f label=com.docker.swarm.service.name=comandou_api | head -1) \
     node dist/platform/platform-admin-cli.js voce@empresa.com "Seu nome"
   unset OWNER_URL ADMIN_PW
   ```

   Ela imprime **uma vez** o endereço `otpauth://`: adicione no aplicativo autenticador e não guarde
   em outro lugar. O painel fica em `https://admin.comandou.com` (o certificado curinga já cobre).
4. **Plano padrão.** Sem planos, nenhum restaurante tem limite. Crie os planos no painel e marque
   um como padrão para os restaurantes novos.

### `/etc/comandou/deploy.env`

Valores **não secretos** do servidor, lidos pelo `install.sh` (permissão 600, dono root):

```bash
COMANDOU_BASE_DOMAIN=comandou.com
COMANDOU_HEALTH_URL=https://demo.comandou.com
BACKUP_S3_BUCKET=comandou-backups
BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKUP_S3_REGION=us-west-004
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERT_RESOLVER=letsencryptresolver
TRAEFIK_CUSTOM_CERT_RESOLVER=letsencrypt-http
```

### Domínios próprios dos restaurantes (Traefik)

Os domínios verificados chegam ao Traefik pelo **provider HTTP**. Na configuração estática do
Traefik existente (pendente de validação no servidor):

```yaml
providers:
  http:
    endpoint: http://comandou_api:3000/api/v1/internal/traefik?token=<conteúdo de comandou_traefik_provider_token>
    pollInterval: 30s
    # Traefik 3: pode usar `headers: { Authorization: Bearer <token> }`. Traefik 2.x não aceita
    # cabeçalhos no provider HTTP; use o token na URL (?token=...), que a API também aceita.
certificatesResolvers:
  letsencrypt-http:
    acme:
      email: voce@empresa.com
      storage: /letsencrypt/acme-http.json
      httpChallenge: { entryPoint: web }
```

O Traefik precisa alcançar a API pela rede `network_public`. Cada domínio pede o próprio
certificado por HTTP-01, então o cliente aponta o domínio (CNAME ou A) para o servidor **antes**
de verificar.

### Endereço de cada restaurante sem certificado coringa (alternativa)

O certificado coringa (`*.comandou.com`) exige DNS-01. Quando não houver, ligue na API
`TRAEFIK_TENANT_HOSTS=true`: o mesmo provider HTTP passa a listar também `admin.<domínio>` e
`<slug>.<domínio>` de cada restaurante ativo (função `app_tenant_slugs()`, migração 0011). O
Traefik consulta a cada 30 s e emite um certificado HTTP-01 por endereço; restaurante novo abre em
até ~1 minuto, sem editar a stack. Variáveis opcionais: `TRAEFIK_TENANT_CERT_RESOLVER` (resolver
HTTP-01 dos endereços; vazio usa `TRAEFIK_CUSTOM_CERT_RESOLVER`), `TRAEFIK_API_SERVICE` e
`TRAEFIK_WEB_SERVICE` (nomes dos serviços **com o sufixo do provider** do seu Traefik, ex.:
`comandou-api@docker`). Com esta opção, não use as regras fixas por `Host(...)` nas labels da
stack. O Let's Encrypt limita a 50 certificados novos por semana por domínio.

### Monitoramento

`GET https://<qualquer restaurante>/api/v1/metrics` com `Authorization: Bearer <comandou_metrics_token>`
(sem o token: 404). Exemplo de alvo no Prometheus: `bearer_token_file` com o token e
`metrics_path: /api/v1/metrics`. Métricas: duração e contagem de requisições por rota/método/status,
pool do banco, filas e as padrão do Node.

Por restaurante (opcional, `METRICS_PER_TENANT=true` na API): `comandou_tenant_http_requests_total`,
`comandou_tenant_http_request_seconds_total` e `comandou_tenant_http_server_errors_total`, com o
rótulo `tenant` igual ao slug e sem rota (a quantidade de séries cresce só com o número de
restaurantes). Servem para ver quem mais usa o sistema, por exemplo
`topk(5, rate(comandou_tenant_http_request_seconds_total[1h]))`, e decidir quem precisa de banco
dedicado ([ADR 0011](decisions/0011-banco-dedicado-por-cliente.md)).

### PgBouncer (opcional)

Quando o número de conexões crescer, coloque o PgBouncer (modo transação) entre a API e o Postgres
com o overlay [`infrastructure/swarm/pgbouncer.yml`](../infrastructure/swarm/pgbouncer.yml):

```bash
printf '%s' 'postgres://comandou_app:senha-app@pgbouncer:5432/comandou' | docker secret create comandou_db_app_pooler_url -
docker stack deploy -c infrastructure/swarm/comandou-stack.yml -c infrastructure/swarm/pgbouncer.yml comandou
```

Só a API passa por ele. Migrações e o painel Super Admin continuam direto no Postgres (usam travas
de sessão). Para voltar, faça o deploy sem o overlay. A senha no endereço não pode ter caracteres
que precisem de escape em URL (as geradas com `openssl rand -hex` servem).

### Bancos dedicados (preparado, ainda sem clientes)

O `comandou-migrate` aplica as migrações no banco central (`DATABASE_OWNER_URL`) e depois em cada
banco de `TENANT_DATABASE_OWNER_URLS` (lista separada por vírgula; aceita `_FILE`). Vazio, que é o
normal hoje, só o central é migrado. Se o central falhar, os outros não são tocados; se um dedicado
falhar, os demais seguem e o serviço termina com erro mostrando qual falhou (sem senha no log).

### Backups

Ver [backups](backups.md). O `install.sh` faz um backup antes de aplicar a stack e cancela a
atualização se ele falhar. Na primeira instalação o serviço ainda não existe e o passo é pulado
sozinho; `COMANDOU_SKIP_BACKUP=1` pula à força (só em emergência, fica no log).

## Etapa 7 (0.6.0): antes e depois de cada deploy

- **Antes**: `scripts/preflight.sh` (só lê; confere servidor, `deploy.env`, segredos, Traefik e DNS).
- **Depois**: `scripts/preflight.sh --deployed` (serviços, certificados, HSTS, saúde, métricas
  fechadas, bucket, idade dos backups, saída para Focus NFe, Meta e WhatsApp).
- Migrações 0008 a 0010 são aditivas. Em um banco grande já em produção, crie os índices da
  0009 antes, sem travar escritas:

  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_tenant_created_idx ON orders (tenant_id, created_at DESC);
  CREATE INDEX CONCURRENTLY IF NOT EXISTS cash_movements_tenant_created_idx ON cash_movements (tenant_id, created_at);
  ```

- Variáveis novas da API (opcionais): `RATE_LIMIT_PER_MINUTE` (300), `AUTH_ACCOUNT_LOCK_THRESHOLD`
  (10), `AUTH_ACCOUNT_LOCK_MINUTES` (15), `MAINTENANCE_INTERVAL_MINUTES` (360; 0 desliga).
- Alertas: [operação](operations.md#monitoramento).

## Deploy pelo GitHub (manual, com aprovação)

1. **Tudo em um workflow só (`ci.yml`, "Comandou (testes, imagens e Release)"), um run por push na
   `main`** (mudança só de documentação não roda). Ordem: testes → versão → imagens → tag e
   Release. A versão é a do `package.json` se ela ainda não tem tag, senão a próxima correção
   (`v0.8.1` → `v0.8.2` → ...). Constrói e publica `comandou-api`, `comandou-web`,
   `comandou-whatsapp-gateway` e `comandou-backup` no GHCR (amd64 e arm64) e **só no fim** cria a
   tag e a Release no GitHub; se algo falhar antes, não fica tag sem imagem. Para uma versão de
   funcionalidade (`0.9.0`), suba o número nos `package.json` e em
   `packages/shared/src/releases.ts`. Não implanta nada. Para republicar as imagens de uma tag
   existente: *Actions → Comandou → Run workflow* com a tag (sem rodar os testes).
2. Em *Settings → Environments*, criar `production` com **Required reviewers** e os secrets
   `DEPLOY_SSH_KEY` (chave só para deploy), `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan` do manager, conferido
   à mão), `DEPLOY_HOST`, `DEPLOY_USER`. Opcional: variável `DEPLOY_PATH` (padrão `/opt/comandou`,
   um clone do repositório no manager).
3. *Actions → Deploy (produção) → Run workflow*, digitando a versão duas vezes. O job confere as
   imagens e espera a aprovação; aprovado, roda `scripts/install.sh --yes` no manager.

O workflow não foi executado ainda (não há servidor configurado).

## Certificados

`*.comandou.com` exige desafio **DNS-01** no Traefik (ex.: Cloudflare). Sem isso, cada restaurante pede um certificado HTTP-01 e o limite do Let's Encrypt (50 por semana por domínio registrado) vira gargalo.

## Instalação / atualização

Do zero, em um comando: [install.md](install.md). Com o repositório já no servidor:

```bash
COMANDOU_VERSION=v0.7.0 COMANDOU_HEALTH_URL=https://demo.comandou.com scripts/install.sh
```

O script valida SO e Docker, liga o Swarm e cria `network_public` e o Traefik se faltarem (com
confirmação), cria os secrets que faltam (nunca sobrescreve), aplica a stack, aguarda as migrações
(que criam o Super Admin na primeira vez) e roda `scripts/healthcheck.sh`. Não remove serviços,
redes, volumes nem secrets.

No Portainer: *Stacks → Add stack → Repository*, apontando para `infrastructure/swarm/comandou-stack.yml`, com as variáveis `COMANDOU_VERSION`, `COMANDOU_BASE_DOMAIN`, `PLATFORM_ADMIN_EMAIL`, `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERT_RESOLVER`. Certificado coringa: acrescente `infrastructure/swarm/wildcard.yml`.

## Rollback

- Aplicação: `docker service rollback comandou_api` e `docker service rollback comandou_web` (ou redeploy com a tag anterior). O `update_config.failure_action: rollback` já reverte se o novo contêiner não ficar saudável.
- Banco: migrações são somente aditivas por regra; uma migração destrutiva exige plano próprio, backup verificado e autorização.

## Provisionar um restaurante

```bash
read -rsp 'URL do dono: ' OWNER_URL; echo; read -rsp 'Senha inicial do admin: ' PW; echo
docker exec -it -e DATABASE_OWNER_URL="$OWNER_URL" -e PROVISION_ADMIN_PASSWORD="$PW" -e PROVISION_PLAN=basico \
  $(docker ps -q -f label=com.docker.swarm.service.name=comandou_api | head -1) \
  node dist/provisioning/provision-cli.js <slug> "<Nome>" <email> "<Nome do admin>"
unset OWNER_URL PW
```

A partir da 0.5.0 o caminho normal é o painel Super Admin (*Restaurantes → Novo restaurante*); a
CLI continua para automação. Sem `PROVISION_PLAN`, usa o plano padrão (se houver).
