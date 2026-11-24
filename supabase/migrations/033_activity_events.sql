-- 033_activity_events.sql
-- Activity tracking: what customers do in the app, so shops and the platform can see interest and where
-- people drop off (views -> add to cart -> order) and what people search for.
--
-- activity_events   one row per thing a customer did. Five kinds:
--                   product_view, shop_view, search, add_to_cart, order_placed.
--                   Privacy: no IP address and no device details are stored. A visitor is the signed-in
--                   customer, or a random id the browser makes up for itself (session_id) when signed out.
--                   Search text is stored (at most 100 characters). Keep it only as long as it is useful:
--                   delete old rows with  DELETE FROM activity_events WHERE created_at < now() - interval '180 days';
-- activity_summary  does all the counting inside the database (PostgREST returns at most 1000 rows, so adding
--                   up in the app would silently undercount). p_merchant_id limits it to one shop.
--
-- Nothing existing is changed.

BEGIN;

CREATE TABLE IF NOT EXISTS activity_events (
  id           bigserial PRIMARY KEY,
  event_type   text        NOT NULL CHECK (event_type IN ('product_view', 'shop_view', 'search', 'add_to_cart', 'order_placed')),
  user_id      bigint      NULL REFERENCES users(id)     ON DELETE SET NULL,
  session_id   text        NULL CHECK (session_id IS NULL OR char_length(session_id) <= 64),
  product_id   bigint      NULL REFERENCES products(id)  ON DELETE CASCADE,
  merchant_id  bigint      NULL REFERENCES merchants(id) ON DELETE CASCADE,
  order_id     bigint      NULL REFERENCES orders(id)    ON DELETE SET NULL,
  query        text        NULL CHECK (query IS NULL OR char_length(query) <= 100),
  result_count integer     NULL CHECK (result_count IS NULL OR result_count >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_created       ON activity_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_shop_type     ON activity_events (merchant_id, event_type, created_at DESC) WHERE merchant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_product_type  ON activity_events (product_id, event_type) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_search        ON activity_events (created_at DESC) WHERE event_type = 'search';

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;   -- only the backend (service role) reads and writes it

CREATE OR REPLACE FUNCTION activity_summary(p_days integer, p_merchant_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH win AS (
    SELECT e.*, COALESCE('u' || e.user_id::text, 's' || e.session_id) AS visitor
      FROM activity_events e
     WHERE e.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
       AND (p_merchant_id IS NULL OR e.merchant_id = p_merchant_id)
  ),
  viewed  AS (SELECT DISTINCT visitor FROM win WHERE event_type IN ('product_view', 'shop_view') AND visitor IS NOT NULL),
  carted  AS (SELECT DISTINCT visitor FROM win WHERE event_type = 'add_to_cart'  AND visitor IN (SELECT visitor FROM viewed)),
  ordered AS (SELECT DISTINCT visitor FROM win WHERE event_type = 'order_placed' AND visitor IN (SELECT visitor FROM carted))
  SELECT jsonb_build_object(
    'totals', (SELECT COALESCE(jsonb_object_agg(event_type, n), '{}'::jsonb)
                 FROM (SELECT event_type, count(*) AS n FROM win GROUP BY event_type) t),
    -- Of the people who looked at something, how many added to cart, and of those how many ordered
    'funnel', jsonb_build_object(
      'viewed',  (SELECT count(*) FROM viewed),
      'carted',  (SELECT count(*) FROM carted),
      'ordered', (SELECT count(*) FROM ordered)),
    'daily', (SELECT COALESCE(jsonb_agg(d ORDER BY d->>'date'), '[]'::jsonb) FROM (
                SELECT jsonb_build_object(
                         'date', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
                         'product_view',  count(*) FILTER (WHERE event_type = 'product_view'),
                         'shop_view',     count(*) FILTER (WHERE event_type = 'shop_view'),
                         'search',        count(*) FILTER (WHERE event_type = 'search'),
                         'add_to_cart',   count(*) FILTER (WHERE event_type = 'add_to_cart'),
                         'order_placed',  count(*) FILTER (WHERE event_type = 'order_placed')) AS d
                  FROM win GROUP BY to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')) x),
    'top_products', (SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', product_id, 'views', views, 'carts', carts)
                                               ORDER BY views DESC, carts DESC, product_id), '[]'::jsonb)
                       FROM (SELECT product_id,
                                    count(*) FILTER (WHERE event_type = 'product_view') AS views,
                                    count(*) FILTER (WHERE event_type = 'add_to_cart')  AS carts
                               FROM win
                              WHERE product_id IS NOT NULL AND event_type IN ('product_view', 'add_to_cart')
                              GROUP BY product_id
                              ORDER BY views DESC, carts DESC, product_id
                              LIMIT 10) p),
    -- Searches belong to no shop, so this is empty when the summary is for one shop
    'top_searches', (SELECT COALESCE(jsonb_agg(jsonb_build_object('query', q, 'searches', n, 'no_results', z) ORDER BY n DESC, q), '[]'::jsonb)
                       FROM (SELECT lower(btrim(query)) AS q, count(*) AS n, count(*) FILTER (WHERE result_count = 0) AS z
                               FROM win
                              WHERE event_type = 'search' AND query IS NOT NULL AND btrim(query) <> ''
                              GROUP BY lower(btrim(query))
                              ORDER BY count(*) DESC, lower(btrim(query))
                              LIMIT 10) s)
  );
$$;

REVOKE ALL ON FUNCTION activity_summary(integer, bigint) FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
