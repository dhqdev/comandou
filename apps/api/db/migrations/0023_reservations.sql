-- 0023: reservas de mesa.
-- 1) reservation_settings: o restaurante liga as reservas pelo cardápio online e define dias,
--    horário, intervalo entre horários, tamanho máximo do grupo e capacidade por horário.
-- 2) reservations: pedido de reserva do cliente (cardápio online) ou lançado pela equipe.
--    O link de acompanhamento do cliente usa um token; o banco guarda só o SHA-256.

CREATE TABLE reservation_settings (
  tenant_id           uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  enabled             boolean NOT NULL DEFAULT false,
  -- Reserva do cardápio já entra confirmada (sem a equipe aprovar).
  auto_confirm        boolean NOT NULL DEFAULT false,
  -- Dias da semana com reserva (0 = domingo … 6 = sábado).
  weekdays            smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  opens_at            time NOT NULL DEFAULT '18:00',
  -- Último horário de chegada. Menor que opens_at = passa da meia-noite.
  closes_at           time NOT NULL DEFAULT '22:00',
  slot_minutes        integer NOT NULL DEFAULT 30 CHECK (slot_minutes IN (15, 30, 60)),
  -- Quanto tempo a mesa fica com o grupo (conta na capacidade dos horários seguintes).
  duration_minutes    integer NOT NULL DEFAULT 90 CHECK (duration_minutes BETWEEN 15 AND 600),
  max_party           integer NOT NULL DEFAULT 10 CHECK (max_party BETWEEN 1 AND 100),
  -- Pessoas ao mesmo tempo. Vazio = sem limite (a equipe confirma uma a uma).
  capacity            integer CHECK (capacity BETWEEN 1 AND 5000),
  min_advance_minutes integer NOT NULL DEFAULT 60 CHECK (min_advance_minutes BETWEEN 0 AND 10080),
  max_days_ahead      integer NOT NULL DEFAULT 30 CHECK (max_days_ahead BETWEEN 1 AND 365),
  -- Recado mostrado ao cliente (ex.: "Tolerância de 15 minutos").
  note                text CHECK (length(note) <= 300),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER reservation_settings_updated_at BEFORE UPDATE ON reservation_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE reservations (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  -- Código curto para falar ao telefone ("R-7K2M").
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9]{4,8}$'),
  customer_id       uuid,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone             text NOT NULL CHECK (phone ~ '^[0-9]{10,13}$'),
  email             text CHECK (length(email) <= 254),
  party_size        integer NOT NULL CHECK (party_size BETWEEN 1 AND 100),
  starts_at         timestamptz NOT NULL,
  duration_minutes  integer NOT NULL DEFAULT 90 CHECK (duration_minutes BETWEEN 15 AND 600),
  occasion          text CHECK (length(occasion) <= 40),
  notes             text CHECK (length(notes) <= 300),
  staff_notes       text CHECK (length(staff_notes) <= 300),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','seated','completed','cancelled','no_show')),
  table_id          uuid,
  source            text NOT NULL DEFAULT 'online' CHECK (source IN ('online','staff')),
  public_token_hash bytea UNIQUE,
  cancel_reason     text CHECK (length(cancel_reason) <= 200),
  cancelled_by      text CHECK (cancelled_by IN ('customer','staff')),
  created_by        uuid,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (tenant_id, table_id) REFERENCES dining_tables(tenant_id, id) ON DELETE SET NULL (table_id)
);
CREATE INDEX reservations_tenant_starts_idx ON reservations(tenant_id, starts_at);
CREATE INDEX reservations_customer_idx ON reservations(tenant_id, customer_id, starts_at DESC)
  WHERE customer_id IS NOT NULL;
CREATE TRIGGER reservations_updated_at BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE reservation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reservation_settings
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON reservations
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON reservation_settings, reservations TO comandou_app;
