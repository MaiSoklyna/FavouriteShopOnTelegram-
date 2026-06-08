-- 010_seller_applications.sql
-- Seller onboarding: mini-app applicants submit a store application that a
-- super admin reviews. On approval the app provisions a merchants row + a
-- merchant_admins login (see backend/app/routes/sellers.py).
--
-- Run this in the Supabase SQL Editor.

-- ══════════════════════════════════════════════════════════════
-- Status enum
-- ══════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE seller_application_status AS ENUM
    ('pending', 'under_review', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ══════════════════════════════════════════════════════════════
-- seller_applications
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS seller_applications (
  id                SERIAL PRIMARY KEY,
  user_id           INT          NULL REFERENCES users(id) ON DELETE SET NULL,
  telegram_id       BIGINT       NULL,

  -- Seller type (drives KYC level)
  seller_type       VARCHAR(20)  NOT NULL DEFAULT 'individual',  -- individual | company

  -- Applicant / KYC
  full_name         VARCHAR(150) NOT NULL,
  email             VARCHAR(150) NOT NULL,
  phone             VARCHAR(30)  NULL,
  gender            VARCHAR(20)  NULL,
  date_of_birth     DATE         NULL,
  company_name      VARCHAR(150) NULL,
  password_hash     VARCHAR(255) NOT NULL,

  -- Store
  store_name        VARCHAR(150) NOT NULL,
  store_description TEXT         NULL,
  logo_url          VARCHAR(500) NULL,

  -- Store location
  province          VARCHAR(100) NULL,
  district          VARCHAR(100) NULL,
  commune           VARCHAR(100) NULL,
  address_line1     VARCHAR(255) NULL,
  address_line2     VARCHAR(255) NULL,

  -- Review workflow
  status            seller_application_status DEFAULT 'pending',
  review_note       TEXT         NULL,
  reviewed_by       INT          NULL,
  reviewed_at       TIMESTAMPTZ  NULL,
  merchant_id       INT          NULL REFERENCES merchants(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_apps_status   ON seller_applications(status);
CREATE INDEX IF NOT EXISTS idx_seller_apps_telegram ON seller_applications(telegram_id);

CREATE TRIGGER trg_seller_apps_updated_at
  BEFORE UPDATE ON seller_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════════════════════════
-- RLS: deny all anon/public access — only the service_role (backend
-- proxy) touches this table, same as super_admins / merchant_admins.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE seller_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_applications_deny ON seller_applications;
CREATE POLICY seller_applications_deny ON seller_applications
  FOR ALL USING (FALSE);
