"""ABA PayWay QR payment routes.

Flow:
1. Customer places an order with payment_method="khqr".
2. POST /payments/payway/orders/{id}/qr  → dynamic ABA KHQR for that order.
3. Customer pays in a banking app.
4. PayWay POSTs to /payments/payway/callback, and the checkout page polls
   GET /payments/payway/orders/{id}/status. Both paths call PayWay's
   check-transaction API and only mark the order paid when PayWay says
   APPROVED and the amount matches order.total.

The callback body is never trusted: it only tells us which tran_id to
re-check. tran_id is "<order_id><unix_ts>", so each one maps back to its
order without trusting anything the caller sends.

When an order is paid, its merchant earning is recorded in the settlement
ledger (app/services/settlement.py). Today the platform collects and
pays merchants manually; once ABA enables Split & Payout, the same QR
carries a `payout` for verified merchants and only the earning's
settlement_method changes.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from app.config import settings
from app.core.constants import Role
from app.core.dependencies import require_role
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.rate_limit import limiter
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.services import payway, settlement

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/payments/payway", tags=["Payments"])

QR_PAYMENT_METHOD = "khqr"
_TS_DIGITS = 10  # unix timestamp suffix length in tran_id

_ORDER_COLUMNS = (
    "id,user_id,merchant_id,order_code,total,status,payment_method,"
    "payment_status,payway_tran_id,customer_name,delivery_name,delivery_phone,"
    "delivery_fee,commission_rate,payout_mode"
)


# ═══════════════════════════════════════════════════════════════
#  USER ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.post("/orders/{order_id}/qr")
@limiter.limit("10/minute")
async def create_qr(request: Request, order_id: int, user: TokenClaims = require_role(Role.USER)):
    """Generate an ABA KHQR for one of the caller's unpaid orders."""
    if not payway.is_configured():
        raise BadRequestError("QR payment is not available right now. Please choose cash on delivery.")

    async with SupabaseClient.service_role() as db:
        order = await _get_own_order(db, order_id, user)

        if order.get("payment_status") == "paid":
            return {"data": {"payment_status": "paid"}}
        if order.get("payment_method") != QR_PAYMENT_METHOD:
            raise BadRequestError("This order is not set up for QR payment")
        if order.get("status") != "pending":
            raise BadRequestError("Only pending orders can be paid by QR")

        # A previous QR may already have been paid — settle it before
        # issuing a new one so the customer is never asked to pay twice.
        if order.get("payway_tran_id"):
            if await _settle(db, order, order["payway_tran_id"]) == "paid":
                return {"data": {"payment_status": "paid"}}

        amount = payway.to_money(order["total"])
        merchant = await db.from_("merchants").eq("id", order["merchant_id"]).select_one(
            "id,aba_account,payout_enabled,payout_verification_status,commission_rate"
        )
        # Freeze the commission rate the first time this order is priced
        commission_rate = (
            payway.to_money(order["commission_rate"])
            if order.get("commission_rate") is not None
            else settlement.effective_commission_rate(merchant)
        )
        payout, payout_mode = _build_payout(order, merchant, commission_rate)

        tran_id = f"{order['id']}{int(time.time())}"
        name = (order.get("delivery_name") or order.get("customer_name") or "").strip()
        first_name, _, last_name = name.partition(" ")

        try:
            qr = await payway.generate_qr(
                tran_id=tran_id,
                amount=amount,
                currency=settings.CURRENCY,
                first_name=first_name,
                last_name=last_name,
                phone=(order.get("delivery_phone") or "").replace("+855", "0"),
                payout=payout,
            )
        except payway.PayWayError as exc:
            logger.warning("PayWay QR failed for order %s: %s (code=%s)", order_id, exc, exc.code)
            raise BadRequestError("Could not create the payment QR. Please try again.")

        # Record the tran_id before handing out the QR so the
        # callback and status poll can find it.
        await db.from_("orders").eq("id", order_id).update({
            "payway_tran_id": tran_id,
            "commission_rate": str(commission_rate),
            "payout_mode": payout_mode,
        })

    return {
        "data": {
            "payment_status": "pending",
            "order_id": order_id,
            "order_code": order["order_code"],
            "amount": f"{amount:.2f}",
            "currency": settings.CURRENCY,
            "qr_image": qr.get("qrImage"),
            "qr_string": qr.get("qrString"),
            "deeplink": qr.get("abapay_deeplink"),
            "expires_in": settings.PAYWAY_QR_LIFETIME_MINUTES * 60,
        }
    }


@router.get("/orders/{order_id}/status")
@limiter.limit("60/minute")
async def payment_status(request: Request, order_id: int, user: TokenClaims = require_role(Role.USER)):
    """Polled by the checkout page while the QR is on screen."""
    async with SupabaseClient.service_role() as db:
        order = await _get_own_order(db, order_id, user)
        status = order.get("payment_status") or "pending"
        if status != "paid" and order.get("payway_tran_id"):
            status = await _settle(db, order, order["payway_tran_id"])
    return {"data": {"order_id": order_id, "payment_status": status}}


