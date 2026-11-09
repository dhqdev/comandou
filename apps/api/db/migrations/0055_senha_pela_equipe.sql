-- 0055: o administrador do restaurante define uma senha nova para alguém da equipe (esqueceu a
-- senha, trocou de celular). Antes só o painel Super Admin fazia isso.
--
-- A conta (e-mail e senha) é uma só em todos os restaurantes da pessoa. Por isso o administrador
-- só troca a senha de quem tem conta SÓ neste restaurante: se a mesma conta também entra em outro
-- restaurante, trocar aqui mudaria o acesso de lá, e um administrador poderia tomar a conta do
-- dono de outro restaurante só adicionando o e-mail dele à própria equipe. Nesse caso a própria
-- pessoa troca (Trocar minha senha) ou o suporte redefine pelo painel.
-- Somente aditiva.

-- A pessoa (membro deste restaurante) usa a mesma conta em outro restaurante (ou no painel)?
-- Para quem não é da equipe deste restaurante responde false: não revela nada de fora.
CREATE FUNCTION app_member_account_shared(p_user uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
             SELECT 1 FROM memberships m
              WHERE m.tenant_id = app_current_tenant() AND m.user_id = p_user)
       AND (EXISTS (
             SELECT 1 FROM memberships o
              WHERE o.user_id = p_user AND o.tenant_id <> app_current_tenant())
            OR EXISTS (SELECT 1 FROM users u WHERE u.id = p_user AND u.is_platform_admin))
  $$;

-- Grava a senha nova (hash) de um membro. Quem chama precisa ser administrador ativo deste
-- restaurante (a API também confere a permissão). Responde:
--   'ok'         senha trocada
--   'self'       é a própria conta (essa troca pede a senha atual: app_set_own_password)
--   'not_member' a pessoa não é da equipe deste restaurante
--   'shared'     a conta também entra em outro restaurante: não troca
CREATE FUNCTION app_set_member_password(p_user uuid, p_password_hash text)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := app_current_tenant();
    v_actor  uuid := app_current_user();
  BEGIN
    IF v_tenant IS NULL OR v_actor IS NULL OR NOT EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.tenant_id = v_tenant AND m.user_id = v_actor
         AND m.role = 'owner' AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
    END IF;
    IF p_user = v_actor THEN
      RETURN 'self';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = v_tenant AND m.user_id = p_user) THEN
      RETURN 'not_member';
    END IF;
    -- Trava a conta: um vínculo novo em outro restaurante (a chave estrangeira pede FOR KEY SHARE)
    -- espera esta troca terminar, ou esta espera ele e então o enxerga logo abaixo.
    PERFORM 1 FROM users u WHERE u.id = p_user FOR UPDATE;
    IF app_member_account_shared(p_user) THEN
      RETURN 'shared';
    END IF;
    UPDATE users SET password_hash = p_password_hash WHERE id = p_user;
    RETURN 'ok';
  END $$;

REVOKE ALL ON FUNCTION app_member_account_shared(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_set_member_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_member_account_shared(uuid) TO comandou_app;
GRANT EXECUTE ON FUNCTION app_set_member_password(uuid, text) TO comandou_app;

-- Senha redefinida zera o bloqueio por senhas erradas daquela conta (o login conta só as falhas
-- depois da última redefinição). Mesmo formato do índice das falhas (0008).
CREATE INDEX audit_log_password_reset_idx ON audit_log (tenant_id, (data->>'email'), created_at)
  WHERE action = 'user.password_reset';
