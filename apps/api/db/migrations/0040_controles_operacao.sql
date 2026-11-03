-- 0040: controles do dia a dia que mexem com dinheiro e nota fiscal. Somente aditiva.
-- 1) orders.receivable_*: pedido concluído sem pagamento só como "a receber", com quem e por quê.
-- 2) deliveries.collect_*: acerto do entregador (o que ele recebeu na porta e quando o caixa conferiu).
-- 3) fiscal_documents.tab_id: uma NFC-e para a comanda inteira (mesa com várias rodadas).
-- 4) fiscal_documents.consult_url + tenant_fiscal_settings.print_nfce: cupom da NFC-e na térmica.
-- 5) order_items.cancel_*: cancelamento de um item do pedido, com motivo.
-- 6) salon_settings: taxa de serviço por comanda.
-- 7) tenant_store_settings.hours*: horário de funcionamento da loja online.

ALTER TABLE orders
  ADD COLUMN receivable_at     timestamptz,
  ADD COLUMN receivable_by     uuid,
  ADD COLUMN receivable_reason text CHECK (length(receivable_reason) <= 300);

ALTER TABLE deliveries
  ADD COLUMN collect_status text NOT NULL DEFAULT 'none'
             CHECK (collect_status IN ('none','pending','settled')),
  ADD COLUMN collect_amount numeric(14,2) CHECK (collect_amount >= 0),
  ADD COLUMN collect_method text
             CHECK (collect_method IN ('cash','credit','debit','pix','voucher','other')),
  ADD COLUMN settled_at     timestamptz,
  ADD COLUMN settled_by     uuid;
CREATE INDEX deliveries_collect_pending_idx ON deliveries(tenant_id, courier_id)
  WHERE collect_status = 'pending';

ALTER TABLE fiscal_documents
  ADD COLUMN tab_id      uuid,
  ADD COLUMN consult_url text,
  ADD CONSTRAINT fiscal_documents_tab_fk FOREIGN KEY (tenant_id, tab_id)
      REFERENCES tabs(tenant_id, id) ON DELETE RESTRICT;
-- No máximo uma nota viva por comanda (além da regra de uma por pedido).
-- A aplicação grava o link de consulta quando a nota é autorizada (tab_id nasce no INSERT e não muda).
GRANT UPDATE (consult_url) ON fiscal_documents TO comandou_app;
CREATE UNIQUE INDEX fiscal_documents_one_live_tab
  ON fiscal_documents(tenant_id, tab_id)
  WHERE tab_id IS NOT NULL AND status IN ('draft','pending','processing','authorized','cancelling');

ALTER TABLE tenant_fiscal_settings
  ADD COLUMN print_nfce boolean NOT NULL DEFAULT true;

ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_kind_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_kind_check
  CHECK (kind IN ('kitchen_ticket','receipt','test','fiscal_receipt','kitchen_cancel'));

ALTER TABLE order_items
  ADD COLUMN cancel_reason text CHECK (length(cancel_reason) <= 300),
  ADD COLUMN cancelled_by  uuid,
  ADD COLUMN cancelled_at  timestamptz;
-- Preço e produto seguem fixos; o cancelamento do item grava só quem, quando e por quê.
GRANT UPDATE (cancel_reason, cancelled_by, cancelled_at) ON order_items TO comandou_app;

CREATE TABLE salon_settings (
  tenant_id           uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  -- Taxa de serviço sugerida nas comandas (0 = desligada).
  service_fee_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (service_fee_percent BETWEEN 0 AND 30),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER salon_settings_updated_at BEFORE UPDATE ON salon_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE salon_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON salon_settings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON salon_settings TO comandou_app;

-- Comanda com taxa de serviço: o percentual vale para os pedidos da comanda; NULL = sem taxa.
ALTER TABLE tabs
  ADD COLUMN service_fee_percent numeric(5,2) CHECK (service_fee_percent BETWEEN 0 AND 30);

-- Horário por dia da semana: [{"day":0..6,"open":"HH:MM","close":"HH:MM"}]. close < open = passa da meia-noite.
ALTER TABLE tenant_store_settings
  ADD COLUMN hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN hours         jsonb NOT NULL DEFAULT '[]'::jsonb;
