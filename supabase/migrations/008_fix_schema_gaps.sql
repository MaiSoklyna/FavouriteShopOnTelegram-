-- 008_fix_schema_gaps.sql
-- Fix schema gaps found during full feature audit

-- ══════════════════════════════════════════════════════════════
-- 0. Add telegram_id to super_admins (needed for Telegram login)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE NULL;

-- Also ensure merchant_admins has telegram_id (may be missing if 005 ran instead of 001)
ALTER TABLE merchant_admins ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE NULL;

-- ══════════════════════════════════════════════════════════════
-- 1. Add 'processing' to order_status enum
-- ══════════════════════════════════════════════════════════════

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'processing' AFTER 'confirmed';

-- ══════════════════════════════════════════════════════════════
-- 2. Add delivery_name and delivery_phone to orders
-- ══════════════════════════════════════════════════════════════

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_name  VARCHAR(150) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_phone VARCHAR(20)  NULL;

-- ══════════════════════════════════════════════════════════════
-- 3. Add order status timestamp columns for timeline tracking
-- ══════════════════════════════════════════════════════════════

ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_at    TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at  TIMESTAMPTZ NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS processing_at TIMESTAMPTZ NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at    TIMESTAMPTZ NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at  TIMESTAMPTZ NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ NULL;

-- ══════════════════════════════════════════════════════════════
-- 4. Add start_date to promo_codes
-- ══════════════════════════════════════════════════════════════

ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS start_date DATE NULL;

-- ══════════════════════════════════════════════════════════════
-- 5. Trigger: auto-set status timestamps on order update
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_order_status_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    CASE NEW.status
      WHEN 'confirmed'  THEN NEW.confirmed_at  = NOW();
      WHEN 'processing' THEN NEW.processing_at = NOW();
      WHEN 'shipped'    THEN NEW.shipped_at    = NOW();
      WHEN 'delivered'  THEN NEW.delivered_at  = NOW();
      WHEN 'cancelled'  THEN NEW.cancelled_at  = NOW();
      ELSE NULL;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_status_timestamp ON orders;
CREATE TRIGGER trg_order_status_timestamp
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_order_status_timestamp();

-- ══════════════════════════════════════════════════════════════
-- 6. Update place_order RPC to include delivery_name/phone
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION place_order(
  p_user_id         INT,
  p_merchant_id     INT,
  p_delivery_address TEXT,
  p_delivery_province VARCHAR DEFAULT NULL,
  p_customer_note   TEXT DEFAULT NULL,
  p_payment_method  payment_method DEFAULT 'cod',
  p_promo_code      VARCHAR DEFAULT NULL,
  p_delivery_name   VARCHAR DEFAULT NULL,
  p_delivery_phone  VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cart_id       INT;
  v_subtotal      DECIMAL(10,2);
  v_delivery_fee  DECIMAL(10,2);
  v_discount      DECIMAL(10,2) := 0;
  v_total         DECIMAL(10,2);
  v_promo_id      INT;
  v_order_id      INT;
  v_order_code    VARCHAR(20);
  v_promo         RECORD;
  v_item          RECORD;
BEGIN
  -- 1. Find cart
  SELECT id INTO v_cart_id
    FROM cart
   WHERE user_id = p_user_id AND merchant_id = p_merchant_id;

  IF v_cart_id IS NULL THEN
    RAISE EXCEPTION 'CART_EMPTY';
  END IF;

  -- 2. Calculate subtotal
  SELECT COALESCE(SUM(unit_price * quantity), 0) INTO v_subtotal
    FROM cart_items WHERE cart_id = v_cart_id;

  IF v_subtotal = 0 THEN
    RAISE EXCEPTION 'CART_EMPTY';
  END IF;

  -- 3. Delivery fee
  v_delivery_fee := CASE WHEN v_subtotal > 50 THEN 0 ELSE 5 END;

  -- 4. Promo code
  IF p_promo_code IS NOT NULL THEN
    SELECT * INTO v_promo
      FROM promo_codes
     WHERE merchant_id = p_merchant_id
       AND code = p_promo_code
       AND is_active = TRUE;

    IF FOUND THEN
      IF (v_promo.expires_at IS NULL OR v_promo.expires_at >= CURRENT_DATE)
         AND (v_promo.max_uses IS NULL OR v_promo.used_count < v_promo.max_uses)
         AND v_subtotal >= COALESCE(v_promo.min_order, 0) THEN
        IF v_promo.type = 'percent' THEN
          v_discount := ROUND(v_subtotal * v_promo.value / 100, 2);
        ELSE
          v_discount := LEAST(v_promo.value, v_subtotal);
        END IF;
        v_promo_id := v_promo.id;
      END IF;
    END IF;
  END IF;

  v_total := v_subtotal + v_delivery_fee - v_discount;

  -- 5. Generate order code
  v_order_code := 'FS-' || TO_CHAR(NOW(), 'YYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

  -- 6. Insert order
  INSERT INTO orders (
    order_code, user_id, merchant_id, promo_code_id,
    subtotal, discount_amount, delivery_fee, total,
    status, payment_method, payment_status,
    delivery_address, delivery_province, delivery_name, delivery_phone,
    customer_note, pending_at
  ) VALUES (
    v_order_code, p_user_id, p_merchant_id, v_promo_id,
    v_subtotal, v_discount, v_delivery_fee, v_total,
    'pending', p_payment_method, 'unpaid',
    p_delivery_address, p_delivery_province, p_delivery_name, p_delivery_phone,
    p_customer_note, NOW()
  )
  RETURNING id INTO v_order_id;

  -- 7. Create order items + deduct stock
  FOR v_item IN SELECT ci.*, p.name AS pname, p.sku AS psku, p.stock AS pstock
                  FROM cart_items ci
                  JOIN products p ON p.id = ci.product_id
                 WHERE ci.cart_id = v_cart_id
  LOOP
    INSERT INTO order_items (order_id, product_id, product_name, product_sku, selected_variants, quantity, unit_price, subtotal)
    VALUES (v_order_id, v_item.product_id, v_item.pname, v_item.psku, v_item.selected_variants,
            v_item.quantity, v_item.unit_price, v_item.unit_price * v_item.quantity);

    UPDATE products SET stock = GREATEST(stock - v_item.quantity, 0) WHERE id = v_item.product_id;
  END LOOP;

  -- 8. Record promo usage
  IF v_promo_id IS NOT NULL AND v_discount > 0 THEN
    INSERT INTO promo_usages (promo_code_id, user_id, order_id, discount_applied)
    VALUES (v_promo_id, p_user_id, v_order_id, v_discount);

    UPDATE promo_codes SET used_count = used_count + 1 WHERE id = v_promo_id;
  END IF;

  -- 9. Clear cart
  DELETE FROM cart_items WHERE cart_id = v_cart_id;
  DELETE FROM cart WHERE id = v_cart_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'delivery_fee', v_delivery_fee,
    'total', v_total,
    'status', 'pending',
    'payment_method', p_payment_method,
    'created_at', NOW()
  );
END;
$$;
