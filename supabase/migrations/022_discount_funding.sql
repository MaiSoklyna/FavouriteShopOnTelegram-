-- ════════════════════════════════════════════════════════════════
-- 022 — Who pays for a discount: the shop or the platform
--
-- Default rule:
--   Platform promotions (scope 'platform' / no shop) → paid by the platform
--   Shop promotions                                  → paid by the shop
--
-- A platform-funded discount must never reduce what the merchant earns:
--   Product $100, discount $10 (platform) → customer pays $90,
--   platform covers $10, merchant is owed $100 (minus commission).
--
--  1. promotions.funded_by           'shop' | 'platform'
--  2. orders.merchant_discount_amount / platform_discount_amount
--     (discount_amount stays the total; the two parts add up to it)
--  3. merchant_earnings.platform_subsidy
--     net_amount = gross_amount + platform_subsidy - commission_amount
--     gross_amount stays "money the platform received for this order".
--     A cash-on-delivery order with a platform discount gets a subsidy-only
--     earning (gross 0, net = subsidy): the merchant holds the cash, the
--     platform owes the difference.
--  4. record_order_earning / reverse_order_earning carry the subsidy
--  5. merchant_balances gets subsidy_total
--
-- Earnings already recorded are not changed (the ledger is append-only).
-- Requires 014, 018, 019. Safe to re-run.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Promotions ───────────────────────────────────────────────
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS funded_by text;
UPDATE promotions
   SET funded_by = CASE WHEN scope = 'platform' OR merchant_id IS NULL THEN 'platform' ELSE 'shop' END
 WHERE funded_by IS NULL;
ALTER TABLE promotions ALTER COLUMN funded_by SET DEFAULT 'shop';
ALTER TABLE promotions ALTER COLUMN funded_by SET NOT NULL;
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_funded_by_check;
ALTER TABLE promotions ADD CONSTRAINT promotions_funded_by_check
  CHECK (funded_by IN ('shop', 'platform'));

-- ── 2. Orders ───────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_discount_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_discount_amount numeric(12,2) NOT NULL DEFAULT 0;
-- Until now every discount came out of the shop's payout: record it that way.
UPDATE orders
   SET merchant_discount_amount = COALESCE(discount_amount, 0)
 WHERE COALESCE(discount_amount, 0) > 0
   AND merchant_discount_amount = 0 AND platform_discount_amount = 0;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_discount_parts_chk;
ALTER TABLE orders ADD CONSTRAINT orders_discount_parts_chk
  CHECK (merchant_discount_amount >= 0 AND platform_discount_amount >= 0);

-- ── 3. Earnings ledger ──────────────────────────────────────────
ALTER TABLE merchant_earnings ADD COLUMN IF NOT EXISTS platform_subsidy numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE merchant_earnings DROP CONSTRAINT IF EXISTS merchant_earnings_amounts_chk;
ALTER TABLE merchant_earnings ADD CONSTRAINT merchant_earnings_amounts_chk
  CHECK (net_amount = gross_amount + platform_subsidy - commission_amount);

-- ── 4. Ledger functions ─────────────────────────────────────────
-- New parameter → drop the old signature so PostgREST has one function to call.
DROP FUNCTION IF EXISTS record_order_earning(
  bigint, bigint, text, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text);

CREATE OR REPLACE FUNCTION record_order_earning(
  p_order_id          bigint,
  p_merchant_id       bigint,
  p_currency          text,
  p_gross_amount      numeric,
  p_commission_base   numeric,
  p_commission_rate   numeric,
  p_commission_amount numeric,
  p_net_amount        numeric,
  p_collected_by      text,
  p_settlement_method text,
  p_payway_tran_id    text,
  p_actor_type        text,
  p_actor_id          text,
  p_platform_subsidy  numeric DEFAULT 0,
  p_description       text DEFAULT NULL
) RETURNS merchant_earnings
LANGUAGE plpgsql AS $$
DECLARE
  v_row merchant_earnings;
BEGIN
  INSERT INTO merchant_earnings (
    merchant_id, order_id, entry_type, currency,
    gross_amount, platform_subsidy, commission_base, commission_rate, commission_amount, net_amount,
    collected_by, settlement_method, status, payway_tran_id, description
  ) VALUES (
    p_merchant_id, p_order_id, 'order', p_currency,
    p_gross_amount, COALESCE(p_platform_subsidy, 0), p_commission_base, p_commission_rate,
    p_commission_amount, p_net_amount,
    p_collected_by, p_settlement_method, 'pending', p_payway_tran_id, p_description
  )
  ON CONFLICT (order_id) WHERE entry_type = 'order' DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    -- Already recorded (callback + poll race, retry, backfill)
    SELECT * INTO v_row FROM merchant_earnings
     WHERE order_id = p_order_id AND entry_type = 'order';
    RETURN v_row;
  END IF;

  INSERT INTO settlement_audit_log (entity_type, entity_id, merchant_id, action, actor_type, actor_id, new_value)
  VALUES ('earning', v_row.id, v_row.merchant_id, 'earning.created', p_actor_type, p_actor_id, to_jsonb(v_row));

  RETURN v_row;
