# ADR 0006 — Pedidos, salão e caixa: consistência e concorrência

- Status: aceita (Etapa 3)
- Data: 2026-10-22

## Contexto

Pedidos, pagamentos e caixa são operações em que duplicidade ou perda custa dinheiro: rede instável no salão, dois operadores no mesmo pedido, toques repetidos no tablet. O prompt mestre exige idempotência em pagamento, finalização de pedido e fechamento de caixa, estornos em vez de exclusão e que o tempo real não seja tratado como prova de persistência.

## Decisão

1. **Regras financeiras em SQL explícito** (`tx.$client.query`) dentro de `withTenant()`, com RLS ativo. Mais legível para travas e agregações que o query builder.
2. **Idempotência no banco** (`idempotency_keys`), gravada na mesma transação da operação, com hash do corpo e a resposta. Sem Redis: o resultado é atômico com a operação e sobrevive a reinícios.
3. **Travas pessimistas** (`SELECT … FOR UPDATE/SHARE`) em ordem fixa: sessão de caixa → comanda → pedidos → pagamento. O fechamento trava a sessão em modo exclusivo; vendas a travam em modo compartilhado. Conflitos de serialização/deadlock viram 409.
4. **Livro-razão imutável** (`cash_movements`) com sinal. A aplicação não tem `UPDATE`/`DELETE` em pagamentos (exceto `refunded_amount`), estornos e movimentos.
5. **Comanda** agrupa pedidos de uma mesa. Pagar a comanda distribui o valor entre os pedidos em aberto, do mais antigo para o mais novo (ou só nos pedidos escolhidos). Divisão de conta = vários pagamentos parciais, calculados com `splitCents` (soma exata).
6. **Eventos de tempo real** só depois do COMMIT, sem dados de negócio além de IDs. Clientes reconciliam via REST.

## Consequências

- Uma única instância do Postgres serializa as operações críticas; suficiente para o volume de um restaurante e testado com requisições paralelas.
- A tabela `idempotency_keys` cresce; uma limpeza periódica (chaves > 30 dias) entra junto com as filas (Etapa 5).
- Divisão de **um item** entre pessoas não existe ainda (divide-se por valor ou por pedido).
