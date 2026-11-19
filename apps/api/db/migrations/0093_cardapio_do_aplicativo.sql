-- 0093: Cardápio dos aplicativos (ADR 0015, Fase 6). Somente aditiva.
--
-- O Comandou lê de tempos em tempos o cardápio que está no iFood e compara com o que mandou:
-- preço, disponibilidade ou nome mudados no portal e item apagado lá viram aviso na tela, e os
-- itens que só existem no iFood podem ser trazidos para o Comandou. Guarda só o resultado da
-- última leitura (o cardápio do iFood não tem dado pessoal).

ALTER TABLE menus
  ADD COLUMN ifood_drift       jsonb,
  ADD COLUMN ifood_drift_at    timestamptz,
  ADD COLUMN ifood_drift_error text CHECK (length(ifood_drift_error) <= 300);
-- menus já tem GRANT SELECT, INSERT, UPDATE, DELETE para comandou_app (0028): as colunas novas
-- entram nele.
