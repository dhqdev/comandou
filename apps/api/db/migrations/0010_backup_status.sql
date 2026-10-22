-- PedeMais — 0010 Etapa 7: idade do último backup e do último teste de restauração para as
-- métricas (alertas). A API (pedemais_app) não lê backup_runs; esta função devolve só os dois
-- horários, sem nome de arquivo nem erro. Somente aditiva.
CREATE FUNCTION app_backup_status()
  RETURNS TABLE (kind text, last_ok_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT k.kind, (SELECT max(finished_at) FROM backup_runs b WHERE b.kind = k.kind AND b.status = 'ok')
      FROM (VALUES ('backup'), ('restore_test')) AS k(kind)
  $$;
REVOKE ALL ON FUNCTION app_backup_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_backup_status() TO pedemais_app;
