-- ============================================================
-- 021: One promotion model (run after 020)
-- ------------------------------------------------------------
-- Everything the customer sees as an offer or a banner is now a row in
-- `promotions`. Image, code/discount, shop, products, category and schedule
-- are all optional; the app draws the card from whatever is there.
--
--  1. Home has one Promotions section: 'home_featured' becomes 'home_promotions'.
--  2. Every plain promo code that isn't behind a promotion yet (active, not
--     expired, belongs to a shop) gets a promotion of its own: shop-wide, one
--     time, ending when the code expires, shown on Home and the shop page.
--     auto_apply stays FALSE so these codes still have to be typed, as before.
--  3. Every active old category banner becomes an image promotion (no code).
-- After this the admin manages everything on one Promotions page. Codes, their
-- usage counts and the category_banners rows are untouched.
-- ============================================================

UPDATE promotions
SET display_locations = ARRAY(
  SELECT DISTINCT CASE WHEN loc = 'home_featured' THEN 'home_promotions' ELSE loc END
  FROM unnest(display_locations) AS loc
)
WHERE 'home_featured' = ANY (display_locations);

INSERT INTO promotions (title, scope, merchant_id, promo_code_id, schedule_type, ends_at, display_locations, is_active, auto_apply)
SELECT
  CASE WHEN pc.type::text = 'percent'
       THEN trim(to_char(pc.value, 'FM999990.##'), '.') || '% off'
       ELSE '$' || to_char(pc.value, 'FM999990.00') || ' off'
  END || ' at ' || m.name,
  'shop',
  pc.merchant_id,
  pc.id,
  'once',
  pc.expires_at::timestamptz,
  ARRAY['home_promotions', 'shop_page'],
  TRUE,
  FALSE
FROM promo_codes pc
JOIN merchants m ON m.id = pc.merchant_id
WHERE pc.is_active
  AND pc.merchant_id IS NOT NULL
  AND (pc.expires_at IS NULL OR pc.expires_at::timestamptz > NOW())
  AND (pc.max_uses IS NULL OR COALESCE(pc.used_count, 0) < pc.max_uses)
  AND NOT EXISTS (SELECT 1 FROM promotions p WHERE p.promo_code_id = pc.id);

-- 3. Old category banners become image promotions (no code, no discount).
--    A banner for a shop's own category belongs to that shop; a banner for a
--    global category is platform-wide and lists that category's products from
--    every shop. Each banner is copied once (matched on its image and title).
INSERT INTO promotions (title, subtitle, image_url, scope, merchant_id, category_id, schedule_type, display_locations, is_active, auto_apply, sort_order)
SELECT
  b.title,
  b.subtitle,
  b.image_url,
  CASE WHEN c.merchant_id IS NULL THEN 'platform' ELSE 'category' END,
  c.merchant_id,
  b.category_id,
  'once',
  ARRAY['home_promotions'],
  TRUE,
  FALSE,
  b.sort_order
FROM category_banners b
JOIN categories c ON c.id = b.category_id
WHERE b.is_active
  AND NOT EXISTS (
    SELECT 1 FROM promotions p
    WHERE p.title = b.title AND p.image_url IS NOT DISTINCT FROM b.image_url
  );
