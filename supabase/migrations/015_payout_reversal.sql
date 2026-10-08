-- ════════════════════════════════════════════════════════════════
-- 015 — Reverse a paid payout
--
-- For a payout marked paid when no money actually reached the merchant
-- (test run, wrong reference, bank returned the transfer). The payout row
-- and its items are kept; it is marked 'reversed' and its earnings go
-- back to available so they can be paid again. Fully audited.
--
-- Requires 014_merchant_settlement.sql. Safe to re-run.
-- ════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE merchant_payouts DROP CONSTRAINT IF EXISTS merchant_payouts_status_check;
ALTER TABLE merchant_payouts ADD CONSTRAINT merchant_payouts_status_check
  CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled', 'reversed'));

ALTER TABLE merchant_payouts ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE merchant_payouts ADD COLUMN IF NOT EXISTS reversed_by text;
ALTER TABLE merchant_payouts ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE OR REPLACE FUNCTION reverse_merchant_payout(
  p_payout_id  bigint,
  p_reason     text,
  p_actor_type text,
  p_actor_id   text
) RETURNS merchant_payouts
LANGUAGE plpgsql AS $$
DECLARE
  v_payout   merchant_payouts;
  v_earnings jsonb;
BEGIN
  SELECT * INTO v_payout FROM merchant_payouts WHERE id = p_payout_id FOR UPDATE;
  IF v_payout.id IS NULL THEN
    RAISE EXCEPTION 'Payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;
  IF v_payout.status <> 'paid' THEN
    RAISE EXCEPTION 'Only paid payouts can be reversed (payout % is %)', p_payout_id, v_payout.status
      USING ERRCODE = 'P0001';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'A reversal reason is required' USING ERRCODE = 'P0001';
  END IF;

  -- Serialise with payout creation for this merchant
  PERFORM 1 FROM merchants WHERE id = v_payout.merchant_id FOR UPDATE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'net_amount', net_amount) ORDER BY id), '[]'::jsonb)
    INTO v_earnings
    FROM merchant_earnings WHERE payout_id = p_payout_id;

  -- Earnings become payable again; merchant_payout_items keeps the history
  UPDATE merchant_earnings
     SET status = 'ready', payout_id = NULL, paid_at = NULL
   WHERE payout_id = p_payout_id AND status = 'paid';

  -- Anything else still linked (should not happen) is released too
  UPDATE merchant_earnings SET payout_id = NULL WHERE payout_id = p_payout_id;

  UPDATE merchant_payouts
     SET status = 'reversed', reversed_at = now(), reversed_by = p_actor_id,
         reversal_reason = trim(p_reason)
   WHERE id = p_payout_id
  RETURNING * INTO v_payout;

  INSERT INTO settlement_audit_log (entity_type, entity_id, merchant_id, action, actor_type, actor_id, old_value, new_value, note)
  VALUES ('payout', v_payout.id, v_payout.merchant_id, 'payout.reversed', p_actor_type, p_actor_id,
          jsonb_build_object('status', 'paid', 'reference', v_payout.reference, 'paid_at', v_payout.paid_at),
          jsonb_build_object('status', 'reversed', 'amount', v_payout.amount, 'released_earnings', v_earnings),
          trim(p_reason));

  RETURN v_payout;
END $$;

REVOKE ALL ON FUNCTION reverse_merchant_payout(bigint,text,text,text) FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
