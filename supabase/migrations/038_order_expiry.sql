-- 038: Unpaid online orders expire
--
-- A KHQR or card order reserves stock when it is placed. If the customer never pays, that stock
-- used to stay reserved forever. Now every online order gets a payment deadline when it is placed
-- (orders.payment_expires_at, set by the backend from PAYMENT_EXPIRY_MINUTES per payment method:
-- 30 minutes for KHQR and card; cash on delivery has none). A pending, unpaid order past its
-- deadline is moved to the new status 'expired' by the backend (app/services/order_expiry.py),
-- which also gives the stock and the coupon use back and writes the shop's activity log.
--
-- The deadline is stored on the order, so changing the minutes later only affects new orders.
-- Safe to run more than once. The backend keeps working before this is run (no deadlines are set
-- and nothing expires).

-- New status 'expired'. The live database stores orders.status as text, while 001 created an enum;
-- handle both, and widen any CHECK constraint on orders.status that lists the allowed values.
DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'expired';
  END IF;

  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'orders'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ~ '\mstatus\M' AND pg_get_constraintdef(oid) !~ 'payment_status'
       AND pg_get_constraintdef(oid) LIKE '%''cancelled''%'
       AND pg_get_constraintdef(oid) NOT LIKE '%''expired''%'
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', r.conname);
    EXECUTE format('ALTER TABLE orders ADD CONSTRAINT %I %s', r.conname,
                   regexp_replace(r.def, '''cancelled''(::[a-z_ ]+)?', '''cancelled''\1, ''expired''\1'));
    RAISE NOTICE 'Widened % to allow expired', r.conname;
  END LOOP;
END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz;

-- The expiry sweep only ever looks at pending orders with a deadline
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_pending
  ON orders (payment_expires_at)
  WHERE status = 'pending' AND payment_expires_at IS NOT NULL;

-- Online orders already waiting for payment get the same 30 minutes, counted from when they were placed
UPDATE orders
   SET payment_expires_at = created_at + interval '30 minutes'
 WHERE status = 'pending'
   AND payment_method IN ('khqr', 'stripe')
   AND COALESCE(payment_status::text, '') <> 'paid'
   AND payment_expires_at IS NULL;
