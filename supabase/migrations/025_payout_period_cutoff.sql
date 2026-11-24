-- 025_payout_period_cutoff.sql
-- Strict period cutoff for merchant payouts (monthly settlement).
--
-- create_merchant_payout gains an optional half-open window
-- [p_period_start, p_period_end) on merchant_earnings.ready_at, i.e. the moment
-- the order was delivered (or a post-payout reversal was booked). Only earnings
-- inside the window are bundled; earnings outside it stay 'ready' for a later
-- payout. With both NULL the behaviour is unchanged (everything available).
--
-- The window is stored on the payout so the settlement record shows exactly
-- what it covered. The caller decides the time zone (the backend uses
-- Asia/Phnom_Penh month boundaries converted to UTC).

BEGIN;

ALTER TABLE merchant_payouts
  ADD COLUMN IF NOT EXISTS period_start timestamptz,
  ADD COLUMN IF NOT EXISTS period_end   timestamptz;

-- Replace the 6-argument version (a second overload would make named-argument
-- calls without the new parameters ambiguous).
DROP FUNCTION IF EXISTS create_merchant_payout(bigint, text, text, text, text, text);

CREATE OR REPLACE FUNCTION create_merchant_payout(
  p_merchant_id  bigint,
  p_currency     text,
  p_method       text,
  p_note         text,
  p_actor_type   text,
  p_actor_id     text,
  p_period_start timestamptz DEFAULT NULL,
  p_period_end   timestamptz DEFAULT NULL
) RETURNS merchant_payouts
LANGUAGE plpgsql AS $$
DECLARE
  v_merchant merchants;
  v_total    numeric(12,2);
  v_count    integer;
  v_payout   merchant_payouts;
BEGIN
  IF (p_period_start IS NULL) <> (p_period_end IS NULL) THEN
    RAISE EXCEPTION 'Provide both period_start and period_end, or neither' USING ERRCODE = 'P0001';
  END IF;
  IF p_period_start IS NOT NULL AND p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'period_end must be after period_start' USING ERRCODE = 'P0001';
  END IF;

  -- Serialise payout creation per merchant
  SELECT * INTO v_merchant FROM merchants WHERE id = p_merchant_id FOR UPDATE;
  IF v_merchant.id IS NULL THEN
    RAISE EXCEPTION 'Merchant % not found', p_merchant_id USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM merchant_earnings
   WHERE merchant_id = p_merchant_id AND currency = p_currency
     AND status = 'ready' AND payout_id IS NULL AND settlement_method = 'manual'
     AND (p_period_start IS NULL OR (ready_at >= p_period_start AND ready_at < p_period_end))
   FOR UPDATE;

  SELECT COALESCE(SUM(net_amount), 0), COUNT(*) INTO v_total, v_count
    FROM merchant_earnings
   WHERE merchant_id = p_merchant_id AND currency = p_currency
     AND status = 'ready' AND payout_id IS NULL AND settlement_method = 'manual'
     AND (p_period_start IS NULL OR (ready_at >= p_period_start AND ready_at < p_period_end));

  IF v_count = 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'Nothing to pay out for merchant % (available %)', p_merchant_id, v_total
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO merchant_payouts (
    merchant_id, currency, amount, item_count, method, status,
    aba_account, aba_account_name, note, created_by, period_start, period_end
  ) VALUES (
    p_merchant_id, p_currency, v_total, v_count, p_method, 'pending',
    v_merchant.aba_account, v_merchant.aba_account_name, p_note, p_actor_id,
    p_period_start, p_period_end
  ) RETURNING * INTO v_payout;

  INSERT INTO merchant_payout_items (payout_id, earning_id, amount)
  SELECT v_payout.id, id, net_amount FROM merchant_earnings
   WHERE merchant_id = p_merchant_id AND currency = p_currency
     AND status = 'ready' AND payout_id IS NULL AND settlement_method = 'manual'
     AND (p_period_start IS NULL OR (ready_at >= p_period_start AND ready_at < p_period_end));

  UPDATE merchant_earnings SET payout_id = v_payout.id
   WHERE id IN (SELECT earning_id FROM merchant_payout_items WHERE payout_id = v_payout.id);

  INSERT INTO settlement_audit_log (entity_type, entity_id, merchant_id, action, actor_type, actor_id, new_value, note)
  VALUES ('payout', v_payout.id, p_merchant_id, 'payout.created', p_actor_type, p_actor_id, to_jsonb(v_payout), p_note);

  RETURN v_payout;
END $$;

REVOKE ALL ON FUNCTION create_merchant_payout(bigint,text,text,text,text,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
