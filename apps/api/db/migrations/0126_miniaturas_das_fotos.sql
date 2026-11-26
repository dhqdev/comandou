-- 0126: miniaturas das fotos.
--
-- O cardápio do cliente, a Nova venda do PDV e o app do garçom mostravam cada foto no tamanho
-- original (até 1600 px, ~150–400 KB) mesmo num cartão de 160 px. A API agora serve a foto
-- reduzida (GET /media/<id>?w=320|640): a primeira vez monta a miniatura a partir da original e
-- guarda aqui, as próximas só leem. Apagar a foto apaga as miniaturas (ON DELETE CASCADE).
-- Somente aditiva.

CREATE TABLE media_thumbs (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  media_id      uuid NOT NULL,
  -- Lado maior pedido (a miniatura pode sair menor, nunca maior que a original).
  width         smallint NOT NULL CHECK (width IN (320, 640)),
  content_type  text NOT NULL CHECK (content_type IN ('image/webp','image/jpeg','image/png')),
  bytes         bytea NOT NULL,
  size          integer NOT NULL CHECK (size BETWEEN 1 AND 3145728),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, media_id, width),
  FOREIGN KEY (tenant_id, media_id) REFERENCES media(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE media_thumbs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON media_thumbs TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON media_thumbs TO comandou_app;
