-- 0049: cardápio de integração com o iFood. Somente aditiva.
-- ifood_connections: loja do iFood (merchant) ligada ao restaurante. No modo distribuído guarda o
--   refresh token (cifrado com a INTEGRATIONS_KEY); no centralizado, só o merchant.
-- menus.kind = 'ifood': cardápio que não vale em nenhum canal do Comandou; os itens, preços e
--   complementos dele são enviados ao iFood. "Ativo" = envia sozinho a cada alteração.
-- ifood_sync_map: qual id do iFood corresponde a cada categoria/item/grupo/opção do cardápio, com
--   a impressão digital do que foi enviado (para saber o que mudou e mandar só isso).
-- ifood_merchant_claims: fica no banco central; garante que uma loja do iFood só fica ligada a um
--   restaurante (sem isso, quem soubesse o id da loja de outro poderia mexer no cardápio dela).

CREATE TABLE ifood_connections (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  merchant_id        text NOT NULL CHECK (merchant_id ~ '^[0-9a-fA-F-]{8,64}$'),
  merchant_name      text NOT NULL CHECK (length(merchant_name) BETWEEN 1 AND 160),
  mode               text NOT NULL CHECK (mode IN ('centralized','distributed')),
  refresh_token_enc  bytea,
  status             text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','revoked')),
  last_error         text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, merchant_id)
);
CREATE TRIGGER ifood_connections_updated_at BEFORE UPDATE ON ifood_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Autorização em andamento (modo distribuído): o código que o lojista digita no Portal do Parceiro.
CREATE TABLE ifood_pending_auth (
  tenant_id      uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  verifier_enc   bytea NOT NULL,
  user_code      text NOT NULL,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE menus DROP CONSTRAINT menus_kind_check;
ALTER TABLE menus ADD CONSTRAINT menus_kind_check CHECK (kind IN ('principal','delivery','ifood'));
ALTER TABLE menus
  ADD COLUMN ifood_connection_id uuid,
  ADD COLUMN ifood_synced_at     timestamptz,
  ADD COLUMN ifood_sync_started_at timestamptz,
  ADD COLUMN ifood_sync_status   text CHECK (ifood_sync_status IN ('running','ok','partial','error')),
  ADD COLUMN ifood_sync_summary  jsonb,
  ADD FOREIGN KEY (tenant_id, ifood_connection_id)
    REFERENCES ifood_connections(tenant_id, id) ON DELETE SET NULL (ifood_connection_id),
  ADD CONSTRAINT menus_ifood_connection_ck CHECK (kind = 'ifood' OR ifood_connection_id IS NULL);
-- Um ativo por tipo continua valendo para Principal e Delivery; cardápios do iFood são um por loja.
DROP INDEX menus_active_kind_uq;
CREATE UNIQUE INDEX menus_active_kind_uq ON menus(tenant_id, kind) WHERE active AND kind <> 'ifood';
CREATE UNIQUE INDEX menus_ifood_connection_uq ON menus(tenant_id, ifood_connection_id)
  WHERE ifood_connection_id IS NOT NULL;

CREATE TABLE ifood_sync_map (
  tenant_id    uuid NOT NULL,
  menu_id      uuid NOT NULL,
  entity       text NOT NULL CHECK (entity IN ('category','item','image')),
  local_id     uuid NOT NULL,
  remote_id    text NOT NULL,
  -- Item: produto base no iFood; os ids de grupos/opções ficam em extra (vêm do item enviado).
  extra        jsonb NOT NULL DEFAULT '{}',
  -- Impressão digital do que foi enviado: estrutura (nome, descrição, foto, complementos) e oferta.
  shape_hash   text,
  offer_hash   text,
  status       text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','UNAVAILABLE')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, menu_id, entity, local_id),
  FOREIGN KEY (tenant_id, menu_id) REFERENCES menus(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE ifood_merchant_claims (
  merchant_id  text PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ifood_connections','ifood_pending_auth','ifood_sync_map','ifood_merchant_claims']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ifood_connections, ifood_pending_auth, ifood_sync_map,
  ifood_merchant_claims TO comandou_app;
