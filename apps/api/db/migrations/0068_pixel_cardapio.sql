-- 0068: pixel do cardápio online (como o pixel da Meta, mas nosso).
--
-- menu_events: o que o cliente faz no cardápio online, para os relatórios (Relatórios › Cardápio
-- online): visitas, cliques nos itens, itens postos na sacola, sacola aberta, finalização,
-- pedido feito, buscas e toques em categorias e banners. Nada de dado pessoal: a sessão (aba
-- aberta) e o visitante (o navegador) são ids aleatórios gerados no aparelho.
--   - visit: 1 por sessão (índice único); só ela guarda aparelho, origem e campanha.
--   - product_id e target_id (categoria ou banner) sem FK: item apagado mantém o histórico.
-- A limpeza periódica apaga os eventos com mais de 400 dias (dá para comparar com o ano anterior).
-- Somente aditiva.

CREATE TABLE menu_events (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  at          timestamptz NOT NULL DEFAULT now(),
  session_id  uuid NOT NULL,
  visitor_id  uuid NOT NULL,
  type        text NOT NULL CHECK (type IN ('visit','view_item','add_to_cart','remove_from_cart',
                'view_cart','begin_checkout','purchase','search','click_category','click_banner',
                'favorite')),
  product_id  uuid,
  target_id   uuid,
  value       numeric(12,2) CHECK (value >= 0),
  quantity    numeric(10,3) CHECK (quantity >= 0),
  term        text CHECK (length(term) BETWEEN 1 AND 60),
  device      text CHECK (device IN ('phone','tablet','desktop')),
  source      text CHECK (length(source) BETWEEN 1 AND 60),
  medium      text CHECK (length(medium) BETWEEN 1 AND 60),
  campaign    text CHECK (length(campaign) BETWEEN 1 AND 80),
  at_table    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id)
);
CREATE INDEX menu_events_at_idx ON menu_events(tenant_id, at);
CREATE INDEX menu_events_product_idx ON menu_events(tenant_id, product_id, at)
  WHERE product_id IS NOT NULL;
CREATE INDEX menu_events_session_idx ON menu_events(tenant_id, session_id, type);
CREATE UNIQUE INDEX menu_events_visit_idx ON menu_events(tenant_id, session_id)
  WHERE type = 'visit';

ALTER TABLE menu_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_events
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON menu_events TO comandou_app;

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

  RETURN jsonb_build_object(
    'sessions', n_sessions,
    'platformSessions', n_platform_sessions,
    'idempotencyKeys', n_idempotency,
    'deliveryLocations', n_locations + n_trail,
    'pixReceipts', n_receipts,
    'menuEvents', n_menu_events);
END $$;
