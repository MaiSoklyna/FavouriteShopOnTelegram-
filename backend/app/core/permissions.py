"""Who may do what in a shop: the permission matrix for Owner, Manager and Staff.

This file is the single source of truth. The backend enforces it centrally (every request from a
shop account is checked in `get_current_user`), and the dashboard reads the same table from
`GET /api/merchant-permissions` to show or hide buttons. To change what a role may do, change
`ROLE_PERMISSIONS` here; nothing else needs to move.

Super admins are not shop accounts and are not limited by this table.
"""

from __future__ import annotations

from enum import StrEnum

from app.core.constants import ShopRole


class Perm(StrEnum):
    PRODUCTS_EDIT = "products.edit"        # add and edit products, photos, variants, stock
    PRODUCTS_PRICE = "products.price"      # change the price of an existing product
    PRODUCTS_DELETE = "products.delete"    # delete products and shop categories
    ORDERS_PROCESS = "orders.process"      # accept orders, move them forward, assign drivers
    ORDERS_CANCEL = "orders.cancel"        # reject or cancel orders
    DRIVERS_MANAGE = "drivers.manage"      # add, edit, deactivate drivers
    MARKETING_MANAGE = "marketing.manage"  # promotions, coupons, collections
    REVIEWS_MODERATE = "reviews.moderate"  # hide/show or approve/reject reviews
    SALES_VIEW = "sales.view"              # revenue, sales figures, analytics
    ACTIVITY_VIEW = "activity.view"        # the shop activity log
    STAFF_MANAGE = "staff.manage"          # invite, change, deactivate, remove people
    FINANCE_MANAGE = "finance.manage"      # earnings, payouts, payout account
    SHOP_SETTINGS = "shop.settings"        # shop profile, settings, loyalty participation


# Shown in the dashboard's permission table, in this order
PERM_LABELS: dict[Perm, str] = {
    Perm.PRODUCTS_EDIT: "Add and edit products",
    Perm.PRODUCTS_PRICE: "Change product prices",
    Perm.PRODUCTS_DELETE: "Delete products and categories",
    Perm.ORDERS_PROCESS: "Process orders and assign drivers",
    Perm.ORDERS_CANCEL: "Reject or cancel orders",
    Perm.DRIVERS_MANAGE: "Manage drivers",
    Perm.MARKETING_MANAGE: "Promotions, coupons and collections",
    Perm.REVIEWS_MODERATE: "Moderate reviews",
    Perm.SALES_VIEW: "See sales and analytics",
    Perm.ACTIVITY_VIEW: "See the activity log",
    Perm.STAFF_MANAGE: "Manage staff",
    Perm.FINANCE_MANAGE: "Earnings and payouts",
    Perm.SHOP_SETTINGS: "Shop profile and settings",
}

_OPERATIONS = frozenset({Perm.PRODUCTS_EDIT, Perm.ORDERS_PROCESS})
_MANAGEMENT = frozenset({
    Perm.PRODUCTS_PRICE, Perm.PRODUCTS_DELETE, Perm.ORDERS_CANCEL, Perm.DRIVERS_MANAGE,
    Perm.MARKETING_MANAGE, Perm.REVIEWS_MODERATE, Perm.SALES_VIEW, Perm.ACTIVITY_VIEW,
})

ROLE_PERMISSIONS: dict[str, frozenset[Perm]] = {
    ShopRole.OWNER: frozenset(Perm),
    ShopRole.MANAGER: _OPERATIONS | _MANAGEMENT,
    ShopRole.STAFF: _OPERATIONS,
}

ROLE_LABELS = {ShopRole.OWNER: "Owner", ShopRole.MANAGER: "Manager", ShopRole.STAFF: "Staff"}


def role_can(shop_role: str | None, perm: Perm) -> bool:
    """True when a shop role has a permission. Unknown roles have none."""
    return perm in ROLE_PERMISSIONS.get(shop_role or "", frozenset())


# ── Which endpoints need which permission ───────────────────────
# (methods, route path or path prefix, permission). Matched against the route's path template,
# e.g. "/api/products/{product_id}". A prefix ends with "/" or "*". First match wins.
# Endpoints that are not listed are open to every shop account (reads, own notifications, ...).
# Owner-only areas keep their own `require_shop_owner*` guards as well.

_WRITE = ("POST", "PUT", "PATCH", "DELETE")
_ALL = ("GET", "POST", "PUT", "PATCH", "DELETE")

ROUTE_RULES: tuple[tuple[tuple[str, ...], str, Perm], ...] = (
    # Products and the shop's own categories
    (("DELETE",), "/api/products/{product_id}", Perm.PRODUCTS_DELETE),
    (("DELETE",), "/api/categories/{category_id}", Perm.PRODUCTS_DELETE),
    # Drivers (assigning a driver to an order is order processing and stays open)
    (_WRITE, "/api/deliveries/admin/drivers*", Perm.DRIVERS_MANAGE),
    # Promotions, coupons (promo codes), collections
    (_WRITE, "/api/promotions/admin*", Perm.MARKETING_MANAGE),
    (_WRITE, "/api/promos", Perm.MARKETING_MANAGE),
    (_WRITE, "/api/promos/{promo_id}", Perm.MARKETING_MANAGE),
    (_WRITE, "/api/collections/admin*", Perm.MARKETING_MANAGE),
    (("POST",), "/api/coupons/{code_id}/grant", Perm.MARKETING_MANAGE),
    # Reviews
    (_WRITE, "/api/shop-reviews/admin/*", Perm.REVIEWS_MODERATE),
    (_WRITE, "/api/reviews/admin/*", Perm.REVIEWS_MODERATE),
    # Sales figures
    (_ALL, "/api/analytics/*", Perm.SALES_VIEW),
)


def _matches(rule_path: str, path: str) -> bool:
    if rule_path.endswith("*"):
        return path.startswith(rule_path[:-1])
    return path == rule_path


def required_permission(method: str, route_path: str) -> Perm | None:
    """The permission an endpoint needs from a shop account, or None if any shop account may use it."""
    method = method.upper()
    for methods, rule_path, perm in ROUTE_RULES:
        if method in methods and _matches(rule_path, route_path):
            return perm
    return None


def denied_message(shop_role: str | None, perm: Perm) -> str:
    role = ROLE_LABELS.get(shop_role or "", "This account")
    return f"Your role ({role}) cannot do this: {PERM_LABELS[perm].lower()}. Ask the shop owner."


def matrix() -> dict:
    """The whole table, for the dashboard."""
    return {
        "roles": [{"key": str(r), "label": ROLE_LABELS[r]} for r in (ShopRole.OWNER, ShopRole.MANAGER, ShopRole.STAFF)],
        "permissions": [
            {"key": str(p), "label": PERM_LABELS[p],
             "roles": [str(r) for r in (ShopRole.OWNER, ShopRole.MANAGER, ShopRole.STAFF) if p in ROLE_PERMISSIONS[r]]}
            for p in PERM_LABELS
        ],
    }
