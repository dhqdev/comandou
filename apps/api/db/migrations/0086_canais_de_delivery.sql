-- 0086: Aplicativos de delivery, base comum (ADR 0015, Fase 1). Somente aditiva.
-- Roda no banco central e em cada banco de restaurante (as tabelas do central existem nos dois,
-- só são usadas no central).
--
-- Banco do restaurante:
--   channel_stores        loja do aplicativo ligada ao restaurante (receber pedidos, aceite automático)
--   channel_inbox         caixa de entrada: cada evento do canal, cru, uma vez só (canal + id do evento)
--   integration_outbox    caixa de saída: ações para o canal, gravadas na mesma transação da mudança
--   channel_orders        pedido do Comandou ↔ pedido do canal (id externo, código curto, prazos, valores)
--   channel_order_items   item do pedido ↔ item do canal (preço do app × do cardápio, sem vínculo)
--   channel_item_links    item do canal ligado a um produto do cardápio (vale para os próximos pedidos)
--   channel_order_lookups quantas vezes cada pedido foi consultado no canal (o iFood bloqueia acima de 10)
-- Banco central:
--   channel_store_claims  loja do canal → restaurante (uma loja nunca em dois restaurantes) e quem
--                         faz o polling dela; lido pelo polling só pela função app_channel_poll_targets
--   channel_poll_leases   trava do polling: uma réplica por credencial, outra assume se ela cair

-- 1) Pedido: de onde veio --------------------------------------------------------------------
ALTER TABLE orders DROP CONSTRAINT orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('staff','online','app'));
ALTER TABLE orders
  ADD COLUMN app_channel   text CHECK (app_channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  -- Código curto que o cliente vê no aplicativo (ex.: displayId do iFood).
  ADD COLUMN external_code text CHECK (length(external_code) BETWEEN 1 AND 40),
  ADD COLUMN delivered_by  text CHECK (delivered_by IN ('merchant','channel')),
  ADD COLUMN scheduled_for timestamptz,
  ADD CONSTRAINT orders_app_channel_ck CHECK ((source = 'app') = (app_channel IS NOT NULL));
CREATE INDEX orders_app_channel_idx ON orders(tenant_id, app_channel, created_at DESC)
  WHERE app_channel IS NOT NULL;

-- 2) Item do aplicativo sem vínculo: produto técnico, inativo, um por restaurante ----------------
ALTER TABLE categories ADD COLUMN system_kind text CHECK (system_kind IN ('channel_unlinked'));
ALTER TABLE products ADD COLUMN system_kind text CHECK (system_kind IN ('channel_unlinked'));
CREATE UNIQUE INDEX categories_system_kind_uq ON categories(tenant_id, system_kind)
  WHERE system_kind IS NOT NULL;
CREATE UNIQUE INDEX products_system_kind_uq ON products(tenant_id, system_kind)
  WHERE system_kind IS NOT NULL;

