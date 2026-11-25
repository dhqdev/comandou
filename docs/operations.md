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
| Todo dia | Olhar a tela Status do painel: **Pede atenção** junta o que precisa de você (site fora do ar, backup, credencial faltando, fila com falha, faturas vencidas, versão nova) | painel → Status |
| Todo mês | Conferir as chaves no fornecedor | painel → Credenciais › Conferir todas agora |
| Todo mês | Ler o registro do painel (entradas, logins recusados) e o histórico dos restaurantes (suspensões, planos, acessos de suporte) | painel → Conta › Registro do painel; Restaurantes › restaurante › Histórico |
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

### Restaurante com tela velha ou dado que não atualiza

Super Admin › restaurante › **Limpar cache** (`POST /platform/tenants/:id/cache/clear`,
`platform-cache.service.ts`). Apaga o cache da API daquele restaurante em todas as réplicas
(onde fica o banco dele e o bloqueio da assinatura, pelo aviso entre réplicas do adapter Redis do
socket.io) e manda o aviso `cache.clear` para a sala `a:<restaurante>`, onde entram todas as
conexões dele (equipe, cozinha, entregador, cliente na conversa). A tela apaga o Cache Storage, o
service worker e a gaveta `cache` do modo offline (`lib/tenant-cache.ts`) e recarrega. A data fica
em `tenants.cache_cleared_at` (0098): o aparelho que estava fechado limpa ao conectar (vem no
`ready`) e o cardápio online aberto, no `GET /store/status`. Não apaga a fila do offline
(`outbox`), o login nem os ajustes do aparelho. Fica no Histórico como "Limpou o cache".

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

### Aplicativos de delivery

Alertas `ComandouApp*` (ADR 0015). O crítico é **polling parado** (`ComandouAppPollingParado`):
pedidos do aplicativo não chegam e ele cancela sozinho depois do prazo.

1. `docker service logs comandou_api --since 15m | grep -E 'ChannelsPoller|ChannelsInbox|ChannelsOutbox'`.
2. Só uma réplica busca cada credencial (trava `channel_poll_leases` no banco central, vale
   `CHANNELS_LEASE_SECONDS`, 90 s). Réplica caída: outra assume quando a trava vence. Confira
   `SELECT credential, holder, lease_until, last_poll_at FROM channel_poll_leases` (dono).
3. `CHANNELS_POLL_SECONDS=0` desliga o polling naquela réplica (as cópias de versão fixa já vêm
   assim). Pelo menos uma réplica da versão principal precisa estar com ele ligado.
4. Erro 401: credencial do aplicativo errada (Super Admin › Credenciais). 403: a loja revogou o
   acesso (o restaurante vê "sem autorização" na tela Aplicativos de delivery). 429 ou muitos 5xx
   (`ComandouAppPediuParaEsperar`, `ComandouAppErrosNoEndpoint`): o aplicativo está no limite ou
   fora; o Comandou já espera e repete, não force mais chamadas.
5. Eventos e ações que falharam de vez aparecem para o restaurante em Sistema › Aplicativos de
   delivery, com "Tentar de novo". Nunca apague `channel_inbox` à mão: é a prova do que chegou.
6. **iFood** (Fase 2): o polling usa `GET /events/v1.0/events:polling` com `x-polling-merchants`
   (até 100 lojas) e o ack `POST /events/v1.0/events/acknowledgment`; os caminhos ficam em
   `IFOOD_PATHS` (`integrations/ifood/ifood-order.ts`). Se o iFood mudar o caminho, troque só ali.
   Credencial `ifood:central` (modo centralizado, um token para todas as lojas) ou
   `ifood:conn:<id>` (distribuído, um token por loja, refresh token cifrado em `ifood_connections`).
   Pedido que o iFood não acha (404) é consultado no máximo 10 vezes e depois fica "falhou".
7. **Negociação do iFood** (Fase 3): o cliente pede cancelamento ou reembolso e o restaurante
   responde no pedido. Resposta que falhou aparece em Aplicativos de delivery com "Tentar de
   novo"; depois do prazo o iFood decide sozinho (`timeout_action` em `channel_disputes`). Não
   responda negociação pelo banco nem automatize: o iFood recomenda resposta de uma pessoa.
