-- ============================================================
-- 010: Loyalty Program (Points-based rewards)
-- ============================================================

-- Loyalty settings (global config)
CREATE TABLE IF NOT EXISTS loyalty_settings (
    id SERIAL PRIMARY KEY,
    is_enabled BOOLEAN DEFAULT FALSE,
    points_per_dollar DECIMAL(6,2) DEFAULT 10.00,   -- earn rate: 10 points per $1
    points_value_cents INT DEFAULT 1,                -- 1 point = 1 cent discount
    min_redeem_points INT DEFAULT 100,               -- minimum to redeem
    bronze_threshold INT DEFAULT 0,
    silver_threshold INT DEFAULT 500,
    gold_threshold INT DEFAULT 2000,
    silver_multiplier DECIMAL(3,2) DEFAULT 1.50,
    gold_multiplier DECIMAL(3,2) DEFAULT 2.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO loyalty_settings (is_enabled, points_per_dollar, min_redeem_points)
VALUES (FALSE, 10.00, 100)
ON CONFLICT DO NOTHING;

-- Per-user loyalty account
CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance INT DEFAULT 0,
    lifetime_points INT DEFAULT 0,
    tier VARCHAR(20) DEFAULT 'bronze',  -- bronze, silver, gold
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Points transaction ledger
CREATE TABLE IF NOT EXISTS points_transactions (
    id SERIAL PRIMARY KEY,
    loyalty_account_id INT NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,  -- earn, redeem, adjust, expire
    points INT NOT NULL,        -- positive for earn, negative for redeem
    balance_after INT NOT NULL,
    order_id INT REFERENCES orders(id),
    description TEXT,
    created_by INT,             -- admin ID for manual adjustments
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_user ON loyalty_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_points_tx_account ON points_transactions(loyalty_account_id);
CREATE INDEX IF NOT EXISTS idx_points_tx_order ON points_transactions(order_id);

-- Updated_at triggers
DROP TRIGGER IF EXISTS loyalty_accounts_updated_at ON loyalty_accounts;
CREATE TRIGGER loyalty_accounts_updated_at
    BEFORE UPDATE ON loyalty_accounts
    FOR EACH ROW EXECUTE FUNCTION update_ai_updated_at();

DROP TRIGGER IF EXISTS loyalty_settings_updated_at ON loyalty_settings;
CREATE TRIGGER loyalty_settings_updated_at
    BEFORE UPDATE ON loyalty_settings
    FOR EACH ROW EXECUTE FUNCTION update_ai_updated_at();

-- Auto-recalculate tier when lifetime_points changes
CREATE OR REPLACE FUNCTION recalculate_tier()
RETURNS TRIGGER AS $$
DECLARE
    _settings RECORD;
BEGIN
    SELECT * INTO _settings FROM loyalty_settings LIMIT 1;
    IF NOT FOUND THEN
        NEW.tier = 'bronze';
        RETURN NEW;
    END IF;

    IF NEW.lifetime_points >= _settings.gold_threshold THEN
        NEW.tier = 'gold';
    ELSIF NEW.lifetime_points >= _settings.silver_threshold THEN
        NEW.tier = 'silver';
    ELSE
        NEW.tier = 'bronze';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS loyalty_recalc_tier ON loyalty_accounts;
CREATE TRIGGER loyalty_recalc_tier
    BEFORE INSERT OR UPDATE OF lifetime_points ON loyalty_accounts
    FOR EACH ROW EXECUTE FUNCTION recalculate_tier();
