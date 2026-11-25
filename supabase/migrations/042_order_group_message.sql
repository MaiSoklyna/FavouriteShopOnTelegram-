-- 042: Remember each order's message in the shop's Telegram order group
--
-- The "New order" message in the shop's group now has Accept / Reject buttons (cash orders) or
-- "Can't fulfil – cancel & refund" (paid orders). Storing the message id lets the backend update that
-- message when the order is handled somewhere else (the dashboard, or the customer cancelling): the
-- buttons go away and the message says what happened, so nobody taps a stale button.
--
-- Safe to run more than once. Before it is run the buttons still work; a dashboard action just leaves
-- them on the message until someone taps one (the tap then says the order was already handled).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS telegram_group_message_id bigint;

NOTIFY pgrst, 'reload schema';
