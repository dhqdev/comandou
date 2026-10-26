-- 0022: editor visual do salão. Cada mesa ganha um formato (quadrada, redonda ou retangular)
-- para o mapa do salão desenhar a mesa como ela é. Mesa que nunca teve comanda pode ser
-- excluída de vez (com histórico, a API só desativa). Somente aditiva.

ALTER TABLE dining_tables
  ADD COLUMN shape text NOT NULL DEFAULT 'square' CHECK (shape IN ('square','round','rect'));

GRANT DELETE ON dining_tables TO comandou_app;
