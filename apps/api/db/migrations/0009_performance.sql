-- Comandou — 0009 Etapa 7: índices achados no teste de carga com 1 milhão de pedidos.
-- Sem eles, listar os últimos pedidos de um restaurante grande lia a tabela inteira (1,7 s com
-- 1 milhão de pedidos; 9 ms com o índice). Somente aditiva.
--
-- Em um banco que já está em produção e grande, crie estes índices antes, à mão, com
-- CREATE INDEX CONCURRENTLY ... (mesmos nomes): o IF NOT EXISTS abaixo então não faz nada e a
-- migração não trava as escritas.
CREATE INDEX IF NOT EXISTS orders_tenant_created_idx ON orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_movements_tenant_created_idx ON cash_movements (tenant_id, created_at);
