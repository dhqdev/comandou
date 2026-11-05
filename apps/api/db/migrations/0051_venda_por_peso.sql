-- 0051: venda por peso (sorveteria, restaurante por quilo, açougue).
-- 1) products.weight_tare: tara em kg descontada do peso lido na balança (pote, prato, marmita).
--    Vale só para item vendido por peso (sold_by_weight, que já existia).
-- 2) order_items.unit: 'kg' quando o item foi vendido por peso (a quantidade é o peso em kg),
--    'un' nos demais. Fica gravado no item para o cupom, a cozinha e a nota mostrarem o peso
--    mesmo que o cadastro do produto mude depois.
-- Somente aditiva.

ALTER TABLE products
  ADD COLUMN weight_tare numeric(6,3) NOT NULL DEFAULT 0 CHECK (weight_tare >= 0 AND weight_tare < 10);

ALTER TABLE order_items
  ADD COLUMN unit text NOT NULL DEFAULT 'un' CHECK (unit IN ('un', 'kg'));
