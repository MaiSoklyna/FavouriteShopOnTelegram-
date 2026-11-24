-- 026_atomic_stock_test.sql
-- Run in the Supabase SQL editor AFTER migration 026.
-- Everything happens inside a transaction that is ROLLED BACK at the end, so no data is
-- kept. Success = the final result row says "ALL CHECKS PASSED"; a failed check raises an
-- error and shows which one.
--
-- It creates a throw-away product with variants. (Concurrency between two sessions cannot
-- be shown in one script; each call below is a single transaction, which is what the
-- row-level "UPDATE ... WHERE stock >= qty" relies on. The API-level concurrency test
-- covers the rest.)

BEGIN;

DO $$
DECLARE
  m        bigint;
  p_plain  bigint;
  p_var    bigint;
  v_color  integer;
  o_red    integer;
  o_blue   integer;
  s        integer;
  failed   boolean;
  msg      text;
BEGIN
  SELECT id INTO m FROM merchants ORDER BY id LIMIT 1;
  IF m IS NULL THEN RAISE EXCEPTION 'No merchant to test with'; END IF;

  INSERT INTO products (name, merchant_id, base_price, stock, is_active)
  VALUES ('TEST plain', m, 5, 3, true) RETURNING id INTO p_plain;
  INSERT INTO products (name, merchant_id, base_price, stock, is_active)
  VALUES ('TEST variants', m, 5, 0, true) RETURNING id INTO p_var;
  INSERT INTO product_variants (product_id, group_name, type) VALUES (p_var, 'Color', 'color') RETURNING id INTO v_color;
  INSERT INTO product_variant_options (variant_id, label, stock_adjust) VALUES (v_color, 'Red', 2) RETURNING id INTO o_red;
  INSERT INTO product_variant_options (variant_id, label, stock_adjust) VALUES (v_color, 'Blue', 5) RETURNING id INTO o_blue;

  -- 1. A plain product: reserve 2 of 3, then 2 more must fail and take nothing
  PERFORM reserve_stock(jsonb_build_array(jsonb_build_object('product_id', p_plain, 'quantity', 2)));
  SELECT stock INTO s FROM products WHERE id = p_plain;
  IF s <> 1 THEN RAISE EXCEPTION 'CHECK 1 FAILED: stock is % after reserving 2 of 3 (expected 1)', s; END IF;

  failed := false;
  BEGIN
    PERFORM reserve_stock(jsonb_build_array(jsonb_build_object('product_id', p_plain, 'quantity', 2)));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN failed := true; msg := SQLERRM;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'CHECK 2 FAILED: oversell was allowed'; END IF;
  IF msg NOT LIKE '%TEST plain%' THEN RAISE EXCEPTION 'CHECK 2b FAILED: error does not name the product: %', msg; END IF;
  SELECT stock INTO s FROM products WHERE id = p_plain;
  IF s <> 1 THEN RAISE EXCEPTION 'CHECK 2c FAILED: a refused reservation changed stock to %', s; END IF;

  -- 3. The last unit goes to exactly one buyer
  PERFORM reserve_stock(jsonb_build_array(jsonb_build_object('product_id', p_plain, 'quantity', 1)));
  failed := false;
  BEGIN
    PERFORM reserve_stock(jsonb_build_array(jsonb_build_object('product_id', p_plain, 'quantity', 1)));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'CHECK 3 FAILED: the same last unit was sold twice'; END IF;

  -- 4. Variants: the chosen options limit the order, product stock (0) is not a limit
  PERFORM reserve_stock(jsonb_build_array(jsonb_build_object('product_id', p_var, 'quantity', 2, 'option_ids', jsonb_build_array(o_red))));
  SELECT stock_adjust INTO s FROM product_variant_options WHERE id = o_red;
  IF s <> 0 THEN RAISE EXCEPTION 'CHECK 4 FAILED: Red has % left (expected 0)', s; END IF;
  SELECT stock INTO s FROM products WHERE id = p_var;
  IF s <> 0 THEN RAISE EXCEPTION 'CHECK 4b FAILED: variant product stock went to % (expected clamped 0)', s; END IF;

  -- 5. All or nothing: line 1 is fine, line 2 is sold out -> line 1 must be rolled back too
  failed := false;
  BEGIN
    PERFORM reserve_stock(jsonb_build_array(
      jsonb_build_object('product_id', p_var,   'quantity', 1, 'option_ids', jsonb_build_array(o_blue)),
      jsonb_build_object('product_id', p_plain, 'quantity', 1)));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'CHECK 5 FAILED: a basket with a sold-out line was accepted'; END IF;
  SELECT stock_adjust INTO s FROM product_variant_options WHERE id = o_blue;
  IF s <> 5 THEN RAISE EXCEPTION 'CHECK 5b FAILED: Blue is % after a refused basket (expected 5, i.e. rolled back)', s; END IF;

  -- 6. Release gives it back (atomic increment) and counts options too
  PERFORM release_stock(jsonb_build_array(
    jsonb_build_object('product_id', p_var, 'quantity', 2, 'option_ids', jsonb_build_array(o_red)),
    jsonb_build_object('product_id', p_plain, 'quantity', 3)));
  SELECT stock_adjust INTO s FROM product_variant_options WHERE id = o_red;
  IF s <> 2 THEN RAISE EXCEPTION 'CHECK 6 FAILED: Red is % after release (expected 2)', s; END IF;
  SELECT stock INTO s FROM products WHERE id = p_plain;
  IF s <> 3 THEN RAISE EXCEPTION 'CHECK 6b FAILED: plain stock is % after release (expected 3)', s; END IF;

  -- 7. Bad input is refused
  failed := false;
  BEGIN
    PERFORM reserve_stock(jsonb_build_array(jsonb_build_object('product_id', p_plain, 'quantity', 0)));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'CHECK 7 FAILED: quantity 0 was accepted'; END IF;
END $$;

SELECT 'ALL CHECKS PASSED' AS result;

ROLLBACK;
