-- 0092: Entrega dos pedidos dos aplicativos (ADR 0015, Fase 5). Somente aditiva.
--
-- channel_orders ganha o entregador do aplicativo (situação, primeiro nome e veículo, sem
-- telefone nem foto), a previsão do rastreio (lida no máximo a cada 30 s) e o entregador chamado
-- pelo restaurante no aplicativo (Sob Demanda): a cotação guardada aqui (o valor nunca vem da tela)
-- e o valor cobrado do restaurante.
-- app_purge_expired: nome e veículo do entregador saem 30 dias depois do último aviso.

ALTER TABLE channel_orders
  ADD COLUMN driver_status     text CHECK (driver_status IN ('requested','request_failed','assigned',
                                 'to_store','at_store','collected','at_customer','cancelled')),
  ADD COLUMN driver_name       text CHECK (length(driver_name) <= 60),
  ADD COLUMN driver_vehicle    text CHECK (length(driver_vehicle) <= 30),
  ADD COLUMN driver_status_at  timestamptz,
  ADD COLUMN tracking_eta      timestamptz,
  ADD COLUMN tracking_pickup_eta timestamptz,
  ADD COLUMN tracking_at       timestamptz,
  ADD COLUMN driver_quote_id   text CHECK (length(driver_quote_id) BETWEEN 1 AND 100),
  ADD COLUMN driver_quote_fee  numeric(14,2) CHECK (driver_quote_fee >= 0),
  ADD COLUMN driver_quote_until timestamptz,
  ADD COLUMN driver_fee        numeric(14,2) CHECK (driver_fee >= 0);

GRANT UPDATE (driver_status, driver_name, driver_vehicle, driver_status_at, tracking_eta,
              tracking_pickup_eta, tracking_at, driver_quote_id, driver_quote_fee,
              driver_quote_until, driver_fee)
  ON channel_orders TO comandou_app;

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
  n_menu_events bigint;
  n_channel_payloads bigint;
  n_channel_rows bigint;
  n_channel_drivers bigint;
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

  -- Arquivo do comprovante do Pix: 5 anos. A linha (quem aprovou, quando, valor) fica.
  UPDATE pix_receipts SET bytes = NULL
   WHERE created_at < now() - interval '5 years' AND bytes IS NOT NULL;
  GET DIAGNOSTICS n_receipts = ROW_COUNT;

  -- Pixel do cardápio: 400 dias.
  DELETE FROM menu_events WHERE at < now() - interval '400 days';
  GET DIAGNOSTICS n_menu_events = ROW_COUNT;

  -- Aplicativos de delivery: evento cru 90 dias; eventos e ações tratados, 400 dias.
  UPDATE channel_inbox SET payload = NULL
   WHERE received_at < now() - interval '90 days' AND payload IS NOT NULL;
  GET DIAGNOSTICS n_channel_payloads = ROW_COUNT;
  DELETE FROM channel_inbox
   WHERE received_at < now() - interval '400 days' AND status IN ('done','ignored','failed');
  GET DIAGNOSTICS n_channel_rows = ROW_COUNT;

  -- Entregador do aplicativo (nome e veículo): 30 dias depois do último aviso, como a posição do
  -- entregador próprio.
  UPDATE channel_orders SET driver_name = NULL, driver_vehicle = NULL
   WHERE driver_status_at < now() - interval '30 days'
     AND (driver_name IS NOT NULL OR driver_vehicle IS NOT NULL);
  GET DIAGNOSTICS n_channel_drivers = ROW_COUNT;

  RETURN jsonb_build_object(
    'sessions', n_sessions,
    'platformSessions', n_platform_sessions,
    'idempotencyKeys', n_idempotency,
    'deliveryLocations', n_locations + n_trail,
    'pixReceipts', n_receipts,
    'menuEvents', n_menu_events,
    'channelEvents', n_channel_payloads + n_channel_rows,
    'channelDrivers', n_channel_drivers);
END $$;
