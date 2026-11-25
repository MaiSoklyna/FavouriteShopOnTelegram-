-- 040: Delivery confirmation code
--
-- A driver marks an order delivered only with the 4-digit code the customer sees on their order
-- page (and in the "out for delivery" message). The code itself is not stored: the backend derives
-- it from the order and a server secret (app/services/delivery_code.py). This column counts wrong
-- tries, so a code cannot be guessed: after 5 the driver must ask the shop, which can still confirm
-- the delivery from the dashboard.
--
-- Safe to run more than once. Before it is run the code is still required, but wrong tries are
-- not counted.

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS code_attempts int NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
