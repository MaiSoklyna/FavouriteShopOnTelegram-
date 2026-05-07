"""Centralised constants — every magic number lives here.

Import from this module instead of scattering literals across routes.
Group by domain so it's easy to find the knob you need to turn.
"""

from enum import StrEnum


# ── Roles ───────────────────────────────────────────────────────

class Role(StrEnum):
    USER = "user"
    MERCHANT_ADMIN = "merchant_admin"
    SUPER_ADMIN = "super_admin"


# Admin roles are a convenience set for permission checks
ADMIN_ROLES = frozenset({Role.MERCHANT_ADMIN, Role.SUPER_ADMIN})
ALL_ROLES = frozenset({Role.USER, Role.MERCHANT_ADMIN, Role.SUPER_ADMIN})


# ── JWT ─────────────────────────────────────────────────────────

JWT_ALGORITHM = "HS256"
JWT_AUDIENCE = "authenticated"
JWT_ISSUER = "supabase"

# Seconds
USER_TOKEN_EXPIRY = 86_400       # 24 hours — miniapp sessions
ADMIN_TOKEN_EXPIRY = 86_400      # 24 hours — dashboard sessions
SESSION_TOKEN_EXPIRY = 900       # 15 min — short-lived widget tokens


# ── Telegram Auth ───────────────────────────────────────────────

TELEGRAM_AUTH_MAX_AGE = 3_600    # 1 hour — reject stale initData


# ── Login Sessions (Telegram → Dashboard) ───────────────────────

LOGIN_SESSION_TTL = 300          # 5 minutes until a pending session expires
LOGIN_SESSION_PREFIX = "dash_"


# ── Orders ──────────────────────────────────────────────────────

ORDER_PREFIX = "FS-"
FREE_DELIVERY_THRESHOLD = 50.0   # USD — orders above this get free delivery


class OrderStatus(StrEnum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PROCESSING = "processing"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


# Which transitions are allowed and by whom
ORDER_STATUS_TRANSITIONS: dict[str, list[str]] = {
    "pending":    ["confirmed", "cancelled"],
    "confirmed":  ["processing", "cancelled"],
    "processing": ["shipped", "cancelled"],
    "shipped":    ["delivered"],
}


# ── Pagination ──────────────────────────────────────────────────

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100


# ── Cart ────────────────────────────────────────────────────────

MAX_CART_ITEMS = 50


# ── Loyalty ─────────────────────────────────────────────────────

class LoyaltyTier(StrEnum):
    BRONZE = "bronze"
    SILVER = "silver"
    GOLD = "gold"


# ── Support Tickets ─────────────────────────────────────────────

class TicketStatus(StrEnum):
    OPEN = "open"
    REPLIED = "replied"
    CLOSED = "closed"
