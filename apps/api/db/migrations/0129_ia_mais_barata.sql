-- 0129: IA mais barata e um modelo para cada tarefa (pedido do David, 0.269).
--
-- 1) platform_ai_settings.model passa a ser o modelo da conversa (chat da equipe, IA do WhatsApp,
--    modelo de impressão e texto da página do restaurante) e o padrão vira o DeepSeek V4 Flash
--    (US$ 0,05 de entrada e 0,45 de saída por 1 milhão de tokens no OpenRouter, metade da entrada
--    do Gemini 2.5 Flash Lite, e a parte repetida da pergunta sai ainda mais barata no cache).
--    Quem estava no padrão antigo (google/gemini-2.5-flash-lite) passa para o novo; quem escolheu
--    outro modelo à mão fica com o dele. O Gemini 2.5 Flash Lite vira a reserva automática da
--    conversa (se o DeepSeek falhar, o OpenRouter responde com ele), no código.
-- 2) platform_ai_settings.import_model: o modelo que lê o cardápio (PDF, foto, link e texto) e
--    acha o restaurante no Google, antes fixo no AI_IMPORT_MODEL do servidor. Continua o Gemini 2.5
--    Flash (lê PDF e foto com boa precisão; é uma vez por restaurante). O Super Admin troca na tela.
-- 3) app_ai_config() devolve o import_model para o restaurante (que não enxerga a tabela).
-- 4) platform_ai_usage.step: a etapa da esteira de chamados que gastou (triagem, priorização,
--    desenvolvimento...), para as métricas de IA da esteira em Chamados, separadas do uso dos
--    restaurantes. Índice por fonte para somar só a esteira.
-- Somente aditiva (o UPDATE só troca o valor padrão antigo pelo novo).

ALTER TABLE platform_ai_settings ALTER COLUMN model SET DEFAULT 'deepseek/deepseek-v4-flash';
UPDATE platform_ai_settings SET model = 'deepseek/deepseek-v4-flash'
 WHERE model = 'google/gemini-2.5-flash-lite';

ALTER TABLE platform_ai_settings
  ADD COLUMN import_model text NOT NULL DEFAULT 'google/gemini-2.5-flash'
    CHECK (import_model ~ '^[A-Za-z0-9._:/-]{3,120}$');
GRANT UPDATE (import_model) ON platform_ai_settings TO comandou_platform;

DROP FUNCTION app_ai_config();
CREATE FUNCTION app_ai_config()
  RETURNS TABLE (enabled boolean, tenant_enabled boolean, model text, assistant_name text,
                 api_key_enc bytea, monthly_tokens integer, bonus_tokens bigint,
                 photo_ai_enabled boolean, model3d_ai_enabled boolean, vision_model text,
                 image_model text, import_model text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.enabled AND s.api_key_enc IS NOT NULL, coalesce(t.enabled, true), s.model,
           s.assistant_name, s.api_key_enc, coalesce(t.monthly_tokens, s.default_monthly_tokens),
           coalesce(t.bonus_tokens, 0), s.photo_ai_enabled, s.model3d_ai_enabled, s.vision_model,
           s.image_model, s.import_model
      FROM platform_ai_settings s
      LEFT JOIN tenant_ai_settings t ON t.tenant_id = app_current_tenant()
     WHERE s.id
  $$;
REVOKE ALL ON FUNCTION app_ai_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ai_config() TO comandou_app;

ALTER TABLE platform_ai_usage
  ADD COLUMN step text CHECK (step ~ '^[a-z_]{2,30}$');
CREATE INDEX platform_ai_usage_source_idx ON platform_ai_usage(source, created_at DESC);
