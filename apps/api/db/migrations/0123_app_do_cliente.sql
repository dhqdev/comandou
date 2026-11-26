-- 0123: app do cliente (cardápio online) com níveis, PIN, cupons, indicação, ajuda e avisos.
--
-- 1) products.loyalty_points: pontos fixos que o item rende (null = pela regra do programa, R$ ×
--    pontos por real). O cardápio mostra "Ganhe N pts" no cartão do item.
-- 2) option_groups.allow_repeat: o cliente pode escolher a mesma opção mais de uma vez (2x o mesmo
--    sabor), com o contador + e − no cardápio. O máximo do grupo conta as repetições.
-- 3) loyalty_programs: janela dos níveis, pontos da indicação (quem indica e quem foi indicado) e
--    se o cardápio mostra os pontos em cada item.
-- 4) loyalty_levels: níveis do programa (Bronze, Prata, Ouro...), pelos pontos ganhos na janela.
-- 5) loyalty_members: o PIN de cada cliente (usar os pontos e o cupom no balcão) e o código de
--    convite (indique um amigo). Sem nome, telefone ou endereço: some junto com o cliente.
-- 6) loyalty_entries.kind ganha 'bonus' (indicação) e 'store' (troca feita no balcão pelo PIN).
-- 7) coupons + coupon_redemptions: cupons da loja (porcentagem, valor ou entrega grátis), com
--    validade, mínimo, limite total e por cliente, primeiro pedido e se aparece na aba Cupons.
-- 8) store_faq: perguntas e respostas da tela Ajuda do app.
-- 9) store_notices: avisos da loja para os clientes (tela Notificações do app).
-- 10) tenant_store_settings: textos da tela Sobre.
-- Somente aditiva.

ALTER TABLE products ADD COLUMN loyalty_points integer
  CHECK (loyalty_points BETWEEN 0 AND 100000);

ALTER TABLE option_groups ADD COLUMN allow_repeat boolean NOT NULL DEFAULT false;

ALTER TABLE loyalty_programs
  -- Pontos ganhos nos últimos N dias decidem o nível (null = desde sempre).
  ADD COLUMN level_window_days integer CHECK (level_window_days BETWEEN 30 AND 1095),
  -- Indique um amigo: pontos para quem indicou e para o amigo, no primeiro pedido concluído dele.
  ADD COLUMN referral_points integer NOT NULL DEFAULT 0 CHECK (referral_points BETWEEN 0 AND 100000),
  ADD COLUMN referral_friend_points integer NOT NULL DEFAULT 0
    CHECK (referral_friend_points BETWEEN 0 AND 100000),
  ADD COLUMN show_item_points boolean NOT NULL DEFAULT true;

CREATE TABLE loyalty_levels (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 30),
  min_points  integer NOT NULL CHECK (min_points BETWEEN 0 AND 10000000),
  -- O que o nível dá (texto livre, mostrado ao cliente).
  perks       text CHECK (length(perks) <= 300),
  color       text CHECK (color ~ '^#[0-9a-f]{6}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, min_points)
);
CREATE TRIGGER loyalty_levels_updated_at BEFORE UPDATE ON loyalty_levels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE loyalty_members (
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id      uuid NOT NULL,
  -- 6 dígitos, únicos na loja; o cliente troca quando quiser.
  pin              text NOT NULL CHECK (pin ~ '^[0-9]{6}$'),
  referral_code    text NOT NULL CHECK (referral_code ~ '^[A-Z0-9]{6,10}$'),
  -- Quem indicou este cliente (e quando os pontos da indicação foram dados).
  referred_by      uuid,
  referral_paid_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id),
  UNIQUE (tenant_id, pin),
  UNIQUE (tenant_id, referral_code),
  CHECK (referred_by IS NULL OR referred_by <> customer_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, referred_by) REFERENCES customers(tenant_id, id) ON DELETE SET NULL (referred_by)
);
CREATE INDEX loyalty_members_referred_idx ON loyalty_members(tenant_id, referred_by)
  WHERE referred_by IS NOT NULL;

