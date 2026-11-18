-- 0081: Super Admin › Credenciais. Credenciais da plataforma cadastradas pelo painel (em vez de
-- variável no servidor), cifradas com a INTEGRATIONS_KEY. Uma linha por credencial; hoje só o
-- token master da Focus NFe (cadastro das empresas dos restaurantes). Quando a linha existe, vale
-- ela; sem linha, a API usa a variável antiga do servidor (FOCUS_NFE_MASTER_TOKEN).
-- Só o painel (papel comandou_platform) lê e grava. Somente aditiva.

CREATE TABLE platform_credentials (
  name        text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{2,40}$'),
  value_enc   bytea NOT NULL,
  -- Últimos 4 caracteres, para você reconhecer qual está salva (o resto nunca volta à tela).
  last4       text NOT NULL DEFAULT '' CHECK (length(last4) <= 4),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES platform_admins(id) ON DELETE SET NULL
);

ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_credentials TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_credentials TO comandou_platform;
