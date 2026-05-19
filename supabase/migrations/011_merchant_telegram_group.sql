-- ============================================================
-- 011: Merchant Telegram group chat id
-- ------------------------------------------------------------
-- Adds a nullable column on merchants for the Telegram group/channel
-- where new orders should be announced. NULL means no group is configured
-- and the notification is skipped.
--
-- Telegram group ids are negative and exceed INT32 (e.g. -1001234567890),
-- so we use BIGINT. Channels use the same encoding.
-- ============================================================

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS telegram_group_id BIGINT NULL;

COMMENT ON COLUMN merchants.telegram_group_id IS
  'Telegram chat id (negative integer) where new orders for this shop are posted. NULL = disabled.';
