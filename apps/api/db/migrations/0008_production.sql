-- PedeMais — 0008 Etapa 7: endurecimento para produção.
-- 1. Índices para o bloqueio temporário por conta após muitas senhas erradas (restaurante e painel).
-- 2. Limpeza periódica de dados operacionais vencidos (LGPD e tamanho do banco). A função só
--    apaga sessões encerradas há mais de 90 dias e chaves de idempotência com mais de 30 dias, e
--    apaga a última posição do entregador 30 dias após a entrega terminar. Nada financeiro,
--    fiscal ou de auditoria é tocado. Esta migração em si é aditiva.

CREATE INDEX audit_log_login_failed_idx ON audit_log (tenant_id, (data->>'email'), created_at)
  WHERE action = 'auth.login_failed';
CREATE INDEX platform_audit_login_failed_idx ON platform_audit_log ((data->>'email'), created_at)
  WHERE action = 'platform.login_failed';

CREATE FUNCTION app_purge_expired()
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  n_sessions bigint;
  n_platform_sessions bigint;
  n_idempotency bigint;
  n_locations bigint;
BEGIN
  DELETE FROM sessions
   WHERE expires_at < now() - interval '90 days'
      OR revoked_at < now() - interval '90 days';
  GET DIAGNOSTICS n_sessions = ROW_COUNT;

  DELETE FROM platform_sessions
   WHERE expires_at < now() - interval '90 days'
      OR revoked_at < now() - interval '90 days';
  GET DIAGNOSTICS n_platform_sessions = ROW_COUNT;

  DELETE FROM idempotency_keys WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS n_idempotency = ROW_COUNT;

  UPDATE deliveries SET last_lat = NULL, last_lng = NULL
   WHERE finished_at < now() - interval '30 days' AND last_lat IS NOT NULL;
  GET DIAGNOSTICS n_locations = ROW_COUNT;

  RETURN jsonb_build_object(
    'sessions', n_sessions,
    'platformSessions', n_platform_sessions,
    'idempotencyKeys', n_idempotency,
    'deliveryLocations', n_locations);
END $$;
REVOKE ALL ON FUNCTION app_purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_purge_expired() TO pedemais_app;
