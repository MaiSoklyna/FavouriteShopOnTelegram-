-- ============================================================
-- 016: Map & delivery (V1 — merchant-delivered, no riders)
-- ------------------------------------------------------------
-- The "shops" of the spec are the existing `merchants` table; we extend it
-- rather than create a parallel table.
--
--   merchants          shop location + delivery radius
--   customer_addresses saved addresses per customer (map pins)
--   orders             delivery type, the pin, the distance that was charged
--
-- Order statuses are NOT changed here (see docs/MAP_DELIVERY_ARCHITECTURE.md).
-- ============================================================

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS address            TEXT NULL,
  ADD COLUMN IF NOT EXISTS latitude           DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS longitude          DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS delivery_radius_km NUMERIC(5,2) NOT NULL DEFAULT 5;

ALTER TABLE merchants
  ADD CONSTRAINT merchants_lat_range CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
  ADD CONSTRAINT merchants_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT merchants_radius_range CHECK (delivery_radius_km >= 0 AND delivery_radius_km <= 10);

CREATE INDEX IF NOT EXISTS idx_merchants_location ON merchants (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ── Saved customer addresses ────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_addresses (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL DEFAULT 'Home',
  address    TEXT NOT NULL,
  latitude   DOUBLE PRECISION NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude  DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_user ON customer_addresses (user_id);
-- At most one default address per customer
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_addresses_default
  ON customer_addresses (user_id) WHERE is_default;

-- Access is through the backend (service role) only
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;

-- ── Orders ──────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_type      TEXT NOT NULL DEFAULT 'delivery',
  ADD COLUMN IF NOT EXISTS delivery_latitude  DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS delivery_longitude DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS distance_km        NUMERIC(6,2) NULL;

ALTER TABLE orders
  ADD CONSTRAINT orders_delivery_type_check CHECK (delivery_type IN ('delivery', 'pickup'));

COMMENT ON COLUMN merchants.delivery_radius_km IS 'Max straight-line km the shop delivers (hard cap 10 = last fee tier).';
COMMENT ON COLUMN orders.distance_km IS 'Straight-line shop-to-pin distance used to price delivery. NULL = pickup or no pin.';
