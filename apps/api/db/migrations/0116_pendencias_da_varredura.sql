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

-- 5) Cadastro do cliente confirma o celular pelo WhatsApp --------------------------------------
-- Com o WhatsApp da loja mandando código, a conta nova só nasce com o código que chegou no
-- número. phone_verified_at: quando o telefone foi confirmado (código no cadastro, "esqueci a
-- senha" pelo WhatsApp ou cadastro feito pela equipe). Contas que já existiam ficam como
-- confirmadas (não dá para conferir agora).
ALTER TABLE customers ADD COLUMN phone_verified_at timestamptz;
UPDATE customers SET phone_verified_at = created_at;
GRANT UPDATE (phone_verified_at) ON customers TO comandou_app;

CREATE TABLE customer_phone_codes (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone       text NOT NULL CHECK (phone ~ '^[0-9]{10,13}$'),
  -- Só o hash (restaurante + telefone + código); o código nunca é gravado.
  code_hash   bytea NOT NULL,
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX customer_phone_codes_phone_idx ON customer_phone_codes(tenant_id, phone, created_at DESC);
ALTER TABLE customer_phone_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_phone_codes
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT ON customer_phone_codes TO comandou_app;
GRANT UPDATE (attempts, used_at) ON customer_phone_codes TO comandou_app;

-- 6) Loja de aplicativo ligada só pelo código espera a aprovação do Super Admin ------------------
-- Keeta, 99Food, Rappi, outros Open Delivery e o iFood centralizado ligam a loja pelo código dela,
-- sem provar que o restaurante é o dono. Agora a reserva nasce sem approved_at e nada acontece com
-- a loja (pedidos, estado, avaliações, repasses, cardápio) até o Super Admin aprovar. Quem autoriza
-- no próprio aplicativo (aiqfome pelo ID Magalu, iFood distribuído pelo código no portal) já nasce
-- aprovado. As reservas que já existiam ficam aprovadas.
ALTER TABLE channel_store_claims ADD COLUMN approved_at timestamptz;
ALTER TABLE channel_store_claims ADD COLUMN approved_by text
  CHECK (approved_by IS NULL OR length(approved_by) BETWEEN 1 AND 160);
-- Nome que o restaurante deu à loja (para o Super Admin conferir antes de aprovar).
ALTER TABLE channel_store_claims ADD COLUMN store_name text
  CHECK (store_name IS NULL OR length(store_name) BETWEEN 1 AND 160);
UPDATE channel_store_claims SET approved_at = created_at, approved_by = 'Antes da aprovação';
CREATE INDEX channel_store_claims_pending_idx ON channel_store_claims(created_at)
  WHERE approved_at IS NULL;
GRANT UPDATE (store_name, approved_at, approved_by) ON channel_store_claims TO comandou_app;

CREATE POLICY platform_all ON channel_store_claims TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, DELETE ON channel_store_claims TO comandou_platform;
GRANT UPDATE (approved_at, approved_by) ON channel_store_claims TO comandou_platform;

CREATE OR REPLACE FUNCTION app_channel_poll_targets()
  RETURNS TABLE (channel text, store_id text, tenant_id uuid, store_ref uuid, credential text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT c.channel, c.store_id, c.tenant_id, c.store_ref, c.credential
      FROM channel_store_claims c JOIN tenants t ON t.id = c.tenant_id
     WHERE c.receive_orders AND c.approved_at IS NOT NULL AND t.status = 'provisioned'
     ORDER BY c.credential, c.store_id
  $$;
