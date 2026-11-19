-- 0099: Avisos da equipe (chat_notices) somem sozinhos 7 dias depois de chegarem. Somente aditiva.
--
-- A limpeza periódica (app_purge_expired) passa a apagar os avisos com mais de 7 dias. A API já
-- deixa de mostrar esses avisos na mesma hora, então o intervalo da varredura não importa para
-- quem usa a tela. O índice ajuda a varredura e a lista de cada pessoa.

CREATE INDEX IF NOT EXISTS chat_notices_created_idx ON chat_notices (created_at);

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
  n_channel_reviews bigint;
  n_notices bigint;
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

  -- Avaliações dos aplicativos: o primeiro nome do cliente sai depois de 90 dias; a avaliação
  -- (nota, comentário e resposta) sai depois de 2 anos.
  UPDATE channel_reviews SET customer_name = NULL
   WHERE reviewed_at < now() - interval '90 days' AND customer_name IS NOT NULL;
  GET DIAGNOSTICS n_channel_reviews = ROW_COUNT;
  DELETE FROM channel_reviews WHERE reviewed_at < now() - interval '2 years';

  -- Avisos da equipe (menções, grupos, mural, IA): 7 dias.
  DELETE FROM chat_notices WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS n_notices = ROW_COUNT;

  RETURN jsonb_build_object(
    'sessions', n_sessions,
    'platformSessions', n_platform_sessions,
    'idempotencyKeys', n_idempotency,
    'deliveryLocations', n_locations + n_trail,
    'pixReceipts', n_receipts,
    'menuEvents', n_menu_events,
    'channelEvents', n_channel_payloads + n_channel_rows,
    'channelDrivers', n_channel_drivers,
    'channelReviews', n_channel_reviews,
    'notices', n_notices);
END $$;
