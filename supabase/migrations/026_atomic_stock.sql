-- 026_atomic_stock.sql
-- Atomic stock reservation and release for orders.
--
-- Before: the API read the stock, subtracted in Python and wrote it back, one row at a
-- time, after the order already existed. Two orders for the last unit both succeeded
-- (and the clamp at zero hid it), concurrent updates overwrote each other, and a
-- failure halfway left stock half-taken.
--
-- Now one function call is one transaction:
--   reserve_stock(items)  takes stock for every line, or takes none and raises
--   release_stock(items)  gives it back (cancelled / failed orders)
--
-- p_items is a JSON array: [{"product_id": 9, "quantity": 2, "option_ids": [21, 18]}, ...]
--
-- Rules (same as the cart): a plain product is limited by its own stock; a product with
-- variants is limited by the chosen options' stock (product-level stock is only a running
-- total for those, clamped at zero, never a limit - it is not kept in step with options).

BEGIN;

CREATE OR REPLACE FUNCTION reserve_stock(p_items jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_line  jsonb;
  v_pid   bigint;
  v_qty   integer;
  v_opt   bigint;
  v_rows  integer;
  v_name  text;
  v_label text;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Invalid stock request' USING ERRCODE = 'P0001';
  END IF;

  -- Fixed lock order (product id, then option id): two overlapping orders can never deadlock.
  FOR v_line IN
    SELECT value FROM jsonb_array_elements(p_items) ORDER BY (value->>'product_id')::bigint
  LOOP
    v_pid := (v_line->>'product_id')::bigint;
    v_qty := (v_line->>'quantity')::integer;
    IF v_pid IS NULL OR v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'Invalid stock request' USING ERRCODE = 'P0001';
    END IF;

    IF jsonb_array_length(COALESCE(v_line->'option_ids', '[]'::jsonb)) = 0 THEN
      -- Plain product: its own stock is the limit. The check and the subtraction are one
      -- statement, so two buyers of the last unit cannot both pass.
      UPDATE products SET stock = stock - v_qty WHERE id = v_pid AND stock >= v_qty;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        SELECT name INTO v_name FROM products WHERE id = v_pid;
        RAISE EXCEPTION '"%" just sold out or has fewer left than you asked for', COALESCE(v_name, 'An item')
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      UPDATE products SET stock = GREATEST(stock - v_qty, 0) WHERE id = v_pid;
      FOR v_opt IN
        SELECT o::bigint FROM jsonb_array_elements_text(v_line->'option_ids') AS t(o) ORDER BY 1
      LOOP
        UPDATE product_variant_options SET stock_adjust = COALESCE(stock_adjust, 0) - v_qty
         WHERE id = v_opt AND COALESCE(stock_adjust, 0) >= v_qty;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows = 0 THEN
          SELECT o.label, p.name INTO v_label, v_name
            FROM product_variant_options o
            JOIN product_variants v ON v.id = o.variant_id
            JOIN products p ON p.id = v.product_id
           WHERE o.id = v_opt;
          RAISE EXCEPTION '"%" (%) just sold out or has fewer left than you asked for',
            COALESCE(v_name, 'An item'), COALESCE(v_label, 'that option')
            USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;


CREATE OR REPLACE FUNCTION release_stock(p_items jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_line jsonb;
  v_pid  bigint;
  v_qty  integer;
  v_opt  bigint;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Invalid stock request' USING ERRCODE = 'P0001';
  END IF;

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(p_items) ORDER BY (value->>'product_id')::bigint
  LOOP
    v_pid := (v_line->>'product_id')::bigint;
    v_qty := (v_line->>'quantity')::integer;
    IF v_pid IS NULL OR v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'Invalid stock request' USING ERRCODE = 'P0001';
    END IF;

    UPDATE products SET stock = stock + v_qty WHERE id = v_pid;
    FOR v_opt IN
      SELECT o::bigint FROM jsonb_array_elements_text(COALESCE(v_line->'option_ids', '[]'::jsonb)) AS t(o) ORDER BY 1
    LOOP
      UPDATE product_variant_options SET stock_adjust = COALESCE(stock_adjust, 0) + v_qty WHERE id = v_opt;
    END LOOP;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION reserve_stock(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_stock(jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
