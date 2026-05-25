"""
Migration: Add is_approved column to reviews table.

Run this SQL in your Supabase SQL Editor:

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT false;

-- Approve all existing reviews (they were already public)
UPDATE reviews SET is_approved = true WHERE is_approved IS NULL OR is_approved = false;

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_reviews_is_approved ON reviews(is_approved);
"""

print("Run this SQL in Supabase SQL Editor:")
print()
print("ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT false;")
print("UPDATE reviews SET is_approved = true WHERE is_approved IS NULL OR is_approved = false;")
print("CREATE INDEX IF NOT EXISTS idx_reviews_is_approved ON reviews(is_approved);")
print()
print("This will:")
print("1. Add is_approved column (defaults to false for new reviews)")
print("2. Approve all existing reviews (so they stay visible)")
print("3. Add an index for fast filtering")
