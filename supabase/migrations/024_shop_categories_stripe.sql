-- 024_shop_categories_stripe.sql
-- Shop categories/subcategories (what KIND of shop a merchant runs) and
-- Stripe test-mode payments.
--
-- Named shop_categories to avoid clashing with the existing product
-- `categories` table.

CREATE TABLE IF NOT EXISTS shop_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shop_subcategories (
  id          SERIAL PRIMARY KEY,
  category_id INT  NOT NULL REFERENCES shop_categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  UNIQUE (category_id, name)
);
CREATE INDEX IF NOT EXISTS idx_shop_subcategories_category ON shop_subcategories(category_id);

ALTER TABLE shop_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_subcategories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_categories_read ON shop_categories;
CREATE POLICY shop_categories_read ON shop_categories FOR SELECT USING (true);
DROP POLICY IF EXISTS shop_subcategories_read ON shop_subcategories;
CREATE POLICY shop_subcategories_read ON shop_subcategories FOR SELECT USING (true);

-- Nullable so shops and applications created before this migration keep working.
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS shop_category_id    INT REFERENCES shop_categories(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shop_subcategory_id INT REFERENCES shop_subcategories(id) ON DELETE SET NULL;
ALTER TABLE seller_applications
  ADD COLUMN IF NOT EXISTS shop_category_id    INT REFERENCES shop_categories(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shop_subcategory_id INT REFERENCES shop_subcategories(id) ON DELETE SET NULL;

INSERT INTO shop_categories (name, sort_order) VALUES
  ('Food & Beverage', 1), ('Fashion', 2), ('Electronics', 3),
  ('Health & Beauty', 4), ('Home & Living', 5)
ON CONFLICT (name) DO NOTHING;

INSERT INTO shop_subcategories (category_id, name, sort_order)
SELECT c.id, s.name, s.ord FROM (VALUES
  ('Food & Beverage', 'Cake Shop', 1), ('Food & Beverage', 'Coffee Shop', 2), ('Food & Beverage', 'Restaurant', 3),
  ('Fashion', 'Clothing', 1), ('Fashion', 'Shoes', 2), ('Fashion', 'Bags', 3),
  ('Electronics', 'Mobile Phones', 1), ('Electronics', 'Computers', 2), ('Electronics', 'Accessories', 3),
  ('Health & Beauty', 'Cosmetics', 1), ('Health & Beauty', 'Skincare', 2),
  ('Home & Living', 'Furniture', 1), ('Home & Living', 'Decoration', 2)
) AS s(cat, name, ord)
JOIN shop_categories c ON c.name = s.cat
ON CONFLICT (category_id, name) DO NOTHING;

-- Stripe test-mode payments
-- Some databases type orders.payment_method as an enum, others as plain text.
-- Only extend the enum when it exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'stripe';
  END IF;
END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

NOTIFY pgrst, 'reload schema';
