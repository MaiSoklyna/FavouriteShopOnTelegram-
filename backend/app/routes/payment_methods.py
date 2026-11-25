"""GET /api/payments/methods: the payment methods checkout may offer this customer right now."""

from fastapi import APIRouter, Depends

from app.core.dependencies import get_optional_user
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.services import payment_methods

router = APIRouter(prefix="/payments", tags=["Payments"])


@router.get("/methods")
async def list_payment_methods(user: TokenClaims | None = Depends(get_optional_user)):
    async with SupabaseClient.service_role() as db:
        uid = await payment_methods.customer_id(db, user)
    return {"data": {"methods": payment_methods.available(uid), "card_mode": payment_methods.card_mode()}}
