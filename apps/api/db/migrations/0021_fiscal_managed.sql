-- Comandou — 0021: NFC-e no modo revenda (Focus NFe com o token master do Comandou).
-- No modo "managed" o restaurante não tem conta na Focus: o Comandou cadastra a empresa pela API
-- de empresas (certificado A1 + CSC) e guarda os dois tokens que a Focus devolve, CIFRADOS.
-- O modo "own" (o restaurante cola o próprio token) continua igual.
-- O certificado e a senha nunca são guardados aqui: vão direto para a Focus.

ALTER TABLE tenant_fiscal_settings
  ADD COLUMN mode                   text NOT NULL DEFAULT 'own' CHECK (mode IN ('own','managed')),
  ADD COLUMN focus_company_id       text CHECK (focus_company_id IS NULL OR focus_company_id ~ '^[0-9]{1,20}$'),
  ADD COLUMN token_homolog_enc      bytea,   -- token de homologação devolvido pela Focus (iv|tag|dados)
  ADD COLUMN token_prod_enc         bytea,   -- token de produção devolvido pela Focus (iv|tag|dados)
  -- Dados cadastrais (não sigilosos): razão social, endereço, IE, regime, contato.
  ADD COLUMN company                jsonb,
  ADD COLUMN certificate_valid_until timestamptz,
  ADD COLUMN csc_homolog_set        boolean NOT NULL DEFAULT false,
  ADD COLUMN csc_prod_set           boolean NOT NULL DEFAULT false,
  ADD COLUMN focus_synced_at        timestamptz;

-- Ativar exige o CNPJ e um token do modo escolhido.
ALTER TABLE tenant_fiscal_settings DROP CONSTRAINT IF EXISTS tenant_fiscal_settings_check;
ALTER TABLE tenant_fiscal_settings ADD CONSTRAINT tenant_fiscal_settings_enabled_check CHECK (
  NOT enabled OR (
    cnpj IS NOT NULL AND (
      (mode = 'own' AND token_enc IS NOT NULL) OR
      (mode = 'managed' AND (token_homolog_enc IS NOT NULL OR token_prod_enc IS NOT NULL))
    )
  )
);
