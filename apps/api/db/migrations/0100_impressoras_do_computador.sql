-- 0100: O aplicativo de impressão conta, no heartbeat, quais impressoras escolheu em cada destino
-- (principal e setores), para a tela Impressão mostrar "PC do caixa: principal EPSON TM-T20" e
-- avisar quando o computador está online mas ainda sem impressora (os trabalhos ficam na fila).
-- Somente aditiva. O GRANT da tabela (0004) já cobre a coluna nova.

ALTER TABLE print_agents ADD COLUMN IF NOT EXISTS printers jsonb;
