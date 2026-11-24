-- 029_shop_reviews.sql
-- Ratings & Reviews for shops: a customer rates the shop once their order is delivered.
--
-- shop_reviews   one row per delivered order (order_id is unique): 1-5 stars and an optional comment.
--                Separate from the product `reviews` table, which stays as it is.
-- merchants      rating / rating_count: the shop's average and number of visible reviews, kept in step by
--                recalc_shop_rating() so shop cards and lists read one number instead of adding it up.
--
-- is_visible lets the platform hide an abusive review; hidden reviews leave the average.

BEGIN;

CREATE TABLE IF NOT EXISTS shop_reviews (
  id          bigserial PRIMARY KEY,
  order_id    bigint      NOT NULL UNIQUE REFERENCES orders(id)    ON DELETE CASCADE,
  user_id     bigint      NOT NULL        REFERENCES users(id)     ON DELETE CASCADE,
  merchant_id bigint      NOT NULL        REFERENCES merchants(id) ON DELETE CASCADE,
  rating      smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text        NULL     CHECK (comment IS NULL OR char_length(comment) <= 1000),
  is_visible  boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_reviews_merchant ON shop_reviews (merchant_id, created_at DESC) WHERE is_visible;
CREATE INDEX IF NOT EXISTS idx_shop_reviews_user     ON shop_reviews (user_id);

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS rating       numeric(3,2) NULL,
  ADD COLUMN IF NOT EXISTS rating_count integer      NOT NULL DEFAULT 0;

-- One statement, so the average and the count always agree even when reviews arrive at the same moment
CREATE OR REPLACE FUNCTION recalc_shop_rating(p_merchant_id bigint)
RETURNS void
LANGUAGE sql AS $$
  UPDATE merchants m
     SET rating = s.avg_rating, rating_count = s.n
    FROM (SELECT round(avg(rating)::numeric, 2) AS avg_rating, count(*)::integer AS n
            FROM shop_reviews
           WHERE merchant_id = p_merchant_id AND is_visible) s
   WHERE m.id = p_merchant_id;
$$;

REVOKE ALL ON FUNCTION recalc_shop_rating(bigint) FROM PUBLIC, anon, authenticated;
ALTER TABLE shop_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON shop_reviews FROM anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
