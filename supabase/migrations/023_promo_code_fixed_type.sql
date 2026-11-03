-- ════════════════════════════════════════════════════════════════
-- 023 — Allow fixed-amount promo codes
--
-- The live database has a promo_codes_type_check constraint (not from any
-- migration file) that rejects type = 'fixed', so a "$10 off" code could not
-- be saved ("Could not save the promotion"). The app and checkout use exactly
-- two types: 'percent' and 'fixed'. Every existing code is 'percent'.
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_type_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_type_check
  CHECK (type::text IN ('percent', 'fixed'));

NOTIFY pgrst, 'reload schema';

COMMIT;
