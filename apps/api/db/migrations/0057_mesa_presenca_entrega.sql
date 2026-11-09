-- 0057: pedido pela mesa com o cliente no restaurante e pedido pronto que chega até a mesa.
--
-- 1) tenant_store_settings.table_check_location: quem pede pelo QR Code da mesa confirma a
--    localização do celular, conferida com o ponto da loja no mapa (store_lat/lng). Sem o ponto
--    marcado não há com o que comparar e o pedido segue como antes.
-- 2) tenant_store_settings.table_self_pickup: em vez de o garçom levar, o cliente busca o pedido
--    pronto no balcão e toca "Já peguei" no acompanhamento.
-- 3) orders.served_at/served_by: o pedido de mesa chegou na mesa (garçom tocou "Entreguei" ou o
--    cliente "Já peguei"; served_by fica NULL quando foi o cliente). Pedido pago e entregue
--    conclui na hora; a comanda paga inteira pelo Pix do cardápio fecha sozinha.
-- Somente aditiva.

ALTER TABLE tenant_store_settings
  ADD COLUMN table_check_location boolean NOT NULL DEFAULT true,
  ADD COLUMN table_self_pickup    boolean NOT NULL DEFAULT false;

ALTER TABLE orders
  ADD COLUMN served_at timestamptz,
  ADD COLUMN served_by uuid;

-- "Prontos para levar" do garçom: pedidos de mesa prontos que ainda não chegaram na mesa.
CREATE INDEX orders_ready_to_serve_idx ON orders(tenant_id, created_at)
  WHERE channel = 'table' AND status = 'ready' AND served_at IS NULL;