8. **Loja fechada no iFood** (Fase 4): a situação vem de `GET /merchants/{id}/status` e as pausas
   são interrupções do iFood. Se o restaurante diz que fechou no Comandou e o iFood segue aberto,
   veja `channel_stores.state_error` e `follow_store_open` da loja; pausa feita no portal do iFood
   o Comandou só mostra. Pausa mais longa que o iFood aceita: 7 dias.
9. **Entregador do iFood** (Fase 5): a situação vem dos eventos de entrega e a previsão de
   `GET /orders/{id}/tracking` (no máximo a cada 30 s por pedido, quando alguém abre o pedido).
   "Não achou entregador" (RDF) aparece no pedido; o restaurante chama de novo ou entrega com o
   motoboy dele (cancelar o chamado libera o "Saiu para entrega"). "Chamar entregador do iFood"
   recusado com 403: a loja não tem o Sob Demanda liberado no iFood (é contrato com o iFood, não
   erro do Comandou). Não mude `driver_status` pelo banco: o despacho com motoboy da loja fica
   travado enquanto ele estiver em andamento.
10. **Cardápio do iFood diferente do Comandou** (Fase 6): a conferência roda a cada 30 minutos
    (`menus.ifood_drift_at`; erro em `ifood_drift_error`). Preço ou pausa mudados no portal: o
    restaurante usa "Mandar o do Comandou". Item que não sai do iFood quando acaba o estoque: veja se
    o cardápio do iFood está ativo e se o item tem ficha técnica (sem ficha, só "esgotado" à mão).
11. **Repasse do iFood não aparece ou está diferente** (Fase 7): o financeiro é lido a cada 6 horas
    por loja (`channel_stores.finance_at`; erro em `finance_error`). Venda "sem fechar" é normal nos
    primeiros dias: o iFood só fecha a conta da venda depois. Repasse que mudou de valor cancela a
    conta aberta e abre outra (veja o motivo do cancelamento em Contas). Não edite
    `channel_payouts` nem a conta "Repasse de vendas" pelo banco: a próxima leitura refaz. 403 no
    financeiro = a loja não autorizou o módulo financeiro do Comandou no Portal do Parceiro.
12. **Avaliação do iFood não aparece ou não dá para responder** (Fase 8): as avaliações são lidas a
    cada hora por loja (`channel_stores.reviews_at`; erro em `reviews_error`). O iFood só aceita
    resposta em avaliação `NOT_REPLIED` e uma por avaliação: 409 = já respondida (no portal ou
    antes). Não responda pelo banco nem automatize: a resposta é pública no iFood.
13. **Uso do iFood fora das regras** (Fase 9): Super Admin › Aplicativos de delivery mostra ack,
    erro por chamada e consultas por pedido das últimas 24 horas (ou 7/30 dias). Ack abaixo de 95%:
    veja se algum banco de restaurante está em manutenção (o evento fica guardado sem ack) e a fila
    `channel_inbox`. Erro de polling acima de 1%: veja o 5xx/rede do iFood e a saúde da API. 401/403
    repetidos: chave trocada no Portal ou loja que tirou a autorização (cole a chave de novo em
    Credenciais ou desligue a loja). Pedido "no limite" de consultas: o pedido não veio do iFood
    depois de 10 tentativas; não force mais consultas. A contagem fica 35 dias; não edite
    `channel_usage` à mão.
14. **Loja da Keeta (ou de outro app Open Delivery) não recebe pedidos** (Fase 10): confira em
    Super Admin › Credenciais o cartão Keeta (verde e com o Client Secret certo; 401 em toda chamada
    = assinatura ou chave errada). Ao ligar a loja, 403/404 quer dizer que o restaurante ainda não
    autorizou o Comandou no portal da Keeta: autorizar e ligar de novo (o cadastro
    `merchantOnboarding` é refeito). Sem esse cadastro a Keeta não entrega nenhum evento. O código
    da loja é o número que aparece no portal da Keeta (Loja › Informações). Pedido parado em "Em
    análise" no app: veja `channel_outbox` (ação `confirm` com erro) e a coluna `last_error` da loja.
