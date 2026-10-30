-- 0035: conta dividida.
-- tabs.bill_split_parts: em quantas partes a mesa quer dividir a conta (o garçom marca junto com
-- "pediu a conta"; o caixa já abre o recebimento com uma parte por pessoa). Somente aditiva.

ALTER TABLE tabs
  ADD COLUMN bill_split_parts smallint CHECK (bill_split_parts BETWEEN 2 AND 20);
