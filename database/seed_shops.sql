-- ============================================================
-- Seed: 6 demo shops + ~47 products
-- ------------------------------------------------------------
-- Idempotent: safe to run multiple times.
--   * Merchants:  ON CONFLICT (slug) DO NOTHING
--   * Products:   inserted only when no row with the same
--                 (merchant_id, sku) exists yet
--
-- Skin Care By Lyna is intentionally NOT inserted here — that
-- shop was created via the dashboard. An OPTIONAL appendix
-- below adds its 8 products if you want a fully populated demo.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────
-- 1) Six merchants
-- ─────────────────────────────────────────────────────
INSERT INTO merchants
  (name, slug, owner_name, email, phone, tagline, description,
   icon_emoji, accent_color, plan, status, fb_page, instagram, is_featured)
VALUES
  ('ChhayCha Coffee',     'chhaycha-coffee',     'Vichea Phon',     'vichea@chhaycha.com',    '+855 87 456 789',
   'Mondulkiri beans, brewed with love',
   'Specialty Cambodian coffee, fresh-roasted weekly in Phnom Penh. Single-origin beans from Mondulkiri and Ratanakiri provinces. Subscriptions and one-time bags available.',
   '☕', '#6F4E37', 'Standard', 'active',
   'facebook.com/chhaycha', '@chhaycha.coffee', true),

  ('Sokunthea Boutique',  'sokunthea-boutique',  'Sokunthea Chan',  'contact@sokunthea.shop', '+855 96 712 345',
   'Modern Khmer silhouettes for every occasion',
   'Contemporary women apparel mixing traditional Cambodian silk with modern cuts. Made-to-order alterations available. Sizes XS to XL.',
   '👗', '#EC4899', 'Standard', 'active',
   'facebook.com/sokunthea.boutique', '@sokunthea.shop', false),

  ('Bayon Eats',          'bayon-eats',          'Sopheap Kim',     'orders@bayoneats.kh',    '+855 78 901 234',
   'Homemade Khmer snacks, delivered hot',
   'Authentic street snacks made fresh daily by Phnom Penh aunties. Same-day delivery 10:00 to 20:00. No MSG; gluten-free options on request.',
   '🍜', '#F59E0B', 'Standard', 'active',
   'facebook.com/bayon.eats', '@bayon.eats', true),

  ('Angkor Tech',         'angkor-tech',         'Pisey Tep',       'hello@angkortech.kh',    '+855 11 234 567',
   'Smart gadgets for the Khmer hustle',
   'Curated electronics: phone accessories, smart home, audio, ergonomic peripherals. Every item is QC-checked before shipping. 14-day return policy.',
   '💻', '#2563EB', 'Premium', 'active',
   'facebook.com/angkortech', '@angkor.tech', false),

  ('Sanchey Books',       'sanchey-books',       'Channary Ouk',    'shop@sancheybooks.kh',   '+855 17 345 678',
   'Read more. Write better. Live curious.',
   'Khmer and English titles, plus planners and art supplies, curated for thinkers and makers. Local-author shelf restocked monthly.',
   '📚', '#16A34A', 'Standard', 'active',
   'facebook.com/sanchey.books', '@sanchey.books', false),

  ('Pteah Style',         'pteah-style',         'Sreyleak Meas',   'home@pteah.style',       '+855 81 567 890',
   'Beautiful Khmer homes, one piece at a time',
   'Rattan, ceramics, and textiles handmade by local artisans across Cambodia. Pieces are one-of-a-kind; small variations are part of the charm.',
   '🪴', '#A78BFA', 'Standard', 'active',
   'facebook.com/pteah.style', '@pteah.style', false)
ON CONFLICT (slug) DO NOTHING;


-- ─────────────────────────────────────────────────────
-- 2) Products — one VALUES table joined to merchants
-- ─────────────────────────────────────────────────────
INSERT INTO products
  (merchant_id, name, slug, description, sku,
   base_price, stock, icon_emoji, is_active, delivery_days)
SELECT m.id, p.name, p.slug, p.description, p.sku,
       p.base_price, p.stock, p.icon_emoji, TRUE, 3
