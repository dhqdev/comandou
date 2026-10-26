-- 0023: identidade visual do restaurante (cores, fonte, cantos e ícone da aba).
-- brand_color/accent_color: cor principal e de destaque em #rrggbb. NULL = cores do Comandou.
--   O navegador gera os tons (claro, escuro, texto por cima) a partir delas, sempre legíveis.
-- font_style/corner_style: tipografia e cantos do cardápio online.
-- favicon_image_id: ícone da aba e do atalho no celular (sem ele, vale o logo).
-- brand_staff_app: as cores valem também no sistema da equipe (PDV, pedidos, cozinha…).
-- Somente aditiva.

ALTER TABLE tenant_store_settings
  ADD COLUMN brand_color      text CHECK (brand_color ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN accent_color     text CHECK (accent_color ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN font_style       text NOT NULL DEFAULT 'padrao'
    CHECK (font_style IN ('padrao','sistema','classica','arredondada')),
  ADD COLUMN corner_style     text NOT NULL DEFAULT 'padrao'
    CHECK (corner_style IN ('padrao','reto','arredondado')),
  ADD COLUMN favicon_image_id uuid,
  ADD COLUMN brand_staff_app  boolean NOT NULL DEFAULT true,
  ADD FOREIGN KEY (tenant_id, favicon_image_id) REFERENCES media(tenant_id, id)
    ON DELETE SET NULL (favicon_image_id);
