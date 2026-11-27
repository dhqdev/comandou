-- 0130: foto de perfil de quem trabalha no restaurante (Conta › Meus dados).
--
-- Pedido do David: "coloque a minha foto na conversa" com o assistente de IA. A equipe só tinha
-- as iniciais. A foto é de cada pessoa em cada restaurante (como as preferências de tela da
-- 0127), fica numa tabela própria (bytea fora de memberships, que é lida o tempo todo) e é
-- privada: só sai pela rota da conta da própria pessoa, com a sessão dela.
--   * photo/photo_type: o navegador recorta quadrado e reduz para 320 px antes; aqui no máximo
--     1 MB e só WebP, JPEG ou PNG (a API confere a assinatura do arquivo).
--   * updated_at muda a cada troca e vai na URL (?v=), então o navegador pode guardar a foto.
-- Somente aditiva.

CREATE TABLE member_photos (
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  photo       bytea NOT NULL CHECK (octet_length(photo) BETWEEN 1 AND 1048576),
  photo_type  text NOT NULL CHECK (photo_type IN ('image/webp', 'image/jpeg', 'image/png')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);

ALTER TABLE member_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_photos TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON member_photos TO comandou_app;