ALTER TABLE loyalty_entries DROP CONSTRAINT loyalty_entries_kind_check;
ALTER TABLE loyalty_entries ADD CONSTRAINT loyalty_entries_kind_check
  CHECK (kind IN ('earn','redeem','refund','expire','adjust','bonus','store'));

CREATE TABLE coupons (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,24}$'),
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  description      text CHECK (length(description) <= 240),
  kind             text NOT NULL CHECK (kind IN ('percent','fixed','free_delivery')),
  -- percent: 1 a 100; fixed: valor em reais; free_delivery: sem valor.
  value            numeric(14,2) CHECK (value > 0),
  -- Teto do desconto em porcentagem (null = sem teto).
  max_discount     numeric(14,2) CHECK (max_discount > 0),
  min_order        numeric(14,2) NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  starts_at        timestamptz,
  ends_at          timestamptz,
  max_uses         integer CHECK (max_uses BETWEEN 1 AND 1000000),
  per_customer     integer NOT NULL DEFAULT 1 CHECK (per_customer BETWEEN 1 AND 1000),
  first_order_only boolean NOT NULL DEFAULT false,
  -- Aparece na aba Cupons do app (false = só quem tem o código usa).
  listed           boolean NOT NULL DEFAULT true,
  active           boolean NOT NULL DEFAULT true,
  image_id         uuid,
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK ((kind = 'free_delivery') = (value IS NULL)),
  CHECK (kind <> 'percent' OR value <= 100),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE TRIGGER coupons_updated_at BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE coupon_redemptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  coupon_id    uuid NOT NULL,
  customer_id  uuid,
  order_id     uuid,
  -- Quanto saiu de desconto (na entrega grátis, a taxa que deixou de ser cobrada).
  discount     numeric(14,2) NOT NULL CHECK (discount >= 0),
  -- 'store' = usado no balcão pelo PIN do cliente.
  channel      text NOT NULL DEFAULT 'online' CHECK (channel IN ('online','store')),
  refunded_at  timestamptz,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, coupon_id) REFERENCES coupons(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE SET NULL (order_id)
);
CREATE INDEX coupon_redemptions_coupon_idx ON coupon_redemptions(tenant_id, coupon_id);
CREATE INDEX coupon_redemptions_customer_idx ON coupon_redemptions(tenant_id, customer_id);
CREATE UNIQUE INDEX coupon_redemptions_order_idx ON coupon_redemptions(order_id)
  WHERE order_id IS NOT NULL;

CREATE TABLE store_faq (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  section     text NOT NULL DEFAULT 'Geral' CHECK (length(section) BETWEEN 1 AND 40),
  question    text NOT NULL CHECK (length(question) BETWEEN 3 AND 160),
  answer      text NOT NULL CHECK (length(answer) BETWEEN 1 AND 2000),
  position    integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX store_faq_tenant_idx ON store_faq(tenant_id, position);
CREATE TRIGGER store_faq_updated_at BEFORE UPDATE ON store_faq
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE store_notices (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  body        text CHECK (length(body) <= 600),
  image_id    uuid,
  -- Para onde o aviso leva: nada, um produto, um cupom (código) ou um link de fora.
  target_type text NOT NULL DEFAULT 'none' CHECK (target_type IN ('none','product','coupon')),
  target      text CHECK (length(target) <= 60),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX store_notices_tenant_idx ON store_notices(tenant_id, starts_at DESC);
CREATE TRIGGER store_notices_updated_at BEFORE UPDATE ON store_notices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_store_settings
  ADD COLUMN app_about text CHECK (length(app_about) <= 2000),
  ADD COLUMN app_instagram text CHECK (length(app_instagram) <= 60);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loyalty_levels','loyalty_members','coupons','coupon_redemptions',
                           'store_faq','store_notices']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty_levels, coupons, store_faq, store_notices TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON loyalty_members, coupon_redemptions TO comandou_app;
