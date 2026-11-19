-- 0090: Loja aberta, fechada ou pausada nos aplicativos de delivery (ADR 0015, Fase 4). Somente aditiva.
--
-- channel_stores ganha a situação da loja no aplicativo (lida com calma: no máximo a cada minuto
-- pela tela e a cada 5 minutos pela varredura), a pausa feita pelo Comandou (o id da interrupção no
-- aplicativo, até quando e o motivo) e os horários que o aplicativo tem (só para mostrar).
-- follow_store_open: fechar a loja no Comandou ("Loja fechada" no PDV) pausa a loja no aplicativo
-- e reabrir tira a pausa (padrão ligado).

ALTER TABLE channel_stores
  ADD COLUMN channel_state     text CHECK (channel_state IN ('open','closed','paused','warning','error','unknown')),
  ADD COLUMN state_title       text CHECK (length(state_title) <= 200),
  ADD COLUMN state_detail      text CHECK (length(state_detail) <= 300),
  ADD COLUMN state_at          timestamptz,
  ADD COLUMN state_error       text CHECK (length(state_error) <= 300),
  ADD COLUMN pause_id          text CHECK (length(pause_id) BETWEEN 1 AND 100),
  ADD COLUMN pause_until       timestamptz,
  ADD COLUMN pause_reason      text CHECK (length(pause_reason) <= 200),
  ADD COLUMN pause_by_store    boolean NOT NULL DEFAULT false,
  ADD COLUMN follow_store_open boolean NOT NULL DEFAULT true,
  ADD COLUMN opening_hours     jsonb,
  ADD COLUMN hours_at          timestamptz;

GRANT UPDATE (channel_state, state_title, state_detail, state_at, state_error, pause_id, pause_until,
              pause_reason, pause_by_store, follow_store_open, opening_hours, hours_at)
  ON channel_stores TO comandou_app;
