-- 0116: pendências altas e médias da varredura de 2026-11-25 (docs/varredura-2026-11-25.md).
-- Somente aditiva.

-- 1) Troca de senha derruba as sessões da conta nos outros restaurantes -----------------------
-- A conta (e-mail e senha) é uma só em todos os restaurantes do mesmo banco (0055). Trocar a senha
-- num deles (a própria, pelo "esqueci minha senha" ou pelo Super Admin) encerrava só as sessões
-- daquele restaurante: quem tinha a senha antiga seguia dentro dos outros. Agora o banco encerra
-- as sessões dos outros restaurantes sozinho; as deste restaurante continuam com a API (que mantém
-- a sessão de quem trocou).
CREATE FUNCTION app_password_changed_revoke() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
      UPDATE sessions SET revoked_at = now()
       WHERE user_id = NEW.id AND revoked_at IS NULL
         AND tenant_id IS DISTINCT FROM app_current_tenant();
    END IF;
    RETURN NEW;
  END $$;
REVOKE ALL ON FUNCTION app_password_changed_revoke() FROM PUBLIC;
CREATE TRIGGER users_password_changed_revoke AFTER UPDATE OF password_hash ON users
  FOR EACH ROW EXECUTE FUNCTION app_password_changed_revoke();
