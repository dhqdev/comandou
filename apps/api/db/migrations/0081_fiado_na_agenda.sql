-- 0081: Vender fiado ligado à Agenda pessoal (docs/agenda.md › Fiado).
--
-- 1) orders.fiado_*: quem ficou devendo, o WhatsApp dela e o dia/hora combinados para pagar.
--    Marcado por quem pode dar fiado (o mesmo poder do "a receber"); depois disso o pedido pode
--    ser concluído com saldo por qualquer pessoa do caixa (vira "a receber" sozinho).
-- 2) agenda_events: o compromisso de cobrança aponta para o pedido (order_id) e guarda para quem
--    vai a mensagem (charge_name/charge_phone). charge_at = quando o WhatsApp do restaurante manda
--    a cobrança para o cliente; charge_sent_at marca que já saiu (ou que não deu, com charge_error).
--    Se o pedido já estiver pago na hora, a mensagem não sai e o compromisso fica concluído.
-- Somente aditiva.

ALTER TABLE orders
  ADD COLUMN fiado_name   text CHECK (length(fiado_name) BETWEEN 1 AND 80),
  ADD COLUMN fiado_phone  text CHECK (fiado_phone ~ '^[0-9]{10,15}$'),
  ADD COLUMN fiado_due_at timestamptz,
  ADD COLUMN fiado_at     timestamptz,
  ADD COLUMN fiado_by     uuid;
-- Fiados por dia de pagar.
CREATE INDEX orders_fiado_idx ON orders(tenant_id, fiado_due_at) WHERE fiado_at IS NOT NULL;

ALTER TABLE agenda_events
  ADD COLUMN order_id        uuid,
  ADD COLUMN charge_name     text CHECK (length(charge_name) BETWEEN 1 AND 80),
  ADD COLUMN charge_phone    text CHECK (charge_phone ~ '^[0-9]{10,15}$'),
  ADD COLUMN charge_at       timestamptz,
  ADD COLUMN charge_sent_at  timestamptz,
  ADD COLUMN charge_error    text CHECK (length(charge_error) <= 300),
  ADD CONSTRAINT agenda_events_order_fk FOREIGN KEY (tenant_id, order_id)
    REFERENCES orders(tenant_id, id) ON DELETE SET NULL (order_id),
  ADD CONSTRAINT agenda_events_charge_ck CHECK (charge_at IS NULL OR charge_phone IS NOT NULL);
CREATE INDEX agenda_events_order_idx ON agenda_events(tenant_id, order_id) WHERE order_id IS NOT NULL;
-- Cobranças que ainda vão sair (a mesma varredura de minuto em minuto dos lembretes).
CREATE INDEX agenda_events_charge_due_idx ON agenda_events(charge_at)
  WHERE charge_at IS NOT NULL AND charge_sent_at IS NULL;

-- A varredura do painel só descobre QUAIS restaurantes têm cobrança vencida.
GRANT SELECT (charge_at, charge_sent_at) ON agenda_events TO comandou_platform;
