-- ============================================================
-- 018: Promotions (replaces category banners as the promotion system)
-- ------------------------------------------------------------
-- A promotion is the banner AND the offer:
--   scope = 'shop'      every product in the shop
--   scope = 'product'   only the products listed in promotion_products
--   scope = 'category'  the shop's products in one category
--
-- The coupon itself stays a promo_codes row (promo_code_id), so checkout
-- validation, usage limits and promo_usages keep working unchanged. The admin
-- form creates and updates that row; checkout reads `scope` to discount only
-- the eligible items.
--
-- Every promotion belongs to one shop: the shop funds the discount.
-- category_banners is left in place but is no longer shown in the app.
-- ============================================================

CREATE TABLE IF NOT EXISTS promotions (
  id                BIGSERIAL PRIMARY KEY,
  title             TEXT        NOT NULL,
  subtitle          TEXT        NULL,
  image_url         TEXT        NULL,
  scope             TEXT        NOT NULL CHECK (scope IN ('shop', 'product', 'category')),
  merchant_id       INT         NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  category_id       INT         NULL REFERENCES categories(id) ON DELETE SET NULL,
  promo_code_id     INT         NULL REFERENCES promo_codes(id) ON DELETE SET NULL,
  starts_at         TIMESTAMPTZ NULL,
  ends_at           TIMESTAMPTZ NULL,
  -- where it is shown: 'home_promotions', 'home_featured', 'shop_page'
  display_locations TEXT[]      NOT NULL DEFAULT ARRAY['home_promotions'],
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order        INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promotions_category_scope CHECK (scope <> 'category' OR category_id IS NOT NULL),
  CONSTRAINT promotions_dates CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE TABLE IF NOT EXISTS promotion_products (
  promotion_id BIGINT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id   INT    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_promotions_merchant ON promotions (merchant_id);
CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions (promo_code_id) WHERE promo_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_live ON promotions (is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_promotion_products_product ON promotion_products (product_id);

-- The app reads and writes through the backend's service role only
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_products ENABLE ROW LEVEL SECURITY;
