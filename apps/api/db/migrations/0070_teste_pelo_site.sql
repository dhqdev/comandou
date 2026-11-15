-- 0070: teste grátis criado pelo próprio cliente no site (comandou.com).
--
-- 1) platform_site_settings: liga/desliga o cadastro pelo site, dias de teste, limite por dia e
--    o webhook (n8n) que envia o e-mail de boas-vindas com o login.
-- 2) trial_signups: cada teste criado pelo site (quem pediu, de onde veio o cardápio, quando
--    vence e se o e-mail saiu). Só o painel lê.
-- 3) signup_entry_tokens: link de uso único que abre o restaurante novo já logado, logo depois
--    de criado (fica no banco do restaurante, como o acesso de suporte).
-- 4) app_tenant_trial(): o restaurante da sessão lê só a origem do cardápio informada no site
--    (link, Google Maps ou descrição) para os primeiros passos começarem sozinhos.
-- Somente aditiva.

CREATE TABLE platform_site_settings (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  signup_enabled     boolean NOT NULL DEFAULT true,
  trial_days         int NOT NULL DEFAULT 3 CHECK (trial_days BETWEEN 1 AND 30),
  daily_limit        int NOT NULL DEFAULT 40 CHECK (daily_limit BETWEEN 1 AND 1000),
  -- Webhook que envia o e-mail (n8n). Vazio: o cadastro funciona e o login aparece só na tela.
  email_webhook_url  text NOT NULL DEFAULT '' CHECK (length(email_webhook_url) <= 500),
  -- Segredo enviado no cabeçalho X-Comandou-Token (cifrado com a INTEGRATIONS_KEY).
  email_token_enc    bytea,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_site_settings (id) VALUES (true);
ALTER TABLE platform_site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_site_settings TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON platform_site_settings TO comandou_platform;

CREATE TABLE trial_signups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email            citext NOT NULL,
  contact_name     text NOT NULL CHECK (length(contact_name) <= 120),
  phone            text CHECK (length(phone) <= 30),
  -- De onde montar o cardápio: site do restaurante, link do Google Maps ou descrição dos itens.
  source_kind      text NOT NULL CHECK (source_kind IN ('site', 'maps', 'text', 'none')),
  source_value     text NOT NULL DEFAULT '' CHECK (length(source_value) <= 6000),
  -- Quem acompanha a criação na tela do site prova que é o dono do pedido com este token.
  status_hash      bytea NOT NULL UNIQUE,
  ip               text CHECK (length(ip) <= 64),
  created_at       timestamptz NOT NULL DEFAULT now(),
  trial_ends_at    timestamptz NOT NULL,
  email_sent_at    timestamptz,
  email_error      text CHECK (length(email_error) <= 300),
  -- Senha inicial cifrada (INTEGRATIONS_KEY) só até o e-mail de boas-vindas sair; depois é apagada.
  pending_enc      bytea,
  -- Teste venceu sem fechar: o restaurante foi suspenso nesta hora.
  expired_at       timestamptz,
  UNIQUE (tenant_id)
);
CREATE INDEX trial_signups_created_idx ON trial_signups(created_at DESC);
CREATE INDEX trial_signups_email_idx ON trial_signups(email);
ALTER TABLE trial_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON trial_signups TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON trial_signups TO comandou_platform;

CREATE TABLE signup_entry_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  -- Só o SHA-256 do token; o token em si só existe no navegador de quem se cadastrou.
  token_hash  bytea NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);
ALTER TABLE signup_entry_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON signup_entry_tokens TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON signup_entry_tokens TO comandou_platform;
-- comandou_app não lê a tabela: só troca o token pela função abaixo.

/**
 * Troca o token de entrada do cadastro pelo usuário. Uso único, dentro do prazo, só no
 * restaurante do token e com o membro ativo.
 */
CREATE FUNCTION app_consume_entry_token(p_tenant uuid, p_hash bytea)
RETURNS TABLE (user_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE signup_entry_tokens t SET used_at = now()
    FROM memberships m, users u
   WHERE t.token_hash = p_hash AND t.tenant_id = p_tenant
     AND t.used_at IS NULL AND t.expires_at > now()
     AND m.tenant_id = t.tenant_id AND m.user_id = t.user_id AND m.status = 'active'
     AND u.id = t.user_id AND u.disabled_at IS NULL
  RETURNING t.user_id
$$;
REVOKE ALL ON FUNCTION app_consume_entry_token(uuid, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_consume_entry_token(uuid, bytea) TO comandou_app;

CREATE FUNCTION app_tenant_trial()
  RETURNS TABLE ("sourceKind" text, "sourceValue" text, "trialEndsAt" timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.source_kind, s.source_value, s.trial_ends_at
      FROM trial_signups s
     WHERE s.tenant_id = app_current_tenant()
  $$;
REVOKE ALL ON FUNCTION app_tenant_trial() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_trial() TO comandou_app;
