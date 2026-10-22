# Operação

Guia para quem mantém o Comandou no ar. Comandos rodam no manager do Swarm, com a stack
`comandou`. Nada aqui apaga volume, rede ou banco.

## Rotina

| Quando | O quê | Como |
| --- | --- | --- |
| Antes do primeiro deploy | Checagem do servidor, DNS, Traefik e segredos | `scripts/preflight.sh` |
| Depois de cada deploy | Saúde, certificados, backups e saída para as integrações | `scripts/preflight.sh --deployed` |
| Todo dia (automático) | Backup cifrado no bucket | serviço `backup` ([backups](backups.md)) |
| Todo domingo (automático) | Teste de restauração | serviço `backup` |
| A cada 6 h (automático) | Limpeza de dados vencidos (sessões antigas, chaves de idempotência, posição do entregador) | API, função `app_purge_expired()` |
| Todo mês | Ler a auditoria do painel (logins recusados, suspensões) | painel → Auditoria |
| A cada 3 meses | Ensaio de restauração completo num banco novo e rotação de segredos | seções abaixo |

## Monitoramento

- **Métricas**: `GET /api/v1/metrics` com `Authorization: Bearer <comandou_metrics_token>`.
  Exemplo de alvo no Prometheus:

  ```yaml
  scrape_configs:
    - job_name: comandou-api
      scheme: https
      metrics_path: /api/v1/metrics
      bearer_token_file: /etc/prometheus/comandou_metrics_token
      static_configs: [{ targets: ['demo.comandou.com'] }]
  ```

  Com 2 réplicas atrás do Traefik, cada coleta cai em uma delas; para ver as duas, colete pela
  rede interna (`tasks.comandou_api:3000`) com `Host` de um restaurante.
- **Alertas**: [`infrastructure/monitoring/alerts.yml`](../infrastructure/monitoring/alerts.yml)
  (API fora, 5xx acima de 2%, lentidão, pool do banco esperando, fila acumulada, memória, backup
  e teste de restauração atrasados). Testados com `promtool` no CI.
- **Painel Super Admin** (`admin.comandou.com`): saúde do banco, Redis e WhatsApp, último backup e
  último teste de restauração.
- **Logs**: `docker service logs comandou_api --since 30m`. JSON (pino), sem cookies, tokens,
  senhas nem o token do link de rastreio. O Traefik também registra URLs: desligue o access log
  dele para `/rastreio/` e `/api/v1/track/` ou deixe-o desligado.

## Incidentes

### API fora do ar

1. `docker service ps comandou_api --no-trunc` mostra por que a tarefa caiu.
2. `docker service logs comandou_api --since 15m | tail -100`.
3. Banco: `docker service ps comandou_postgres`. A API responde `ready` 503 quando o banco cai e
   o Traefik tira a réplica do balanceamento sozinho.
