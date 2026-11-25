-- IA nas fotos e no 3D dos itens do cardápio (0.252), ligada e escolhida no Super Admin › Tokens.
--  * photo_ai_enabled: botão "Melhorar a foto" do item (a IA olha a foto e sugere ajustes de luz,
--    cor e corte; e, se o restaurante quiser, deixa a foto pronta com fundo limpo).
--  * model3d_ai_enabled: "Fazer o 3D pela foto" (a IA lê a forma do prato e o servidor monta o GLB).
--  * vision_model: o modelo que olha a foto (o mais barato que lê imagem).
--  * image_model: o modelo que edita a foto (fundo limpo), pela API de imagens do OpenRouter.
-- Tudo desconta dos tokens do restaurante (ai_usage, fontes photo_tune, photo_clean e menu_model).

ALTER TABLE platform_ai_settings
  ADD COLUMN photo_ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN model3d_ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN vision_model text NOT NULL DEFAULT 'google/gemini-2.5-flash-lite'
    CHECK (vision_model ~ '^[A-Za-z0-9._:/-]{3,120}$'),
  ADD COLUMN image_model text NOT NULL DEFAULT 'openai/gpt-image-2'
    CHECK (image_model ~ '^[A-Za-z0-9._:/-]{3,120}$');

GRANT UPDATE (photo_ai_enabled, model3d_ai_enabled, vision_model, image_model)
  ON platform_ai_settings TO comandou_platform;

-- O restaurante lê as opções novas pela mesma função (não enxerga a tabela).
DROP FUNCTION app_ai_config();
CREATE FUNCTION app_ai_config()
  RETURNS TABLE (enabled boolean, tenant_enabled boolean, model text, assistant_name text,
                 api_key_enc bytea, monthly_tokens integer, bonus_tokens bigint,
                 photo_ai_enabled boolean, model3d_ai_enabled boolean, vision_model text,
                 image_model text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.enabled AND s.api_key_enc IS NOT NULL, coalesce(t.enabled, true), s.model,
           s.assistant_name, s.api_key_enc, coalesce(t.monthly_tokens, s.default_monthly_tokens),
           coalesce(t.bonus_tokens, 0), s.photo_ai_enabled, s.model3d_ai_enabled, s.vision_model,
           s.image_model
      FROM platform_ai_settings s
      LEFT JOIN tenant_ai_settings t ON t.tenant_id = app_current_tenant()
     WHERE s.id
  $$;
REVOKE ALL ON FUNCTION app_ai_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ai_config() TO comandou_app;
