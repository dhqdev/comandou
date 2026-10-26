-- 0021: rastreio do entregador em tempo real.
-- 1) delivery_positions: o caminho do entregador em cada corrida (um ponto a cada envio do
--    celular). Desenha o trajeto no mapa do restaurante e do cliente.
-- 2) deliveries: rumo, velocidade e precisão da última posição (seta da moto e previsão de chegada).
-- 3) A limpeza periódica passa a apagar também o trajeto 30 dias depois da entrega (LGPD).

ALTER TABLE deliveries
  ADD COLUMN last_heading  smallint CHECK (last_heading BETWEEN 0 AND 360),
  ADD COLUMN last_speed    numeric(6,2) CHECK (last_speed >= 0),
  ADD COLUMN last_accuracy integer CHECK (last_accuracy >= 0);

CREATE TABLE delivery_positions (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id   uuid NOT NULL,
  delivery_id uuid NOT NULL,
  lat         numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         numeric(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy    integer CHECK (accuracy >= 0),
  speed       numeric(6,2) CHECK (speed >= 0),
  heading     smallint CHECK (heading BETWEEN 0 AND 360),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, delivery_id) REFERENCES deliveries(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX delivery_positions_delivery_idx ON delivery_positions(tenant_id, delivery_id, recorded_at);

ALTER TABLE delivery_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_positions
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON delivery_positions TO comandou_app;

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

  RETURN jsonb_build_object(
    'sessions', n_sessions,
    'platformSessions', n_platform_sessions,
    'idempotencyKeys', n_idempotency,
    'deliveryLocations', n_locations + n_trail);
END $$;
REVOKE ALL ON FUNCTION app_purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_purge_expired() TO comandou_app;