-- 3) Lojas dos canais ----------------------------------------------------------------------------
CREATE TABLE channel_stores (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  channel             text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  store_id            text NOT NULL CHECK (length(store_id) BETWEEN 1 AND 100),
  name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  -- iFood: a mesma loja ligada do cardápio (mesmo token e mesma trava do banco central).
  ifood_connection_id uuid,
  receive_orders      boolean NOT NULL DEFAULT false,
  auto_accept         boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','revoked')),
  last_error          text CHECK (length(last_error) <= 300),
  last_event_at       timestamptz,
  last_order_at       timestamptz,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, channel, store_id),
  FOREIGN KEY (tenant_id, ifood_connection_id)
    REFERENCES ifood_connections(tenant_id, id) ON DELETE CASCADE,
  CHECK (channel = 'ifood' OR ifood_connection_id IS NULL)
);
CREATE TRIGGER channel_stores_updated_at BEFORE UPDATE ON channel_stores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4) Caixa de entrada ----------------------------------------------------------------------------
CREATE TABLE channel_inbox (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  channel            text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  event_id           text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 200),
  -- Código como o canal mandou (PLC, CREATED…) e o tipo normalizado.
  event_code         text NOT NULL CHECK (length(event_code) BETWEEN 1 AND 80),
  kind               text NOT NULL CHECK (kind IN ('order.created','order.confirmed','order.preparing',
                       'order.ready','order.dispatched','order.delivered','order.concluded',
                       'order.cancellation_requested','order.cancellation_denied','order.cancelled',
                       'order.dispute','order.dispute_settled','delivery.update','other')),
  store_id           text NOT NULL CHECK (length(store_id) BETWEEN 1 AND 100),
  external_order_id  text CHECK (length(external_order_id) BETWEEN 1 AND 100),
  occurred_at        timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  -- O evento como veio (sem o pedido: os detalhes do pedido não são guardados crus). A limpeza
  -- apaga depois de 90 dias.
  payload            jsonb,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','ignored','failed')),
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  last_error         text CHECK (length(last_error) <= 300),
  processed_at       timestamptz,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, channel, event_id)
);
CREATE INDEX channel_inbox_due_idx ON channel_inbox(tenant_id, next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX channel_inbox_order_idx ON channel_inbox(tenant_id, channel, external_order_id, occurred_at);

-- 5) Pedido ↔ canal ------------------------------------------------------------------------------
CREATE TABLE channel_orders (
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_id           uuid NOT NULL,
  channel            text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  store_ref          uuid,
  store_id           text NOT NULL CHECK (length(store_id) BETWEEN 1 AND 100),
  external_id        text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 100),
  display_code       text NOT NULL CHECK (length(display_code) BETWEEN 1 AND 40),
  -- Último evento do canal para este pedido (código normalizado).
  channel_status     text CHECK (length(channel_status) <= 60),
  fulfillment        text NOT NULL CHECK (fulfillment IN ('delivery','takeout','dine_in')),
  timing             text NOT NULL CHECK (timing IN ('immediate','scheduled')),
  delivered_by       text NOT NULL CHECK (delivered_by IN ('merchant','channel')),
  scheduled_for      timestamptz,
  prepare_from       timestamptz,
  confirm_by         timestamptz,
  pickup_code        text CHECK (length(pickup_code) <= 40),
  phone_locator      text CHECK (length(phone_locator) <= 40),
  prepaid            boolean NOT NULL,
  payment_method     text CHECK (payment_method IN ('cash','credit','debit','pix','voucher','other')),
  payment_brand      text CHECK (length(payment_brand) <= 40),
  change_for         numeric(14,2) CHECK (change_for >= 0),
  -- O que o cliente pagou, o desconto pago pelo aplicativo (volta no repasse) e o do restaurante.
  customer_total     numeric(14,2) NOT NULL CHECK (customer_total >= 0),
  channel_discount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (channel_discount >= 0),
  merchant_discount  numeric(14,2) NOT NULL DEFAULT 0 CHECK (merchant_discount >= 0),
  -- Soma de (preço do aplicativo − preço do cardápio) dos itens com vínculo, para relatório.
  menu_difference    numeric(14,2),
  unlinked_items     integer NOT NULL DEFAULT 0 CHECK (unlinked_items >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_id),
  UNIQUE (tenant_id, channel, external_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_ref) REFERENCES channel_stores(tenant_id, id) ON DELETE SET NULL (store_ref)
);
CREATE TRIGGER channel_orders_updated_at BEFORE UPDATE ON channel_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE channel_order_items (
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_item_id      uuid NOT NULL,
  order_id           uuid NOT NULL,
  channel            text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  item_key           text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 200),
  external_code      text CHECK (length(external_code) <= 100),
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  app_unit_price     numeric(14,2) NOT NULL CHECK (app_unit_price >= 0),
  menu_unit_price    numeric(14,2) CHECK (menu_unit_price >= 0),
  linked             boolean NOT NULL,
  PRIMARY KEY (tenant_id, order_item_id),
  FOREIGN KEY (tenant_id, order_item_id) REFERENCES order_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX channel_order_items_unlinked_idx ON channel_order_items(tenant_id, channel, item_key)
  WHERE NOT linked;

CREATE TABLE channel_item_links (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  channel      text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  -- "code:<código do canal>" ou "name:<nome em minúsculas>" (canal sem código).
  item_key     text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 200),
  product_id   uuid NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, channel, item_key),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE channel_order_lookups (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  channel      text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  external_id  text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 100),
  lookups      integer NOT NULL DEFAULT 0 CHECK (lookups >= 0),
  last_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, channel, external_id)
);

