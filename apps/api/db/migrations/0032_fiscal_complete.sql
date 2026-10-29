-- 0030: módulo fiscal completo (NFC-e e NF-e pela Focus NFe). Somente aditiva.
-- 1) Padrões fiscais: a regra de tributação de cada item (CFOP, CST/CSOSN, PIS, COFINS, IPI,
--    IBS/CBS, benefício fiscal e tributos aproximados). O item usa, nesta ordem: o padrão ligado
--    ao produto, o padrão ligado ao NCM do produto, o padrão marcado como "padrão" da empresa e,
--    por último, os códigos padrão antigos da configuração (compatibilidade).
-- 2) NF-e (modelo 55) nos mesmos documentos fiscais da NFC-e: rascunho editável, destinatário,
--    operação (natureza, finalidade, presença, frete) e os problemas encontrados antes do envio.
--    Rascunho, rejeitada e erro podem ser corrigidos e reemitidos com a MESMA referência (a Focus
--    reaproveita o número); depois de enviado, o conteúdo não muda mais.
-- 3) Inutilização de numeração, carta de correção (CC-e) e notas recebidas (manifestação).
-- 4) Cliente ganha CPF/CNPJ e inscrição estadual (destinatário da nota).

-- ---------------------------------------------------------------- padrões fiscais
CREATE TABLE fiscal_rules (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code                text NOT NULL,
  name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- Em qual nota vale: as duas, só NFC-e ou só NF-e.
  scope               text NOT NULL DEFAULT 'all' CHECK (scope IN ('all','nfce','nfe')),
  active              boolean NOT NULL DEFAULT true,
  is_default          boolean NOT NULL DEFAULT false,
  cfop                text NOT NULL CHECK (cfop ~ '^[0-9]{4}$'),
  -- CFOP para venda a outro estado (NF-e). Vazio usa o CFOP com 6 no lugar do 5.
  cfop_interstate     text CHECK (cfop_interstate IS NULL OR cfop_interstate ~ '^[0-9]{4}$'),
  icms_cst            text NOT NULL CHECK (icms_cst ~ '^[0-9]{2,3}$'),
  icms_origin         smallint NOT NULL DEFAULT 0 CHECK (icms_origin BETWEEN 0 AND 8),
  icms_rate           numeric(5,2) CHECK (icms_rate IS NULL OR icms_rate BETWEEN 0 AND 100),
  icms_base_reduction numeric(5,2) CHECK (icms_base_reduction IS NULL OR icms_base_reduction BETWEEN 0 AND 100),
  pis_cst             text NOT NULL DEFAULT '49' CHECK (pis_cst ~ '^[0-9]{2}$'),
  pis_rate            numeric(6,4) CHECK (pis_rate IS NULL OR pis_rate BETWEEN 0 AND 100),
  cofins_cst          text NOT NULL DEFAULT '49' CHECK (cofins_cst ~ '^[0-9]{2}$'),
  cofins_rate         numeric(6,4) CHECK (cofins_rate IS NULL OR cofins_rate BETWEEN 0 AND 100),
  ipi_cst             text CHECK (ipi_cst IS NULL OR ipi_cst ~ '^[0-9]{2}$'),
  ipi_rate            numeric(5,2) CHECK (ipi_rate IS NULL OR ipi_rate BETWEEN 0 AND 100),
  -- Reforma tributária (IBS/CBS): CST de 3 dígitos e classificação tributária (cClassTrib) de 6.
  ibs_cbs_cst         text CHECK (ibs_cbs_cst IS NULL OR ibs_cbs_cst ~ '^[0-9]{3}$'),
  ibs_cbs_class       text CHECK (ibs_cbs_class IS NULL OR ibs_cbs_class ~ '^[0-9]{6}$'),
  cbs_rate            numeric(6,4) CHECK (cbs_rate IS NULL OR cbs_rate BETWEEN 0 AND 100),
  ibs_uf_rate         numeric(6,4) CHECK (ibs_uf_rate IS NULL OR ibs_uf_rate BETWEEN 0 AND 100),
  ibs_mun_rate        numeric(6,4) CHECK (ibs_mun_rate IS NULL OR ibs_mun_rate BETWEEN 0 AND 100),
  -- Código de benefício fiscal (cBenef), exigido em alguns estados para isenção/redução.
  benefit_code        text CHECK (benefit_code IS NULL OR benefit_code ~ '^[A-Z0-9]{8,10}$'),
  -- Percentual aproximado de tributos (Lei 12.741/2012, tabela IBPT) impresso no cupom.
  approx_tax_rate     numeric(5,2) CHECK (approx_tax_rate IS NULL OR approx_tax_rate BETWEEN 0 AND 100),
  notes               text CHECK (length(notes) <= 500),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX fiscal_rules_code_uq ON fiscal_rules(tenant_id, upper(code));
-- Um único padrão "padrão da empresa" por restaurante.
CREATE UNIQUE INDEX fiscal_rules_one_default ON fiscal_rules(tenant_id) WHERE is_default;
CREATE TRIGGER fiscal_rules_code BEFORE INSERT ON fiscal_rules
  FOR EACH ROW EXECUTE FUNCTION stock_fill_code('PF');
CREATE TRIGGER fiscal_rules_updated_at BEFORE UPDATE ON fiscal_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Padrão fiscal por NCM: todos os produtos com este NCM usam o padrão (se não tiverem um próprio).
CREATE TABLE fiscal_ncm_rules (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  ncm        text NOT NULL CHECK (ncm ~ '^[0-9]{8}$'),
  rule_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, ncm),
  FOREIGN KEY (tenant_id, rule_id) REFERENCES fiscal_rules(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE products
  ADD COLUMN fiscal_rule_id uuid,
  -- CEST: exigido nos produtos com substituição tributária (bebidas, por exemplo).
  ADD COLUMN cest text CHECK (cest IS NULL OR cest ~ '^[0-9]{7}$'),
  ADD FOREIGN KEY (tenant_id, fiscal_rule_id) REFERENCES fiscal_rules(tenant_id, id)
    ON DELETE SET NULL (fiscal_rule_id);

-- ---------------------------------------------------------------- configuração
ALTER TABLE tenant_fiscal_settings
  ADD COLUMN nfe_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN nfce_nature      text NOT NULL DEFAULT 'VENDA AO CONSUMIDOR' CHECK (length(nfce_nature) BETWEEN 1 AND 60),
  ADD COLUMN nfe_nature       text NOT NULL DEFAULT 'VENDA DE MERCADORIA' CHECK (length(nfe_nature) BETWEEN 1 AND 60),
  -- Texto que vai em "informações complementares" de toda nota.
  ADD COLUMN additional_info  text CHECK (length(additional_info) <= 2000),
  -- Emite a NFC-e sozinho quando o pedido fica totalmente pago.
  ADD COLUMN auto_emit_nfce   boolean NOT NULL DEFAULT false,
  -- Manda o DANFE/XML para o e-mail do cliente quando a nota é autorizada.
  ADD COLUMN email_customer   boolean NOT NULL DEFAULT false,
  -- Notas recebidas: última versão sincronizada com a Focus (consulta incremental).
  ADD COLUMN received_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN received_synced_at timestamptz;

-- ---------------------------------------------------------------- documentos (NFC-e e NF-e)
ALTER TABLE fiscal_documents DROP CONSTRAINT fiscal_documents_kind_check;
ALTER TABLE fiscal_documents ADD CONSTRAINT fiscal_documents_kind_check CHECK (kind IN ('nfce','nfe'));
ALTER TABLE fiscal_documents DROP CONSTRAINT fiscal_documents_status_check;
ALTER TABLE fiscal_documents ADD CONSTRAINT fiscal_documents_status_check CHECK (status IN
  ('draft','pending','processing','authorized','rejected','error','cancelling','cancelled','discarded'));
ALTER TABLE fiscal_documents
  -- Destinatário (CPF/CNPJ, nome, IE, endereço, e-mail). Na NFC-e é opcional, exceto no delivery.
  ADD COLUMN recipient    jsonb,
  ADD COLUMN customer_id  uuid,
  -- NF-e: natureza, finalidade, presença, frete, nota referenciada, padrão por linha, observações.
  ADD COLUMN operation    jsonb,
  -- Problemas achados antes de enviar (sem padrão fiscal, sem CPF no delivery...), em palavras simples.
  ADD COLUMN issues       jsonb,
  ADD COLUMN protocol     text,
  ADD COLUMN discarded_at timestamptz,
  ADD COLUMN discard_reason text CHECK (length(discard_reason) <= 255),
  ADD FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE SET NULL (customer_id);
CREATE INDEX fiscal_documents_kind_idx ON fiscal_documents(tenant_id, kind, created_at DESC);

-- Rascunho também conta como nota viva do pedido (não deixa emitir NFC-e e NF-e da mesma venda).
DROP INDEX fiscal_documents_one_live;
CREATE UNIQUE INDEX fiscal_documents_one_live
  ON fiscal_documents(tenant_id, order_id)
  WHERE status IN ('draft','pending','processing','authorized','cancelling');

-- Correção e reemissão: o conteúdo só muda enquanto a nota não foi aceita pela SEFAZ.
GRANT UPDATE (request_payload, recipient, customer_id, operation, issues, protocol, discarded_at, discard_reason, total)
  ON fiscal_documents TO comandou_app;
CREATE FUNCTION fiscal_documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.request_payload IS DISTINCT FROM OLD.request_payload
      OR NEW.recipient IS DISTINCT FROM OLD.recipient
      OR NEW.operation IS DISTINCT FROM OLD.operation
      OR NEW.total IS DISTINCT FROM OLD.total)
     AND OLD.status NOT IN ('draft','rejected','error') THEN
    RAISE EXCEPTION 'nota fiscal já enviada não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('authorized','cancelling','cancelled') AND NEW.status = 'discarded' THEN
    RAISE EXCEPTION 'nota autorizada não pode ser descartada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_documents_guard BEFORE UPDATE ON fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION fiscal_documents_guard();

-- Eventos da nota: carta de correção (CC-e) e envio por e-mail.
CREATE TABLE fiscal_events (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  document_id   uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('correction','email')),
  sequence      integer,
  text          text NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
  status        text NOT NULL CHECK (status IN ('authorized','rejected','sent','error')),
  sefaz_status  text,
  sefaz_message text,
  xml_path      text,
  pdf_path      text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES fiscal_documents(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX fiscal_events_doc_idx ON fiscal_events(tenant_id, document_id, created_at);

-- ---------------------------------------------------------------- inutilização
CREATE TABLE fiscal_voids (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind          text NOT NULL CHECK (kind IN ('nfce','nfe')),
  environment   text NOT NULL CHECK (environment IN ('homologacao','producao')),
  series        integer NOT NULL CHECK (series BETWEEN 0 AND 999),
  number_from   integer NOT NULL CHECK (number_from >= 1),
  number_to     integer NOT NULL,
  reason        text NOT NULL CHECK (length(reason) BETWEEN 15 AND 255),
  status        text NOT NULL CHECK (status IN ('authorized','rejected','error')),
  sefaz_status  text,
  sefaz_message text,
  protocol      text,
  xml_path      text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (number_to >= number_from AND number_to - number_from < 10000)
);
CREATE INDEX fiscal_voids_created_idx ON fiscal_voids(tenant_id, created_at DESC);

-- ---------------------------------------------------------------- notas recebidas (fornecedores)
CREATE TABLE fiscal_received (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  access_key       text NOT NULL CHECK (access_key ~ '^[0-9]{44}$'),
  issuer_name      text,
  issuer_document  text,
  total            numeric(14,2),
  issued_at        timestamptz,
  situation        text NOT NULL DEFAULT 'autorizada' CHECK (situation IN ('autorizada','cancelada','denegada')),
  manifestation    text CHECK (manifestation IN ('ciencia','confirmacao','desconhecimento','nao_realizada')),
  manifested_at    timestamptz,
  manifest_reason  text CHECK (length(manifest_reason) <= 255),
  complete         boolean NOT NULL DEFAULT false,
  version          bigint NOT NULL DEFAULT 0,
  nfe_type         text,
  correction_text  text,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, access_key)
);
CREATE INDEX fiscal_received_issued_idx ON fiscal_received(tenant_id, issued_at DESC);
CREATE TRIGGER fiscal_received_updated_at BEFORE UPDATE ON fiscal_received
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- cliente (destinatário)
ALTER TABLE customers
  ADD COLUMN document           text CHECK (document IS NULL OR document ~ '^([0-9]{11}|[0-9]{14})$'),
  ADD COLUMN state_registration text CHECK (state_registration IS NULL OR state_registration ~ '^([0-9]{2,14}|ISENTO)$'),
  -- 1 contribuinte de ICMS; 2 contribuinte isento; 9 não contribuinte.
  ADD COLUMN ie_indicator       smallint CHECK (ie_indicator IS NULL OR ie_indicator IN (1,2,9));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fiscal_rules','fiscal_ncm_rules','fiscal_events','fiscal_voids','fiscal_received']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_rules, fiscal_ncm_rules TO comandou_app;
GRANT SELECT, INSERT ON fiscal_events, fiscal_voids TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON fiscal_received TO comandou_app;

-- ---------------------------------------------------------------- CPF/CNPJ na nota
-- Pedido no caixa: o cliente diz o CPF ao pagar e a NFC-e (manual ou automática) sai com ele.
ALTER TABLE orders ADD COLUMN tax_document text
  CHECK (tax_document IS NULL OR tax_document ~ '^([0-9]{11}|[0-9]{14})$');

-- ---------------------------------------------------------------- painel da plataforma
-- Situação fiscal de cada restaurante, sem segredos (nada de token, certificado ou CSC).
CREATE FUNCTION platform_fiscal_overview()
  RETURNS TABLE (tenant_id uuid, enabled boolean, nfe_enabled boolean, mode text, environment text,
                 cnpj text, focus_registered boolean, certificate_valid_until timestamptz,
                 authorized_30d bigint, failed_7d bigint, pending_now bigint, last_authorized_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.tenant_id, s.enabled, s.nfe_enabled, s.mode, s.environment, s.cnpj,
      s.focus_company_id IS NOT NULL, s.certificate_valid_until,
      (SELECT count(*) FROM fiscal_documents f WHERE f.tenant_id = s.tenant_id AND f.status = 'authorized'
          AND f.authorized_at > now() - interval '30 days'),
      (SELECT count(*) FROM fiscal_documents f WHERE f.tenant_id = s.tenant_id AND f.status IN ('error','rejected')
          AND f.created_at > now() - interval '7 days'),
      (SELECT count(*) FROM fiscal_documents f WHERE f.tenant_id = s.tenant_id
          AND f.status IN ('pending','processing','cancelling')),
      (SELECT max(f.authorized_at) FROM fiscal_documents f WHERE f.tenant_id = s.tenant_id)
    FROM tenant_fiscal_settings s
  $$;
REVOKE ALL ON FUNCTION platform_fiscal_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_fiscal_overview() TO comandou_platform;
