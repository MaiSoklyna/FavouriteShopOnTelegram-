#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Secret rotation helper
#
# Run this script, then update your .env files with the new values.
# After updating .env, you MUST also update these in Supabase:
#   - Supabase Dashboard → Settings → API → JWT Secret
#   - Revoke old service_role key and anon key
#   - Regenerate Telegram bot token via @BotFather → /revoke
# ────────────────────────────��────────────────────────────────

set -euo pipefail

echo "============================================"
echo "  SECRET ROTATION - NEW VALUES"
echo "============================================"
echo ""
echo "1. Generate new SUPABASE_JWT_SECRET (use Supabase dashboard to set):"
echo "   You CANNOT change this yourself — it's managed by Supabase."
echo "   If compromised, contact Supabase support or recreate the project."
echo ""
echo "2. New local JWT fallback (if you ever need one):"
python3 -c "import secrets; print(f'   JWT_SECRET={secrets.token_urlsafe(64)}')" 2>/dev/null || \
python  -c "import secrets; print(f'   JWT_SECRET={secrets.token_urlsafe(64)}')"
echo ""
echo "3. Telegram Bot Token:"
echo "   → Open Telegram, message @BotFather"
echo "   → Send /revoke"
echo "   → Select your bot"
echo "   → Send /newbot or /token to get a new token"
echo ""
echo "4. Database password:"
echo "   → Supabase Dashboard → Settings → Database → Reset database password"
echo ""
echo "5. Service Role Key & Anon Key:"
echo "   → These are derived from your JWT secret."
echo "   → If JWT secret is rotated, these change automatically."
echo ""
echo "============================================"
echo "  AFTER ROTATING"
echo "============================================"
echo ""
echo "  1. Update backend/.env with new values"
echo "  2. Update dashboard/.env.local with new ANON_KEY"
echo "  3. Update miniapp/.env with new ANON_KEY"
echo "  4. Restart all services"
echo "  5. Test login flows (Telegram + email/password)"
echo ""
