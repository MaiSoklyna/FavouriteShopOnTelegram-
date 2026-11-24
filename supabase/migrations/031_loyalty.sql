-- 031_loyalty.sql
-- Loyalty: points are earned once per DELIVERED order, can be spent (as a coupon), and shops can opt out.
--
-- merchants.loyalty_enabled        a shop takes part in the program (customers earn points on its orders)
-- loyalty_settings.redeem_coupon_days   how long a coupon bought with points stays valid
-- points_transactions.promo_code_id     the coupon a redemption created
-- uq_points_one_earn_per_order     an order can only ever pay out points once (even if two requests race)
-- uq_points_one_reversal_per_order a cancelled order can only take its points back once
--
-- Nothing is deleted or changed in existing balances.

BEGIN;

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS loyalty_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE loyalty_settings
  ADD COLUMN IF NOT EXISTS redeem_coupon_days integer NOT NULL DEFAULT 30 CHECK (redeem_coupon_days >= 1);

ALTER TABLE points_transactions
  ADD COLUMN IF NOT EXISTS promo_code_id bigint NULL REFERENCES promo_codes(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_points_one_earn_per_order
  ON points_transactions (order_id) WHERE type = 'earn' AND order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_points_one_reversal_per_order
  ON points_transactions (order_id) WHERE type = 'reversal' AND order_id IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
