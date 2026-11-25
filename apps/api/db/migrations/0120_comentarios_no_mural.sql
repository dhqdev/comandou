-- Comentários nos recados do Mural: o Mural vira a "rede social" da equipe (publicar, reagir e
-- comentar). Quem escreveu o comentário (ou o gestor) apaga; apagar só marca deleted_at.
CREATE TABLE chat_post_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  post_id     uuid NOT NULL REFERENCES chat_posts(id) ON DELETE CASCADE,
  author_id   uuid,
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX chat_post_comments_post_idx ON chat_post_comments(tenant_id, post_id, created_at);

ALTER TABLE chat_post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chat_post_comments
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON chat_post_comments TO comandou_app;
