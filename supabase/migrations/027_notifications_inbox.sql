-- 027_notifications_inbox.sql
-- In-app notifications for customers AND shops, with deep links and no duplicates.
--
-- Before: one row per customer, a number in ref_id nobody could interpret, nothing to stop the
-- same event being announced twice, and no inbox for merchants.
--
-- Now:
--   kind        what happened (order_placed, order_paid, order_status, review_request, new_order,
--               payout, promo, system, loyalty); `type` stays for the old enum
--   link        where a tap goes inside the app, e.g. /shop/order/35 or /orders
--   dedupe_key  one row per event: "order:35:status:delivered". A repeated event is ignored.
--   merchant_id the recipient is a shop (user_id is then null), so merchants get their own inbox
--
-- The API works before this migration too (it falls back to the old columns), so it can be
-- deployed first. Run this in the Supabase SQL editor.

BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS kind        text,
  ADD COLUMN IF NOT EXISTS link        text,
  ADD COLUMN IF NOT EXISTS dedupe_key  text,
  ADD COLUMN IF NOT EXISTS merchant_id bigint REFERENCES merchants(id) ON DELETE CASCADE;

ALTER TABLE notifications ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_recipient_chk') THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_recipient_chk CHECK (user_id IS NOT NULL OR merchant_id IS NOT NULL);
  END IF;
END $$;

-- One notification per event and recipient
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_dedupe
  ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_merchant_dedupe
  ON notifications (merchant_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND merchant_id IS NOT NULL;

-- Fast list and unread count
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, is_read, sent_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_merchant_unread
  ON notifications (merchant_id, is_read, sent_at DESC) WHERE merchant_id IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
