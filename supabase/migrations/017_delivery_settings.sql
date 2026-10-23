-- ============================================================
-- 017: Per-shop delivery settings
-- ------------------------------------------------------------
--   opening_hours        {"mon":[["08:00","20:00"]], ...}; NULL = always open.
--                        Missing/empty day = closed. End before start = past midnight.
--                        Times are Cambodia time (UTC+7).
--   delivery_base_fee    Shop's own fee: base + per_km × distance. NULL = platform bands.
--   delivery_per_km_fee  Per-km part of the above.
--   min_order_amount     Minimum cart subtotal for this shop. NULL = none.
--
-- All optional: a shop that sets none of them behaves exactly as before.
-- ============================================================

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS opening_hours       JSONB NULL,
  ADD COLUMN IF NOT EXISTS delivery_base_fee   NUMERIC(6,2) NULL,
  ADD COLUMN IF NOT EXISTS delivery_per_km_fee NUMERIC(6,2) NULL,
  ADD COLUMN IF NOT EXISTS min_order_amount    NUMERIC(8,2) NULL;

ALTER TABLE merchants
  ADD CONSTRAINT merchants_base_fee_nonneg   CHECK (delivery_base_fee   IS NULL OR delivery_base_fee   >= 0),
  ADD CONSTRAINT merchants_per_km_fee_nonneg CHECK (delivery_per_km_fee IS NULL OR delivery_per_km_fee >= 0),
  ADD CONSTRAINT merchants_min_order_nonneg  CHECK (min_order_amount    IS NULL OR min_order_amount    >= 0);

COMMENT ON COLUMN merchants.opening_hours IS 'Weekly hours in Cambodia time; NULL = always open.';
