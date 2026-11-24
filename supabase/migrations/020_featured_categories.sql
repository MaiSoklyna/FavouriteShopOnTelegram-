-- ============================================================
-- 020: Featured categories on Home (run after 019)
-- ------------------------------------------------------------
-- Which category icons Home shows, in which order, and when.
--   kind 'permanent'  always on
--   kind 'seasonal'   on yearly dates (yearly_ranges), e.g. "Gifts" in December
--   kind 'scheduled'  between starts_at and ends_at, or on weekdays / month days
-- The schedule columns mean the same as on promotions (019) and are checked by
-- the same code (services/promo_schedule.py) whenever Home asks — nothing to
-- switch on or off. Home shows the live rows by priority (lowest first), at
-- most 8; with fewer than 4 it tops up automatically (most products for now).
-- Categories that aren't featured stay on the Discover and Categories pages.
-- ============================================================

CREATE TABLE IF NOT EXISTS featured_categories (
  id            BIGSERIAL PRIMARY KEY,
  category_id   INT         NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL DEFAULT 'permanent' CHECK (kind IN ('permanent', 'seasonal', 'scheduled')),
  priority      INT         NOT NULL DEFAULT 100,
  schedule_type TEXT        NOT NULL DEFAULT 'once' CHECK (schedule_type IN ('once', 'weekly', 'monthly', 'yearly')),
  starts_at     TIMESTAMPTZ NULL,
  ends_at       TIMESTAMPTZ NULL,
  weekdays      INT[]       NOT NULL DEFAULT '{}',
  month_days    INT[]       NOT NULL DEFAULT '{}',
  yearly_ranges JSONB       NOT NULL DEFAULT '[]'::jsonb,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT featured_categories_dates CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
  CONSTRAINT featured_categories_seasonal_is_yearly CHECK (kind <> 'seasonal' OR schedule_type = 'yearly')
);

CREATE INDEX IF NOT EXISTS idx_featured_categories_priority ON featured_categories (is_active, priority);

-- Read and written through the backend's service role only
ALTER TABLE featured_categories ENABLE ROW LEVEL SECURITY;
