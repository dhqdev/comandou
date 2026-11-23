-- 0113: cliente da mesa chama o garçom e fecha a conta pelo celular. Somente aditiva.
--
-- table_calls:      chamado da mesa pelo cardápio do QR Code ("Chamar o garçom" ou "pagar com o
--                   garçom"). Aparece no app do garçom e no sistema (PDV, Salão) até alguém
--                   atender; no máximo um chamado aberto por mesa. Some depois de 90 dias.
-- tab_pix_receipts: comprovante do Pix da conta inteira da mesa (todos os pedidos da comanda,
--                   inclusive os do garçom e de outros celulares). O caixa confere: aprovado, o
--                   valor entra como Pix nos pedidos da comanda, do mais antigo ao mais novo;
--                   recusado, o cliente pode mandar outro. O arquivo fica 5 anos (como o do pedido).
-- app_purge_expired: é a mesma da 0099 com os dois passos acima no fim.

CREATE TABLE table_calls (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  table_id    uuid NOT NULL,
  tab_id      uuid,
  -- waiter = chamar o garçom; bill = quer pagar com o garçom (maquininha ou dinheiro).
  kind        text NOT NULL CHECK (kind IN ('waiter','bill')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  answered_by uuid,
  -- answered = alguém da equipe atendeu; cancelled = o próprio cliente desistiu.
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','cancelled')),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, table_id) REFERENCES dining_tables(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, tab_id) REFERENCES tabs(tenant_id, id) ON DELETE SET NULL (tab_id),
  CHECK ((status = 'answered') = (answered_at IS NOT NULL))
);
CREATE UNIQUE INDEX table_calls_one_open ON table_calls(tenant_id, table_id) WHERE status = 'open';
CREATE INDEX table_calls_created_idx ON table_calls(created_at);
ALTER TABLE table_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON table_calls
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON table_calls TO comandou_app;
GRANT UPDATE (status, answered_at, answered_by, kind) ON table_calls TO comandou_app;

CREATE TABLE tab_pix_receipts (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  tab_id        uuid NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('image/webp','image/jpeg','image/png','application/pdf')),
  -- NULL depois da limpeza (5 anos): a tela mostra "arquivo apagado".
  bytes         bytea CHECK (octet_length(bytes) BETWEEN 1 AND 3145728),
  size          integer NOT NULL CHECK (size BETWEEN 1 AND 3145728),
  width         integer CHECK (width BETWEEN 1 AND 8192),
  height        integer CHECK (height BETWEEN 1 AND 8192),
  -- Saldo da conta quando o comprovante chegou (o que o QR Code pedia).
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted','approved','rejected','replaced')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  reject_reason text CHECK (length(reject_reason) <= 200),
  -- Quanto entrou no caixa ao aprovar (pode ser menos que `amount` se a conta mudou).
  applied       numeric(14,2) CHECK (applied >= 0),
  cash_session_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, tab_id) REFERENCES tabs(tenant_id, id) ON DELETE CASCADE,
  CHECK ((status IN ('approved','rejected')) = (reviewed_at IS NOT NULL))
);
CREATE INDEX tab_pix_receipts_tab_idx ON tab_pix_receipts(tenant_id, tab_id, created_at DESC);
CREATE INDEX tab_pix_receipts_pending_idx ON tab_pix_receipts(tenant_id, created_at)
  WHERE status = 'submitted';
CREATE INDEX tab_pix_receipts_age_idx ON tab_pix_receipts(created_at) WHERE bytes IS NOT NULL;
ALTER TABLE tab_pix_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tab_pix_receipts
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON tab_pix_receipts TO comandou_app;
GRANT UPDATE (status, reviewed_by, reviewed_at, reject_reason, applied, cash_session_id)
  ON tab_pix_receipts TO comandou_app;

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
  n_tab_receipts bigint;
  n_table_calls bigint;
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

  -- Comprovante do Pix da conta da mesa: o arquivo fica 5 anos, como o do pedido.
  UPDATE tab_pix_receipts SET bytes = NULL
   WHERE created_at < now() - interval '5 years' AND bytes IS NOT NULL;
  GET DIAGNOSTICS n_tab_receipts = ROW_COUNT;

  -- Chamados do garçom pela mesa: 90 dias.
  DELETE FROM table_calls WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS n_table_calls = ROW_COUNT;

  RETURN jsonb_build_object(
    'sessions', n_sessions,
    'platformSessions', n_platform_sessions,
    'idempotencyKeys', n_idempotency,
    'deliveryLocations', n_locations + n_trail,
    'pixReceipts', n_receipts + n_tab_receipts,
    'menuEvents', n_menu_events,
    'channelEvents', n_channel_payloads + n_channel_rows,
    'channelDrivers', n_channel_drivers,
    'channelReviews', n_channel_reviews,
    'notices', n_notices,
    'tableCalls', n_table_calls);
END $$;
