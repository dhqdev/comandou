-- 0131: criação do restaurante pelo site paga pela chave do sistema, com o gasto por etapa.
--
-- Pedido do David (0.275): "toda essa parte inicial do cliente pela landing page use a credencial
-- OpenRouter · chave do sistema (esteira), porque isso tudo é gasto meu"; "mostra numa aba quanto
-- usou de IA em cada etapa da criação"; e, no site, "o campo para ele colocar o cardápio dele e já
-- separar os itens com os valores, e já fazer uma suposição do estoque de cada item".
--
-- 1) site_ai_generations aceita 'menu' (cardápio enviado em foto ou PDF no site, uma linha por
--    cardápio, com as páginas somadas) e guarda a sessão do visitante (`session`, número
--    aleatório da aba), para juntar no restaurante tudo o que a IA fez antes do cadastro,
--    inclusive os "Refazer" que não viraram restaurante.
-- 2) trial_signups.site_session e trial_signups.menu_generation_id: o teste aponta para a sessão e
--    para o cardápio enviado.
-- 3) platform_ai_usage.tenant_id e generation_id: cada chamada da criação fica ligada ao rascunho
--    (antes do cadastro) ou ao restaurante (primeiros passos).
-- 4) platform_site_ai_settings.first_steps_tokens: quanto os primeiros passos de um restaurante
--    criado pelo site podem gastar da chave do sistema (0 = gastam do limite do restaurante).
-- 5) app_tenant_trial_menu(): o restaurante da sessão lê só o próprio cardápio enviado no site.
-- Somente aditiva (a regra de source_kind só ganha um valor).

ALTER TABLE site_ai_generations DROP CONSTRAINT site_ai_generations_source_kind_check;
ALTER TABLE site_ai_generations
  ADD CONSTRAINT site_ai_generations_source_kind_check
    CHECK (source_kind IN ('site', 'maps', 'text', 'menu')),
  ADD COLUMN session text CHECK (session ~ '^[A-Za-z0-9_-]{16,64}$');
CREATE INDEX site_ai_generations_session_idx ON site_ai_generations(session)
  WHERE session IS NOT NULL;

ALTER TABLE trial_signups
  ADD COLUMN site_session text CHECK (site_session ~ '^[A-Za-z0-9_-]{16,64}$'),
  ADD COLUMN menu_generation_id uuid REFERENCES site_ai_generations(id) ON DELETE SET NULL;

ALTER TABLE platform_ai_usage
  ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN generation_id uuid REFERENCES site_ai_generations(id) ON DELETE SET NULL;
CREATE INDEX platform_ai_usage_tenant_idx ON platform_ai_usage(tenant_id, created_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX platform_ai_usage_generation_idx ON platform_ai_usage(generation_id)
  WHERE generation_id IS NOT NULL;

ALTER TABLE platform_site_ai_settings
  ADD COLUMN first_steps_tokens bigint NOT NULL DEFAULT 400000 CHECK (first_steps_tokens >= 0);

CREATE FUNCTION app_tenant_trial_menu()
  RETURNS TABLE (draft jsonb, "createdAt" timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT g.draft, g.created_at
      FROM trial_signups s
      JOIN site_ai_generations g ON g.id = s.menu_generation_id
     WHERE s.tenant_id = app_current_tenant() AND g.status = 'ok' AND g.draft IS NOT NULL
  $$;
REVOKE ALL ON FUNCTION app_tenant_trial_menu() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_trial_menu() TO comandou_app;
