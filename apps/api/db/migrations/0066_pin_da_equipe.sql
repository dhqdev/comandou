-- 0066: entrada do garçom e do entregador por PIN de 4 números.
--
-- O PIN é do vínculo (memberships), não da conta: a mesma pessoa pode ter outro PIN em outro
-- restaurante. Guardamos só o SHA-256 de "restaurante:PIN" (o PIN identifica a pessoa na entrada,
-- então precisa ser único no restaurante e achado direto pelo índice). O app só grava o PIN; a
-- leitura antes do login usa o contexto do restaurante (RLS), como o resto da tabela.

ALTER TABLE memberships ADD COLUMN pin_hash bytea;
ALTER TABLE memberships ADD COLUMN pin_set_at timestamptz;
CREATE UNIQUE INDEX memberships_pin_uniq ON memberships (tenant_id, pin_hash) WHERE pin_hash IS NOT NULL;

GRANT UPDATE (pin_hash, pin_set_at) ON memberships TO comandou_app;

-- Acelera a contagem de PINs errados do restaurante (bloqueio por restaurante).
CREATE INDEX audit_log_pin_failed_idx ON audit_log (tenant_id, created_at)
  WHERE action = 'auth.pin_failed';
