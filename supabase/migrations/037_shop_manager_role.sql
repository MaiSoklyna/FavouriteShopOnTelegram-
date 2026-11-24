-- 037: Manager role for shop accounts
--
-- Shop accounts (merchant_admins.role) can now be 'owner', 'manager' or 'staff'.
-- What each role may do is defined in backend/app/core/permissions.py.
-- The activity log (merchant_audit_log.actor_type) accepts 'manager' too.
--
-- Safe to run more than once. Before it runs the app keeps working; only adding or
-- changing someone to Manager is refused with a message that points here.

ALTER TABLE merchant_admins DROP CONSTRAINT IF EXISTS merchant_admins_role_check;
ALTER TABLE merchant_admins ADD CONSTRAINT merchant_admins_role_check
  CHECK (role IN ('owner', 'manager', 'staff'));

ALTER TABLE merchant_audit_log DROP CONSTRAINT IF EXISTS merchant_audit_log_actor_type_check;
ALTER TABLE merchant_audit_log ADD CONSTRAINT merchant_audit_log_actor_type_check
  CHECK (actor_type IN ('owner', 'manager', 'staff', 'super_admin', 'system', 'user'));
