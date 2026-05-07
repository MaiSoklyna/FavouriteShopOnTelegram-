"""FastAPI dependency injection — auth, roles, and database access.

These replace the scattered _get_claims() / _verify_admin() functions that
were copy-pasted across admin_auth.py, miniapp_api.py, and db_proxy.py.

Usage in routes:

    from app.core.dependencies import require_role
    from app.core.constants import Role

    @router.get("/products")
    async def list_products(user: TokenClaims = require_role(Role.USER, Role.MERCHANT_ADMIN, Role.SUPER_ADMIN)):
        ...

    @router.post("/admins")
    async def create_admin(user: TokenClaims = require_role(Role.SUPER_ADMIN)):
        ...
"""

from __future__ import annotations

import logging

from fastapi import Depends, Request

from app.core.constants import Role
from app.core.exceptions import AuthenticationError, ForbiddenError
from app.core.security import (
    InvalidTokenError,
    TokenClaims,
    TokenExpiredError,
    verify_jwt,
)

logger = logging.getLogger(__name__)


# ── Token extraction ────────────────────────────────────────────


def _extract_token(request: Request) -> str:
    """Pull the JWT from the Authorization header or cookie.

    Order of precedence:
    1. Authorization: Bearer <token>
    2. Cookie named "token" (for httpOnly cookie flow — future)

    Raises AuthenticationError if neither source has a token.
    """
    # 1. Authorization header
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        if token:
            return token

    # 2. Cookie fallback (ready for httpOnly cookie migration)
    cookie_token = request.cookies.get("token")
    if cookie_token:
        return cookie_token

    raise AuthenticationError("Missing authentication token")


# ── Core dependency: current user ───────────────────────────────


async def get_current_user(request: Request) -> TokenClaims:
    """Extract, verify, and parse the JWT from the request.

    This is the base dependency that all protected routes use.
    Returns a TokenClaims dataclass with typed fields.

    Raises:
        AuthenticationError: Missing or invalid token.
    """
    token = _extract_token(request)
    try:
        return verify_jwt(token)
    except TokenExpiredError:
        raise AuthenticationError("Token expired")
    except InvalidTokenError as exc:
        raise AuthenticationError(exc.reason)


# ── Optional user (for public-with-optional-auth routes) ────────


async def get_optional_user(request: Request) -> TokenClaims | None:
    """Like get_current_user but returns None instead of raising.

    Useful for endpoints that behave differently for logged-in vs anonymous
    users (e.g. product listing might show personalised data if logged in).
    """
    try:
        return await get_current_user(request)
    except AuthenticationError:
        return None


# ── Role guards ─────────────────────────────────────────────────


def require_role(*allowed_roles: Role):
    """Factory that returns a Depends-compatible dependency.

    Verifies the token AND checks that the caller's role is in the
    allowed set.  Use as a default parameter on route functions:

        async def my_route(user: TokenClaims = require_role(Role.SUPER_ADMIN)):
            ...

    Multiple roles create an OR condition — any of them is sufficient.
    """

    async def _guard(
        current_user: TokenClaims = Depends(get_current_user),
    ) -> TokenClaims:
        if current_user.role not in allowed_roles:
            logger.warning(
                "Role denied: user %s has role %s, needs one of %s",
                current_user.sub,
                current_user.role,
                [str(r) for r in allowed_roles],
            )
            raise ForbiddenError(
                f"This action requires one of: {', '.join(str(r) for r in allowed_roles)}"
            )
        return current_user

    return Depends(_guard)


# ── Convenience shortcuts ───────────────────────────────────────
# These read better in route signatures than require_role(Role.X, Role.Y)

def require_any_admin():
    """Allow merchant_admin or super_admin."""
    return require_role(Role.MERCHANT_ADMIN, Role.SUPER_ADMIN)


def require_super_admin():
    """Allow super_admin only."""
    return require_role(Role.SUPER_ADMIN)


def require_authenticated():
    """Allow any authenticated user regardless of role."""
    return require_role(Role.USER, Role.MERCHANT_ADMIN, Role.SUPER_ADMIN)


# ── Merchant-scoped guard ──────────────────────────────────────


def require_merchant_access(merchant_id_param: str = "merchant_id"):
    """Ensures the caller owns the merchant or is super_admin.

    For routes that accept a merchant_id path/query parameter, this
    dependency verifies that:
    - Super admins can access any merchant
    - Merchant admins can only access their own merchant

    Usage:
        @router.get("/merchants/{merchant_id}/products")
        async def list_products(
            merchant_id: int,
            user: TokenClaims = require_merchant_access(),
        ):
            ...
    """

    async def _guard(
        request: Request,
        current_user: TokenClaims = Depends(get_current_user),
    ) -> TokenClaims:
        if current_user.is_super_admin:
            return current_user

        if current_user.role != Role.MERCHANT_ADMIN:
            raise ForbiddenError("Merchant admin access required")

        # Get merchant_id from path params, query params, or body
        target_id = request.path_params.get(merchant_id_param)
        if target_id is None:
            target_id = request.query_params.get(merchant_id_param)

        if target_id is not None and int(target_id) != current_user.merchant_id:
            raise ForbiddenError("You can only access your own merchant's data")

        return current_user

    return Depends(_guard)
