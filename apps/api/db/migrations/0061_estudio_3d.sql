-- 0061: estúdio 3D. O servidor cria e otimiza o modelo 3D do item do cardápio.
--
-- product_model_jobs: cada pedido de "gerar o 3D pelas fotos" ou "otimizar o arquivo escaneado".
-- O serviço model3d pega o trabalho na fila, guarda o resultado em product_models e marca aqui.
-- product_model_job_files: as fotos (até 4) ou o arquivo enviado; apagados quando o trabalho
-- termina (só o resultado fica). Um trabalho em andamento por produto. Somente aditiva.

CREATE TABLE product_model_jobs (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  product_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('generate', 'optimize')),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  provider     text CHECK (provider IN ('local', 'meshy', 'studio')),
  progress     smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  size_cm      smallint CHECK (size_cm BETWEEN 3 AND 200),
  error        text CHECK (length(error) <= 500),
  stats        jsonb,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX product_model_jobs_product ON product_model_jobs (product_id, created_at DESC);
CREATE INDEX product_model_jobs_month ON product_model_jobs (created_at) WHERE kind = 'generate';
CREATE UNIQUE INDEX product_model_jobs_one_active ON product_model_jobs (product_id)
  WHERE status IN ('queued', 'running');

CREATE TABLE product_model_job_files (
  tenant_id     uuid NOT NULL,
  job_id        uuid NOT NULL,
  position      smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
  content_type  text NOT NULL CHECK (length(content_type) <= 80),
  bytes         bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 41943040),
  PRIMARY KEY (job_id, position),
  FOREIGN KEY (tenant_id, job_id) REFERENCES product_model_jobs(tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE product_model_job_files ALTER COLUMN bytes SET STORAGE EXTERNAL;

ALTER TABLE product_model_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_model_jobs
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
ALTER TABLE product_model_job_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_model_job_files
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON product_model_jobs TO comandou_app;
GRANT SELECT, INSERT, DELETE ON product_model_job_files TO comandou_app;
