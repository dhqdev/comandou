-- 0026: perfis da equipe mais enxutos e código de entrega (como o iFood).
-- 1) Os papéis Estoquista, Financeiro e Fiscal deixam de existir: quem tinha um deles passa a
--    Gerente (é quem tem essas telas agora). A lista válida fica: administrador, gerente, caixa,
--    PDV (atendente), garçom, cozinha e entregador.
-- 2) deliveries.confirm_code: 4 dígitos que o cliente recebe no acompanhamento do pedido (e no
--    WhatsApp) e o entregador digita para concluir a entrega. confirm_attempts conta os erros:
--    passou do limite, só o restaurante conclui. Corridas que já estavam na rua ficam sem código.

UPDATE memberships SET role = 'manager' WHERE role IN ('stock', 'finance', 'fiscal');
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('owner','manager','cashier','waiter','kitchen','driver','attendant'));

ALTER TABLE deliveries
  ADD COLUMN confirm_code     text CHECK (confirm_code IS NULL OR confirm_code ~ '^[0-9]{4}$'),
  ADD COLUMN confirm_attempts smallint NOT NULL DEFAULT 0;
