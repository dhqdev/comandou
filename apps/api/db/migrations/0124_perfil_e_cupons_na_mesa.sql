-- 0124: perfil e cupons do cliente no cardápio da mesa (QR Code).
--
-- tenant_store_settings.table_account: aba Perfil no cardápio da mesa (dados, CPF, avisos e a
--   loja; nada de entrega). Vale só com as contas de cliente ligadas.
-- tenant_store_settings.table_coupons: o cliente usa os cupons da conta no pedido da mesa (pede o
--   Perfil na mesa).
-- Somente aditiva.

ALTER TABLE tenant_store_settings
  ADD COLUMN table_account boolean NOT NULL DEFAULT true,
  ADD COLUMN table_coupons boolean NOT NULL DEFAULT true;
