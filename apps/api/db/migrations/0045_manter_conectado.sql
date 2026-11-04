-- "Manter conectado": a sessão lembrada vale por semanas e se renova sozinha a cada uso, então
-- quem entrou uma vez no aparelho (inclusive o app instalado) não precisa entrar de novo.
ALTER TABLE sessions ADD COLUMN remember boolean NOT NULL DEFAULT false;
ALTER TABLE platform_sessions ADD COLUMN remember boolean NOT NULL DEFAULT false;
GRANT UPDATE (expires_at) ON platform_sessions TO comandou_platform;
