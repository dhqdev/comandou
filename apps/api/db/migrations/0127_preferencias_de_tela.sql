-- 0127: preferências de tela de cada pessoa em cada restaurante.
--
-- O PDV guardava "Compacto ou Completo" só no navegador: em outro computador, outro navegador ou
-- depois de limpar os dados, voltava ao padrão e a pessoa escolhia de novo (pedido do David).
-- Agora fica na própria ligação da pessoa com o restaurante (memberships), e vale em qualquer
-- aparelho em que ela entrar. Só escolhas de tela, curtas (a API limita chaves e valores).
-- Somente aditiva.

ALTER TABLE memberships
  ADD COLUMN ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(ui_prefs) = 'object' AND pg_column_size(ui_prefs) <= 4096);

GRANT UPDATE (ui_prefs) ON memberships TO comandou_app;
