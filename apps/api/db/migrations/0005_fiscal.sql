-- Comandou — 0005 Etapa 5: nota fiscal ao consumidor (NFC-e) via Focus NFe.
-- O token da Focus NFe é guardado CIFRADO pela aplicação (AES-256-GCM, chave fora do banco).
-- Documentos fiscais nunca são apagados; cancelamento é um estado com motivo.

-- Dados fiscais do produto (NCM, CFOP, CSOSN/CST, origem, unidade).
ALTER TABLE products
  ADD COLUMN ncm           text CHECK (ncm IS NULL OR ncm ~ '^[0-9]{8}$'),
  ADD COLUMN cfop          text CHECK (cfop IS NULL OR cfop ~ '^[0-9]{4}$'),
  ADD COLUMN fiscal_code   text CHECK (fiscal_code IS NULL OR fiscal_code ~ '^[0-9]{2,3}$'),
  ADD COLUMN fiscal_origin smallint CHECK (fiscal_origin IS NULL OR fiscal_origin BETWEEN 0 AND 8),
  ADD COLUMN fiscal_unit   text CHECK (fiscal_unit IS NULL OR length(fiscal_unit) BETWEEN 1 AND 6);

CREATE TABLE tenant_fiscal_settings (
  tenant_id         uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  enabled           boolean NOT NULL DEFAULT false,
  environment       text NOT NULL DEFAULT 'homologacao' CHECK (environment IN ('homologacao','producao')),
  cnpj              text CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
  token_enc         bytea,          -- token Focus NFe cifrado (iv|tag|dados)
  token_last4       text,
  default_cfop      text NOT NULL DEFAULT '5102' CHECK (default_cfop ~ '^[0-9]{4}$'),
  default_code      text NOT NULL DEFAULT '102' CHECK (default_code ~ '^[0-9]{2,3}$'),
  default_ncm       text CHECK (default_ncm IS NULL OR default_ncm ~ '^[0-9]{8}$'),
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR (cnpj IS NOT NULL AND token_enc IS NOT NULL))
);

CREATE TABLE fiscal_documents (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  order_id         uuid NOT NULL,
  kind             text NOT NULL DEFAULT 'nfce' CHECK (kind IN ('nfce')),
  -- Referência única enviada à Focus NFe: reenviar a mesma referência nunca emite duas notas.
  ref              text NOT NULL CHECK (ref ~ '^[A-Za-z0-9_-]{8,50}$'),
  environment      text NOT NULL CHECK (environment IN ('homologacao','producao')),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','processing','authorized','rejected','error','cancelling','cancelled')),
  attempts         integer NOT NULL DEFAULT 0,
  total            numeric(14,2) NOT NULL CHECK (total > 0),
  request_payload  jsonb NOT NULL,
  provider_status  text,
  sefaz_status     text,
  sefaz_message    text,
  access_key       text,
  number           text,
  series           text,
  xml_path         text,
  danfe_path       text,
  qrcode_url       text,
  cancel_reason    text,
  last_error       text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  authorized_at    timestamptz,
  cancelled_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, ref),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE RESTRICT,
  CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);
-- No máximo uma nota "viva" por pedido (rejeitada/erro/cancelada permite emitir de novo).
CREATE UNIQUE INDEX fiscal_documents_one_live
  ON fiscal_documents(tenant_id, order_id)
  WHERE status IN ('pending','processing','authorized','cancelling');
CREATE INDEX fiscal_documents_created_idx ON fiscal_documents(tenant_id, created_at DESC);
CREATE TRIGGER fiscal_documents_updated_at BEFORE UPDATE ON fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_fiscal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_fiscal_settings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON fiscal_documents
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, UPDATE ON tenant_fiscal_settings TO comandou_app;
GRANT SELECT, INSERT ON fiscal_documents TO comandou_app;
-- O conteúdo enviado (payload, total, pedido, referência) não muda depois de criado.
GRANT UPDATE (status, attempts, provider_status, sefaz_status, sefaz_message, access_key, number, series,
              xml_path, danfe_path, qrcode_url, cancel_reason, last_error, authorized_at, cancelled_at, updated_at)
  ON fiscal_documents TO comandou_app;
