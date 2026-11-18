-- 0079: chamado dentro da conversa de suporte. A conversa de cada chamado saiu: o restaurante e a
-- Comandou falam só pela conversa de suporte (aba Suporte do chat / Super Admin › Conversas) e a
-- mensagem pode levar junto o chamado de que fala, que vira um cartão clicável dos dois lados.
-- Chamado apagado: a mensagem fica, sem o cartão. Somente aditiva.

ALTER TABLE platform_support_messages
  ADD COLUMN ticket_id uuid REFERENCES platform_tickets(id) ON DELETE SET NULL;
CREATE INDEX platform_support_messages_ticket_idx
  ON platform_support_messages(ticket_id) WHERE ticket_id IS NOT NULL;
