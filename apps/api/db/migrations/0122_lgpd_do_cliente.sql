-- 0122: pedidos de titular da LGPD pelo sistema (exportar e apagar os dados do cliente).
--
-- 1) app_phone_key(text): a chave do telefone para achar a mesma pessoa em tabelas diferentes
--    (DDD + 8 últimos dígitos, sem o 55): pega o número com e sem o nono dígito, como o WhatsApp
--    manda. Mesma regra da IA (`ordersIn`).
-- 2) privacy_requests: registro de cada pedido atendido (exportar ou apagar), SEM dado pessoal:
--    só quando, quem fez (o próprio cliente ou alguém da equipe) e quantas linhas mudaram. Serve
--    para provar que o pedido foi atendido.
-- 3) app_privacy_erase(cliente, telefone): apaga a conta e tira nome, telefone, e-mail, endereço e
--    CPF de tudo o que fica (pedidos, reservas, cobranças do fiado), numa transação só. Pedidos,
--    pagamentos e notas continuam (prazo fiscal); o CPF só fica no pedido com nota autorizada.
--    SECURITY DEFINER porque o papel do app não apaga clientes nem mexe nessas colunas, e o dono
--    ignora o RLS: TODO comando abaixo filtra por app_current_tenant().
-- Somente aditiva.

CREATE FUNCTION app_phone_key(p text)
  RETURNS text
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  AS $$
  DECLARE
    d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  BEGIN
    IF length(d) IN (12, 13) AND left(d, 2) = '55' THEN
      d := substr(d, 3);
    END IF;
    IF length(d) < 10 THEN
      RETURN NULL;
    END IF;
    RETURN left(d, 2) || right(d, 8);
  END $$;
GRANT EXECUTE ON FUNCTION app_phone_key(text) TO comandou_app;

CREATE TABLE privacy_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind          text NOT NULL CHECK (kind IN ('export','erase')),
  requested_by  text NOT NULL CHECK (requested_by IN ('customer','staff')),
  -- Quem da equipe atendeu (null quando foi o próprio cliente pelo cardápio).
  actor_user_id uuid,
  -- O que mudou (números, nunca nome ou telefone).
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX privacy_requests_tenant_idx ON privacy_requests(tenant_id, created_at DESC);
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON privacy_requests
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON privacy_requests TO comandou_app;

