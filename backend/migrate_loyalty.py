"""Create loyalty program tables in Supabase.

Run: python backend/migrate_loyalty.py
"""

import asyncio
import aiohttp
import os
import sys

# Add parent to path so we can import app.config
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from app.config import settings


SUPABASE_URL = settings.SUPABASE_URL.rstrip("/")
SERVICE_KEY = settings.SUPABASE_SERVICE_ROLE_KEY.strip()

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


SQL_STATEMENTS = [
    # ── loyalty_accounts ──
    """
    CREATE TABLE IF NOT EXISTS loyalty_accounts (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        merchant_id BIGINT REFERENCES merchants(id) ON DELETE SET NULL,
        points INTEGER NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'bronze',
        total_earned INTEGER NOT NULL DEFAULT 0,
        total_spent INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, merchant_id)
    );
    """,

    # ── points_transactions ──
    """
    CREATE TABLE IF NOT EXISTS points_transactions (
        id BIGSERIAL PRIMARY KEY,
        loyalty_account_id BIGINT NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'adjust',
        points INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,

    # ── loyalty_settings ──
    """
    CREATE TABLE IF NOT EXISTS loyalty_settings (
        id BIGSERIAL PRIMARY KEY,
        merchant_id BIGINT REFERENCES merchants(id) ON DELETE CASCADE,
        points_per_dollar NUMERIC NOT NULL DEFAULT 1,
        bronze_threshold INTEGER NOT NULL DEFAULT 0,
        silver_threshold INTEGER NOT NULL DEFAULT 500,
        gold_threshold INTEGER NOT NULL DEFAULT 2000,
        platinum_threshold INTEGER NOT NULL DEFAULT 5000,
        bronze_multiplier NUMERIC NOT NULL DEFAULT 1.0,
        silver_multiplier NUMERIC NOT NULL DEFAULT 1.25,
        gold_multiplier NUMERIC NOT NULL DEFAULT 1.5,
        platinum_multiplier NUMERIC NOT NULL DEFAULT 2.0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        points_value_cents INTEGER NOT NULL DEFAULT 1,
        min_redeem_points INTEGER NOT NULL DEFAULT 100,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(merchant_id)
    );
    """,

    # ── Indexes ──
    "CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_user_id ON loyalty_accounts(user_id);",
    "CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_tier ON loyalty_accounts(tier);",
    "CREATE INDEX IF NOT EXISTS idx_points_transactions_account ON points_transactions(loyalty_account_id);",
    "CREATE INDEX IF NOT EXISTS idx_points_transactions_created ON points_transactions(created_at);",

    # ── RLS policies ──
    "ALTER TABLE loyalty_accounts ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE points_transactions ENABLE ROW LEVEL SECURITY;",
    "ALTER TABLE loyalty_settings ENABLE ROW LEVEL SECURITY;",

    # Service role can do everything
    """
    DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'loyalty_accounts_service' AND tablename = 'loyalty_accounts') THEN
            CREATE POLICY loyalty_accounts_service ON loyalty_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
    END $$;
    """,
    """
    DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'points_transactions_service' AND tablename = 'points_transactions') THEN
            CREATE POLICY points_transactions_service ON points_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
    END $$;
    """,
    """
    DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'loyalty_settings_service' AND tablename = 'loyalty_settings') THEN
            CREATE POLICY loyalty_settings_service ON loyalty_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
    END $$;
    """,

    # Authenticated users can read their own loyalty account
    """
    DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'loyalty_accounts_user_read' AND tablename = 'loyalty_accounts') THEN
            CREATE POLICY loyalty_accounts_user_read ON loyalty_accounts FOR SELECT TO authenticated
                USING (user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);
        END IF;
    END $$;
    """,
]


async def run_migration():
    print(f"Connecting to Supabase: {SUPABASE_URL}")
    print("Running loyalty program migration...\n")

    async with aiohttp.ClientSession() as session:
        for i, sql in enumerate(SQL_STATEMENTS, 1):
            sql_clean = sql.strip()
            label = sql_clean[:80].replace("\n", " ")
            print(f"  [{i}/{len(SQL_STATEMENTS)}] {label}...")

            async with session.post(
                f"{SUPABASE_URL}/rest/v1/rpc/exec_sql",
                headers=HEADERS,
                json={"query": sql_clean},
            ) as resp:
                if resp.status >= 400:
                    # Try the raw SQL endpoint instead
                    async with session.post(
                        f"{SUPABASE_URL}/pg",
                        headers={**HEADERS, "Content-Type": "application/json"},
                        json={"query": sql_clean},
                    ) as resp2:
                        if resp2.status >= 400:
                            text = await resp.text()
                            # exec_sql RPC might not exist, try via SQL editor API
                            print(f"    WARNING: HTTP {resp.status} - may need manual execution")
                            print(f"    Response: {text[:200]}")
                        else:
                            print(f"    OK OK (via /pg)")
                else:
                    print(f"    OK OK")

    print("\n" + "=" * 60)
    print("Migration complete!")
    print()
    print("If any statements failed with 'exec_sql not found',")
    print("run the SQL manually in the Supabase SQL Editor:")
    print(f"  {SUPABASE_URL.replace('.supabase.co', '.supabase.co')}/project/sql")
    print()
    print("Full SQL to copy-paste:\n")
    print("-- Loyalty Program Tables")
    for sql in SQL_STATEMENTS:
        print(sql.strip())
        print()


if __name__ == "__main__":
    asyncio.run(run_migration())
