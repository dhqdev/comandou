-- 0048: categoria com ícone (emoji) e cozinha padrão. Somente aditiva.
-- categories.icon: emoji que aparece no cardápio da retaguarda quando a categoria não tem foto.
-- categories.sector_id: cozinha (KDS) da categoria. Ao escolher, os itens da categoria passam a ir
-- para essa cozinha e item novo nela já nasce com ela (o item ainda pode ter a sua própria).

ALTER TABLE categories
  ADD COLUMN icon text CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 16),
  ADD COLUMN sector_id uuid;
ALTER TABLE categories
  ADD FOREIGN KEY (tenant_id, sector_id) REFERENCES production_sectors(tenant_id, id) ON DELETE RESTRICT;
