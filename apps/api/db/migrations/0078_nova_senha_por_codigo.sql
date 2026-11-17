-- 0078: "Esqueci minha senha" com código por e-mail em todas as telas de entrada (painel, PDV,
-- cozinha, entregas e Super Admin) e os avisos automáticos de teste grátis e cobrança.
--
-- 1) staff_password_resets (banco do restaurante): código de 6 números (só o hash), vale 15
--    minutos e aceita 5 tentativas. Código certo vira um token de uso único para gravar a senha
--    nova (tela 2 → tela 3). A senha só muda pela função app_reset_password_with_token.
-- 2) platform_password_resets (banco central): o mesmo para o Super Admin. Trocar a senha não
--    dispensa o código do autenticador no login.
-- 3) platform_lifecycle_mails: cada aviso (teste acabando, teste acabou, mensalidade vencendo,
--    vencida, paga) sai uma vez só por restaurante e assunto.
-- 4) mail_settings.lifecycle_enabled: liga e desliga esses avisos (Super Admin › E-mail).
-- Somente aditiva.

CREATE TABLE staff_password_resets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  code_hash    bytea NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  -- Código conferido: o token (só o hash) grava a senha nova uma vez, por pouco tempo.
  verified_at  timestamptz,
  token_hash   bytea UNIQUE,
  used_at      timestamptz,
  ip           text CHECK (length(ip) <= 100),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX staff_password_resets_user_idx
  ON staff_password_resets(tenant_id, user_id, created_at DESC);
ALTER TABLE staff_password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_password_resets
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON staff_password_resets TO comandou_app;
GRANT UPDATE (attempts, verified_at, token_hash, used_at) ON staff_password_resets TO comandou_app;

-- Grava a senha nova com o token de um código conferido (uso único, até 30 minutos depois de
-- conferir), só para membro ativo do restaurante. Devolve a pessoa, ou nada.
CREATE FUNCTION app_reset_password_with_token(p_tenant uuid, p_token_hash bytea, p_password_hash text)
  RETURNS TABLE (user_id uuid, email text, name text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_user uuid;
  BEGIN
    UPDATE staff_password_resets r SET used_at = now()
     WHERE r.tenant_id = p_tenant AND r.token_hash = p_token_hash AND r.used_at IS NULL
       AND r.verified_at IS NOT NULL AND r.verified_at > now() - interval '30 minutes'
    RETURNING r.user_id INTO v_user;
    IF v_user IS NULL OR NOT EXISTS (
      SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = p_tenant AND m.user_id = v_user AND m.status = 'active'
         AND u.disabled_at IS NULL
    ) THEN
      RETURN;
    END IF;
    UPDATE users SET password_hash = p_password_hash WHERE id = v_user;
    RETURN QUERY SELECT u.id, u.email::text, u.name FROM users u WHERE u.id = v_user;
  END $$;
REVOKE ALL ON FUNCTION app_reset_password_with_token(uuid, bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_reset_password_with_token(uuid, bytea, text) TO comandou_app;

CREATE TABLE platform_password_resets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  code_hash    bytea NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  verified_at  timestamptz,
  token_hash   bytea UNIQUE,
  used_at      timestamptz,
  ip           text CHECK (length(ip) <= 100),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_password_resets_admin_idx
  ON platform_password_resets(admin_id, created_at DESC);
ALTER TABLE platform_password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_password_resets TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON platform_password_resets TO comandou_platform;
GRANT UPDATE (attempts, verified_at, token_hash, used_at) ON platform_password_resets TO comandou_platform;
GRANT UPDATE (password_hash) ON platform_admins TO comandou_platform;

CREATE TABLE platform_lifecycle_mails (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- trial.ending, trial.ended, payment.due, payment.overdue, payment.blocked, payment.received
  kind        text NOT NULL CHECK (length(kind) <= 40),
  -- O que o aviso é: o dia do fim do teste ou a fatura (o mesmo aviso não sai duas vezes).
  ref         text NOT NULL CHECK (length(ref) <= 100),
  outbox_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, ref)
);
ALTER TABLE platform_lifecycle_mails ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_lifecycle_mails TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON platform_lifecycle_mails TO comandou_platform;
GRANT UPDATE (outbox_id) ON platform_lifecycle_mails TO comandou_platform;

ALTER TABLE mail_settings ADD COLUMN lifecycle_enabled boolean NOT NULL DEFAULT true;
