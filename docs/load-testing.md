# Testes de carga

Ferramenta: [`tools/load/load.mjs`](../tools/load/load.mjs) (Node 22, sem dependências). Ela entra
em vários restaurantes ao mesmo tempo, cada um com vários caixas, e mede três cenários:

1. **Cardápio**: `GET /api/v1/menu`, a leitura mais frequente.
2. **Venda**: pedido de balcão (`POST /orders` com chave de idempotência) e pagamento no PIX do
   valor total.
3. **Disputa**: 5 pagamentos simultâneos do saldo inteiro do mesmo pedido, com chaves diferentes.
   Exatamente um pode passar; qualquer outra coisa faz o teste falhar.

No fim confere que o cookie de um restaurante não abre outro.

```bash
LOAD_TARGET=http://127.0.0.1:3000 LOAD_BASE_DOMAIN=pedemais.localhost \
LOAD_TENANTS=load-1,load-2,load-3 LOAD_EMAIL='dono@{slug}.local' LOAD_PASSWORD=... \
LOAD_CONCURRENCY=4 LOAD_SECONDS=30 node tools/load/load.mjs
```

A carga sai de um único IP, então a API testada precisa de `RATE_LIMIT_PER_MINUTE` e
`AUTH_LOGIN_RATE_LIMIT` altos. **Não rode em produção com restaurantes reais**: o teste cria
pedidos e pagamentos de verdade.

## Resultado de 2026-10-22

Ambiente: máquina de desenvolvimento com 4 vCPUs (Intel Xeon 2,1 GHz) e 15 GB, rodando ao mesmo
tempo **uma** réplica da API (`NODE_ENV=production`, build de produção, logs ligados), PostgreSQL
16, Redis e o gerador de carga. 5 restaurantes; um deles com **1 milhão de pedidos** no banco
(1,1 GB). 20 s por cenário. Não é o servidor de produção: os números servem de referência e para
achar gargalos, não como garantia de capacidade.

**20 clientes simultâneos** (5 restaurantes × 4 caixas)

| Cenário | Vazão | p50 | p95 | p99 | Máx. |
| --- | --- | --- | --- | --- | --- |
| Cardápio | 472/s | 42 ms | 57 ms | 65 ms | 111 ms |
| Criar pedido | 136/s | 77 ms | 102 ms | 120 ms | 155 ms |
| Pagar pedido | 136/s | 68 ms | 88 ms | 100 ms | 134 ms |

**50 clientes simultâneos** (5 restaurantes × 10 caixas)

| Cenário | Vazão | p50 | p95 | p99 | Máx. |
| --- | --- | --- | --- | --- | --- |
| Cardápio | 520/s | 95 ms | 122 ms | 132 ms | 148 ms |
| Criar pedido | 138/s | 180 ms | 245 ms | 304 ms | 365 ms |
| Pagar pedido | 138/s | 170 ms | 232 ms | 283 ms | 333 ms |

- **Nenhum erro** em 30.815 requisições; nenhum erro no log da API.
- **Disputa**: 100 pedidos × 5 pagamentos simultâneos em cada rodada → 100 aceitos e 400
  recusados com 409. Nenhum pedido pago duas vezes.
- **Consistência conferida no banco** depois: nenhum pedido com valor pago maior que o total e
  nenhum com valor pago diferente da soma dos pagamentos.
- **Isolamento**: o cookie de um restaurante recebeu 401 no outro.
- Com 50 clientes a vazão quase não sobe e a latência dobra: uma réplica nessa máquina satura em
  cerca de 520 leituras/s ou 140 vendas completas/s (pedido + pagamento). Para comparação, um
  restaurante movimentado faz algumas centenas de pedidos **por hora**.

### Gargalo encontrado e corrigido

Com 1 milhão de pedidos num restaurante, `GET /orders?limit=100` levava **1,7 s** (lia a tabela
inteira para ordenar por data). O índice `orders (tenant_id, created_at DESC)` (migração 0009)
levou para **9 ms**. O relatório de vendas de 22 dias desse restaurante (cerca de 63 mil pedidos)
leva 0,7 s; de um dia, 21 ms.

### Ainda não medido

Duas réplicas atrás do Traefik, o servidor ARM de produção, WebSocket com muitas telas de cozinha
abertas e a fila com a Focus NFe real.
