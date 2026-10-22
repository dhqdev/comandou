# Deploy (Docker Swarm + Portainer + Traefik)

> Nada foi implantado. Este guia foi escrito sem acesso ao servidor; os nomes do entrypoint e do certresolver do Traefik existente estão **pendentes de validação** (R5 em [riscos](risks.md)).

## Topologia

- Rede pública **existente** `network_public` (Traefik). Não criar outra.
- Rede overlay `pedemais_internal` com `internal: true` para Postgres.
- Serviços: `postgres` (1 réplica, volume local fixado em nó manager), `migrate` (one-shot), `api` (2 réplicas, `start-first`, rollback automático), `web` (2 réplicas).
- Traefik: `HostRegexp(^[a-z0-9-]+\.pedemais\.com$) && PathPrefix(/api)` → API (prioridade 100); restante → web (prioridade 10). Health check de load balancer em `/api/v1/health/ready`.

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
printf '%s' 'senha-superuser'  | docker secret create pedemais_pg_password -
printf '%s' 'senha-owner'      | docker secret create pedemais_owner_password -
printf '%s' 'senha-app'        | docker secret create pedemais_app_password -
printf '%s' 'postgres://pedemais_app:senha-app@postgres:5432/pedemais'     | docker secret create pedemais_db_app_url -
printf '%s' 'postgres://pedemais_owner:senha-owner@postgres:5432/pedemais' | docker secret create pedemais_db_owner_url -
# Etapa 5: chave que cifra tokens da Focus NFe e do WhatsApp (guarde uma cópia fora do servidor)
openssl rand -base64 32 | tr -d '\n' | docker secret create pedemais_integrations_key -
# WhatsApp por QR Code: token interno API ↔ gateway e chave das sessões
openssl rand -hex 32       | tr -d '\n' | docker secret create pedemais_wa_gateway_token -
openssl rand -base64 32    | tr -d '\n' | docker secret create pedemais_wa_session_key -
```

A partir da 0.4.0 a stack inclui um Redis interno (filas BullMQ e tempo real entre réplicas),
sem porta exposta e com volume próprio (`pedemais_redisdata`), e o serviço `whatsapp-gateway`
(Baileys): uma réplica só, sessões cifradas no volume `pedemais_wadata`, sem porta publicada; só a
API fala com ele. Ele usa a rede `pedemais_egress` para sair para a internet (WhatsApp).
Perder `pedemais_wa_session_key` obriga cada restaurante a ler o QR Code de novo.

## Certificados

`*.pedemais.com` exige desafio **DNS-01** no Traefik (ex.: Cloudflare). Sem isso, cada restaurante pede um certificado HTTP-01 e o limite do Let's Encrypt (50 por semana por domínio registrado) vira gargalo.

## Instalação / atualização

```bash
PEDEMAIS_VERSION=v0.1.0 PEDEMAIS_HEALTH_URL=https://demo.pedemais.com scripts/install.sh
```

O script valida SO, Docker, Swarm, `network_public` e secrets, pede confirmação, aplica a stack, aguarda as migrações e roda `scripts/healthcheck.sh`. Não remove serviços, redes ou volumes.

No Portainer: *Stacks → Add stack → Repository*, apontando para `infrastructure/swarm/pedemais-stack.yml`, com as variáveis `PEDEMAIS_VERSION`, `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERT_RESOLVER`.

## Rollback

- Aplicação: `docker service rollback pedemais_api` e `docker service rollback pedemais_web` (ou redeploy com a tag anterior). O `update_config.failure_action: rollback` já reverte se o novo contêiner não ficar saudável.
- Banco: migrações são somente aditivas por regra; uma migração destrutiva exige plano próprio, backup verificado e autorização.

## Provisionar um restaurante

```bash
docker run --rm --network pedemais_pedemais_internal \
  -e DATABASE_OWNER_URL_FILE=/run/secrets/... ghcr.io/dhqdev/pedemais-api:v0.1.0 \
  node dist/provisioning/provision-cli.js <slug> "<Nome>" <email> "<Nome do admin>"
```

(O painel Super Admin substitui este passo na Etapa 6.)
