-- 0084: saldo de verdade do OpenRouter na aba Tokens e o gasto do sistema separado por chave.
-- Somente aditiva.
--
-- 1) platform_ai_settings.admin_api_key_enc: chave de gerenciamento do OpenRouter (opcional,
--    cifrada com a INTEGRATIONS_KEY, contexto "ai:openrouter:admin"). Só ela pode ler
--    /credits (créditos comprados e gastos da conta inteira); nunca faz chamada de IA.
-- 2) platform_ai_usage.key_kind: com qual chave a chamada do sistema saiu ('owner' = a sua,
--    'clients' = a dos restaurantes, quando a sua não existe; 'site' = a dos sites com IA;
--    'typed' = chave digitada no teste, ainda não salva). Linhas antigas ficam vazias e contam
--    como 'owner'.

ALTER TABLE platform_ai_settings ADD COLUMN admin_api_key_enc bytea;
GRANT UPDATE (admin_api_key_enc) ON platform_ai_settings TO comandou_platform;

ALTER TABLE platform_ai_usage
  ADD COLUMN key_kind text CHECK (key_kind IN ('owner', 'clients', 'site', 'typed'));
