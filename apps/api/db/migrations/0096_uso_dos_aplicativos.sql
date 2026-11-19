-- 0096: Uso dos aplicativos de delivery e homologação (ADR 0015, Fase 9). Somente aditiva.
--
-- channel_usage: contagem por hora das chamadas aos aplicativos (endpoint e resultado), dos
-- pollings, dos acks, dos eventos e das consultas por pedido, para o Super Admin ver as regras de
-- uso indevido do iFood (ack ≥ 95%, erro de polling ≤ 1%, até 10 consultas por pedido). Sem loja,
-- pedido ou cliente: só canal, hora e rótulos fixos. Fica no banco central; guarda 35 dias.
-- A API grava só pela função app_channel_usage_add (SECURITY DEFINER); o painel só lê.
-- platform_channel_homologation: o roteiro de homologação de cada aplicativo, passo a passo,
-- marcado pela equipe no Super Admin.

CREATE TABLE channel_usage (
  channel text        NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  hour    timestamptz NOT NULL CHECK (date_trunc('hour', hour) = hour),
  metric  text        NOT NULL CHECK (metric IN ('request','poll','poll_acked','event','ack',
                                                 'order_lookup')),
  label   text        NOT NULL CHECK (label ~ '^[a-z0-9:_|.-]{1,120}$'),
  count   bigint      NOT NULL CHECK (count >= 0),
  PRIMARY KEY (channel, hour, metric, label)
);
CREATE INDEX channel_usage_hour_idx ON channel_usage (hour);

ALTER TABLE channel_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_read ON channel_usage FOR SELECT TO comandou_platform USING (true);
GRANT SELECT ON channel_usage TO comandou_platform;

-- Soma um lote ({channel, hour, metric, label, count}[]) e apaga o que passou de 35 dias.
CREATE FUNCTION app_channel_usage_add(p jsonb)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) > 2000 THEN
    RAISE EXCEPTION 'lote inválido';
  END IF;
  INSERT INTO channel_usage (channel, hour, metric, label, count)
  SELECT r.channel, date_trunc('hour', r.hour), r.metric, r.label, r.count
    FROM jsonb_to_recordset(p) AS r(channel text, hour timestamptz, metric text, label text, count bigint)
   WHERE r.count > 0
  ON CONFLICT (channel, hour, metric, label)
    DO UPDATE SET count = channel_usage.count + EXCLUDED.count;
  DELETE FROM channel_usage WHERE hour < now() - interval '35 days';
END $$;
REVOKE ALL ON FUNCTION app_channel_usage_add(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_channel_usage_add(jsonb) TO comandou_app;

CREATE TABLE platform_channel_homologation (
  channel    text        NOT NULL CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  step       text        NOT NULL CHECK (step ~ '^[a-z0-9_]{1,40}$'),
  done_at    timestamptz,
  done_by    uuid,
  note       text CHECK (length(note) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, step)
);
ALTER TABLE platform_channel_homologation ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_channel_homologation TO comandou_platform
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON platform_channel_homologation TO comandou_platform;

-- Para o painel: por credencial de polling, quantas lojas recebem pedidos e o último polling.
-- Só contagens e horários (nada de loja ou restaurante).
CREATE FUNCTION platform_channel_live()
  RETURNS TABLE (credential text, stores integer, last_poll_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT c.credential, count(*)::int, max(l.last_poll_at)
      FROM channel_store_claims c
      LEFT JOIN channel_poll_leases l ON l.credential = c.credential
     WHERE c.receive_orders
     GROUP BY c.credential
     ORDER BY c.credential
  $$;
REVOKE ALL ON FUNCTION platform_channel_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_channel_live() TO comandou_platform;