FROM (
  VALUES
    -- ChhayCha Coffee ───────────────────────────────────
    ('chhaycha-coffee', 'Mondulkiri Single-Origin 250g', 'chhaycha-coffee-mondulkiri-250g',  'Light roast, notes of jasmine and orange.',          'CHC-MDK-250', 14.00::numeric, 50,  '🫘'),
    ('chhaycha-coffee', 'Ratanakiri Dark Roast 250g',    'chhaycha-coffee-ratanakiri-250g',  'Bold, chocolatey, low-acid finish.',                 'CHC-RTK-250', 13.50, 35,  '☕'),
    ('chhaycha-coffee', 'Cold Brew Concentrate 1L',      'chhaycha-coffee-cold-brew-1l',     'Makes 8 cups. Refrigerate after opening.',           'CHC-CB-1L',   11.00, 20,  '🧊'),
    ('chhaycha-coffee', 'Iced Latte (Ready-to-Drink)',   'chhaycha-coffee-iced-latte-rtd',   '350ml, delivered chilled in Phnom Penh.',            'CHC-LATTE',    3.50, 100, '🥛'),
    ('chhaycha-coffee', 'Vietnamese Phin Filter',        'chhaycha-coffee-phin-filter',      'Stainless steel, single-serve.',                     'CHC-PHIN',     6.00, 25,  '🫖'),
    ('chhaycha-coffee', 'Reusable Tumbler 12oz',         'chhaycha-coffee-tumbler-12oz',     'Insulated, ChhayCha branded.',                       'CHC-TUMB-12',  9.50, 40,  '🧉'),
    ('chhaycha-coffee', 'Cardamom Cinnamon Blend 200g',  'chhaycha-coffee-cardamom-200g',    'Pre-spiced, brew like regular coffee.',              'CHC-CARDA',   12.00, 18,  '🍂'),

    -- Sokunthea Boutique ────────────────────────────────
    ('sokunthea-boutique', 'Sampot Hol Wrap Skirt',         'sokunthea-sampot-hol-skirt',     'Hand-loomed silk, ankle length.',                  'SKB-SAMP-HOL', 48.00, 12, '🧵'),
    ('sokunthea-boutique', 'Silk Krama Scarf',              'sokunthea-silk-krama-scarf',     'Classic Khmer check, 70 x 200cm.',                 'SKB-KRAMA',    22.00, 30, '🧣'),
    ('sokunthea-boutique', 'Linen Wide-Leg Pants',          'sokunthea-linen-wide-leg-pants', 'Breathable, with side pockets. Beige.',            'SKB-LINP-W',   36.00, 18, '👖'),
    ('sokunthea-boutique', 'Embroidered White Blouse',      'sokunthea-embroidered-blouse',   'Cotton voile, floral embroidery at neckline.',     'SKB-EMB-WHT',  42.00, 14, '👚'),
    ('sokunthea-boutique', 'Pearl Drop Earrings',           'sokunthea-pearl-drop-earrings',  'Freshwater pearls, gold-plated hooks.',            'SKB-PRL-DRP',  18.00, 25, '💎'),
    ('sokunthea-boutique', 'Floral Midi Dress',             'sokunthea-floral-midi-dress',    'Cap sleeves, hidden zip, mid-calf.',               'SKB-FL-MIDI',  55.00, 10, '🌺'),
    ('sokunthea-boutique', 'Leather Belt with Brass Buckle','sokunthea-leather-belt-brass',   'Veg-tanned, full grain, 32mm.',                    'SKB-BELT-BR',  24.00, 22, '🪢'),

    -- Bayon Eats ────────────────────────────────────────
    ('bayon-eats', 'Num Banh Chok (Khmer Noodles)', 'bayon-num-banh-chok',     'Rice noodles, fish gravy, fresh herbs.',     'BAY-NBC',     4.50, 50, '🍝'),
    ('bayon-eats', 'Bai Sach Chrouk (Pork & Rice)', 'bayon-bai-sach-chrouk',   'Grilled marinated pork, broken rice.',       'BAY-BSC',     3.50, 60, '🍚'),
    ('bayon-eats', 'Amok Trey (Fish Curry)',        'bayon-amok-trey',         'Steamed in banana leaf, coconut curry.',     'BAY-AMOK',    7.00, 35, '🐟'),
    ('bayon-eats', 'Lort Cha (Stir-fried Noodles)', 'bayon-lort-cha',          'Wok-fried with bean sprouts and egg.',       'BAY-LRTCH',   4.00, 40, '🥢'),
    ('bayon-eats', 'Beef Lok Lak',                  'bayon-beef-lok-lak',      'Cubed beef, pepper-lime sauce, rice.',       'BAY-LOKLAK',  6.50, 30, '🥩'),
    ('bayon-eats', 'Fried Spring Rolls (6 pcs)',    'bayon-spring-rolls-6',    'Pork and glass-noodle filling.',             'BAY-SR-6',    3.00, 80, '🥟'),
    ('bayon-eats', 'Sweet Sticky Rice with Mango',  'bayon-sticky-rice-mango', 'Coconut-cream glaze, seasonal.',             'BAY-STK-MNG', 4.50, 25, '🥭'),

    -- Angkor Tech ───────────────────────────────────────
    ('angkor-tech', 'USB-C Fast Charger 65W',          'angkor-usb-c-charger-65w',   'GaN tech, charges MacBook and phone.',         'AGT-USC-65W',  28.00, 35, '🔌'),
    ('angkor-tech', 'Bluetooth Speaker (Waterproof)',  'angkor-bluetooth-speaker',   'IPX7, 12-hour battery, deep bass.',            'AGT-BT-SPK',   45.00, 20, '🔊'),
    ('angkor-tech', 'AirBuds Pro (Wireless Earbuds)',  'angkor-airbuds-pro',         'ANC, transparency mode, USB-C case.',          'AGT-AB-PRO',   38.00, 25, '🎧'),
    ('angkor-tech', 'Power Bank 20000mAh',             'angkor-power-bank-20000',    '22.5W PD, dual output, LED display.',          'AGT-PB-20K',   24.00, 40, '🔋'),
    ('angkor-tech', 'iPhone Silicone Case',            'angkor-iphone-silicone-case','10 colors, soft-touch, MagSafe-ready.',        'AGT-IP-CS',    12.00, 60, '📱'),
    ('angkor-tech', 'USB-C Hub HDMI + USB-A + SD',     'angkor-usb-c-hub-hdmi',      '4K 60Hz output, 100W passthrough.',            'AGT-HUB-HDMI', 18.00, 18, '🔗'),
    ('angkor-tech', 'Smart LED Strip 5m',              'angkor-smart-led-strip-5m',  'App-controlled, music-sync, 16M colors.',      'AGT-LED-5M',   22.00, 15, '💡'),
    ('angkor-tech', 'Wireless Mouse Ergonomic',        'angkor-wireless-mouse',      'Silent click, 2.4GHz and Bluetooth.',          'AGT-MS-ERG',   19.00, 28, '🖱️'),

    -- Sanchey Books ─────────────────────────────────────
    ('sanchey-books', 'Khmer Novel: Phnom Penh Stories', 'sanchey-phnom-penh-stories', 'Modern fiction by Pen Sokuntheary.',         'SAN-PP-STR',   9.00, 30, '📖'),
    ('sanchey-books', 'Hardcover Notebook A5',           'sanchey-hardcover-notebook', '240 pages, ivory dot grid, ribbon marker.',  'SAN-NB-A5',    7.50, 60, '📓'),
    ('sanchey-books', 'Fountain Pen Set (3 colors)',     'sanchey-fountain-pen-set',   'Refillable, with starter ink cartridges.',   'SAN-FP-SET',  14.00, 20, '🖋️'),
    ('sanchey-books', 'Watercolor Pad 12 sheets',        'sanchey-watercolor-pad',     '300gsm cold-pressed, A4.',                   'SAN-WC-PAD',  11.00, 18, '🎨'),
    ('sanchey-books', 'Daily Planner 2026',              'sanchey-daily-planner-2026', 'Weekly spread, habit tracker, undated.',     'SAN-PLN-26',  13.00, 40, '📅'),
    ('sanchey-books', 'Wooden Ruler and Pencil Set',     'sanchey-ruler-pencil-set',   '2H/HB pencils, beech ruler, eraser.',        'SAN-RUL-WD',   5.50, 80, '📏'),
    ('sanchey-books', 'Khmer-English Dictionary',        'sanchey-khmer-english-dict', '28,000 entries, hardcover.',                 'SAN-DIC-KE',  16.00, 15, '🔤'),

    -- Pteah Style ───────────────────────────────────────
    ('pteah-style', 'Rattan Pendant Lamp (Medium)',  'pteah-rattan-pendant-lamp',  'Hand-woven, 35cm diameter, E27 socket.',    'PTH-RAT-LMP',  58.00,  8, '🪔'),
    ('pteah-style', 'Ceramic Bowl Set (4 pcs)',      'pteah-ceramic-bowl-set',     'Hand-thrown stoneware, dishwasher-safe.',   'PTH-BOWL-4',   32.00, 12, '🥣'),
    ('pteah-style', 'Cotton Throw Blanket (Indigo)', 'pteah-cotton-throw-indigo',  'Natural dye, fringed edges, 130x170cm.',    'PTH-THR-IND',  26.00, 18, '🧶'),
    ('pteah-style', 'Bamboo Wall Mirror',            'pteah-bamboo-wall-mirror',   'Round, 50cm diameter, with hanging hook.',  'PTH-MIR-BAM',  44.00,  6, '🪞'),
    ('pteah-style', 'Beeswax Candle (Lemongrass)',   'pteah-beeswax-candle-lemon', '100 percent beeswax, 45h burn time.',       'PTH-CND-LG',    9.50, 35, '🕯️'),
    ('pteah-style', 'Wicker Storage Basket',         'pteah-wicker-storage',       'Lined, with cotton handles, 28x40cm.',      'PTH-BSK-WC',   19.00, 22, '🧺'),
    ('pteah-style', 'Linen Cushion Cover',           'pteah-linen-cushion-cover',  '45x45cm, hidden zip, cover only.',          'PTH-CSH-LN',   14.00, 28, '🛋️')
) AS p(merchant_slug, name, slug, description, sku, base_price, stock, icon_emoji)
INNER JOIN merchants m ON m.slug = p.merchant_slug
WHERE NOT EXISTS (
  SELECT 1 FROM products
   WHERE merchant_id = m.id AND sku = p.sku
);

