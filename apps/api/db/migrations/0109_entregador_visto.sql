-- 0109: situação de cada entregador na tela Entregas › Entregadores. Somente aditiva.
--
-- link_seen_at: última vez que o link do entregador (sem login) foi usado. Volta a NULL quando o
--               link é trocado ou desligado (assim dá para ver se o link novo já foi aberto).
-- app_seen_at:  última vez que o entregador com login abriu o app (/entregas).
-- Gravados no máximo a cada 30 s por entregador; servem só para "disponível/offline".
ALTER TABLE couriers
  ADD COLUMN link_seen_at timestamptz,
  ADD COLUMN app_seen_at timestamptz;
