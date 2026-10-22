-- Painel admin: consumo e operação de cada restaurante. Só leitura e só agregados: contagens,
-- tamanhos e totais. Nada de nome, telefone ou endereço de cliente final.

-- Linhas e tamanho estimado dos dados de cada tabela com tenant_id (bytes das linhas, sem
-- índices). Sem restaurante: devolve todos, um por tabela e restaurante.
CREATE FUNCTION platform_tenant_footprint(p_tenant uuid DEFAULT NULL)
  RETURNS TABLE (tenant_id uuid, table_name text, row_count bigint, bytes bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name::text AS t
      FROM information_schema.columns c
      JOIN information_schema.tables x
        ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
       AND c.table_name NOT IN ('tenants', 'support_access_tokens')
     ORDER BY 1
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT tenant_id, %L::text, count(*)::bigint, coalesce(sum(pg_column_size(x.*)), 0)::bigint
         FROM %I x WHERE ($1::uuid IS NULL OR tenant_id = $1) GROUP BY tenant_id',
      r.t, r.t) USING p_tenant;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION platform_tenant_footprint(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_tenant_footprint(uuid) TO comandou_platform;

-- Operação de um restaurante nos últimos 30 dias, em um JSON.
CREATE FUNCTION platform_tenant_operation(p_tenant uuid)
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  WITH t AS (SELECT id, timezone FROM tenants WHERE id = p_tenant),
  o AS (
    SELECT o.* FROM orders o, t
     WHERE o.tenant_id = t.id AND o.created_at > now() - interval '30 days'
  ),
  paid AS (
    SELECT p.method, p.amount - p.refunded_amount AS net FROM payments p, t
     WHERE p.tenant_id = t.id AND p.created_at > now() - interval '30 days'
  )
  SELECT jsonb_build_object(
    'orders', jsonb_build_object(
      'total', (SELECT count(*) FROM o),
      'cancelled', (SELECT count(*) FROM o WHERE status = 'cancelled'),
      'revenue', (SELECT coalesce(sum(total), 0) FROM o WHERE status <> 'cancelled'),
      'avgTicket', (SELECT coalesce(round(avg(total), 2), 0) FROM o WHERE status <> 'cancelled'),
      'open', (SELECT count(*) FROM orders x, t WHERE x.tenant_id = t.id
                AND x.status IN ('new', 'in_production', 'ready', 'dispatched', 'cancel_requested')),
      'first', (SELECT min(created_at) FROM orders x, t WHERE x.tenant_id = t.id),
      'last', (SELECT max(created_at) FROM orders x, t WHERE x.tenant_id = t.id),
      'allTime', (SELECT count(*) FROM orders x, t WHERE x.tenant_id = t.id)
    ),
    'byChannel', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', channel, 'count', n, 'revenue', rev)
                    ORDER BY n DESC), '[]')
                    FROM (SELECT channel, count(*) n, coalesce(sum(total), 0) rev FROM o
                           WHERE status <> 'cancelled' GROUP BY channel) c),
    'byStatus', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', status, 'count', n) ORDER BY n DESC), '[]')
                   FROM (SELECT status, count(*) n FROM o GROUP BY status) c),
    'byDay', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d, 'count', n, 'revenue', rev) ORDER BY d), '[]')
                FROM (SELECT (o.created_at AT TIME ZONE (SELECT timezone FROM t))::date d,
                             count(*) n, coalesce(sum(total) FILTER (WHERE status <> 'cancelled'), 0) rev
                        FROM o GROUP BY 1) c),
    'byHour', (SELECT coalesce(jsonb_agg(jsonb_build_object('hour', h, 'count', n) ORDER BY h), '[]')
                 FROM (SELECT extract(hour FROM o.created_at AT TIME ZONE (SELECT timezone FROM t))::int h, count(*) n
                         FROM o GROUP BY 1) c),
    'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', method, 'count', n, 'amount', amt)
                   ORDER BY amt DESC), '[]')
                   FROM (SELECT method, count(*) n, coalesce(sum(net), 0) amt FROM paid GROUP BY method) c),
    'topProducts', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', q) ORDER BY q DESC), '[]')
                      FROM (SELECT oi.name, sum(oi.quantity)::numeric q
                              FROM order_items oi JOIN o ON o.id = oi.order_id AND o.status <> 'cancelled'
                             WHERE oi.tenant_id = p_tenant
                             GROUP BY oi.name ORDER BY q DESC LIMIT 8) c),
    'catalog', jsonb_build_object(
      'categories', (SELECT count(*) FROM categories x, t WHERE x.tenant_id = t.id),
      'products', (SELECT count(*) FROM products x, t WHERE x.tenant_id = t.id AND x.active),
      'soldOut', (SELECT count(*) FROM products x, t WHERE x.tenant_id = t.id AND x.active AND x.sold_out),
      'tables', (SELECT count(*) FROM dining_tables x, t WHERE x.tenant_id = t.id AND x.active),
      'sectors', (SELECT count(*) FROM production_sectors x, t WHERE x.tenant_id = t.id)
    ),
    'cash', jsonb_build_object(
      'openSessions', (SELECT count(*) FROM cash_sessions x, t WHERE x.tenant_id = t.id AND x.status = 'open'),
      'sessions30d', (SELECT count(*) FROM cash_sessions x, t WHERE x.tenant_id = t.id
                        AND x.opened_at > now() - interval '30 days'),
      'difference30d', (SELECT coalesce(sum(difference), 0) FROM cash_sessions x, t WHERE x.tenant_id = t.id
                          AND x.opened_at > now() - interval '30 days'),
      'openTabs', (SELECT count(*) FROM tabs x, t WHERE x.tenant_id = t.id AND x.status = 'open')
    ),
    'delivery', jsonb_build_object(
      'couriers', (SELECT count(*) FROM couriers x, t WHERE x.tenant_id = t.id AND x.active),
      'byStatus', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', status, 'count', n)), '[]')
                     FROM (SELECT status, count(*) n FROM deliveries x, t WHERE x.tenant_id = t.id
                              AND x.dispatched_at > now() - interval '30 days' GROUP BY status) c)
    ),
    'stock', jsonb_build_object(
      'items', (SELECT count(*) FROM stock_items x, t WHERE x.tenant_id = t.id AND x.active),
      'belowMin', (SELECT count(*) FROM stock_items x, t WHERE x.tenant_id = t.id AND x.active
                     AND x.quantity <= x.min_quantity)
    ),
    'fiscal', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', status, 'count', n)), '[]')
                 FROM (SELECT status, count(*) n FROM fiscal_documents x, t WHERE x.tenant_id = t.id
                          AND x.created_at > now() - interval '30 days' GROUP BY status) c),
    'messages', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', status, 'count', n)), '[]')
                   FROM (SELECT status, count(*) n FROM message_outbox x, t WHERE x.tenant_id = t.id
                            AND x.created_at > now() - interval '30 days' GROUP BY status) c),
    'printAgents', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'active', active,
                      'lastSeenAt', last_seen_at, 'version', version) ORDER BY name), '[]')
                      FROM print_agents x, t WHERE x.tenant_id = t.id),
    'printJobs', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', status, 'count', n)), '[]')
                    FROM (SELECT status, count(*) n FROM print_jobs x, t WHERE x.tenant_id = t.id
                             AND x.created_at > now() - interval '30 days' GROUP BY status) c),
    'users', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'orders30d', coalesce(oc.n, 0),
                'payments30d', coalesce(pc.n, 0)) ORDER BY u.id), '[]')
                FROM memberships m JOIN users u ON u.id = m.user_id
                LEFT JOIN (SELECT created_by, count(*) n FROM o GROUP BY created_by) oc ON oc.created_by = u.id
                LEFT JOIN (SELECT created_by, count(*) n FROM payments x
                            WHERE x.tenant_id = p_tenant AND x.created_at > now() - interval '30 days'
                            GROUP BY created_by) pc ON pc.created_by = u.id
               WHERE m.tenant_id = p_tenant)
  )
$$;
REVOKE ALL ON FUNCTION platform_tenant_operation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_tenant_operation(uuid) TO comandou_platform;
