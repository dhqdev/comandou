-- 0069: foto e descrição em cada opção dos complementos (adicionais, tamanhos, sabores).
--
-- options.description: uma linha curta embaixo do nome na tela do item ("Fatias crocantes").
-- options.image_id: miniatura da opção no cardápio online. Some se a foto for apagada.
-- Somente aditiva.

ALTER TABLE options
  ADD COLUMN description text CHECK (length(description) BETWEEN 1 AND 140),
  ADD COLUMN image_id uuid,
  ADD FOREIGN KEY (tenant_id, image_id) REFERENCES media(tenant_id, id) ON DELETE SET NULL (image_id);
