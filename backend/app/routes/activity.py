"""Activity tracking routes: the browser reports what a customer looked at; shops and the platform read the summary.

(No `from __future__ import annotations` here: with slowapi's decorator FastAPI could not resolve the body type.)
"""

from fastapi import APIRouter, Depends, Request

from app.core.constants import Role
from app.core.dependencies import get_optional_user, require_any_admin
from app.core.exceptions import ForbiddenError
from app.core.rate_limit import limiter
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.activity import ActivityIn
from app.services import activity

router = APIRouter(prefix="/activity", tags=["Activity"])


@router.post("")
@limiter.limit("120/minute")
async def report_activity(request: Request, body: ActivityIn, user: TokenClaims | None = Depends(get_optional_user)):
    """A customer (signed in or not) looked at a product or shop, or searched. Always answers 200: tracking is
    best-effort and must never get in the customer's way."""
    async with SupabaseClient.service_role() as db:
        recorded = await activity.ingest(db, user, body)
    return {"recorded": recorded}


@router.get("/summary")
async def activity_summary(days: int = 30, merchant_id: int | None = None, user: TokenClaims = require_any_admin()):
    """Customer activity for the signed-in shop, or for the whole platform (or one chosen shop) for the super admin."""
    if user.role == Role.MERCHANT_ADMIN:
        if user.merchant_id is None:
            raise ForbiddenError("This account is not linked to a shop")
        merchant_id = user.merchant_id          # a shop only ever sees its own customers' activity
    async with SupabaseClient.service_role() as db:
        return await activity.summary(db, days, merchant_id)
