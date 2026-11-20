-- 0104: Apagar trabalhos da fila de impressão. Somente aditiva.
--
-- 1) Os trabalhos tirados da fila antes da 0.208 ficaram como "Falhou" (com o aviso "Tirado da
--    fila na tela Impressão"): passam a "Tirado da fila" (cancelled), como os novos.
-- 2) A tela Impressão pode apagar trabalhos (um, os escolhidos ou o histórico por situação).
UPDATE print_jobs SET status = 'cancelled'
 WHERE status = 'failed' AND last_error = 'Tirado da fila na tela Impressão';

GRANT DELETE ON print_jobs TO comandou_app;
