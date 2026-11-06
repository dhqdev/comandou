-- 0053: sacola do cardápio online guardada na conta do cliente.
-- O cliente monta a sacola sem estar logado; ao entrar na conta, a sacola do aparelho se junta
-- com a que já estava na conta (de outro aparelho ou navegador) e passa a ficar salva nela.
-- Assim o pedido não se perde no login, nem ao trocar do navegador do WhatsApp para o do celular.
--   * online_cart: as linhas da sacola como o cardápio guarda (o servidor recalcula preço no
--     pedido; aqui é só para lembrar o que o cliente escolheu).
--   * online_cart_at: quando a sacola foi salva pela última vez (o aparelho compara com a dele).
-- Somente aditiva.

ALTER TABLE customers
  ADD COLUMN online_cart jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(online_cart) = 'array' AND jsonb_array_length(online_cart) <= 60),
  ADD COLUMN online_cart_at timestamptz;
