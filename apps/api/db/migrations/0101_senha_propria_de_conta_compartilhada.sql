-- 0101: trocar a própria senha de uma conta que também entra em outro restaurante pede a senha
-- atual.
--
-- A conta (e-mail e senha) é uma só em todos os restaurantes da pessoa (ver 0055). Uma sessão
-- neste restaurante não basta para mudar a senha que vale no outro: o administrador daqui pode ter
-- posto o e-mail da pessoa na própria equipe. Por isso:
--   app_set_own_password(hash)          (sem a senha atual) recusa conta compartilhada (42501);
--   app_set_own_password(hash, atual)   só troca se `atual` ainda for o hash gravado, que a API
--                                       acabou de conferir com a senha atual digitada.
-- Conta só deste restaurante continua trocando sem a senha atual. Somente aditiva.

CREATE OR REPLACE FUNCTION app_set_own_password(p_password_hash text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL OR NOT EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.user_id = app_current_user() AND m.tenant_id = app_current_tenant() AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
    END IF;
    -- Trava a conta: um vínculo novo em outro restaurante espera esta troca (ou esta o enxerga).
    PERFORM 1 FROM users u WHERE u.id = app_current_user() FOR UPDATE;
    IF app_member_account_shared(app_current_user()) THEN
      RAISE EXCEPTION 'conta usada em outro restaurante: confirme a senha atual' USING ERRCODE = '42501';
    END IF;
    UPDATE users SET password_hash = p_password_hash WHERE id = app_current_user();
  END $$;

-- Troca conferida pela senha atual: responde false (nada muda) se o hash já não é o atual.
CREATE FUNCTION app_set_own_password(p_password_hash text, p_current_hash text)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF app_current_user() IS NULL OR NOT EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.user_id = app_current_user() AND m.tenant_id = app_current_tenant() AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
    END IF;
    IF p_current_hash IS NULL THEN
      RETURN false;
    END IF;
    UPDATE users SET password_hash = p_password_hash
     WHERE id = app_current_user() AND password_hash = p_current_hash;
    RETURN FOUND;
  END $$;

REVOKE ALL ON FUNCTION app_set_own_password(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_set_own_password(text, text) TO comandou_app;
