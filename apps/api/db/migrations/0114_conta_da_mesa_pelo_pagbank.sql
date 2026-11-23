-- 0114: a conta inteira da mesa (QR Code) paga pelo PagBank: Pix automático ou cartão. Somente
-- aditiva (o order_id passa a aceitar vazio só para a cobrança da comanda).
--
-- online_charges.tab_id: a cobrança é da comanda (todos os pedidos da mesa), não de um pedido.
--   Cada cobrança é de um pedido OU de uma comanda. Pago, o valor entra no caixa como Pix/crédito
--   nos pedidos da comanda, do mais antigo ao mais novo (como o comprovante aprovado).
-- online_charges.applied: quanto entrou nos pedidos ao lançar no caixa. O que passou do saldo da
--   comanda naquela hora (um item cancelado enquanto o cliente pagava) volta ao cliente pelo
--   PagBank (excess_refunded_at diz quando).
-- online_charge_payments: os pagamentos do caixa que uma cobrança da comanda criou (um por
--   pedido). O estorno de qualquer um deles vai ao PagBank antes, como o do pedido.

ALTER TABLE online_charges ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE online_charges
  ADD COLUMN tab_id uuid,
  ADD COLUMN applied numeric(14,2) CHECK (applied >= 0 AND applied <= amount),
  ADD COLUMN excess_refunded_at timestamptz,
  ADD CONSTRAINT online_charges_tab_fk FOREIGN KEY (tenant_id, tab_id)
    REFERENCES tabs(tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT online_charges_order_or_tab CHECK ((order_id IS NULL) <> (tab_id IS NULL));

CREATE INDEX online_charges_tab_idx ON online_charges(tenant_id, tab_id, created_at DESC)
  WHERE tab_id IS NOT NULL;
-- No máximo uma cobrança esperando por comanda.
CREATE UNIQUE INDEX online_charges_tab_one_pending ON online_charges(tab_id)
  WHERE status = 'pending' AND tab_id IS NOT NULL;
-- Varredura: sobra paga acima do saldo que ainda não voltou ao cliente.
CREATE INDEX online_charges_excess_idx ON online_charges(tenant_id, created_at)
  WHERE tab_id IS NOT NULL AND status = 'paid' AND applied IS NOT NULL
    AND excess_refunded_at IS NULL;

-- A varredura acha os restaurantes com algo a fazer pelo papel do painel (só lê estas colunas).
GRANT SELECT (tab_id, applied, excess_refunded_at) ON online_charges TO comandou_platform;

CREATE TABLE online_charge_payments (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  charge_id   uuid NOT NULL,
  payment_id  uuid NOT NULL,
  order_id    uuid NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id),
  FOREIGN KEY (tenant_id, charge_id)  REFERENCES online_charges(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id)       ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, order_id)   REFERENCES orders(tenant_id, id)         ON DELETE RESTRICT
);
CREATE INDEX online_charge_payments_charge_idx ON online_charge_payments(tenant_id, charge_id);
ALTER TABLE online_charge_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON online_charge_payments TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON online_charge_payments TO comandou_app;
