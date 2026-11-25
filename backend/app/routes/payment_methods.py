"""GET /api/payments/methods: the payment methods checkout may offer right now."""

from fastapi import APIRouter

from app.services import payment_methods

router = APIRouter(prefix="/payments", tags=["Payments"])


@router.get("/methods")
async def list_payment_methods():
    return {"data": {"methods": payment_methods.available()}}
