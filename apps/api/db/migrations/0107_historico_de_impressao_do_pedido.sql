-- 0107: Histórico de impressões dentro do pedido. Somente aditiva.
--
-- O detalhe do pedido lista o que foi impresso dele (hora, o quê, onde e a prévia do papel).
-- O índice deixa essa consulta leve mesmo com a fila de meses.
CREATE INDEX IF NOT EXISTS print_jobs_order_idx ON print_jobs (tenant_id, order_id, created_at DESC)
  WHERE order_id IS NOT NULL;
