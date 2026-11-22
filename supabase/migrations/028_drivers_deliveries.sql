-- 028_drivers_deliveries.sql
-- Delivery MVP: drivers, and one delivery per order that is brought to the customer.
--
-- drivers     a person (a Telegram user) who delivers. merchant_id NULL = a platform driver any shop can
--             use; set = that shop's own rider. Being in this table is the "driver role": drivers sign in
--             with Telegram like customers and the API checks for a row here.
-- deliveries  one row per delivery order: who, and how far it got
--               assigned -> accepted -> picked_up -> delivered      (or failed / cancelled / declined)
--             The order's own status (shipped, delivered) is moved by the same code the shop uses.
--
-- Nothing else changes: existing orders and the shop's order screen keep working without drivers.

BEGIN;

CREATE TABLE IF NOT EXISTS drivers (
  id           bigserial PRIMARY KEY,
  user_id      bigint      NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  merchant_id  bigint      NULL REFERENCES merchants(id) ON DELETE CASCADE,
  full_name    text        NOT NULL,
  phone        text        NOT NULL,
  vehicle      text        NULL,
  is_active    boolean     NOT NULL DEFAULT true,   -- the account may work at all (admin switch)
  is_available boolean     NOT NULL DEFAULT true,   -- the driver is on shift (driver switch)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drivers_merchant ON drivers (merchant_id);

CREATE TABLE IF NOT EXISTS deliveries (
  id             bigserial PRIMARY KEY,
  order_id       bigint      NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  driver_id      bigint      NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  status         text        NOT NULL DEFAULT 'assigned'
                 CHECK (status IN ('assigned', 'accepted', 'picked_up', 'delivered', 'failed', 'cancelled', 'declined')),
  assigned_by    text        NULL,                  -- who assigned: "merchant_admin:7" / "super_admin:1"
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at    timestamptz NULL,
  picked_up_at   timestamptz NULL,
  delivered_at   timestamptz NULL,
  failure_reason text        NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_driver_status ON deliveries (driver_id, status);

-- Only the backend (service role) reads and writes these
ALTER TABLE drivers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON drivers, deliveries FROM anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
