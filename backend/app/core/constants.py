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
DEFAULT_DELIVERY_FEE = 5.0       # USD — used when the shop or the customer has no map pin

# Flat fee per distance band: (max straight-line km, fee USD). Past the last band: no delivery.
DELIVERY_FEE_TIERS = (
    (3.0, 0.50),
    (5.0, 0.75),
    (8.0, 1.50),
    (10.0, 3.00),
)
MAX_DELIVERY_KM = DELIVERY_FEE_TIERS[-1][0]
DEFAULT_DELIVERY_RADIUS_KM = 5.0   # used when a shop has no radius set


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
