-- 0060: item do cardápio em 3D (o cliente vê o prato na mesa dele, pela câmera do celular).
--
-- product_models guarda o modelo 3D de um produto: o arquivo GLB (Android e navegador) e,
-- opcional, o USDZ (iPhone/iPad). O restaurante escaneia o prato com um aplicativo de celular e
-- envia o arquivo no cadastro do item. Um modelo por produto; some junto com o produto.
-- Somente aditiva.

CREATE TABLE product_models (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  product_id  uuid NOT NULL,
  glb         bytea CHECK (octet_length(glb) BETWEEN 1 AND 12582912),
  usdz        bytea CHECK (octet_length(usdz) BETWEEN 1 AND 12582912),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE CASCADE,
  CHECK (glb IS NOT NULL OR usdz IS NOT NULL)
);
-- O Postgres não comprime nem tira da linha por padrão o que já vem comprimido: guarda como veio.
ALTER TABLE product_models ALTER COLUMN glb SET STORAGE EXTERNAL;
ALTER TABLE product_models ALTER COLUMN usdz SET STORAGE EXTERNAL;

ALTER TABLE product_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_models
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON product_models TO comandou_app;
