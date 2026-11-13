-- 0065: plano único de R$ 400,00 e orçamento em PDF no Super Admin.
--
-- 1) Plano único "Comandou": R$ 400,00 fixos por mês, sem limite de equipe, produtos ou pedidos,
--    com nota fiscal, WhatsApp e domínio próprio. Os outros planos ficam inativos (não aparecem em
--    /precos nem na troca de plano). Quem já assina outro plano continua nele até alguém trocar no
--    painel: nenhuma mensalidade muda sozinha. Só roda onde já existem planos (banco central de uma
--    instalação em uso); instalação nova recebe o plano único por default-plans.ts.
-- 2) platform_quote_settings: valores padrão do orçamento e do contrato — custo da nota fiscal
--    (Focus NFe) repassado ao cliente, implantação, validade e os custos de terceiros.
-- 3) platform_quotes: cada orçamento gerado (número ORC-AAAA-NNNN e o conteúdo congelado). O PDF é
--    refeito a partir do conteúdo; nada é apagado.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM plans) THEN
    INSERT INTO plans (code, name, price_monthly, max_users, max_products, max_orders_month,
                       feature_fiscal, feature_whatsapp, feature_custom_domain, trial_days,
                       is_default, active, tagline, highlights, featured, show_public, sort_order)
    VALUES ('comandou', 'Comandou', 400.00, NULL, NULL, NULL, true, true, true, 7,
            false, true, 'Tudo do sistema por um valor fixo, sem cobrança por pedido',
            '["Sem limite de equipe, produtos e pedidos", "PDV, salão, cozinha, caixa e entregas", "Cardápio online próprio e WhatsApp", "Nota fiscal (NFC-e e NF-e)"]'::jsonb,
            true, true, 0)
    ON CONFLICT (code) DO UPDATE SET
      price_monthly = EXCLUDED.price_monthly, max_users = NULL, max_products = NULL,
      max_orders_month = NULL, feature_fiscal = true, feature_whatsapp = true,
      feature_custom_domain = true, active = true, show_public = true, featured = true;
    UPDATE plans SET is_default = false WHERE code <> 'comandou' AND is_default;
    UPDATE plans SET is_default = true WHERE code = 'comandou';
    UPDATE plans SET active = false, show_public = false, featured = false WHERE code <> 'comandou';
  END IF;
END $$;

CREATE TABLE platform_quote_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Nota fiscal: 'passthrough' = custo da Focus cobrado à parte; 'included' = dentro da mensalidade.
  fiscal_mode          text NOT NULL DEFAULT 'passthrough' CHECK (fiscal_mode IN ('passthrough', 'included')),
  fiscal_monthly       numeric(10,2) NOT NULL DEFAULT 62.90 CHECK (fiscal_monthly BETWEEN 0 AND 10000),
  fiscal_nfce_included int NOT NULL DEFAULT 500 CHECK (fiscal_nfce_included BETWEEN 0 AND 1000000),
  fiscal_nfe_included  int NOT NULL DEFAULT 100 CHECK (fiscal_nfe_included BETWEEN 0 AND 1000000),
  fiscal_nfce_extra    numeric(8,3) NOT NULL DEFAULT 0.055 CHECK (fiscal_nfce_extra BETWEEN 0 AND 100),
  fiscal_nfe_extra     numeric(8,3) NOT NULL DEFAULT 0.160 CHECK (fiscal_nfe_extra BETWEEN 0 AND 100),
  setup_fee            numeric(10,2) NOT NULL DEFAULT 0 CHECK (setup_fee BETWEEN 0 AND 100000),
  validity_days        int NOT NULL DEFAULT 15 CHECK (validity_days BETWEEN 1 AND 90),
  -- Custos de terceiros mostrados no orçamento: [{"label": "...", "value": "..."}].
  extra_costs          jsonb NOT NULL DEFAULT '[
    {"label": "Certificado digital A1 (e-CNPJ)", "value": "Exigido para a nota fiscal. Comprado pelo restaurante direto com a certificadora, em média R$ 150 a R$ 250 por ano."},
    {"label": "WhatsApp", "value": "Sem custo: conecta pelo QR Code com o número do próprio restaurante."},
    {"label": "Domínio próprio (opcional)", "value": "Cerca de R$ 40 por ano no Registro.br. Sem domínio, a loja usa o endereço do Comandou sem custo."},
    {"label": "Equipamentos e internet", "value": "Computador, tablet ou celular, impressora térmica e internet ficam por conta do restaurante."}
  ]'::jsonb CHECK (jsonb_typeof(extra_costs) = 'array' AND jsonb_array_length(extra_costs) <= 12),
  notes                text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES platform_admins(id) ON DELETE SET NULL
);
INSERT INTO platform_quote_settings (id) VALUES (true);

CREATE TABLE platform_quotes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number      text NOT NULL UNIQUE CHECK (number ~ '^ORC-[0-9]{4}-[0-9]{4,}$'),
  client_name text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 160),
  total_monthly numeric(14,2) NOT NULL CHECK (total_monthly >= 0),
  content     jsonb NOT NULL,
  created_by  uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_quotes_created ON platform_quotes (created_at DESC);

ALTER TABLE platform_quote_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_all ON platform_quote_settings TO comandou_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all ON platform_quotes TO comandou_platform USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON platform_quote_settings TO comandou_platform;
GRANT SELECT, INSERT ON platform_quotes TO comandou_platform;
