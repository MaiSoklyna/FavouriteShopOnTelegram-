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


# Shop accounts (merchant_admins.role). "admin" is the legacy name for an owner.
# What each role may do lives in app/core/permissions.py.
class ShopRole(StrEnum):
    OWNER = "owner"
    MANAGER = "manager"
    STAFF = "staff"


def shop_role(value: str | None) -> str:
    """Normalise a merchant_admins.role value: manager and staff as they are, anything else is the owner."""
    v = (value or "").strip().lower()
    return v if v in (ShopRole.MANAGER, ShopRole.STAFF) else ShopRole.OWNER.value
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
# Shop sessions must NOT start with "dash_": the bot completes any other id as a customer login.
SHOP_LOGIN_SESSION_PREFIX = "shop_"


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
# Platform standard fees cover up to 10 km. A shop may deliver up to 20 km, but beyond 10 km it must
# charge its own fees (base + per km): long-distance pricing is the shop's decision (2026-11-25).
PLATFORM_FEE_MAX_KM = DELIVERY_FEE_TIERS[-1][0]
MAX_DELIVERY_KM = 20.0             # the largest delivery radius a shop can choose (decision 2026-11-26)
DEFAULT_DELIVERY_RADIUS_KM = 5.0   # used when a shop has no radius set

# Delivery time estimate: preparation + travel, shown as a window
ETA_PREP_MINUTES = 10
ETA_MINUTES_PER_KM = 3
ETA_WINDOW_MINUTES = 10


class OrderStatus(StrEnum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PROCESSING = "processing"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"
    EXPIRED = "expired"  # unpaid online order past its payment deadline (migration 038)


# Which transitions are allowed and by whom. 'expired' is not here on purpose: only the system
# expires an order (services/order_expiry.py), never a person through the status endpoint.
ORDER_STATUS_TRANSITIONS: dict[str, list[str]] = {
    "pending":    ["confirmed", "cancelled"],
    "confirmed":  ["processing", "cancelled"],
    "processing": ["shipped", "cancelled"],
    "shipped":    ["delivered"],
}

# Statuses in which an order is over without being delivered: it holds no stock, earns nothing and
# does not count as a sale.
CLOSED_UNSOLD_STATUSES = frozenset({"cancelled", "expired"})


# ── Payment deadlines ───────────────────────────────────────────

# How long a customer has to pay an online order before it expires and its stock goes back.
# A method that is missing (or None) never expires: cash on delivery is paid at the door.
# The deadline is stored on the order when it is placed, so a change here only affects new orders.
PAYMENT_EXPIRY_MINUTES: dict[str, int | None] = {
    "khqr": 30,
    "stripe": 30,
    "cod": None,
}

# PayWay will not issue a QR that lives shorter than this
PAYWAY_MIN_QR_LIFETIME_MINUTES = 3

# How often (at most) one server instance sweeps every shop for overdue orders as a side effect of
# ordinary traffic. Looking at a specific order or order list always checks those orders at once.
EXPIRY_SWEEP_INTERVAL_SECONDS = 60


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