END $$;

-- Same as 014, but the reversal adjustment also undoes the subsidy.
CREATE OR REPLACE FUNCTION reverse_order_earning(
  p_order_id   bigint,
  p_reason     text,
  p_actor_type text,
  p_actor_id   text
) RETURNS merchant_earnings
LANGUAGE plpgsql AS $$
DECLARE
  v_row merchant_earnings;
  v_adj merchant_earnings;
BEGIN
  SELECT * INTO v_row FROM merchant_earnings
   WHERE order_id = p_order_id AND entry_type = 'order'
   FOR UPDATE;

  IF v_row.id IS NULL OR v_row.status = 'reversed' THEN
    RETURN v_row;
  END IF;

  IF v_row.payout_id IS NOT NULL AND v_row.status <> 'paid' THEN
    RAISE EXCEPTION 'Earning % is in open payout %; fail or cancel the payout first',
      v_row.id, v_row.payout_id USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status = 'paid' THEN
    INSERT INTO merchant_earnings (
      merchant_id, order_id, entry_type, currency,
      gross_amount, platform_subsidy, commission_base, commission_rate, commission_amount, net_amount,
      collected_by, settlement_method, status, ready_at, description
    ) VALUES (
      v_row.merchant_id, v_row.order_id, 'adjustment', v_row.currency,
      -v_row.gross_amount, -v_row.platform_subsidy, -v_row.commission_base, v_row.commission_rate,
      -v_row.commission_amount, -v_row.net_amount,
      v_row.collected_by, 'manual', 'ready', now(),
      'Reversal of paid earning #' || v_row.id || COALESCE(': ' || p_reason, '')
    ) RETURNING * INTO v_adj;

    INSERT INTO settlement_audit_log (entity_type, entity_id, merchant_id, action, actor_type, actor_id, new_value, note)
    VALUES ('earning', v_adj.id, v_adj.merchant_id, 'earning.adjustment_created', p_actor_type, p_actor_id, to_jsonb(v_adj), p_reason);
    RETURN v_adj;
  END IF;

  UPDATE merchant_earnings
     SET status = 'reversed', reversed_at = now(),
         description = COALESCE(p_reason, description)
   WHERE id = v_row.id
  RETURNING * INTO v_adj;

  INSERT INTO settlement_audit_log (entity_type, entity_id, merchant_id, action, actor_type, actor_id, old_value, new_value, note)
  VALUES ('earning', v_row.id, v_row.merchant_id, 'earning.reversed', p_actor_type, p_actor_id,
          jsonb_build_object('status', v_row.status), jsonb_build_object('status', 'reversed'), p_reason);
  RETURN v_adj;
END $$;

-- ── 5. Balances: how much of what's owed the platform funded ────
CREATE OR REPLACE VIEW merchant_balances AS
SELECT
  m.id   AS merchant_id,
  m.name AS merchant_name,
  COALESCE(e.currency, 'USD') AS currency,
  COALESCE(e.pending_amount, 0)    AS pending_amount,
  COALESCE(e.available_amount, 0)  AS available_amount,
  COALESCE(e.in_payout_amount, 0)  AS in_payout_amount,
  COALESCE(e.available_amount, 0) + COALESCE(e.in_payout_amount, 0) AS owed_amount,
  COALESCE(e.paid_amount, 0)       AS paid_amount,
  COALESCE(e.failed_amount, 0)     AS failed_amount,
  COALESCE(e.gross_total, 0)       AS gross_total,
  COALESCE(e.commission_total, 0)  AS commission_total,
  e.last_earning_at,
  COALESCE(e.subsidy_total, 0)     AS subsidy_total
FROM merchants m
LEFT JOIN (
  SELECT
    merchant_id,
    currency,
    SUM(net_amount) FILTER (WHERE status = 'pending')                          AS pending_amount,
    SUM(net_amount) FILTER (WHERE status = 'ready' AND payout_id IS NULL
                              AND settlement_method = 'manual')                AS available_amount,
    SUM(net_amount) FILTER (WHERE status = 'ready' AND payout_id IS NOT NULL)  AS in_payout_amount,
    SUM(net_amount) FILTER (WHERE status = 'paid')                             AS paid_amount,
    SUM(net_amount) FILTER (WHERE status = 'failed')                           AS failed_amount,
    SUM(gross_amount)      FILTER (WHERE status <> 'reversed')                 AS gross_total,
    SUM(commission_amount) FILTER (WHERE status <> 'reversed')                 AS commission_total,
    MAX(created_at) AS last_earning_at,
    SUM(platform_subsidy)  FILTER (WHERE status <> 'reversed')                 AS subsidy_total
  FROM merchant_earnings
  GROUP BY merchant_id, currency
) e ON e.merchant_id = m.id;

-- ── 6. Keep the ledger closed to anon/authenticated (as in 014) ──
-- A new function signature starts with PUBLIC execute, so lock it again.
REVOKE ALL ON FUNCTION record_order_earning(bigint,bigint,text,numeric,numeric,numeric,numeric,numeric,text,text,text,text,text,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reverse_order_earning(bigint,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON merchant_balances FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
