-- ============================================================
-- 019: Promotion schedules + platform-wide promotions (run after 018)
-- ------------------------------------------------------------
-- schedule_type
--   'once'     between starts_at and ends_at (018 behaviour)
--   'weekly'   on the weekdays in `weekdays`      (0 = Sunday … 6 = Saturday)
--   'monthly'  on the days in `month_days`        (1 … 31; 31 also means the last day of shorter months)
--   'yearly'   inside the ranges in `yearly_ranges`, e.g. [{"start":"12-25","end":"12-25"},
--              {"start":"04-14","end":"04-16"}] — a range may wrap the new year ("12-30" → "01-02")
-- Recurring promotions may still use starts_at / ends_at as an outer window.
-- Days are counted in Cambodia time (Asia/Phnom_Penh). Nothing switches a
-- promotion on or off: the backend checks the schedule whenever it lists
-- promotions or prices a cart.
--
-- scope 'platform' = every shop; merchant_id is NULL and so is the code's
-- merchant_id (promo_codes.merchant_id becomes nullable for these).
-- ============================================================

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS schedule_type TEXT  NOT NULL DEFAULT 'once',
  ADD COLUMN IF NOT EXISTS weekdays      INT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS month_days    INT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS yearly_ranges JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_apply    BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_schedule_type;
ALTER TABLE promotions ADD CONSTRAINT promotions_schedule_type
  CHECK (schedule_type IN ('once', 'weekly', 'monthly', 'yearly'));

-- Platform-wide promotions belong to no single shop
ALTER TABLE promotions ALTER COLUMN merchant_id DROP NOT NULL;
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_scope_check;
ALTER TABLE promotions ADD CONSTRAINT promotions_scope_check
  CHECK (scope IN ('shop', 'product', 'category', 'platform'));
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_platform_has_no_shop;
ALTER TABLE promotions ADD CONSTRAINT promotions_platform_has_no_shop
  CHECK ((scope = 'platform') = (merchant_id IS NULL));

ALTER TABLE promo_codes ALTER COLUMN merchant_id DROP NOT NULL;
-- One platform code per name (NULLs don't clash in the existing UNIQUE (merchant_id, code))
CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_platform_code ON promo_codes (code) WHERE merchant_id IS NULL;
