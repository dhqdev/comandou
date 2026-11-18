-- 0087: Pagamento feito no aplicativo de delivery (ADR 0015 §7, Fase 2) e loja do iFood religada. Somente aditiva.
--
-- Pedido pago no iFood (ou em outro aplicativo) não é dinheiro da gaveta: vira um pagamento com a
-- forma 'app', SEM sessão de caixa e SEM movimento de caixa, para não entrar no "esperado" do
-- fechamento. Guarda o canal e a forma real (crédito, pix, vale...) para a NFC-e e os relatórios.
-- Quem cria é o próprio aplicativo (sem usuário da equipe): created_by fica vazio só nessa forma.
-- Estorno de pagamento 'app' é do aplicativo: quando ele cancela, o Comandou zera o pago
-- (refunded_amount = amount), sem payment_refunds nem movimento de caixa.

ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash','credit','debit','pix','voucher','other','app'));
ALTER TABLE payments ALTER COLUMN cash_session_id DROP NOT NULL;
ALTER TABLE payments ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE payments
  ADD COLUMN app_channel text CHECK (app_channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  -- Forma real no aplicativo (a NFC-e não aceita "outros" quando a forma é conhecida).
  ADD COLUMN app_method  text CHECK (app_method IN ('cash','credit','debit','pix','voucher','other')),
  ADD COLUMN app_brand   text CHECK (length(app_brand) BETWEEN 1 AND 40),
  ADD CONSTRAINT payments_app_ck CHECK (
    ((method = 'app') = (app_channel IS NOT NULL))
    AND ((method = 'app') = (app_method IS NOT NULL))
    AND (method = 'app' OR (cash_session_id IS NOT NULL AND created_by IS NOT NULL))
    AND (method <> 'app' OR (cash_session_id IS NULL AND tendered IS NULL))
  );

-- Loja do iFood religada: a loja da camada de canais volta a apontar para a conexão do iFood.
GRANT UPDATE (ifood_connection_id) ON channel_stores TO comandou_app;
