-- 0058: Pix a devolver.
--
-- Pedido pago por Pix pelo cardápio pode ser cancelado (pelo cliente, enquanto está em análise, ou
-- pela loja) com o comprovante ainda esperando conferência: o cliente pode já ter pago e ninguém
-- era avisado de devolver. Agora o cancelamento deixa o pedido "Pix a devolver" até a equipe dizer
-- que devolveu ou que o Pix não chegou.
--
-- 1) orders.pix_status ganha refund_due (cancelado com comprovante esperando conferência) e
--    refunded (a equipe devolveu o valor pelo banco).
-- 2) pix_receipts.status ganha refunded (com quem marcou e quando, como aprovado e recusado).
-- 3) Os pedidos já cancelados nessa situação passam a aparecer como "a devolver".
-- Só amplia o que os dois campos aceitam; nada é apagado.

ALTER TABLE orders DROP CONSTRAINT orders_pix_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_pix_status_check
  CHECK (pix_status IN ('waiting','submitted','approved','rejected','refund_due','refunded'));
CREATE INDEX orders_pix_refund_idx ON orders(tenant_id, created_at)
  WHERE pix_status = 'refund_due';

ALTER TABLE pix_receipts DROP CONSTRAINT pix_receipts_status_check;
ALTER TABLE pix_receipts ADD CONSTRAINT pix_receipts_status_check
  CHECK (status IN ('submitted','approved','rejected','replaced','refunded'));
ALTER TABLE pix_receipts DROP CONSTRAINT pix_receipts_check;
ALTER TABLE pix_receipts ADD CONSTRAINT pix_receipts_check
  CHECK ((status IN ('approved','rejected','refunded')) = (reviewed_at IS NOT NULL));

UPDATE orders SET pix_status = 'refund_due'
 WHERE status = 'cancelled' AND pix_status = 'submitted';
