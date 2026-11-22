-- 030_coupons.sql
-- Promotion Center: public coupons, private coupons, a wallet ("My Coupons"), per-customer limits, and
-- coupon use that cannot be over-spent.
--
-- promo_codes.audience        'public'  anyone may claim or use it and it is listed;
--                             'private' hidden, usable only by customers who were given it (the wallet)
-- promo_codes.per_user_limit  how many times one customer may use it; NULL = unlimited (today's behaviour,
--                             so recurring campaigns like a weekend sale keep working)
-- coupon_wallet               a customer's coupons: claimed from the public list, or granted privately
-- promo_usages.order_id       may be NULL for a moment: the use is claimed before the order exists
--
-- claim_promo_use() checks every limit and counts the use in ONE transaction with the code row locked, so
-- two orders racing for the last use (or one customer's second use) cannot both succeed. A failed or
-- cancelled order gives the use back (release_promo_use / release_promo_use_for_order).

BEGIN;

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS audience       text    NOT NULL DEFAULT 'public' CHECK (audience IN ('public', 'private')),
  ADD COLUMN IF NOT EXISTS per_user_limit integer NULL CHECK (per_user_limit IS NULL OR per_user_limit >= 1);

ALTER TABLE promo_usages ALTER COLUMN order_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promo_usages_code_user ON promo_usages (promo_code_id, user_id);

CREATE TABLE IF NOT EXISTS coupon_wallet (
  id            bigserial PRIMARY KEY,
  promo_code_id bigint      NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id       bigint      NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  source        text        NOT NULL CHECK (source IN ('claimed', 'granted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promo_code_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_coupon_wallet_user ON coupon_wallet (user_id);
ALTER TABLE coupon_wallet ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coupon_wallet FROM anon, authenticated;


CREATE OR REPLACE FUNCTION claim_promo_use(p_code_id bigint, p_user_id bigint, p_discount numeric)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  c   promo_codes;
  n   integer;
  uid bigint;
BEGIN
  SELECT * INTO c FROM promo_codes WHERE id = p_code_id FOR UPDATE;   -- one at a time per code
  IF NOT FOUND OR NOT c.is_active THEN
    RAISE EXCEPTION 'This code is no longer valid' USING ERRCODE = 'P0001';
  END IF;
  IF c.expires_at IS NOT NULL AND c.expires_at < now() THEN
    RAISE EXCEPTION 'This code has expired' USING ERRCODE = 'P0001';
  END IF;
  IF c.max_uses IS NOT NULL AND COALESCE(c.used_count, 0) >= c.max_uses THEN
    RAISE EXCEPTION 'This code has been fully used' USING ERRCODE = 'P0001';
  END IF;
  IF c.audience = 'private' AND NOT EXISTS (
       SELECT 1 FROM coupon_wallet w WHERE w.promo_code_id = p_code_id AND w.user_id = p_user_id) THEN
    RAISE EXCEPTION 'This code is not valid for you' USING ERRCODE = 'P0001';
  END IF;
  IF c.per_user_limit IS NOT NULL THEN
    SELECT count(*) INTO n FROM promo_usages WHERE promo_code_id = p_code_id AND user_id = p_user_id;
    IF n >= c.per_user_limit THEN
      RAISE EXCEPTION 'You have already used this code' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE promo_codes SET used_count = COALESCE(used_count, 0) + 1 WHERE id = p_code_id;
  INSERT INTO promo_usages (promo_code_id, user_id, order_id, discount_applied)
  VALUES (p_code_id, p_user_id, NULL, p_discount) RETURNING id INTO uid;
  RETURN uid;
END $$;


-- Give one use back (the order failed before it existed)
CREATE OR REPLACE FUNCTION release_promo_use(p_usage_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  cid bigint;
BEGIN
  DELETE FROM promo_usages WHERE id = p_usage_id RETURNING promo_code_id INTO cid;
  IF cid IS NOT NULL THEN
    UPDATE promo_codes SET used_count = GREATEST(COALESCE(used_count, 0) - 1, 0) WHERE id = cid;
  END IF;
END $$;


-- Give back the use of a cancelled order
CREATE OR REPLACE FUNCTION release_promo_use_for_order(p_order_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN DELETE FROM promo_usages WHERE order_id = p_order_id RETURNING promo_code_id LOOP
    UPDATE promo_codes SET used_count = GREATEST(COALESCE(used_count, 0) - 1, 0) WHERE id = r.promo_code_id;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION claim_promo_use(bigint, bigint, numeric)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_promo_use(bigint)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_promo_use_for_order(bigint)        FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
