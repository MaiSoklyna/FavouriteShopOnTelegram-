-- ABA PayWay QR payments
-- Run in Supabase SQL editor. Safe to re-run.

-- Latest PayWay transaction issued for the order (format: <order_id><unix_ts>)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payway_tran_id text;
-- When PayWay confirmed the payment
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
-- PayWay approval code (apv) for reconciliation
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_ref text;

CREATE INDEX IF NOT EXISTS idx_orders_payway_tran_id ON orders (payway_tran_id);

-- Seller's ABA account number for PayWay payout (split payment)
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS aba_account text;

-- Refresh PostgREST schema cache so the API sees the new columns
NOTIFY pgrst, 'reload schema';
