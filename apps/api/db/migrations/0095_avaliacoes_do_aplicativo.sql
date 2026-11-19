-- 0095: Avaliações dos aplicativos de delivery (ADR 0015, Fase 8). Somente aditiva.
--
-- channel_reviews guarda cada avaliação do cliente no aplicativo (nota, comentário, primeiro nome,
-- pedido) e a resposta da loja, escrita por uma pessoa no Comandou ou no portal do aplicativo.
-- Nada de telefone, documento ou sobrenome. channel_stores ganha a nota média e a hora da leitura
-- (no máximo a cada hora por loja).
-- app_purge_expired: o primeiro nome sai em 90 dias e a avaliação em 2 anos.

CREATE TABLE channel_reviews (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  channel           text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  store_ref         uuid,
  store_id          text NOT NULL CHECK (length(store_id) BETWEEN 1 AND 100),
  external_id       text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 100),
  order_id          uuid,
  external_order_id text CHECK (length(external_order_id) BETWEEN 1 AND 100),
  display_code      text CHECK (length(display_code) BETWEEN 1 AND 40),
  score             numeric(3,1) NOT NULL CHECK (score BETWEEN 0 AND 5),
  comment           text CHECK (length(comment) <= 2000),
  customer_name     text CHECK (length(customer_name) <= 60),
  channel_status    text CHECK (length(channel_status) <= 40),
  can_reply         boolean NOT NULL DEFAULT false,
  reviewed_at       timestamptz NOT NULL,
  reply             text CHECK (length(reply) BETWEEN 1 AND 300),
  replied_at        timestamptz,
  replied_by        uuid,
  reply_from        text CHECK (reply_from IN ('comandou','portal')),
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, channel, external_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE SET NULL (order_id),
  FOREIGN KEY (tenant_id, store_ref) REFERENCES channel_stores(tenant_id, id) ON DELETE SET NULL (store_ref),
  CHECK ((reply IS NULL) = (replied_at IS NULL))
);
CREATE INDEX channel_reviews_at_idx ON channel_reviews(tenant_id, reviewed_at DESC);

ALTER TABLE channel_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON channel_reviews
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- A API não apaga avaliações (só a limpeza do dono): grava, atualiza o que o aplicativo diz e a
-- resposta.
GRANT SELECT, INSERT ON channel_reviews TO comandou_app;
GRANT UPDATE (order_id, display_code, score, comment, channel_status, can_reply, reply, replied_at,
              replied_by, reply_from, fetched_at, store_ref)
  ON channel_reviews TO comandou_app;

ALTER TABLE channel_stores
  ADD COLUMN reviews_at    timestamptz,
  ADD COLUMN reviews_error text CHECK (length(reviews_error) <= 300),
  ADD COLUMN review_score  numeric(3,2) CHECK (review_score BETWEEN 0 AND 5),
  ADD COLUMN review_count  integer CHECK (review_count >= 0);

GRANT UPDATE (reviews_at, reviews_error, review_score, review_count) ON channel_stores TO comandou_app;

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

  RETURN jsonb_build_object(
    'sessions', n_sessions,
    'platformSessions', n_platform_sessions,
    'idempotencyKeys', n_idempotency,
    'deliveryLocations', n_locations + n_trail,
    'pixReceipts', n_receipts,
    'menuEvents', n_menu_events,
    'channelEvents', n_channel_payloads + n_channel_rows,
    'channelDrivers', n_channel_drivers,
    'channelReviews', n_channel_reviews);
END $$;
