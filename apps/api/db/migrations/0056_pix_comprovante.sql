-- 0056: Pix pelo cardápio online, com comprovante (sem banco nem intermediário).
--
-- 1) tenant_store_settings ganha a chave Pix do restaurante: tipo, chave (já no formato do Pix),
--    nome e cidade do recebedor (limites do BR Code: 25 e 15 letras). Com pix_enabled, o cliente
--    que escolhe Pix no checkout vê o QR Code e o copia e cola com o valor do pedido.
-- 2) orders.pix_status: situação do comprovante do pedido pago assim (NULL = não é Pix pelo
--    cardápio). waiting = sem comprovante ainda; submitted = chegou, a equipe confere;
--    approved = conferido (o pagamento entra no caixa); rejected = recusado (o cliente pode mandar
--    outro).
-- 3) pix_receipts: os comprovantes (foto ou PDF), um por envio. Privados: só quem tem o link do
--    pedido (ou a conta do cliente) envia e só a equipe abre. O arquivo sai depois de 180 dias
--    (app_purge_expired); a linha fica, com o que a equipe decidiu.
-- Somente aditiva (app_purge_expired é a mesma da 0021 com mais um passo no fim).

ALTER TABLE tenant_store_settings
  ADD COLUMN pix_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN pix_key_type text CHECK (pix_key_type IN ('cpf','cnpj','phone','email','random')),
  ADD COLUMN pix_key      text CHECK (length(pix_key) BETWEEN 1 AND 77),
  ADD COLUMN pix_name     text CHECK (length(pix_name) BETWEEN 1 AND 25),
  ADD COLUMN pix_city     text CHECK (length(pix_city) BETWEEN 1 AND 15),
  ADD CONSTRAINT store_pix_complete CHECK (
    NOT pix_enabled
    OR (pix_key_type IS NOT NULL AND pix_key IS NOT NULL AND pix_name IS NOT NULL AND pix_city IS NOT NULL)
  );

ALTER TABLE orders
  ADD COLUMN pix_status text CHECK (pix_status IN ('waiting','submitted','approved','rejected'));
CREATE INDEX orders_pix_pending_idx ON orders(tenant_id, created_at)
  WHERE pix_status IN ('waiting','submitted');

CREATE TABLE pix_receipts (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_id      uuid NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('image/webp','image/jpeg','image/png','application/pdf')),
  -- NULL depois da limpeza (180 dias): a tela mostra "arquivo apagado".
  bytes         bytea CHECK (octet_length(bytes) BETWEEN 1 AND 3145728),
  size          integer NOT NULL CHECK (size BETWEEN 1 AND 3145728),
  width         integer CHECK (width BETWEEN 1 AND 8192),
  height        integer CHECK (height BETWEEN 1 AND 8192),
  -- Valor do pedido quando o comprovante chegou (o que o QR Code pedia).
  amount        numeric(14,2) NOT NULL CHECK (amount >= 0),
  status        text NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted','approved','rejected','replaced')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  reject_reason text CHECK (length(reject_reason) <= 200),
  payment_id    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id)   REFERENCES orders(tenant_id, id)   ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((status IN ('approved','rejected')) = (reviewed_at IS NOT NULL))
);
CREATE INDEX pix_receipts_order_idx ON pix_receipts(tenant_id, order_id, created_at DESC);
CREATE INDEX pix_receipts_age_idx ON pix_receipts(created_at) WHERE bytes IS NOT NULL;

ALTER TABLE pix_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pix_receipts
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON pix_receipts TO comandou_app;

CREATE OR REPLACE FUNCTION app_purge_expired()
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  n_sessions bigint;
  n_platform_sessions bigint;
  n_idempotency bigint;
  n_locations bigint;
  n_trail bigint;
  n_receipts bigint;
BEGIN
  DELETE FROM sessions
   WHERE expires_at < now() - interval '90 days'
      OR revoked_at < now() - interval '90 days';
  GET DIAGNOSTICS n_sessions = ROW_COUNT;

  DELETE FROM platform_sessions
   WHERE expires_at < now() - interval '90 days'
      OR revoked_at < now() - interval '90 days';
  GET DIAGNOSTICS n_platform_sessions = ROW_COUNT;

  DELETE FROM idempotency_keys WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS n_idempotency = ROW_COUNT;

  UPDATE deliveries SET last_lat = NULL, last_lng = NULL, last_heading = NULL, last_speed = NULL,
                        last_accuracy = NULL
   WHERE finished_at < now() - interval '30 days' AND last_lat IS NOT NULL;
  GET DIAGNOSTICS n_locations = ROW_COUNT;

  DELETE FROM delivery_positions p USING deliveries d
   WHERE d.tenant_id = p.tenant_id AND d.id = p.delivery_id
     AND d.finished_at < now() - interval '30 days';
  GET DIAGNOSTICS n_trail = ROW_COUNT;

  -- Arquivo do comprovante do Pix: 180 dias. A linha (quem aprovou, quando, valor) fica.
  UPDATE pix_receipts SET bytes = NULL
   WHERE created_at < now() - interval '180 days' AND bytes IS NOT NULL;
  GET DIAGNOSTICS n_receipts = ROW_COUNT;

  RETURN jsonb_build_object(
    'sessions', n_sessions,
    'platformSessions', n_platform_sessions,
    'idempotencyKeys', n_idempotency,
    'deliveryLocations', n_locations + n_trail,
    'pixReceipts', n_receipts);
END $$;
REVOKE ALL ON FUNCTION app_purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_purge_expired() TO comandou_app;
