-- 0097: Autorização da loja no aplicativo por OAuth (ADR 0015, Fase 13: aiqfome). Somente aditiva.
--
-- No aiqfome (camada Open Delivery dele), cada loja autoriza o Comandou no ID Magalu e ganha um
-- par de tokens próprio (o de acesso vale 2 horas e o de renovação troca a cada uso).
-- 1) channel_stores: o token de renovação e o de acesso, cifrados com a INTEGRATIONS_KEY
--    (contexto "<canal>:<restaurante>:<loja>"), e até quando o de acesso vale. A renovação trava a
--    linha (FOR UPDATE) para duas réplicas nunca gastarem o mesmo token de renovação.
-- 2) channel_oauth_states: o "state" da autorização, de uso único (só o hash), com a loja que a
--    pessoa digitou e quem começou. A volta do ID Magalu chega em admin.<domínio> e o painel lê
--    só o endereço de volta do restaurante (como no Connect do PagBank).

ALTER TABLE channel_stores
  ADD COLUMN token_enc    bytea,
  ADD COLUMN access_enc   bytea,
  ADD COLUMN access_until timestamptz;
GRANT UPDATE (token_enc, access_enc, access_until) ON channel_stores TO comandou_app;

CREATE TABLE channel_oauth_states (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  channel     text NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  store_id    text NOT NULL CHECK (length(store_id) BETWEEN 1 AND 100),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  state_hash  bytea NOT NULL UNIQUE CHECK (octet_length(state_hash) = 32),
  user_id     uuid NOT NULL,
  -- Endereço do restaurante onde a autorização começou (a volta leva de novo para lá).
  return_host text NOT NULL CHECK (length(return_host) BETWEEN 3 AND 253),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX channel_oauth_states_expires_idx ON channel_oauth_states (expires_at);

ALTER TABLE channel_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON channel_oauth_states TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON channel_oauth_states TO comandou_app;

-- Painel: só o necessário para mandar o navegador de volta ao restaurante.
CREATE POLICY platform_read ON channel_oauth_states FOR SELECT TO comandou_platform USING (true);
GRANT SELECT (tenant_id, state_hash, return_host, expires_at, used_at)
  ON channel_oauth_states TO comandou_platform;
