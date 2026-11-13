-- 0064: mais fotos e avaliações em cada item do cardápio online.
--
-- 1) product_photos: fotos extras do item (até 8), além da foto principal (products.image_id).
--    O cliente passa de uma para outra na tela do produto. Some junto com o produto ou a foto.
-- 2) product_reviews: nota de 1 a 5 e comentário opcional do cliente (com a conta aberta no
--    cardápio). Uma avaliação por cliente e item; avaliar de novo troca a anterior. A equipe pode
--    esconder uma avaliação (hidden_at), que some do cardápio sem ser apagada.
-- 3) product_review_likes: o coração ("curtir") de um cliente numa avaliação.
-- Somente aditiva.

CREATE TABLE product_photos (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  product_id  uuid NOT NULL,
  image_id    uuid NOT NULL,
  position    smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 7),
  PRIMARY KEY (product_id, image_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, image_id) REFERENCES media(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX product_photos_tenant_idx ON product_photos(tenant_id, product_id, position);

CREATE TABLE product_reviews (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  product_id   uuid NOT NULL,
  customer_id  uuid NOT NULL,
  rating       smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      text CHECK (length(comment) BETWEEN 1 AND 500),
  hidden_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (product_id, customer_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX product_reviews_product_idx ON product_reviews(tenant_id, product_id, created_at DESC);
CREATE TRIGGER product_reviews_updated_at BEFORE UPDATE ON product_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_review_likes (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  review_id    uuid NOT NULL,
  customer_id  uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, customer_id),
  FOREIGN KEY (tenant_id, review_id) REFERENCES product_reviews(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE product_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_review_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_photos
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON product_reviews
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON product_review_likes
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON product_photos, product_reviews, product_review_likes
  TO comandou_app;