-- 6) Caixa de saída (base genérica: hoje os canais; amanhã qualquer integração) ------------------
CREATE TABLE integration_outbox (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  target             text NOT NULL CHECK (target ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  store_ref          uuid,
  order_id           uuid,
  external_order_id  text CHECK (length(external_order_id) BETWEEN 1 AND 100),
  action             text NOT NULL CHECK (action ~ '^[a-z][a-z_]{2,40}$'),
  payload            jsonb NOT NULL DEFAULT '{}',
  -- Uma ação por pedido e motivo: repetir a mesma mudança não manda duas vezes.
  idem_key           text NOT NULL CHECK (length(idem_key) BETWEEN 8 AND 200),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sending','sent','confirmed','failed')),
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  last_error         text CHECK (length(last_error) <= 300),
  last_status        integer,
  sent_at            timestamptz,
  confirmed_at       timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idem_key),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_ref) REFERENCES channel_stores(tenant_id, id) ON DELETE SET NULL (store_ref)
);
CREATE INDEX integration_outbox_due_idx ON integration_outbox(tenant_id, next_attempt_at)
  WHERE status IN ('pending','sending');
CREATE INDEX integration_outbox_order_idx ON integration_outbox(tenant_id, order_id, created_at);
CREATE TRIGGER integration_outbox_updated_at BEFORE UPDATE ON integration_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 7) Banco central: trava da loja e do polling ---------------------------------------------------
CREATE TABLE channel_store_claims (
  channel         text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  store_id        text NOT NULL CHECK (length(store_id) BETWEEN 1 AND 100),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- channel_stores.id no banco do restaurante.
  store_ref       uuid NOT NULL,
  -- Quem busca os eventos desta loja: 'ifood:central' (um token para todas) ou um por loja.
  credential      text NOT NULL CHECK (credential ~ '^[a-z0-9][a-z0-9_:.-]{1,120}$'),
  receive_orders  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, store_id)
);
CREATE INDEX channel_store_claims_tenant_idx ON channel_store_claims(tenant_id);
CREATE TRIGGER channel_store_claims_updated_at BEFORE UPDATE ON channel_store_claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE channel_poll_leases (
  credential    text PRIMARY KEY CHECK (credential ~ '^[a-z0-9][a-z0-9_:.-]{1,120}$'),
  holder        text NOT NULL CHECK (length(holder) BETWEEN 1 AND 120),
  lease_until   timestamptz NOT NULL,
  -- Último polling (de qualquer réplica): a próxima espera o intervalo mínimo a partir daqui.
  last_poll_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS -----------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['channel_stores','channel_inbox','channel_orders','channel_order_items',
    'channel_item_links','channel_order_lookups','integration_outbox','channel_store_claims']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;
-- Só as funções abaixo (dono) mexem na trava: a API não lê nem grava direto.
ALTER TABLE channel_poll_leases ENABLE ROW LEVEL SECURITY;

-- GRANT mínimo: a API não apaga eventos nem ações, e só muda as colunas de andamento.
GRANT SELECT, INSERT, DELETE ON channel_stores TO comandou_app;
GRANT UPDATE (name, receive_orders, auto_accept, status, last_error, last_event_at, last_order_at)
  ON channel_stores TO comandou_app;
GRANT SELECT, INSERT ON channel_inbox TO comandou_app;
GRANT UPDATE (status, attempts, next_attempt_at, last_error, processed_at) ON channel_inbox TO comandou_app;
GRANT SELECT, INSERT ON channel_orders TO comandou_app;
GRANT UPDATE (channel_status, confirm_by, unlinked_items, menu_difference, store_ref)
  ON channel_orders TO comandou_app;
GRANT SELECT, INSERT ON channel_order_items TO comandou_app;
GRANT UPDATE (linked, menu_unit_price) ON channel_order_items TO comandou_app;
GRANT SELECT, INSERT, DELETE ON channel_item_links TO comandou_app;
GRANT UPDATE (product_id) ON channel_item_links TO comandou_app;
GRANT SELECT, INSERT ON channel_order_lookups TO comandou_app;
GRANT UPDATE (lookups, last_at) ON channel_order_lookups TO comandou_app;
GRANT SELECT, INSERT ON integration_outbox TO comandou_app;
GRANT UPDATE (status, attempts, next_attempt_at, last_error, last_status, sent_at, confirmed_at)
  ON integration_outbox TO comandou_app;
GRANT SELECT, INSERT, DELETE ON channel_store_claims TO comandou_app;
GRANT UPDATE (store_ref, credential, receive_orders) ON channel_store_claims TO comandou_app;

-- Funções do polling (banco central) ----------------------------------------------------------

-- Lojas que recebem pedidos, de restaurantes ativos, com quem faz o polling de cada uma.
CREATE FUNCTION app_channel_poll_targets()
  RETURNS TABLE (channel text, store_id text, tenant_id uuid, store_ref uuid, credential text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT c.channel, c.store_id, c.tenant_id, c.store_ref, c.credential
      FROM channel_store_claims c JOIN tenants t ON t.id = c.tenant_id
     WHERE c.receive_orders AND t.status = 'provisioned'
     ORDER BY c.credential, c.store_id
  $$;

-- Restaurantes com loja de aplicativo (a varredura da caixa de entrada e de saída passa por eles).
CREATE FUNCTION app_channel_tenants()
  RETURNS TABLE (tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT c.tenant_id FROM channel_store_claims c JOIN tenants t ON t.id = c.tenant_id
     WHERE t.status = 'provisioned'
  $$;

-- Pega ou renova a trava de uma credencial. Devolve se conseguiu e quando foi o último polling
-- (de qualquer réplica), para nunca buscar antes do intervalo mínimo.
CREATE FUNCTION app_channel_lease(p_credential text, p_holder text, p_seconds integer)
  RETURNS TABLE (acquired boolean, last_poll_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF p_seconds < 5 OR p_seconds > 900 THEN RAISE EXCEPTION 'duração da trava inválida'; END IF;
  RETURN QUERY
    INSERT INTO channel_poll_leases AS l (credential, holder, lease_until)
    VALUES (p_credential, p_holder, now() + make_interval(secs => p_seconds))
    ON CONFLICT (credential) DO UPDATE
       SET holder = EXCLUDED.holder, lease_until = EXCLUDED.lease_until, updated_at = now()
     WHERE l.holder = EXCLUDED.holder OR l.lease_until < now()
    RETURNING true, l.last_poll_at;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamptz;
  END IF;
END $$;

-- Marca o início de um polling (só quem segura a trava).
CREATE FUNCTION app_channel_polled(p_credential text, p_holder text)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  UPDATE channel_poll_leases SET last_poll_at = now(), updated_at = now()
   WHERE credential = p_credential AND holder = p_holder AND lease_until > now();
  RETURN FOUND;
END $$;

-- Solta a trava ao desligar a réplica (a outra assume na hora).
CREATE FUNCTION app_channel_lease_release(p_holder text)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE n integer;
BEGIN
  UPDATE channel_poll_leases SET lease_until = now() - interval '1 second', updated_at = now()
   WHERE holder = p_holder;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION app_channel_poll_targets() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_channel_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_channel_lease(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_channel_polled(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_channel_lease_release(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_channel_poll_targets() TO comandou_app;
GRANT EXECUTE ON FUNCTION app_channel_tenants() TO comandou_app;
GRANT EXECUTE ON FUNCTION app_channel_lease(text, text, integer) TO comandou_app;
GRANT EXECUTE ON FUNCTION app_channel_polled(text, text) TO comandou_app;
GRANT EXECUTE ON FUNCTION app_channel_lease_release(text) TO comandou_app;

-- Limpeza (LGPD): o evento cru sai em 90 dias; a linha fica (sem o corpo) por 400 dias.
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

  RETURN jsonb_build_object(
    'sessions', n_sessions,
    'platformSessions', n_platform_sessions,
    'idempotencyKeys', n_idempotency,
    'deliveryLocations', n_locations + n_trail,
    'pixReceipts', n_receipts,
    'menuEvents', n_menu_events,
    'channelEvents', n_channel_payloads + n_channel_rows);
END $$;
