-- 0123: parabéns de aniversário pelo WhatsApp do restaurante.
--
-- 1) customers.birth_day/birth_month/birth_year: o aniversário do cliente (dia e mês; o ano é
--    opcional, quem não quer contar a idade não conta). Preenchido pelo próprio cliente na Conta
--    do cardápio ou pela equipe na ficha. birthday_opt_out = o cliente não quer receber os parabéns.
-- 2) tenant_birthday_settings: o parabéns automático do restaurante (liga/desliga, hora, estilo
--    da arte, frase da arte, texto da mensagem e o presente opcional: pontos da fidelidade ou um
--    texto livre com validade).
-- 3) birthday_greetings: um parabéns por cliente por ano (UNIQUE), com a situação do envio. Não
--    guarda nome nem telefone: sai junto quando a conta é apagada (LGPD, ON DELETE CASCADE).
-- A varredura do painel só descobre QUAIS restaurantes têm o parabéns ligado (sem ler mais nada);
-- o resto roda dentro do restaurante, com o RLS dele. Somente aditiva.

ALTER TABLE customers
  ADD COLUMN birth_day        smallint CHECK (birth_day BETWEEN 1 AND 31),
  ADD COLUMN birth_month      smallint CHECK (birth_month BETWEEN 1 AND 12),
  ADD COLUMN birth_year       smallint CHECK (birth_year BETWEEN 1900 AND 2100),
  ADD COLUMN birthday_opt_out boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT customers_birthday_complete CHECK (
    (birth_day IS NULL) = (birth_month IS NULL) AND (birth_year IS NULL OR birth_day IS NOT NULL)
  ),
  -- Dia que existe no mês (29/02 vale: no ano que não é bissexto, o parabéns sai em 28/02).
  ADD CONSTRAINT customers_birthday_valid CHECK (
    birth_day IS NULL
    OR birth_day <= CASE WHEN birth_month = 2 THEN 29
                         WHEN birth_month IN (4, 6, 9, 11) THEN 30 ELSE 31 END
  );
CREATE INDEX customers_birthday_idx ON customers(tenant_id, birth_month, birth_day)
  WHERE birth_month IS NOT NULL;

CREATE TABLE tenant_birthday_settings (
  tenant_id    uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,
  -- Hora do dia (no fuso do restaurante) a partir da qual os parabéns saem.
  send_hour    smallint NOT NULL DEFAULT 10 CHECK (send_hour BETWEEN 7 AND 20),
  theme        text NOT NULL DEFAULT 'festa' CHECK (theme IN ('festa','bolo','elegante','simples')),
  -- Frase pequena da arte, embaixo do nome.
  art_line     text NOT NULL DEFAULT 'Hoje o dia é todo seu!' CHECK (length(art_line) BETWEEN 1 AND 48),
  -- Texto que vai junto da arte, com {cliente}, {restaurante} e {presente}.
  message      text CHECK (length(message) BETWEEN 1 AND 900),
  gift_kind    text NOT NULL DEFAULT 'none' CHECK (gift_kind IN ('none','points','text')),
  gift_points  integer CHECK (gift_points BETWEEN 1 AND 100000),
  gift_text    text CHECK (length(gift_text) BETWEEN 1 AND 60),
  -- Validade do presente em texto (dias a partir do aniversário; 0 = só no dia).
  gift_days    smallint NOT NULL DEFAULT 7 CHECK (gift_days BETWEEN 0 AND 60),
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (gift_kind <> 'points' OR gift_points IS NOT NULL),
  CHECK (gift_kind <> 'text' OR gift_text IS NOT NULL)
);
CREATE TRIGGER tenant_birthday_settings_updated_at BEFORE UPDATE ON tenant_birthday_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE birthday_greetings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id         uuid NOT NULL,
  -- Ano do aniversário (um parabéns por ano).
  year                smallint NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','sending','sent','failed')),
  attempts            smallint NOT NULL DEFAULT 0,
  last_error          text CHECK (length(last_error) <= 300),
  -- O presente como estava no dia (a regra pode mudar depois).
  gift_kind           text NOT NULL DEFAULT 'none' CHECK (gift_kind IN ('none','points','text')),
  gift_points         integer,
  gift_text           text CHECK (length(gift_text) <= 60),
  gift_until          date,
  provider_message_id text CHECK (length(provider_message_id) <= 200),
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  UNIQUE (tenant_id, customer_id, year),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX birthday_greetings_tenant_idx ON birthday_greetings(tenant_id, created_at DESC);

ALTER TABLE tenant_birthday_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE birthday_greetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_birthday_settings TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON birthday_greetings TO comandou_app
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON tenant_birthday_settings TO comandou_app;
GRANT SELECT, INSERT, UPDATE ON birthday_greetings TO comandou_app;

-- Varredura: o painel só lê quais restaurantes ligaram o parabéns.
CREATE POLICY platform_read ON tenant_birthday_settings TO comandou_platform USING (true);
GRANT SELECT (tenant_id, enabled) ON tenant_birthday_settings TO comandou_platform;