COMMIT;


-- ============================================================
-- OPTIONAL APPENDIX
-- ------------------------------------------------------------
-- Run this block ONLY if you also want me to populate Skin Care
-- By Lyna with the 8 products from the cockpit. Skip otherwise.
-- ============================================================

-- BEGIN;
--
-- INSERT INTO products
--   (merchant_id, name, slug, description, sku,
--    base_price, stock, icon_emoji, is_active, delivery_days)
-- SELECT m.id, p.name, p.slug, p.description, p.sku,
--        p.base_price, p.stock, p.icon_emoji, TRUE, 3
-- FROM (
--   VALUES
--     ('Vitamin C Serum 20%',          'lyna-vitamin-c-serum',  'Brightens dark spots, even tone in 4 weeks.', 'SCBL-VITC-20',  24.00::numeric, 25, '🍊'),
--     ('Niacinamide Toner 10%',        'lyna-niacinamide-toner','Pore-refining, oil-balancing daily toner.',   'SCBL-NIA-10',   15.00, 40, '💧'),
--     ('Snail Repair Night Cream',     'lyna-snail-night-cream','Korean snail mucin, restores overnight.',     'SCBL-SNAIL-NC', 32.00, 15, '🌙'),
--     ('Hydrating Sheet Mask (5 pk)',  'lyna-sheet-mask-5pk',   'Hyaluronic-acid soaked sheets. Variety.',     'SCBL-MASK-5P',  12.50, 60, '🎴'),
--     ('Centella Soothing Gel',        'lyna-centella-gel',     'For sensitive, acne-prone skin.',             'SCBL-CENT-GEL', 18.00, 22, '🍃'),
--     ('Lip and Cheek Tint (Coral)',   'lyna-lip-cheek-tint',   'Buildable color, all-day wear.',              'SCBL-TINT-COR',  9.50, 35, '💋'),
--     ('Hyaluronic Acid Serum',        'lyna-ha-serum',         '5-layer hydration boost.',                    'SCBL-HA-SER',   19.99, 30, '✨'),
--     ('Sunscreen SPF50 PA++++',       'lyna-sunscreen-spf50',  'Lightweight, no white cast.',                 'SCBL-SPF-50',   22.00, 18, '🌞')
-- ) AS p(name, slug, description, sku, base_price, stock, icon_emoji)
-- CROSS JOIN merchants m
-- WHERE m.slug = 'skin-care-by-lyna'
--   AND NOT EXISTS (SELECT 1 FROM products WHERE merchant_id = m.id AND sku = p.sku);
--
-- -- Ensure the Telegram group is linked (no-op if you already set it)
-- UPDATE merchants
--    SET telegram_group_id = -4820112044
--  WHERE slug = 'skin-care-by-lyna'
--    AND telegram_group_id IS NULL;
--
-- COMMIT;