# ═══════════════════════════════════════════════════════════════
#  PAYWAY CALLBACK
# ═══════════════════════════════════════════════════════════════


@router.post("/callback")
@limiter.limit("120/minute")
async def payway_callback(request: Request):
    """PayWay payment notification.

    Only `tran_id` is read from the body; the result is re-fetched from
    PayWay. Returns 200 only once the outcome is durably recorded (or the
    notification is irrelevant), so PayWay retries on our failures.
    """
    try:
        if "application/json" in request.headers.get("content-type", ""):
            body = await request.json()
        else:
            body = dict(await request.form())
    except Exception:
        raise BadRequestError("Invalid callback body")

    tran_id = str(body.get("tran_id") or "")
    order_id = _order_id_from_tran_id(tran_id)
    if order_id is None:
        logger.warning("PayWay callback with unrecognised tran_id")
        return {"received": True}

    async with SupabaseClient.service_role() as db:
        order = await db.from_("orders").eq("id", order_id).select_one(_ORDER_COLUMNS)
        if not order:
            logger.warning("PayWay callback for unknown order %s", order_id)
            return {"received": True}
        if order.get("payment_status") != "paid":
            # Raises on PayWay/DB failure → non-2xx → PayWay retries.
            await _settle(db, order, tran_id, raise_errors=True)

    return {"received": True}


# ═══════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════


async def _settle(db, order: dict, tran_id: str, *, raise_errors: bool = False) -> str:
    """Check a transaction with PayWay and mark the order paid if approved.

    Idempotent: the update only matches rows not already paid.
    Returns the order's resulting payment_status.
    """
    try:
        txn = await payway.check_transaction(tran_id)
    except payway.PayWayError as exc:
        logger.warning("PayWay check failed for order %s: %s (code=%s)", order["id"], exc, exc.code)
        if raise_errors:
            raise
        return order.get("payment_status") or "pending"

    if txn.get("payment_status") != payway.STATUS_APPROVED:
        return order.get("payment_status") or "pending"

    expected = payway.to_money(order["total"])
    paid_amount = payway.to_money(txn.get("total_amount") or txn.get("original_amount") or 0)
    if paid_amount != expected:
        # Never mark paid on a mismatch — this needs a human.
        logger.error(
            "PayWay amount mismatch on order %s tran %s: expected %s got %s",
            order["id"], tran_id, expected, paid_amount,
        )
        return order.get("payment_status") or "pending"

    updated = await (
        db.from_("orders")
        .eq("id", order["id"])
        .neq("payment_status", "paid")
        .update({
            "payment_status": "paid",
            "paid_at": datetime.now(timezone.utc).isoformat(),
            "payment_ref": txn.get("apv") or None,
            "payway_tran_id": tran_id,
        })
    )
    if updated:
        logger.info("Order %s paid via PayWay tran %s", order["id"], tran_id)
        # Advance a pending order; a cancelled one stays cancelled and
        # needs a manual refund.
        if order.get("status") == "pending":
            await db.from_("orders").eq("id", order["id"]).eq("status", "pending").update(
                {"status": "confirmed"}
            )
        elif order.get("status") == "cancelled":
            logger.error("Order %s was paid after cancellation — refund required", order["id"])

    # Record the merchant's earning. Idempotent, so it also repairs a
    # previous attempt that marked the order paid but failed here. A ledger
    # failure must never undo or block the payment itself; the admin
    # backfill endpoint re-runs this for any paid order without an earning.
    try:
        await settlement.record_order_earning(
            db, {**order, "payway_tran_id": tran_id}, actor_type="payway", actor_id=tran_id,
        )
    except Exception:
        logger.exception("Failed to record earning for paid order %s", order["id"])
    return "paid"


def _build_payout(order: dict, merchant: dict | None, commission_rate) -> tuple[list[dict] | None, str]:
    """Decide how this payment's money is routed.

    ABA Split & Payout (sends the seller's share straight to their ABA
    account) is used only when the platform switch is on and the merchant
    is verified. Otherwise the platform collects everything and the
    merchant is paid from the settlement ledger.
    """
    if not settlement.split_payout_allowed(merchant):
        return None, "platform"
    split = settlement.compute_split(order, commission_rate)
    if split.net <= 0:
        return None, "platform"
    return [{"account": merchant["aba_account"].replace(" ", ""), "amount": split.net}], "aba_split"


async def _get_own_order(db, order_id: int, user: TokenClaims) -> dict:
    order = await db.from_("orders").eq("id", order_id).select_one(_ORDER_COLUMNS)
    if not order:
        raise NotFoundError("Order", order_id)
    db_user = None
    if user.telegram_id:
        db_user = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id")
    if not db_user or order["user_id"] != db_user["id"]:
        raise ForbiddenError("You can only pay for your own orders")
    return order


def _order_id_from_tran_id(tran_id: str) -> int | None:
    if not tran_id.isdigit() or len(tran_id) <= _TS_DIGITS:
        return None
    return int(tran_id[:-_TS_DIGITS])
