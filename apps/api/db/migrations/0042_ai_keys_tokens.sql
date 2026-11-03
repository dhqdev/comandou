-- 0042: chaves de API e tokens da IA, tudo numa aba do Super Admin. Somente aditiva
-- (a função app_ai_config é recriada com uma coluna a mais).
--
-- Banco central:
-- 1) platform_ai_settings.owner_api_key_enc: a chave do dono da plataforma (cifrada com a
--    INTEGRATIONS_KEY, contexto "ai:openrouter:owner"), usada pelo próprio sistema: esteira de
--    chamados e testes do painel. Vazia = usa a chave dos restaurantes (api_key_enc).
-- 2) tenant_ai_settings.bonus_tokens: tokens extras doados pelo Super Admin. Não vencem e só
--    são gastos depois que o limite do mês acaba.
-- 3) ai_usage.source (de onde veio o uso: 'chat', 'whatsapp'...) e ai_usage.bonus_tokens
--    (quanto daquela resposta saiu dos tokens extras).
-- 4) platform_ai_usage: cada chamada feita com a chave do dono (esteira, teste).
-- 5) platform_ai_token_grants: extrato dos tokens extras (doação, retirada), com quem fez.
-- 6) app_ai_record_usage(): a API do restaurante grava o uso por aqui; numa transação só,
--    trava a linha do restaurante e desconta dos extras o que passou do limite do mês.

ALTER TABLE platform_ai_settings ADD COLUMN owner_api_key_enc bytea;
GRANT UPDATE (owner_api_key_enc) ON platform_ai_settings TO comandou_platform;

ALTER TABLE tenant_ai_settings
  ADD COLUMN bonus_tokens bigint NOT NULL DEFAULT 0 CHECK (bonus_tokens >= 0);

ALTER TABLE ai_usage
  ADD COLUMN source       text NOT NULL DEFAULT 'chat' CHECK (source ~ '^[a-z_]{2,20}$'),
  ADD COLUMN bonus_tokens integer NOT NULL DEFAULT 0 CHECK (bonus_tokens >= 0);

CREATE TABLE platform_ai_usage (
  id                 bigserial PRIMARY KEY,
  source             text NOT NULL CHECK (source ~ '^[a-z_]{2,20}$'),
  -- Referência legível (ex.: "CH-0012" para um chamado da esteira).
  ref                text CHECK (length(ref) <= 60),
  model              text NOT NULL,
  prompt_tokens      integer NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens  integer NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  cost_usd           numeric(12,6) NOT NULL DEFAULT 0,
  admin_id           uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_ai_usage_created_idx ON platform_ai_usage(created_at DESC);

CREATE TABLE platform_ai_token_grants (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Positivo = doação; negativo = retirada.
  delta          bigint NOT NULL CHECK (delta <> 0),
  balance_after  bigint NOT NULL CHECK (balance_after >= 0),
  note           text CHECK (length(note) <= 200),
  admin_id       uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_ai_token_grants_tenant_idx ON platform_ai_token_grants(tenant_id, created_at DESC);

ALTER TABLE platform_ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_ai_token_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_ai_usage TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON platform_ai_token_grants TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON platform_ai_usage TO comandou_platform;
GRANT USAGE ON SEQUENCE platform_ai_usage_id_seq TO comandou_platform;
GRANT SELECT, INSERT ON platform_ai_token_grants TO comandou_platform;
GRANT USAGE ON SEQUENCE platform_ai_token_grants_id_seq TO comandou_platform;

-- O restaurante não grava mais direto em ai_usage: passa por app_ai_record_usage().
REVOKE INSERT ON ai_usage FROM comandou_app;

DROP FUNCTION app_ai_config();
CREATE FUNCTION app_ai_config()
  RETURNS TABLE (enabled boolean, tenant_enabled boolean, model text, assistant_name text,
                 api_key_enc bytea, monthly_tokens integer, bonus_tokens bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.enabled AND s.api_key_enc IS NOT NULL, coalesce(t.enabled, true), s.model,
           s.assistant_name, s.api_key_enc, coalesce(t.monthly_tokens, s.default_monthly_tokens),
           coalesce(t.bonus_tokens, 0)
      FROM platform_ai_settings s
      LEFT JOIN tenant_ai_settings t ON t.tenant_id = app_current_tenant()
     WHERE s.id
  $$;
REVOKE ALL ON FUNCTION app_ai_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ai_config() TO comandou_app;

-- Grava o uso de uma resposta do restaurante da transação e devolve o total do mês e os
-- extras que sobraram. O que passar do limite do mês sai dos extras (até zerar).
CREATE FUNCTION app_ai_record_usage(p_user_id uuid, p_model text, p_prompt integer,
                                    p_completion integer, p_cost numeric, p_source text)
  RETURNS TABLE (used_month bigint, bonus_left bigint, bonus_used bigint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := app_current_tenant();
    v_tokens bigint := greatest(coalesce(p_prompt, 0), 0) + greatest(coalesce(p_completion, 0), 0);
    v_limit  bigint;
    v_bonus  bigint := 0;
    v_before bigint;
    v_debit  bigint := 0;
  BEGIN
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'app_ai_record_usage sem restaurante na transação';
    END IF;
    -- Trava a linha do restaurante: duas respostas ao mesmo tempo não gastam o mesmo extra.
    SELECT t.bonus_tokens INTO v_bonus FROM tenant_ai_settings t
     WHERE t.tenant_id = v_tenant FOR UPDATE;
    v_bonus := coalesce(v_bonus, 0);
    SELECT coalesce(t.monthly_tokens, s.default_monthly_tokens) INTO v_limit
      FROM platform_ai_settings s
      LEFT JOIN tenant_ai_settings t ON t.tenant_id = v_tenant
     WHERE s.id;
    SELECT coalesce(sum(u.prompt_tokens + u.completion_tokens), 0) INTO v_before
      FROM ai_usage u
     WHERE u.tenant_id = v_tenant
       AND u.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
                           AT TIME ZONE 'America/Sao_Paulo';
    IF v_limit > 0 AND v_bonus > 0 THEN
      v_debit := least(v_bonus, greatest(0, v_before + v_tokens - greatest(v_before, v_limit)));
      IF v_debit > 0 THEN
        UPDATE tenant_ai_settings SET bonus_tokens = bonus_tokens - v_debit, updated_at = now()
         WHERE tenant_id = v_tenant;
      END IF;
    END IF;
    INSERT INTO ai_usage (tenant_id, user_id, model, prompt_tokens, completion_tokens, cost_usd,
                          source, bonus_tokens)
    VALUES (v_tenant, p_user_id, p_model, greatest(coalesce(p_prompt, 0), 0),
            greatest(coalesce(p_completion, 0), 0), coalesce(p_cost, 0),
            coalesce(nullif(p_source, ''), 'chat'), v_debit);
    RETURN QUERY SELECT v_before + v_tokens, v_bonus - v_debit, v_debit;
  END
  $$;
REVOKE ALL ON FUNCTION app_ai_record_usage(uuid, text, integer, integer, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ai_record_usage(uuid, text, integer, integer, numeric, text)
  TO comandou_app;