4. Se começou depois de um deploy: [rollback](deploy.md#rollback).

### Erros 5xx

O log tem a pilha do erro (`"level":50`). Erros do banco viram 409/422 claros; 5xx é bug ou
infraestrutura. Abra um issue com a rota e o horário, sem copiar dados de clientes.

### Lentidão

1. Pool esperando conexão (`comandou_db_pool_connections{state="waiting"}`): consultas lentas no
   banco. Veja as mais caras:

   ```bash
   docker exec -it $(docker ps -q -f name=comandou_postgres) psql -U postgres -d comandou -c \
     "SELECT now() - query_start AS tempo, state, left(query, 120) FROM pg_stat_activity
       WHERE datname = 'comandou' AND state <> 'idle' ORDER BY 1 DESC LIMIT 10"
   ```

2. Memória da API perto de 512 MB: `docker service update --limit-memory 768M comandou_api`
   (é reversível) e investigue.
3. Referência do que é normal: [teste de carga](load-testing.md).

### Fila acumulada

Nota fiscal e WhatsApp saem pela fila. Fila crescendo quase sempre é serviço de fora fora do ar
(Focus NFe, WhatsApp). O pedido nunca trava por isso; as notas ficam "processando" e são
consultadas de novo. Confira o `ready` da API (WhatsApp) e o status da Focus NFe.

### Backup atrasado

1. `docker service logs comandou_backup --since 30h | grep -E 'ERRO|ok'`.
2. Erros comuns: chave do bucket vencida ou sem permissão de escrita, bucket cheio, banco
   indisponível. A linha em `backup_runs` (painel → Backups) mostra o erro.
3. Rodar agora: `docker exec $(docker ps -q -f name=comandou_backup) /opt/comandou-backup/backup.sh`.

### Suspeita de vazamento ou invasão

1. Não apague nada: logs, auditoria e backups são evidência.
2. Revogue sessões do painel (`UPDATE platform_sessions SET revoked_at = now() WHERE revoked_at IS NULL`,
   com a conexão do dono) e, se preciso, de um restaurante (`sessions`, mesmo comando com `tenant_id`).
3. Gire os segredos envolvidos (abaixo).
4. LGPD: incidente com dado pessoal precisa ser comunicado à ANPD e aos titulares em prazo
   razoável. Registre o que aconteceu, quando e quem foi afetado.

## Rotação de segredos

Docker secrets não mudam de valor: cria-se um novo com outro nome e troca-se no serviço. Com
`docker service update` o Swarm reinicia as réplicas uma a uma, sem parar o sistema.

```bash
# Exemplo: token das métricas
openssl rand -hex 32 | tr -d '\n' | docker secret create comandou_metrics_token_v2 -
docker service update \
  --secret-rm comandou_metrics_token \
  --secret-add source=comandou_metrics_token_v2,target=comandou_metrics_token \
  comandou_api
# Atualize o Prometheus; o secret antigo pode ser removido depois que nada mais o usar.
```

| Segredo | Efeito de trocar |
| --- | --- |
| `comandou_metrics_token`, `comandou_traefik_provider_token` | atualizar Prometheus / Traefik junto |
| `comandou_wa_gateway_token` | trocar na API e no gateway na mesma janela |
| Senhas dos papéis do banco (`*_password` e `*_url`) | `ALTER ROLE ... PASSWORD` primeiro, depois os secrets |
| `comandou_integrations_key` | **não troque sem migração**: cifra tokens da Focus/Meta e o 2º fator dos administradores |
| `comandou_wa_session_key` | cada restaurante lê o QR Code de novo |
| `comandou_backup_age_identity` | backups novos usam a chave nova; guarde a antiga enquanto houver backup cifrado com ela |
| Chave do bucket (B2/S3) | criar a nova no B2, trocar os dois secrets, apagar a antiga no B2 |

## Ensaio de restauração completo

O teste semanal restaura num banco temporário dentro do contêiner. A cada 3 meses, faça o
caminho de desastre de verdade ([backups](backups.md#restaurar-de-verdade-desastre)) num
servidor separado e confira que a API sobe e o login funciona nesse banco. Ensaio feito em
2026-10-22 (ambiente de desenvolvimento, 1 milhão de pedidos): resultados em [backups](backups.md#ensaios).

## Retenção de dados (LGPD)

| Dado | Fica por | Como sai |
| --- | --- | --- |
| Sessões (IP, navegador) | 90 dias depois de encerrar | limpeza automática |
| Chaves de idempotência | 30 dias | limpeza automática |
| Última posição do entregador | 30 dias depois da entrega | limpeza automática (apaga só a coordenada) |
| Pedidos, pagamentos, caixa, notas fiscais | prazo fiscal (mínimo 5 anos) | não são apagados |
| Auditoria | 5 anos | manual, com autorização |
| Backups | regra de ciclo de vida do bucket (sugestão: 35 dias) | B2 |

Pedidos de titular (acesso, correção, exclusão de nome e telefone de cliente em pedidos) ainda
são atendidos manualmente pelo dono do restaurante com o suporte; não há tela para isso.
