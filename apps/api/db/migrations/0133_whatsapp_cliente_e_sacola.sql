-- 0133: cliente do WhatsApp pelo telefone ou pelo PIN, e a sacola do WhatsApp no cardápio.
--
-- Pedido do David (0.280): "quando perguntar quem é o cliente sempre pegue pelo número de
-- telefone e confirme e, caso não for, pegue o código que seria o PIN do cliente"; "quando ele
-- for adicionando os itens, quero que vá adicionando ao pedido do cliente lá no cardápio".
--
-- 1) ai_customer_chats.pin_fails / pin_fail_at: PIN errado no WhatsApp (6 números se adivinham).
--    O número da conversa tem poucas tentativas por dia; a conta fica no banco, não na conversa
--    (mandar "menu" não zera).
-- 2) customer_login_links: link de uso único, com prazo de 30 minutos, que o WhatsApp manda para o
--    próprio número da conta abrir o cardápio já dentro dela (e ver a sacola montada na conversa).
--    Só o hash do token é gravado.
-- Somente aditiva.

ALTER TABLE ai_customer_chats
  ADD COLUMN pin_fails integer NOT NULL DEFAULT 0 CHECK (pin_fails BETWEEN 0 AND 1000),
  ADD COLUMN pin_fail_at timestamptz;

CREATE TABLE customer_login_links (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL,
  token_hash   bytea NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX customer_login_links_customer_idx
  ON customer_login_links(tenant_id, customer_id, created_at DESC);
ALTER TABLE customer_login_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_login_links
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON customer_login_links TO comandou_app;
GRANT UPDATE (used_at) ON customer_login_links TO comandou_app;
