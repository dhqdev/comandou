-- 0071: site do restaurante criado com IA no comandou.com.
--
-- Quem chega pelo site cola o link do site, do Google Maps ou descreve o cardápio e a IA
-- (OpenRouter) monta a loja na hora: nome, frase, cores, categorias e itens. O rascunho vai
-- junto com o teste e os primeiros passos começam por ele, sem gastar o limite do restaurante.
--
-- 1) platform_site_ai_settings: liga/desliga, chave própria opcional (sem ela vale a sua chave
--    de Super Admin › Tokens), modelo e os limites de tokens (por site, por dia, por mês) e de
--    sites por visitante (IP) por dia.
-- 2) site_ai_generations: cada site gerado (de onde veio, tokens, custo, o rascunho e, depois do
--    cadastro, o restaurante que nasceu dele). Só o painel lê.
-- 3) trial_signups.ai_generation_id: o teste aponta para o site que a pessoa viu.
-- 4) app_tenant_trial_site(): o restaurante da sessão lê só o próprio rascunho.
-- Somente aditiva.

CREATE TABLE platform_site_ai_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled              boolean NOT NULL DEFAULT true,
  -- Chave do OpenRouter só para os sites (cifrada com a INTEGRATIONS_KEY). Vazia: usa a sua.
  api_key_enc          bytea,
  model                text NOT NULL DEFAULT 'google/gemini-2.5-flash'
                       CHECK (model ~ '^[A-Za-z0-9._:/-]{3,120}$'),
  -- Teto da resposta de cada site (tokens de saída).
  max_tokens_per_site  int NOT NULL DEFAULT 6000 CHECK (max_tokens_per_site BETWEEN 500 AND 32000),
  -- Tokens (entrada + saída) somados de todos os sites; 0 = sem limite.
  daily_tokens         bigint NOT NULL DEFAULT 400000 CHECK (daily_tokens >= 0),
  monthly_tokens       bigint NOT NULL DEFAULT 5000000 CHECK (monthly_tokens >= 0),
  -- Sites que um mesmo visitante (IP) gera em 24 horas.
  per_ip_daily         int NOT NULL DEFAULT 4 CHECK (per_ip_daily BETWEEN 1 AND 100),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_site_ai_settings (id) VALUES (true);
ALTER TABLE platform_site_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_site_ai_settings TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON platform_site_ai_settings TO comandou_platform;

CREATE TABLE site_ai_generations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- site, Google Maps, descrição escrita ou teste feito no painel.
  source_kind        text NOT NULL CHECK (source_kind IN ('site', 'maps', 'text')),
  source_value       text NOT NULL DEFAULT '' CHECK (length(source_value) <= 2000),
  -- Gerado pelo próprio Super Admin (botão de teste): não conta no limite por visitante.
  from_panel         boolean NOT NULL DEFAULT false,
  ip                 text CHECK (length(ip) <= 64),
  model              text NOT NULL,
  prompt_tokens      integer NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens  integer NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  cost_usd           numeric(12,6) NOT NULL DEFAULT 0,
  status             text NOT NULL CHECK (status IN ('ok', 'failed')),
  error              text CHECK (length(error) <= 300),
  -- O que a IA montou (loja e cardápio), já limpo.
  draft              jsonb,
  items              int NOT NULL DEFAULT 0,
  -- Quem gerou prova que é dono do rascunho com este token na hora do cadastro.
  claim_hash         bytea UNIQUE,
  tenant_id          uuid REFERENCES tenants(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_ai_generations_created_idx ON site_ai_generations(created_at DESC);
CREATE INDEX site_ai_generations_ip_idx ON site_ai_generations(ip, created_at DESC);
CREATE INDEX site_ai_generations_tenant_idx ON site_ai_generations(tenant_id);
ALTER TABLE site_ai_generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON site_ai_generations TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON site_ai_generations TO comandou_platform;

ALTER TABLE trial_signups
  ADD COLUMN ai_generation_id uuid REFERENCES site_ai_generations(id) ON DELETE SET NULL;

CREATE FUNCTION app_tenant_trial_site()
  RETURNS TABLE (draft jsonb, "createdAt" timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT g.draft, g.created_at
      FROM trial_signups s
      JOIN site_ai_generations g ON g.id = s.ai_generation_id
     WHERE s.tenant_id = app_current_tenant() AND g.status = 'ok' AND g.draft IS NOT NULL
  $$;
REVOKE ALL ON FUNCTION app_tenant_trial_site() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_trial_site() TO comandou_app;
