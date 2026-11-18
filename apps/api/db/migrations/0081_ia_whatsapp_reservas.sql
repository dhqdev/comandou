-- 0081: IA do WhatsApp faz reserva de mesa, manda o cardápio e o calendário de reservas em PDF,
-- guarda um resumo da conversa (memória longa) e se protege de abuso.
--
-- 1) ai_agent_settings: o gerente liga/desliga reserva pelo WhatsApp e o envio dos PDFs.
-- 2) ai_customer_chats:
--    - memory / memory_at: resumo do que importa dessa conversa (nome, preferências, o que já
--      foi combinado) até memory_at; a IA lê o resumo + as últimas mensagens depois dele.
--    - pending / pending_until: reserva (ou cancelamento) esperando o "SIM" do cliente. Quem
--      grava a reserva é o servidor, depois do SIM, nunca a IA sozinha.
--    - strikes / strikes_at / blocked_until: tentativas de tirar a IA do papel, assunto
--      indevido ou golpe; na terceira em 24 h a IA para de responder esse número por 24 h.
-- 3) reservations.source: 'whatsapp' (feita pela IA, com o telefone da própria conversa).
-- Somente aditiva.

ALTER TABLE ai_agent_settings
  ADD COLUMN take_reservations boolean NOT NULL DEFAULT true,
  ADD COLUMN send_pdfs boolean NOT NULL DEFAULT true;

ALTER TABLE ai_customer_chats
  ADD COLUMN memory text CHECK (length(memory) <= 1500),
  ADD COLUMN memory_at timestamptz,
  ADD COLUMN pending jsonb,
  ADD COLUMN pending_until timestamptz,
  ADD COLUMN strikes integer NOT NULL DEFAULT 0 CHECK (strikes >= 0),
  ADD COLUMN strikes_at timestamptz,
  ADD COLUMN blocked_until timestamptz;

ALTER TABLE reservations DROP CONSTRAINT reservations_source_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_source_check
  CHECK (source IN ('online','staff','whatsapp'));
