-- 0088: Conta › Meus dados. A própria pessoa troca o nome e o e-mail de entrada.
--
-- O papel do restaurante (comandou_app) só lê `users`. Esta função muda SÓ a conta de quem está
-- usando (app.user_id), que precisa ser membro ativo do restaurante da sessão. A API confere a
-- senha atual antes de mudar o e-mail (é o login da pessoa em todos os restaurantes dela).
-- Responde:
--   'ok'     dados gravados
--   'taken'  o e-mail já é de outra conta (nada muda)
-- Os dados do restaurante (nome, razão social, CPF/CNPJ...) ficam no banco central e são gravados
-- pela API com o papel da plataforma, como a cobrança já faz. Somente aditiva.

CREATE FUNCTION app_update_own_account(p_name text, p_email text)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_user uuid := app_current_user();
  BEGIN
    IF v_user IS NULL OR NOT EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.user_id = v_user AND m.tenant_id = app_current_tenant() AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
    END IF;
    IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 80 THEN
      RAISE EXCEPTION 'nome inválido' USING ERRCODE = '22023';
    END IF;
    IF p_email IS NOT NULL AND (length(p_email) > 254 OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
      RAISE EXCEPTION 'e-mail inválido' USING ERRCODE = '22023';
    END IF;
    -- Trava a conta: duas trocas ao mesmo tempo não se atropelam.
    PERFORM 1 FROM users u WHERE u.id = v_user FOR UPDATE;
    IF p_email IS NOT NULL
       AND EXISTS (SELECT 1 FROM users u WHERE u.email = p_email::citext AND u.id <> v_user) THEN
      RETURN 'taken';
    END IF;
    UPDATE users
       SET name = btrim(p_name),
           email = coalesce(p_email::citext, email)
     WHERE id = v_user;
    RETURN 'ok';
  EXCEPTION
    WHEN unique_violation THEN
      RETURN 'taken';
  END $$;

REVOKE ALL ON FUNCTION app_update_own_account(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_update_own_account(text, text) TO comandou_app;
