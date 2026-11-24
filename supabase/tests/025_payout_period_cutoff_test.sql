-- 025_payout_period_cutoff_test.sql
-- Run in the Supabase SQL editor AFTER migration 025.
-- Everything happens inside a transaction that is ROLLED BACK at the end, so no
-- data is kept. Success = the final result row says "ALL CHECKS PASSED";
-- a failed check raises an error and shows which one.
--
-- It uses the first merchant it finds and inserts throw-away earnings.

BEGIN;

DO $$
DECLARE
  m   bigint;
  p1  merchant_payouts;
  p2  merchant_payouts;
  n   integer;
  dup boolean;
BEGIN
  SELECT id INTO m FROM merchants ORDER BY id LIMIT 1;
  IF m IS NULL THEN RAISE EXCEPTION 'No merchant to test with'; END IF;

  -- Park any real ready earnings so the test only sees its own rows.
  UPDATE merchant_earnings SET settlement_method = 'aba_split'
   WHERE merchant_id = m AND status = 'ready' AND payout_id IS NULL AND settlement_method = 'manual';

  -- Phnom Penh (UTC+7) November 2026 = [2026-10-31 17:00Z, 2026-11-30 17:00Z)
  INSERT INTO merchant_earnings (merchant_id, entry_type, currency, gross_amount, commission_base,
                                 commission_rate, commission_amount, net_amount, status, ready_at, description)
  VALUES
    (m,'adjustment','USD',10,10,0,0,10,'ready','2026-10-31 16:59:59+00','TEST october (just before)'),
    (m,'adjustment','USD',20,20,0,0,20,'ready','2026-10-31 17:00:00+00','TEST nov first second'),
    (m,'adjustment','USD',30,30,0,0,30,'ready','2026-11-15 05:00:00+00','TEST nov middle'),
    (m,'adjustment','USD',40,40,0,0,40,'ready','2026-11-30 16:59:59+00','TEST nov last second'),
    (m,'adjustment','USD',80,80,0,0,80,'ready','2026-11-30 17:00:00+00','TEST december first second'),
    (m,'adjustment','USD',160,160,0,0,160,'ready','2026-12-20 03:00:00+00','TEST december later');

  -- 1. November payout contains exactly 20 + 30 + 40
  p1 := create_merchant_payout(m,'USD','manual_transfer','Monthly settlement 2026-11','test','test',
                               '2026-10-31 17:00:00+00', '2026-11-30 17:00:00+00');
  IF p1.amount <> 90 OR p1.item_count <> 3 THEN
    RAISE EXCEPTION 'CHECK 1 FAILED: November payout was % over % items (expected 90 over 3)', p1.amount, p1.item_count;
  END IF;
  IF p1.period_start IS NULL OR p1.note <> 'Monthly settlement 2026-11' THEN
    RAISE EXCEPTION 'CHECK 1b FAILED: window/note not stored';
  END IF;

  -- 2. Running November again finds nothing (no double settling)
  BEGIN
    PERFORM create_merchant_payout(m,'USD','manual_transfer','Monthly settlement 2026-11','test','test',
                                   '2026-10-31 17:00:00+00', '2026-11-30 17:00:00+00');
    dup := true;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    dup := false; -- "Nothing to pay out" is the expected outcome
  END;
  IF dup THEN RAISE EXCEPTION 'CHECK 2 FAILED: second November run created a payout'; END IF;

  -- 3. December orders were untouched and still available
  SELECT COUNT(*) INTO n FROM merchant_earnings
   WHERE merchant_id = m AND status = 'ready' AND payout_id IS NULL AND description LIKE 'TEST december%';
  IF n <> 2 THEN RAISE EXCEPTION 'CHECK 3 FAILED: % december earnings left (expected 2)', n; END IF;

  -- 4. The October earning (outside the window) was not swept into November
  SELECT COUNT(*) INTO n FROM merchant_earnings
   WHERE merchant_id = m AND payout_id IS NULL AND description = 'TEST october (just before)';
  IF n <> 1 THEN RAISE EXCEPTION 'CHECK 4 FAILED: october earning was settled in november'; END IF;

  -- 5. December payout takes only December (80 + 160)
  p2 := create_merchant_payout(m,'USD','manual_transfer','Monthly settlement 2026-12','test','test',
                               '2026-11-30 17:00:00+00', '2026-12-31 17:00:00+00');
  IF p2.amount <> 240 THEN RAISE EXCEPTION 'CHECK 5 FAILED: december payout was %', p2.amount; END IF;

  -- 6. No earning is in two payouts
  SELECT COUNT(*) INTO n FROM (
    SELECT earning_id FROM merchant_payout_items
     WHERE payout_id IN (p1.id, p2.id) GROUP BY earning_id HAVING COUNT(*) > 1) d;
  IF n <> 0 THEN RAISE EXCEPTION 'CHECK 6 FAILED: an earning is in both payouts'; END IF;

  -- 7. Omitting the window still means "everything available" (old behaviour)
  UPDATE merchant_earnings SET status = 'ready', payout_id = NULL, description = 'TEST legacy'
   WHERE description = 'TEST october (just before)';
  IF (create_merchant_payout(m,'USD','manual_transfer','legacy','test','test')).amount <> 10 THEN
    RAISE EXCEPTION 'CHECK 7 FAILED: call without a window changed behaviour';
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

ROLLBACK;

SELECT 'If you saw no error above: ALL CHECKS PASSED (transaction rolled back, nothing saved)' AS result;