15. **Loja da 99Food não liga ou não recebe** (Fase 11): "não está vinculada ao Comandou na 99Food"
    = a 99Food recusou o token da loja (`<App ID>_<número da loja>`). Confira em Application
    Management › Store Management se a loja está vinculada ao app do Comandou **com o app_shop_id
    igual ao número da loja na 99Food**, e o App ID/App Secret no cartão 99Food de Credenciais.
    Cada loja só pode estar vinculada a um app de produção: se outro sistema tem a loja, a 99Food
    não entrega os pedidos aqui. 400 no polling = a 99Food mudou o formato de `eventType`/`fromTime`
    (veja Super Admin › Aplicativos de delivery, erro por chamada).
16. **Rappi: pedido não chega, cancelamento não chega ou webhook recusado** (Fase 12): pedido novo
    só se busca uma vez; se sumiu, veja `channel_inbox` (evento `<pedido>:new`) e o log "pedido da
    Rappi não está mais na lista": passou dos 10 minutos da lista dos SENT antes de entrar (banco
    do restaurante fora por muito tempo); recupere pelo portal da Rappi. Cancelamento só chega por
    webhook: confira se os 5 endereços estão cadastrados na Rappi
    (`admin.<domínio>/api/v1/platform/channels/webhooks/rappi/<aviso>`) e se o segredo é o mesmo do
    cartão Rappi em Credenciais. "webhook da Rappi recusado: bad_signature" no log = segredo
    diferente ou relógio fora (mais de 10 minutos). Não desligue a assinatura.
17. **aiqfome: a loja não liga ou parou de receber** (Fase 13): "aiqfome=erro" na volta com
    "venceu ou já foi usada" = passou dos 15 minutos ou a pessoa recarregou a página; ligue de
    novo. "Não aceitou o cadastro desta loja" = o código digitado não é o da loja escolhida no ID
    Magalu (a pessoa precisa entrar com o e-mail de dono da loja no Geraldo). Erro do ID Magalu
    sobre a Redirect URI = cadastre no portal do aiqfome exatamente
    `https://admin.<domínio>/api/v1/platform/channels/oauth/aiqfome/callback`. Loja "sem
    autorização" = a renovação do token foi recusada (o lojista tirou o acesso ou ficou muito tempo
    sem uso): ligue de novo pelo ID Magalu; os tokens ficam cifrados em `channel_stores` e nunca
    aparecem no log. Recusar e cancelar pedido do aiqfome é no gestor do aiqfome.
18. **Outro aplicativo Open Delivery não aparece** (Fase 13): o cadastro em Super Admin ›
    Credenciais › Outros aplicativos Open Delivery é relido a cada minuto; confira o nome (vira
    `od-<letras e números>`), o endereço HTTPS e as chaves. Apagar tira o aplicativo de todos os
    restaurantes (as lojas param de buscar).

### Backup atrasado

1. `docker service logs comandou_backup --since 30h | grep -E 'ERRO|ok'`.
2. Erros comuns: chave do bucket vencida ou sem permissão de escrita, bucket cheio, banco
   indisponível. A linha em `backup_runs` (painel → Backups) mostra o erro.
3. Rodar agora: painel → Backups → **Fazer backup agora**, ou
   `docker exec $(docker ps -q -f name=comandou_backup) node dist/backup/backup-cli.js run`.

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
| Evento cru dos aplicativos de delivery (`channel_inbox.payload`) | 90 dias | limpeza automática (a linha fica sem o corpo) |
| Eventos e ações dos aplicativos já tratados | 400 dias | limpeza automática |
| Auditoria | 5 anos | manual, com autorização |
| Backups | regra de ciclo de vida do bucket (sugestão: 35 dias) | B2 |

Pedidos de titular (acesso, correção, exclusão de nome e telefone de cliente em pedidos) ainda
são atendidos manualmente pelo dono do restaurante com o suporte; não há tela para isso.
