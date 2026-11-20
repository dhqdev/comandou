-- 0103: Impressão sem cópias repetidas. Somente aditiva.
--
-- 1) print_jobs.status ganha 'cancelled' (tirado da fila na tela Impressão): deixa de aparecer
--    como "Falhou" e o aplicativo não imprime mais.
-- 2) print_jobs.retry_at: falha volta para a fila só depois de um tempo (10 s, 20 s, 40 s...),
--    em vez de tentar de novo a cada 3 segundos.
-- 3) print_jobs.printer_label: em qual impressora o computador mandou (tela da impressora).
-- 4) print_agents.purge_requested_at: pedido da tela Impressão para o computador limpar os
--    documentos do Comandou da fila do sistema (spooler do Windows, CUPS).
-- 5) print_agents.printer_removals: impressoras que a tela Impressão mandou tirar do aplicativo.
-- 6) Computador conectado pode ser excluído (GRANT DELETE); os trabalhos dele ficam no histórico.
ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_status_check
  CHECK (status IN ('queued','printing','done','failed','cancelled'));

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS retry_at timestamptz;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS printer_label text
  CHECK (printer_label IS NULL OR length(printer_label) <= 80);
ALTER TABLE print_agents ADD COLUMN IF NOT EXISTS purge_requested_at timestamptz;
ALTER TABLE print_agents ADD COLUMN IF NOT EXISTS printer_removals jsonb;

GRANT DELETE ON print_agents TO comandou_app;

CREATE INDEX IF NOT EXISTS print_jobs_agent_idx ON print_jobs (tenant_id, claimed_by, created_at DESC);
