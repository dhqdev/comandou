-- 0102: Varredura das notas fiscais paradas. Somente aditiva.
--
-- Se o trabalho da fila se perde (Redis apagado, API reiniciada sem Redis, tentativas esgotadas
-- com a SEFAZ demorando), a nota fica "pendente", "processando" ou "cancelando" até alguém tocar
-- em Atualizar. A API passa a procurar essas notas de tempos em tempos e a reenfileirar.
-- Como nos lembretes da agenda, o painel só descobre QUAIS restaurantes têm nota parada (sem ler
-- o conteúdo); o reenvio roda dentro do restaurante, com o RLS dele.
CREATE POLICY platform_read ON fiscal_documents TO comandou_platform USING (true);
GRANT SELECT (tenant_id, status, updated_at) ON fiscal_documents TO comandou_platform;

CREATE INDEX IF NOT EXISTS fiscal_documents_stuck_idx ON fiscal_documents (updated_at)
  WHERE status IN ('pending','processing','cancelling');
