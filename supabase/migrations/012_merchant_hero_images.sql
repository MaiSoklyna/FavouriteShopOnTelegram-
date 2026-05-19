-- ============================================================
-- 012: Merchant hero carousel images
-- ------------------------------------------------------------
-- Stores the per-merchant hero/banner images shown at the top of
-- the shop page. Backed by the same Supabase Storage bucket as
-- product images (``product-images``), under the
-- ``merchant-hero/<merchant_id>/`` prefix — the URL is stored
-- absolute so the miniapp can render them without a proxy.
-- ============================================================

CREATE TABLE IF NOT EXISTS merchant_hero_images (
  id          SERIAL PRIMARY KEY,
  merchant_id INT          NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  url         TEXT         NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchant_hero_lookup
  ON merchant_hero_images (merchant_id, is_active, sort_order);

COMMENT ON TABLE merchant_hero_images IS
  'Hero carousel images for the shop page. Caps at 6 active per merchant (enforced in backend route).';
