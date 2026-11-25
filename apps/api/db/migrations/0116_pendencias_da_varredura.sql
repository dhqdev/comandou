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

-- 2) Cobrança do app paga acima do que o pedido devia --------------------------------------------
-- Pedido já quitado (ou cancelado) quando o pagamento do app chega: a cobrança vira refund_due e
-- volta inteira. Pedido que baixou de total enquanto o cliente pagava: entra o saldo e a sobra
-- volta pelo PagBank (applied < amount), como já era na conta da mesa (0114).
CREATE INDEX online_charges_excess_any_idx ON online_charges(tenant_id, created_at)
  WHERE status = 'paid' AND applied IS NOT NULL AND excess_refunded_at IS NULL;

-- 3) Estorno do PagBank dentro da transação do caixa ---------------------------------------------
-- O PagBank é chamado no meio da transação do estorno do caixa. Se ele devolveu e a transação do
-- caixa não gravou, o dinheiro saiu sem ninguém saber. Este registro é gravado à parte antes da
-- chamada ('sent'); vira 'done' junto com o estorno do caixa e 'failed' quando o PagBank recusa.
-- 'sent' parado é acertado pela varredura ('orphan': a cobrança mostra o devolvido e o histórico
-- do pedido avisa).
CREATE TABLE online_refund_journal (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  charge_id   uuid NOT NULL,
  payment_id  uuid NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  idem_key    text NOT NULL CHECK (length(idem_key) BETWEEN 1 AND 120),
  status      text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','done','failed','orphan')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Sem chave estrangeira para online_charges: é gravado à parte enquanto a transação do caixa
  -- trava a cobrança (a chave pediria uma trava na mesma linha e uma esperaria a outra).
  PRIMARY KEY (id)
);
CREATE INDEX online_refund_journal_sent_idx ON online_refund_journal(tenant_id, created_at)
  WHERE status = 'sent';
CREATE INDEX online_refund_journal_key_idx ON online_refund_journal(tenant_id, idem_key);
ALTER TABLE online_refund_journal ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON online_refund_journal
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_read ON online_refund_journal FOR SELECT TO comandou_platform USING (true);
GRANT SELECT, INSERT ON online_refund_journal TO comandou_app;
GRANT UPDATE (status) ON online_refund_journal TO comandou_app;
GRANT SELECT (tenant_id, status, created_at) ON online_refund_journal TO comandou_platform;

-- 4) PIN da equipe com 6 números e trava por aparelho -------------------------------------------
-- PIN novo tem 6 números (o de 4, de antes, continua entrando até o gerente gerar outro:
-- pin_digits vazio = 4). PINs errados contam por aparelho (cookie sorteado) e, para aparelho que
-- nunca entrou, no restaurante inteiro: um desconhecido errando não trava mais a equipe toda.
ALTER TABLE memberships ADD COLUMN pin_digits smallint CHECK (pin_digits IN (4, 6));
GRANT UPDATE (pin_digits) ON memberships TO comandou_app;

CREATE TABLE pin_devices (
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- sha256 do restaurante + cookie do aparelho (o cookie nunca é gravado como veio).
  device_hash    text NOT NULL CHECK (device_hash ~ '^[0-9a-f]{40}$'),
  trusted_until  timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_hash)
);
ALTER TABLE pin_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pin_devices
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON pin_devices TO comandou_app;
GRANT UPDATE (trusted_until) ON pin_devices TO comandou_app;