CREATE FUNCTION app_privacy_erase(p_customer uuid, p_phone text)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := app_current_tenant();
    v_key text;
    v_found boolean := false;
    v_ids uuid[];
    v_orders int := 0;
    v_reservations int := 0;
    v_chats int := 0;
    v_ai int := 0;
    v_messages int := 0;
    v_charges int := 0;
    v_tabs int := 0;
    v_customer int := 0;
    gone constant text := 'Cliente removido';
  BEGIN
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'sem restaurante' USING ERRCODE = '42501';
    END IF;

    IF p_customer IS NOT NULL THEN
      -- Trava a conta: dois pedidos de apagar ao mesmo tempo não se atropelam.
      SELECT app_phone_key(c.phone), true INTO v_key, v_found
        FROM customers c WHERE c.tenant_id = v_tenant AND c.id = p_customer FOR UPDATE;
      IF NOT coalesce(v_found, false) THEN
        RETURN jsonb_build_object('status', 'not_found');
      END IF;
    ELSE
      v_key := app_phone_key(p_phone);
      IF v_key IS NULL THEN
        RETURN jsonb_build_object('status', 'bad_phone');
      END IF;
    END IF;

    SELECT coalesce(array_agg(o.id), '{}') INTO v_ids FROM orders o
     WHERE o.tenant_id = v_tenant
       AND ((p_customer IS NOT NULL AND o.customer_id = p_customer)
            OR app_phone_key(o.customer_phone) = v_key
            OR app_phone_key(o.fiado_phone) = v_key);

    -- O que ainda está acontecendo trava o pedido (a tela explica o motivo).
    IF EXISTS (SELECT 1 FROM orders o
                WHERE o.tenant_id = v_tenant AND o.id = ANY(v_ids) AND o.status NOT IN ('completed','cancelled')) THEN
      RETURN jsonb_build_object('status', 'blocked', 'reason', 'open_order');
    END IF;
    IF EXISTS (SELECT 1 FROM orders o
                WHERE o.tenant_id = v_tenant AND o.id = ANY(v_ids) AND o.status <> 'cancelled'
                  AND o.payment_status <> 'paid'
                  AND (o.fiado_at IS NOT NULL OR o.receivable_at IS NOT NULL)) THEN
      RETURN jsonb_build_object('status', 'blocked', 'reason', 'owes');
    END IF;
    IF EXISTS (SELECT 1 FROM orders o
                WHERE o.tenant_id = v_tenant AND o.id = ANY(v_ids) AND o.pix_status = 'refund_due')
       OR EXISTS (SELECT 1 FROM online_charges oc
                   WHERE oc.tenant_id = v_tenant AND oc.order_id = ANY(v_ids) AND oc.status IN ('pending','refund_due')) THEN
      RETURN jsonb_build_object('status', 'blocked', 'reason', 'refund');
    END IF;
    IF EXISTS (SELECT 1 FROM reservations r
                WHERE r.tenant_id = v_tenant
                  AND ((p_customer IS NOT NULL AND r.customer_id = p_customer)
                       OR app_phone_key(r.phone) = v_key)
                  AND r.status IN ('pending','confirmed','seated')
                  AND r.starts_at > now() - interval '12 hours') THEN
      RETURN jsonb_build_object('status', 'blocked', 'reason', 'reservation');
    END IF;

    -- Pedidos: ficam (caixa, DRE e notas), sem quem pediu. CPF só com nota autorizada.
    UPDATE orders o
       SET customer_name = CASE WHEN o.customer_name IS NULL THEN NULL ELSE gone END,
           customer_phone = NULL,
           delivery_address = CASE WHEN o.delivery_address IS NULL THEN NULL ELSE gone END,
           delivery_lat = NULL,
           delivery_lng = NULL,
           fiado_name = CASE WHEN o.fiado_name IS NULL THEN NULL ELSE gone END,
           fiado_phone = NULL,
           tax_document = CASE
             WHEN EXISTS (SELECT 1 FROM fiscal_documents fd
                           WHERE fd.tenant_id = v_tenant AND fd.status = 'authorized'
                             AND (fd.order_id = o.id OR (o.tab_id IS NOT NULL AND fd.tab_id = o.tab_id)))
             THEN o.tax_document ELSE NULL END
     WHERE o.tenant_id = v_tenant AND o.id = ANY(v_ids);
    GET DIAGNOSTICS v_orders = ROW_COUNT;

    -- Nome da comanda (mesa) desses pedidos.
    UPDATE tabs t SET customer_name = gone
     WHERE t.tenant_id = v_tenant AND t.customer_name IS NOT NULL AND t.status <> 'open'
       AND EXISTS (SELECT 1 FROM orders o
                    WHERE o.tenant_id = v_tenant AND o.id = ANY(v_ids) AND o.tab_id = t.id);
    GET DIAGNOSTICS v_tabs = ROW_COUNT;

    -- Cobrança do fiado na agenda (as que ainda iam sair já travaram acima).
    UPDATE agenda_events e
       SET charge_name = CASE WHEN e.charge_name IS NULL THEN NULL ELSE gone END,
           charge_phone = NULL,
           charge_at = NULL
     WHERE e.tenant_id = v_tenant
       AND (app_phone_key(e.charge_phone) = v_key
            OR e.order_id = ANY(v_ids));
    GET DIAGNOSTICS v_charges = ROW_COUNT;

    -- Reservas antigas: ficam para o histórico do salão, sem nome, telefone e recados.
    UPDATE reservations r
       SET name = gone, phone = '0000000000', email = NULL, notes = NULL, occasion = NULL,
           customer_id = NULL
     WHERE r.tenant_id = v_tenant
       AND ((p_customer IS NOT NULL AND r.customer_id = p_customer)
            OR app_phone_key(r.phone) = v_key);
    GET DIAGNOSTICS v_reservations = ROW_COUNT;

    -- Conversas: com a loja (cardápio) e com a IA do WhatsApp, inteiras.
    DELETE FROM store_chats s
     WHERE s.tenant_id = v_tenant
       AND ((p_customer IS NOT NULL AND s.customer_id = p_customer)
            OR app_phone_key(s.phone) = v_key);
    GET DIAGNOSTICS v_chats = ROW_COUNT;
    DELETE FROM ai_customer_chats a
     WHERE a.tenant_id = v_tenant AND app_phone_key(a.phone) = v_key;
    GET DIAGNOSTICS v_ai = ROW_COUNT;

    -- Avisos de WhatsApp já enviados (o texto leva o nome) e códigos de confirmação.
    DELETE FROM message_outbox m
     WHERE m.tenant_id = v_tenant AND m.status <> 'queued' AND app_phone_key(m.to_phone) = v_key;
    GET DIAGNOSTICS v_messages = ROW_COUNT;
    DELETE FROM customer_phone_codes pc
     WHERE pc.tenant_id = v_tenant AND app_phone_key(pc.phone) = v_key;

    -- Login errado guarda o telefone digitado no histórico (para o bloqueio): sai o número.
    UPDATE audit_log a SET data = a.data - 'phone'
     WHERE a.tenant_id = v_tenant AND a.action = 'customer.login_failed'
       AND app_phone_key(a.data->>'phone') = v_key;

    -- A conta: leva junto endereços, sessões, foto, sacola, CPF, pontos, avaliações e códigos.
    IF p_customer IS NOT NULL THEN
      DELETE FROM customers c WHERE c.tenant_id = v_tenant AND c.id = p_customer;
      GET DIAGNOSTICS v_customer = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
      'status', 'ok',
      'account', v_customer > 0,
      'orders', v_orders,
      'tabs', v_tabs,
      'reservations', v_reservations,
      'chats', v_chats + v_ai,
      'messages', v_messages,
      'charges', v_charges);
  END $$;
REVOKE ALL ON FUNCTION app_privacy_erase(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_privacy_erase(uuid, text) TO comandou_app;
