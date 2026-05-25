"""Create category_banners table in Supabase."""

import asyncio, os, sys, httpx
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv; load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
from app.config import settings

SQL = """
CREATE TABLE IF NOT EXISTS category_banners (
  id           BIGSERIAL PRIMARY KEY,
  category_id  BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  subtitle     TEXT,
  image_url    TEXT,
  placement    TEXT NOT NULL DEFAULT 'home' CHECK (placement IN ('home', 'category')),
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_category_banners_lookup
  ON category_banners (placement, is_active, sort_order);

ALTER TABLE category_banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "category_banners_public_read"
  ON category_banners FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "category_banners_service_write"
  ON category_banners FOR ALL USING (true) WITH CHECK (true);
"""

async def main():
    url = f"{settings.SUPABASE_URL}/rest/v1/rpc/exec_sql"
    headers = {
        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    # Try direct SQL via PostgREST — if exec_sql RPC doesn't exist, fall back to raw HTTP
    async with httpx.AsyncClient(timeout=30) as http:
        # Use the Supabase Management API or direct SQL
        # Simplest: use the pg-meta endpoint
        sql_url = f"{settings.SUPABASE_URL}/rest/v1/"
        # Actually, let's just use the query endpoint
        resp = await http.post(
            f"{settings.SUPABASE_URL}/rest/v1/rpc/",
            headers=headers,
            json={"query": SQL},
        )
        if resp.status_code == 404:
            print("RPC not available. Please run this SQL in Supabase SQL Editor:")
            print("=" * 60)
            print(SQL)
            print("=" * 60)
            return

    print("Done!")

if __name__ == "__main__":
    asyncio.run(main())
