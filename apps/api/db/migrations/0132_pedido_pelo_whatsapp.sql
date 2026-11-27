-- 0132: pedido inteiro pelo WhatsApp (atendimento por menu numerado) e criação pelo site com um
-- campo só.
--
-- Pedido do David (0.279): "quero que dê para o cliente fazer toda a trajetória de compra pela
-- IA, estilo de call center, começando por um menu com os números (1, 2, 3...), ver status do
-- pedido, fazer pedido"; "ela tem que perguntar se o cliente já tem cadastro ou se ele deseja
-- fazer um"; "não quero que ela mande ele para o cardápio"; "coloque várias configurações na aba
-- de assistente para o dono escolher o que ele quer que a IA faça"; "use um modelo barato de IA
-- que só eu, o Super Admin, consigo colocar". E no site: "uma barra de texto para eu enviar o
-- que eu quiser sobre o restaurante (texto, imagem, link)", com CNPJ/CPF e o contrato para
-- assinar digitalmente.
--
-- 1) ai_agent_settings: o que o atendimento por menu faz (menu numerado, pedidos, status,
--    cadastro, pedido sem cadastro, entrega, retirada, formas de pagamento, entender pedido
--    escrito com IA, observação por item, link de acompanhamento, perguntas livres com IA,
--    horários e endereço) e o número do WhatsApp conectado (para o botão "Pedir pelo WhatsApp"
--    do cardápio).
-- 2) ai_customer_chats.flow / flow_until: onde o cliente está no menu (tela, sacola, endereço,
--    pagamento). Quem anda pelo menu é o servidor, sem gastar a IA; 2 horas parado recomeça.
-- 3) platform_ai_settings.whatsapp_model: o modelo do WhatsApp, escolhido só no Super Admin
--    (Tokens de IA). Padrão: Gemini 2.5 Flash Lite, barato e rápido. app_ai_config() devolve.
-- 4) Site: rascunho 'compose' (tudo junto num campo: texto, links, fotos e PDFs), o teste pelo
--    site com origem 'compose' e o contrato gerado na criação (trial_signups.contract_id).
-- Somente aditiva (as regras de source_kind só ganham um valor).

ALTER TABLE ai_agent_settings
  ADD COLUMN menu_mode boolean NOT NULL DEFAULT true,
  ADD COLUMN take_orders boolean NOT NULL DEFAULT true,
  ADD COLUMN order_status boolean NOT NULL DEFAULT true,
  ADD COLUMN offer_signup boolean NOT NULL DEFAULT true,
  ADD COLUMN guest_orders boolean NOT NULL DEFAULT true,
  ADD COLUMN order_delivery boolean NOT NULL DEFAULT true,
  ADD COLUMN order_pickup boolean NOT NULL DEFAULT true,
  ADD COLUMN pay_methods text[] NOT NULL DEFAULT '{pix,cash,credit,debit}'
    CHECK (pay_methods <@ ARRAY['pix','cash','credit','debit','voucher']::text[]
           AND cardinality(pay_methods) BETWEEN 1 AND 5),
  ADD COLUMN understand_text boolean NOT NULL DEFAULT true,
  ADD COLUMN item_notes boolean NOT NULL DEFAULT true,
  ADD COLUMN send_tracking boolean NOT NULL DEFAULT false,
  ADD COLUMN free_chat boolean NOT NULL DEFAULT true,
  ADD COLUMN show_info boolean NOT NULL DEFAULT true,
  ADD COLUMN wa_phone text CHECK (wa_phone ~ '^[0-9]{10,15}$');

ALTER TABLE ai_customer_chats
  ADD COLUMN flow jsonb CHECK (flow IS NULL OR pg_column_size(flow) <= 16384),
  ADD COLUMN flow_until timestamptz;

ALTER TABLE platform_ai_settings
  ADD COLUMN whatsapp_model text NOT NULL DEFAULT 'google/gemini-2.5-flash-lite'
    CHECK (whatsapp_model ~ '^[A-Za-z0-9._:/-]{3,120}$');
GRANT UPDATE (whatsapp_model) ON platform_ai_settings TO comandou_platform;

DROP FUNCTION app_ai_config();
CREATE FUNCTION app_ai_config()
  RETURNS TABLE (enabled boolean, tenant_enabled boolean, model text, assistant_name text,
                 api_key_enc bytea, monthly_tokens integer, bonus_tokens bigint,
                 photo_ai_enabled boolean, model3d_ai_enabled boolean, vision_model text,
                 image_model text, import_model text, whatsapp_model text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.enabled AND s.api_key_enc IS NOT NULL, coalesce(t.enabled, true), s.model,
           s.assistant_name, s.api_key_enc, coalesce(t.monthly_tokens, s.default_monthly_tokens),
           coalesce(t.bonus_tokens, 0), s.photo_ai_enabled, s.model3d_ai_enabled, s.vision_model,
           s.image_model, s.import_model, s.whatsapp_model
      FROM platform_ai_settings s
      LEFT JOIN tenant_ai_settings t ON t.tenant_id = app_current_tenant()
     WHERE s.id
  $$;
REVOKE ALL ON FUNCTION app_ai_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_ai_config() TO comandou_app;

ALTER TABLE site_ai_generations DROP CONSTRAINT site_ai_generations_source_kind_check;
ALTER TABLE site_ai_generations
  ADD CONSTRAINT site_ai_generations_source_kind_check
    CHECK (source_kind IN ('site', 'maps', 'text', 'menu', 'compose'));

ALTER TABLE trial_signups DROP CONSTRAINT trial_signups_source_kind_check;
ALTER TABLE trial_signups
  ADD CONSTRAINT trial_signups_source_kind_check
    CHECK (source_kind IN ('site', 'maps', 'text', 'none', 'compose')),
  ADD COLUMN contract_id uuid REFERENCES tenant_contracts(id) ON DELETE SET NULL,
  ADD COLUMN contract_error text CHECK (length(contract_error) <= 300);
