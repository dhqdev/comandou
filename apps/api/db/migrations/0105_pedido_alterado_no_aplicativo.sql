-- 0105: Pedido alterado pelo cliente no aplicativo (ADR 0015). Somente aditiva.
--
-- A caixa de entrada (channel_inbox) passa a aceitar dois tipos novos de evento:
--   order.patched          o cliente mudou itens ou quantidades depois de confirmado
--                          (iFood ORDER_PATCHED, OPA);
--   order.address_changed  o cliente pediu outro endereço de entrega
--                          (iFood DELIVERY_ADDRESS_CHANGE_REQUESTED, DAR).
-- O Comandou não reescreve o pedido: grava um aviso na observação para a equipe conferir no portal.

ALTER TABLE channel_inbox DROP CONSTRAINT IF EXISTS channel_inbox_kind_check;
ALTER TABLE channel_inbox ADD CONSTRAINT channel_inbox_kind_check
  CHECK (kind IN ('order.created','order.confirmed','order.preparing',
                  'order.ready','order.dispatched','order.delivered','order.concluded',
                  'order.cancellation_requested','order.cancellation_denied','order.cancelled',
                  'order.dispute','order.dispute_settled','order.patched','order.address_changed',
                  'delivery.update','other'));
