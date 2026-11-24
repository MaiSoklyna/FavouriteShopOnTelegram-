-- 032_favorites.sql
-- Favorites: a customer saves products and shops to come back to. Until now the product heart lived only in
-- the browser (localStorage), so it was lost on a new phone and there was no way to save a shop.
--
-- favorites   one row per saved item. `kind` says which of product_id / merchant_id is set (exactly one),
--             and a partial unique index per kind means saving twice (two taps, two tabs) keeps one row.
--             Rows go when the customer, product or shop is deleted.
--
-- Nothing existing is changed.

BEGIN;

CREATE TABLE IF NOT EXISTS favorites (
  id          bigserial PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('product', 'shop')),
  product_id  bigint      NULL     REFERENCES products(id)  ON DELETE CASCADE,
  merchant_id bigint      NULL     REFERENCES merchants(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorites_one_target CHECK (
    (kind = 'product' AND product_id  IS NOT NULL AND merchant_id IS NULL) OR
    (kind = 'shop'    AND merchant_id IS NOT NULL AND product_id  IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_favorites_product ON favorites (user_id, product_id)  WHERE kind = 'product';
CREATE UNIQUE INDEX IF NOT EXISTS uq_favorites_shop    ON favorites (user_id, merchant_id) WHERE kind = 'shop';
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites (user_id, kind, created_at DESC);
-- "how many people saved this shop / product" (shop dashboard, later analytics)
CREATE INDEX IF NOT EXISTS idx_favorites_shop_target    ON favorites (merchant_id) WHERE kind = 'shop';
CREATE INDEX IF NOT EXISTS idx_favorites_product_target ON favorites (product_id)  WHERE kind = 'product';

-- Only the backend (service role) reads and writes it
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';
