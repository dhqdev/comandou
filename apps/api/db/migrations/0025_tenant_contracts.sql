-- 0025: contrato digital de cada cliente, gerado e enviado pelo painel Super Admin.
-- 1) platform_contract_settings: dados da contratada (quem vende o Comandou), regras padrão do
--    contrato e o webhook do n8n que manda os e-mails. Uma linha só. O segredo do webhook fica
--    cifrado com a INTEGRATIONS_KEY (contexto "contracts:n8n") e nunca volta para o navegador.
-- 2) tenant_contracts: cada contrato gerado (texto congelado + PDF + hash). O cliente assina por um
--    link público de uso pessoal (só o hash do token fica aqui). Depois de assinado, o PDF final
--    (contrato + manifesto da assinatura) fica guardado e não muda mais.
-- 3) tenant_contract_events: trilha do contrato (gerado, enviado, aberto, lido até o fim, assinado,
--    aviso enviado), com IP e navegador. Vai para o manifesto do PDF assinado.
-- Só o painel (papel comandou_platform) lê e grava; nada é apagado. Somente aditiva.

CREATE TABLE platform_contract_settings (
  id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
  provider_name           text NOT NULL DEFAULT '' CHECK (length(provider_name) <= 160),
  provider_document       text NOT NULL DEFAULT '' CHECK (provider_document ~ '^([0-9]{11}|[0-9]{14})?$'),
  provider_address        text NOT NULL DEFAULT '' CHECK (length(provider_address) <= 240),
  provider_email          text NOT NULL DEFAULT '' CHECK (length(provider_email) <= 254),
  provider_representative text NOT NULL DEFAULT '' CHECK (length(provider_representative) <= 120),
  forum_city              text NOT NULL DEFAULT '' CHECK (length(forum_city) <= 80),
  due_day                 int NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
  term_months             int NOT NULL DEFAULT 12 CHECK (term_months BETWEEN 1 AND 60),
  sla_percent             numeric(5,2) NOT NULL DEFAULT 99.5 CHECK (sla_percent BETWEEN 90 AND 100),
  readjust_index          text NOT NULL DEFAULT 'IPCA/IBGE' CHECK (length(readjust_index) <= 40),
  late_fee_percent        numeric(5,2) NOT NULL DEFAULT 2 CHECK (late_fee_percent BETWEEN 0 AND 2),
  late_interest_percent   numeric(5,2) NOT NULL DEFAULT 1 CHECK (late_interest_percent BETWEEN 0 AND 10),
  suspend_after_days      int NOT NULL DEFAULT 15 CHECK (suspend_after_days BETWEEN 1 AND 90),
  support_hours           text NOT NULL DEFAULT 'segunda a sábado, das 9h às 18h (horário de Brasília)'
                            CHECK (length(support_hours) <= 160),
  webhook_url             text NOT NULL DEFAULT '' CHECK (webhook_url = '' OR webhook_url ~ '^https?://'),
  webhook_secret_enc      bytea,
  notify_email            text NOT NULL DEFAULT '' CHECK (length(notify_email) <= 254),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES platform_admins(id) ON DELETE SET NULL
);
INSERT INTO platform_contract_settings (id) VALUES (true);

CREATE TABLE tenant_contracts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number             text NOT NULL UNIQUE CHECK (number ~ '^CMD-[0-9]{4}-[0-9]{4,}$'),
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'cancelled')),
  -- Texto exato do contrato (JSON canônico). content_hash = sha256 deste texto.
  content            text NOT NULL,
  content_hash       text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  pdf                bytea NOT NULL,
  pdf_sha256         text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  signer_email       text CHECK (length(signer_email) <= 254),
  token_hash         bytea UNIQUE,
  token_expires_at   timestamptz,
  sent_at            timestamptz,
  viewed_at          timestamptz,
  read_at            timestamptz,
  signed_at          timestamptz,
  signer_name        text CHECK (length(signer_name) <= 120),
  signer_document    text CHECK (signer_document ~ '^[0-9]{11}$'),
  signer_ip          text CHECK (length(signer_ip) <= 64),
  signer_user_agent  text CHECK (length(signer_user_agent) <= 300),
  signature_kind     text CHECK (signature_kind IN ('drawn', 'typed')),
  signature_image    bytea,
  signed_pdf         bytea,
  signed_pdf_sha256  text CHECK (signed_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  notified_at        timestamptz,
  notify_error       text CHECK (length(notify_error) <= 300),
  cancelled_at       timestamptz,
  cancel_reason      text CHECK (length(cancel_reason) <= 300),
  created_by         uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'signed' OR (signed_pdf IS NOT NULL AND signed_at IS NOT NULL))
);
CREATE INDEX tenant_contracts_tenant ON tenant_contracts (tenant_id, created_at DESC);
CREATE TRIGGER tenant_contracts_updated_at BEFORE UPDATE ON tenant_contracts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Contrato assinado não muda mais (nem pelo painel): só o aviso de "enviado ao David" é gravado.
CREATE FUNCTION tenant_contracts_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'signed' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.pdf IS DISTINCT FROM OLD.pdf OR NEW.signed_pdf IS DISTINCT FROM OLD.signed_pdf
       OR NEW.signature_image IS DISTINCT FROM OLD.signature_image
       OR NEW.signer_name IS DISTINCT FROM OLD.signer_name
       OR NEW.signer_document IS DISTINCT FROM OLD.signer_document
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at) THEN
    RAISE EXCEPTION 'contrato assinado não pode ser alterado';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_contracts_frozen BEFORE UPDATE ON tenant_contracts
  FOR EACH ROW EXECUTE FUNCTION tenant_contracts_freeze();

CREATE TABLE tenant_contract_events (
  id          bigserial PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES tenant_contracts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('created', 'link', 'sent', 'opened', 'read', 'signed',
                                            'notified', 'notify_failed', 'cancelled')),
  ip          text CHECK (length(ip) <= 64),
  user_agent  text CHECK (length(user_agent) <= 300),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_contract_events_contract ON tenant_contract_events (contract_id, id);

ALTER TABLE platform_contract_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_contract_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_contract_settings TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON tenant_contracts TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON tenant_contract_events TO comandou_platform USING (true) WITH CHECK (true);

GRANT SELECT ON platform_contract_settings TO comandou_platform;
GRANT UPDATE (provider_name, provider_document, provider_address, provider_email,
              provider_representative, forum_city, due_day, term_months, sla_percent,
              readjust_index, late_fee_percent, late_interest_percent, suspend_after_days,
              support_hours, webhook_url, webhook_secret_enc, notify_email, updated_at, updated_by)
  ON platform_contract_settings TO comandou_platform;
GRANT SELECT, INSERT, UPDATE ON tenant_contracts TO comandou_platform;
GRANT SELECT, INSERT ON tenant_contract_events TO comandou_platform;
GRANT USAGE ON SEQUENCE tenant_contract_events_id_seq TO comandou_platform;
