-- 0030: contrato com duas assinaturas, na ordem certa, e trilha à prova de alteração.
-- Regras (docs/contratos.md):
-- 1) O cliente (CONTRATANTE) assina primeiro, pelo link pessoal. O contrato fica em
--    'client_signed' (aguardando a assinatura da CONTRATADA) e a assinatura dele não muda mais.
-- 2) A CONTRATADA assina depois, no painel, com o código do autenticador. Só então o contrato
--    vira 'signed' e o PDF final (contrato + rubricas + manifesto das duas assinaturas) é gerado.
-- 3) Cada evento da trilha guarda o hash do anterior (cadeia SHA-256): apagar, trocar ou inserir
--    um evento no meio quebra a cadeia, e o hash final vai impresso no manifesto.
-- Contratos já assinados antes desta versão continuam 'signed' (sem contra-assinatura).
-- Somente aditiva.

ALTER TABLE tenant_contracts DROP CONSTRAINT IF EXISTS tenant_contracts_status_check;
ALTER TABLE tenant_contracts ADD CONSTRAINT tenant_contracts_status_check
  CHECK (status IN ('draft', 'sent', 'viewed', 'client_signed', 'signed', 'cancelled'));

ALTER TABLE tenant_contracts
  -- Localização que o navegador do cliente informou (só se ele permitiu): {lat, lng, accuracy}.
  ADD COLUMN signer_geo                 jsonb,
  -- Cabeçalho X-Forwarded-For como chegou (informativo; o IP que vale é signer_ip).
  ADD COLUMN signer_forwarded_for       text CHECK (length(signer_forwarded_for) <= 300),
  -- sha256 do registro da assinatura do cliente (texto, nome, CPF, e-mail, hora, IP, imagem...).
  ADD COLUMN client_evidence_sha256     text CHECK (client_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN countersigned_at           timestamptz,
  ADD COLUMN countersigner_admin_id     uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  ADD COLUMN countersigner_name         text CHECK (length(countersigner_name) <= 120),
  ADD COLUMN countersigner_document     text CHECK (countersigner_document ~ '^[0-9]{11}$'),
  ADD COLUMN countersigner_email        text CHECK (length(countersigner_email) <= 254),
  ADD COLUMN countersigner_ip           text CHECK (length(countersigner_ip) <= 64),
  ADD COLUMN countersigner_user_agent   text CHECK (length(countersigner_user_agent) <= 300),
  ADD COLUMN countersigner_geo          jsonb,
  ADD COLUMN countersign_kind           text CHECK (countersign_kind IN ('drawn', 'typed')),
  ADD COLUMN countersign_image          bytea,
  ADD COLUMN countersign_evidence_sha256 text CHECK (countersign_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  -- Hash final da cadeia de eventos no momento da assinatura completa (vai no manifesto).
  ADD COLUMN trail_sha256               text CHECK (trail_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT tenant_contracts_client_signed_check
    CHECK (status <> 'client_signed' OR (signed_at IS NOT NULL AND client_evidence_sha256 IS NOT NULL)),
  ADD CONSTRAINT tenant_contracts_countersign_order_check
    CHECK (countersigned_at IS NULL OR (signed_at IS NOT NULL AND countersigned_at >= signed_at));

-- CPF de quem assina pela contratada (preenche o formulário da contra-assinatura).
ALTER TABLE platform_contract_settings
  ADD COLUMN provider_representative_document text NOT NULL DEFAULT ''
    CHECK (provider_representative_document ~ '^([0-9]{11})?$');
GRANT UPDATE (provider_representative_document) ON platform_contract_settings TO comandou_platform;

-- Assinatura do cliente não muda depois de feita; contrato completo não muda mais nada
-- (só o registro do aviso por e-mail); de 'client_signed' só se vai para 'signed' ou 'cancelled'.
CREATE OR REPLACE FUNCTION tenant_contracts_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
       NEW.content IS DISTINCT FROM OLD.content OR NEW.pdf IS DISTINCT FROM OLD.pdf
       OR NEW.signature_image IS DISTINCT FROM OLD.signature_image
       OR NEW.signature_kind IS DISTINCT FROM OLD.signature_kind
       OR NEW.signer_name IS DISTINCT FROM OLD.signer_name
       OR NEW.signer_document IS DISTINCT FROM OLD.signer_document
       OR NEW.signer_email IS DISTINCT FROM OLD.signer_email
       OR NEW.signer_ip IS DISTINCT FROM OLD.signer_ip
       OR NEW.signer_user_agent IS DISTINCT FROM OLD.signer_user_agent
       OR NEW.signer_geo IS DISTINCT FROM OLD.signer_geo
       OR NEW.client_evidence_sha256 IS DISTINCT FROM OLD.client_evidence_sha256
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at) THEN
    RAISE EXCEPTION 'contrato assinado não pode ser alterado';
  END IF;
  IF OLD.status = 'signed' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.signed_pdf IS DISTINCT FROM OLD.signed_pdf
       OR NEW.signed_pdf_sha256 IS DISTINCT FROM OLD.signed_pdf_sha256
       OR NEW.countersigned_at IS DISTINCT FROM OLD.countersigned_at
       OR NEW.countersigner_name IS DISTINCT FROM OLD.countersigner_name
       OR NEW.countersigner_document IS DISTINCT FROM OLD.countersigner_document
       OR NEW.countersign_image IS DISTINCT FROM OLD.countersign_image
       OR NEW.countersign_evidence_sha256 IS DISTINCT FROM OLD.countersign_evidence_sha256
       OR NEW.trail_sha256 IS DISTINCT FROM OLD.trail_sha256) THEN
    RAISE EXCEPTION 'contrato assinado não pode ser alterado';
  END IF;
  IF OLD.status = 'client_signed' AND NEW.status NOT IN ('client_signed', 'signed', 'cancelled') THEN
    RAISE EXCEPTION 'contrato assinado pelo cliente só pode ser contra-assinado ou cancelado';
  END IF;
  IF NEW.status = 'signed' AND OLD.status <> 'signed' AND OLD.status <> 'client_signed' THEN
    RAISE EXCEPTION 'a contratada só assina depois do cliente';
  END IF;
  RETURN NEW;
END $$;

-- Trilha encadeada: hash = sha256(hash anterior + evento). Eventos antigos ficam sem hash.
ALTER TABLE tenant_contract_events
  ADD COLUMN prev_hash text CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN hash      text CHECK (hash ~ '^[0-9a-f]{64}$');
ALTER TABLE tenant_contract_events DROP CONSTRAINT IF EXISTS tenant_contract_events_kind_check;
ALTER TABLE tenant_contract_events ADD CONSTRAINT tenant_contract_events_kind_check
  CHECK (kind IN ('created', 'link', 'sent', 'opened', 'read', 'signed', 'countersigned',
                  'countersign_denied', 'notified', 'notify_failed', 'cancelled'));
