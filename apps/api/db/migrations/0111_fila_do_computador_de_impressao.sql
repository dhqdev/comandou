-- 0111: Fila de impressão igual à do computador. Somente aditiva.
--
-- 1) print_jobs.spooled: o computador entregou à fila do Windows e a folha ainda está lá
--    (impressora desligada, sem papel...). Na tela é "Enviado"; quando sai da fila do Windows
--    vira "Impresso" (done_at passa a ser essa hora).
-- 2) print_jobs.queued_at: quando entrou (ou voltou) para a fila. A validade conta daqui, então
--    "Voltar para a fila" dá prazo novo sem mexer na hora em que o trabalho foi criado.
-- 3) print_agents.spool / spool_at: o que está na fila do Windows de cada computador agora
--    (documentos do Comandou e dos outros programas), mandado pelo aplicativo (1.12 em diante).
-- 4) tenant_store_settings.print_max_age_minutes: validade do que espera para imprimir. Passou
--    disso sem sair, não imprime mais sozinho (0 = sem validade). Evita a impressora ligar e
--    despejar comandas velhas.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS spooled boolean NOT NULL DEFAULT false;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS queued_at timestamptz;
UPDATE print_jobs SET queued_at = created_at WHERE queued_at IS NULL;
ALTER TABLE print_jobs ALTER COLUMN queued_at SET DEFAULT now();
ALTER TABLE print_jobs ALTER COLUMN queued_at SET NOT NULL;

ALTER TABLE print_agents ADD COLUMN IF NOT EXISTS spool jsonb;
ALTER TABLE print_agents ADD COLUMN IF NOT EXISTS spool_at timestamptz;

ALTER TABLE tenant_store_settings ADD COLUMN IF NOT EXISTS print_max_age_minutes integer NOT NULL
  DEFAULT 30 CHECK (print_max_age_minutes BETWEEN 0 AND 1440);

CREATE INDEX IF NOT EXISTS print_jobs_spooled_idx ON print_jobs (tenant_id, claimed_by) WHERE spooled;
