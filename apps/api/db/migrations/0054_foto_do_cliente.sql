-- 0054: foto ou avatar do cliente no perfil do cardápio online.
--   * avatar: nome do avatar desenhado que o cliente escolheu (lista em @comandou/shared,
--     CUSTOMER_AVATARS). NULL = o automático, sorteado fixo pelo id da conta.
--   * photo/photo_type/photo_at: foto que o cliente enviou (o navegador recorta quadrado e reduz
--     para 320 px antes; aqui no máximo 1 MB). photo_at muda a cada troca e vai na URL.
-- Somente aditiva.

ALTER TABLE customers
  ADD COLUMN avatar text CHECK (avatar ~ '^[a-z0-9-]{1,24}$'),
  ADD COLUMN photo bytea CHECK (octet_length(photo) BETWEEN 1 AND 1048576),
  ADD COLUMN photo_type text CHECK (photo_type IN ('image/webp', 'image/jpeg', 'image/png')),
  ADD COLUMN photo_at timestamptz,
  ADD CONSTRAINT customers_photo_complete CHECK (
    (photo IS NULL) = (photo_type IS NULL) AND (photo IS NULL) = (photo_at IS NULL)
  );
