"""Merchant settlement routes — balances, earnings, payouts, payout accounts.

Merchant admins see only their own shop. Super admins see every shop and
are the only role that can verify payout accounts or move money
(create / complete / fail payouts). Every state change is audited in
settlement_audit_log.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Query

from app.core.constants import Role
from app.core.dependencies import require_role, require_super_admin
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.settlement import (
    EarningStatus,
    PayoutAccountUpdate,
    PayoutCreate,
    PayoutComplete,
    PayoutFail,
    PayoutReverse,
    PayoutMethod,
    PayoutSettingsUpdate,
    PayoutStatus,
    VerificationStatus,
)
from app.services import settlement

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settlements", tags=["Settlements"])

_ACCOUNT_COLUMNS = (
    "id,aba_account,aba_account_name,payout_enabled,payout_verification_status,"
    "payout_verified_at,payout_rejection_reason,commission_rate"
)


# ═══════════════════════════════════════════════════════════════
#  MERCHANT ENDPOINTS
# ═══════════════════════════════════════════════════════════════


@router.get("/merchant/balance")
async def merchant_balance(user: TokenClaims = require_role(Role.MERCHANT_ADMIN)):
    """What the platform owes this shop, per currency."""
    merchant_id = _own_merchant_id(user)
    async with SupabaseClient.service_role() as db:
        rows = await db.from_("merchant_balances").eq("merchant_id", merchant_id).select()
    return {"data": rows}


@router.get("/merchant/earnings")
async def merchant_earnings(
    status: EarningStatus | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    user: TokenClaims = require_role(Role.MERCHANT_ADMIN),
):
    merchant_id = _own_merchant_id(user)
    async with SupabaseClient.service_role() as db:
        return {"data": await _list_earnings(db, merchant_id, status, page, page_size)}


@router.get("/merchant/payouts")
async def merchant_payouts(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    user: TokenClaims = require_role(Role.MERCHANT_ADMIN),
):
    merchant_id = _own_merchant_id(user)
    async with SupabaseClient.service_role() as db:
        q = (
            db.from_("merchant_payouts").eq("merchant_id", merchant_id)
            .order("created_at", desc=True)
            .offset((page - 1) * page_size).limit(page_size)
        )
        return {"data": await q.select()}


@router.get("/merchant/payout-account")
async def get_payout_account(user: TokenClaims = require_role(Role.MERCHANT_ADMIN)):
    merchant_id = _own_merchant_id(user)
    async with SupabaseClient.service_role() as db:
        merchant = await _get_merchant(db, merchant_id)
    return {"data": _account_view(merchant)}


@router.put("/merchant/payout-account")
async def update_payout_account(
    body: PayoutAccountUpdate,
    user: TokenClaims = require_role(Role.MERCHANT_ADMIN),
):
    """Set the ABA account to be paid into.

    Any change resets verification and switches payout off until a super
    admin re-verifies — a changed account is the classic payout-fraud path.
    """
    merchant_id = _own_merchant_id(user)
    account = body.aba_account.replace(" ", "")
    async with SupabaseClient.service_role() as db:
        merchant = await _get_merchant(db, merchant_id)
        if account == merchant.get("aba_account") and body.aba_account_name == merchant.get("aba_account_name"):
            return {"data": _account_view(merchant)}

        changes = {
            "aba_account": account,
            "aba_account_name": body.aba_account_name.strip(),
            "payout_verification_status": VerificationStatus.PENDING.value,
            "payout_enabled": False,
            "payout_verified_at": None,
            "payout_verified_by": None,
            "payout_rejection_reason": None,
        }
        await db.from_("merchants").eq("id", merchant_id).update(changes)
        await settlement.audit(
            db, entity_type="merchant", entity_id=merchant_id, merchant_id=merchant_id,
            action="payout_account.changed", actor_type=str(user.role), actor_id=user.sub,
            # Full numbers on purpose: this is the evidence trail if a
            # payout account is ever changed fraudulently.
            old_value={
                "aba_account": merchant.get("aba_account"),
                "aba_account_name": merchant.get("aba_account_name"),
                "payout_verification_status": merchant.get("payout_verification_status"),
            },
            new_value={
                "aba_account": account,
                "aba_account_name": changes["aba_account_name"],
                "payout_verification_status": changes["payout_verification_status"],
            },
        )
        merchant.update(changes)
    return {"data": _account_view(merchant)}


# ═══════════════════════════════════════════════════════════════
#  SUPER ADMIN — BALANCES & ACCOUNTS
# ═══════════════════════════════════════════════════════════════


@router.get("/admin/balances")
async def admin_balances(
    only_owed: bool = True,
    user: TokenClaims = require_super_admin(),
):
    """Amounts owed to every merchant, largest first."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("merchant_balances").order("owed_amount", desc=True)
        rows = await q.select()
        accounts = {
            m["id"]: m for m in await db.from_("merchants").select(
                "id,aba_account,aba_account_name,payout_verification_status,payout_enabled"
            )
        }
    if only_owed:
        rows = [r for r in rows if float(r.get("owed_amount") or 0) != 0 or float(r.get("pending_amount") or 0) != 0]
    for r in rows:
        m = accounts.get(r["merchant_id"], {})
        r["aba_account_masked"] = settlement.mask_account(m.get("aba_account"))
        r["aba_account_name"] = m.get("aba_account_name")
        r["payout_verification_status"] = m.get("payout_verification_status")
        r["payout_enabled"] = m.get("payout_enabled")
    return {"data": rows}


@router.get("/admin/merchants/{merchant_id}/payout-account")
async def admin_get_payout_account(merchant_id: int, user: TokenClaims = require_super_admin()):
    async with SupabaseClient.service_role() as db:
        merchant = await _get_merchant(db, merchant_id)
    return {"data": _account_view(merchant)}


@router.patch("/admin/merchants/{merchant_id}/payout-settings")
async def admin_update_payout_settings(
    merchant_id: int,
    body: PayoutSettingsUpdate,
    user: TokenClaims = require_super_admin(),
):
    """Verify / reject a payout account, toggle payout, set commission."""
    async with SupabaseClient.service_role() as db:
        merchant = await _get_merchant(db, merchant_id)
        changes: dict = {}

        status = body.payout_verification_status
        if status is not None:
            if status == VerificationStatus.VERIFIED and not merchant.get("aba_account"):
                raise BadRequestError("Merchant has no ABA account to verify")
            if status == VerificationStatus.REJECTED and not body.payout_rejection_reason:
                raise BadRequestError("A rejection reason is required")
            changes["payout_verification_status"] = status.value
            changes["payout_rejection_reason"] = (
                body.payout_rejection_reason if status == VerificationStatus.REJECTED else None
            )
            if status == VerificationStatus.VERIFIED:
                changes["payout_verified_at"] = _now()
                changes["payout_verified_by"] = user.sub
            else:
                changes["payout_verified_at"] = None
                changes["payout_verified_by"] = None
                changes["payout_enabled"] = False

        if body.payout_enabled is not None:
            final_status = changes.get("payout_verification_status", merchant.get("payout_verification_status"))
            if body.payout_enabled and final_status != VerificationStatus.VERIFIED.value:
                raise BadRequestError("Verify the payout account before enabling payout")
            changes["payout_enabled"] = body.payout_enabled

        if body.clear_commission_rate:
            changes["commission_rate"] = None
        elif body.commission_rate is not None:
            changes["commission_rate"] = str(body.commission_rate)

        if not changes:
            return {"data": _account_view(merchant)}

        await db.from_("merchants").eq("id", merchant_id).update(changes)
        await settlement.audit(
            db, entity_type="merchant", entity_id=merchant_id, merchant_id=merchant_id,
            action="payout_settings.updated", actor_type=str(user.role), actor_id=user.sub,
            old_value={k: _jsonable(merchant.get(k)) for k in changes},
            new_value={k: _jsonable(v) for k, v in changes.items()},
            note=body.payout_rejection_reason,
        )
        merchant.update(changes)
    return {"data": _account_view(merchant)}


@router.get("/admin/merchants/{merchant_id}/earnings")
async def admin_merchant_earnings(
    merchant_id: int,
    status: EarningStatus | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: TokenClaims = require_super_admin(),
):
    async with SupabaseClient.service_role() as db:
        return {"data": await _list_earnings(db, merchant_id, status, page, page_size)}


# ═══════════════════════════════════════════════════════════════
#  SUPER ADMIN — PAYOUTS (manual settlement)
# ═══════════════════════════════════════════════════════════════


@router.post("/admin/merchants/{merchant_id}/payouts")
async def admin_create_payout(
    merchant_id: int,
    body: PayoutCreate,
    user: TokenClaims = require_super_admin(),
):
    """Bundle every available earning for a merchant into one payout.

    The payout starts 'pending'. Send the bank transfer, then call
    /complete with the transfer reference.
    """
    async with SupabaseClient.service_role() as db:
        merchant = await _get_merchant(db, merchant_id)
        if merchant.get("payout_verification_status") != VerificationStatus.VERIFIED.value:
            raise BadRequestError("Verify this merchant's ABA account before paying out")
        payout = await settlement.rpc(db, "create_merchant_payout", {
            "p_merchant_id": merchant_id,
            "p_currency": body.currency,
            "p_method": PayoutMethod.MANUAL_TRANSFER.value,
            "p_note": body.note,
            "p_actor_type": str(user.role),
            "p_actor_id": user.sub,
        })
    return {"data": payout}


@router.get("/admin/payouts")
async def admin_list_payouts(
    status: PayoutStatus | None = None,
    merchant_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    user: TokenClaims = require_super_admin(),
):
    async with SupabaseClient.service_role() as db:
        q = db.from_("merchant_payouts").order("created_at", desc=True)
        if status:
            q = q.eq("status", status.value)
        if merchant_id:
            q = q.eq("merchant_id", merchant_id)
        q = q.offset((page - 1) * page_size).limit(page_size)
        return {"data": await q.select()}


@router.get("/admin/payouts/{payout_id}")
async def admin_get_payout(payout_id: int, user: TokenClaims = require_super_admin()):
    """Payout with the earnings (orders) it covers — the transfer statement."""
    async with SupabaseClient.service_role() as db:
        payout = await db.from_("merchant_payouts").eq("id", payout_id).select_one()
        if not payout:
            raise NotFoundError("Payout", payout_id)
        items = await db.from_("merchant_payout_items").eq("payout_id", payout_id).select()
        earning_ids = [i["earning_id"] for i in items]
        earnings = (
            await db.from_("merchant_earnings").in_("id", earning_ids).select() if earning_ids else []
        )
        await _attach_order_codes(db, earnings)
    payout["items"] = earnings
    return {"data": payout}


@router.post("/admin/payouts/{payout_id}/complete")
async def admin_complete_payout(
    payout_id: int,
    body: PayoutComplete,
    user: TokenClaims = require_super_admin(),
):
    """Mark a payout paid after the bank transfer went through."""
    async with SupabaseClient.service_role() as db:
        payout = await settlement.rpc(db, "complete_merchant_payout", {
            "p_payout_id": payout_id,
            "p_reference": body.reference.strip(),
            "p_actor_type": str(user.role),
            "p_actor_id": user.sub,
        })
    return {"data": payout}


@router.post("/admin/payouts/{payout_id}/fail")
async def admin_fail_payout(
    payout_id: int,
    body: PayoutFail,
    user: TokenClaims = require_super_admin(),
):
    """Mark a payout failed (or cancelled). Its earnings become available again."""
    async with SupabaseClient.service_role() as db:
        payout = await settlement.rpc(db, "fail_merchant_payout", {
            "p_payout_id": payout_id,
            "p_reason": body.reason.strip(),
            "p_cancel": body.cancel,
            "p_actor_type": str(user.role),
            "p_actor_id": user.sub,
        })
    return {"data": payout}


@router.post("/admin/payouts/{payout_id}/reverse")
async def admin_reverse_payout(
    payout_id: int,
    body: PayoutReverse,
    user: TokenClaims = require_super_admin(),
):
    """Undo a payout that was marked paid but never reached the merchant.

    The payout and its items stay on record as 'reversed'; its earnings
    return to the merchant's available balance so they can be paid again.
    """
    async with SupabaseClient.service_role() as db:
        payout = await settlement.rpc(db, "reverse_merchant_payout", {
            "p_payout_id": payout_id,
            "p_reason": body.reason.strip(),
            "p_actor_type": str(user.role),
            "p_actor_id": user.sub,
        })
    return {"data": payout}


# ═══════════════════════════════════════════════════════════════
#  SUPER ADMIN — AUDIT & RECONCILIATION
# ═══════════════════════════════════════════════════════════════


@router.get("/admin/audit")
async def admin_audit_log(
    merchant_id: int | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: TokenClaims = require_super_admin(),
):
    async with SupabaseClient.service_role() as db:
        q = db.from_("settlement_audit_log").order("created_at", desc=True)
        if merchant_id:
            q = q.eq("merchant_id", merchant_id)
        if entity_type:
            q = q.eq("entity_type", entity_type)
        if entity_id:
            q = q.eq("entity_id", entity_id)
        q = q.offset((page - 1) * page_size).limit(page_size)
        return {"data": await q.select()}


@router.get("/admin/report")
async def admin_settlement_report(
    date_from: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    user: TokenClaims = require_super_admin(),
):
    """Per-merchant totals for a period (dates inclusive, UTC).

    Earnings are counted by when the order was paid (earning created);
    payouts by when they were marked paid. Reversed earnings are excluded;
    negative adjustments are included so refunds net out.
    """
    try:
        start = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
    except ValueError:
        raise BadRequestError("Invalid date")
    if end <= start:
        raise BadRequestError("date_to must be on or after date_from")
    if (end - start).days > 366:
        raise BadRequestError("Report period is limited to one year")

    async with SupabaseClient.service_role() as db:
        earnings = await (
            db.from_("merchant_earnings")
            .gte("created_at", start.isoformat()).lt("created_at", end.isoformat())
            .neq("status", "reversed")
            .select("merchant_id,currency,gross_amount,commission_amount,net_amount,entry_type")
        )
        payouts = await (
            db.from_("merchant_payouts")
            .eq("status", "paid")
            .gte("paid_at", start.isoformat()).lt("paid_at", end.isoformat())
            .select("merchant_id,currency,amount")
        )
        merchants = {m["id"]: m["name"] for m in await db.from_("merchants").select("id,name")}

    rows: dict[tuple[int, str], dict] = {}

    def row(merchant_id: int, currency: str) -> dict:
        key = (merchant_id, currency)
        if key not in rows:
            rows[key] = {
                "merchant_id": merchant_id, "merchant_name": merchants.get(merchant_id),
                "currency": currency, "orders": 0, "gross": Decimal("0"),
                "commission": Decimal("0"), "net": Decimal("0"),
                "paid_out": Decimal("0"), "payouts": 0,
            }
        return rows[key]

    for e in earnings:
        r = row(e["merchant_id"], e["currency"])
        if e["entry_type"] == "order":
            r["orders"] += 1
        r["gross"] += settlement.money(e["gross_amount"])
        r["commission"] += settlement.money(e["commission_amount"])
        r["net"] += settlement.money(e["net_amount"])
    for p in payouts:
        r = row(p["merchant_id"], p["currency"])
        r["paid_out"] += settlement.money(p["amount"])
        r["payouts"] += 1

    merchants_out = sorted(rows.values(), key=lambda r: r["gross"], reverse=True)
    totals: dict[str, dict] = {}
    for r in merchants_out:
        t = totals.setdefault(r["currency"], {
            "currency": r["currency"], "orders": 0, "gross": Decimal("0"),
            "commission": Decimal("0"), "net": Decimal("0"), "paid_out": Decimal("0"), "payouts": 0,
        })
        for k in ("orders", "gross", "commission", "net", "paid_out", "payouts"):
            t[k] += r[k]

    def out(d: dict) -> dict:
        return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in d.items()}

    return {"data": {
        "date_from": date_from, "date_to": date_to,
        "totals": [out(t) for t in totals.values()],
        "merchants": [out(r) for r in merchants_out],
    }}


@router.post("/admin/backfill")
async def admin_backfill_earnings(
    limit: int = Query(500, ge=1, le=2000),
    user: TokenClaims = require_super_admin(),
):
    """Record earnings for paid QR orders that have none.

    Covers orders paid before the ledger existed and any payment whose
    ledger write failed. Safe to run repeatedly.
    """
    async with SupabaseClient.service_role() as db:
        orders = await (
            db.from_("orders")
            .eq("payment_status", "paid")
            .in_("payment_method", list(settlement.PLATFORM_COLLECTED_METHODS))
            .order("id")
            .limit(limit)
            .select("id,merchant_id,total,delivery_fee,status,payment_method,"
                    "payway_tran_id,commission_rate,payout_mode")
        )
        order_ids = [o["id"] for o in orders]
        existing = set()
        if order_ids:
            rows = await db.from_("merchant_earnings").in_("order_id", order_ids).eq(
                "entry_type", "order").select("order_id")
            existing = {r["order_id"] for r in rows}

        created, skipped = [], []
        for order in orders:
            if order["id"] in existing:
                continue
            earning = await settlement.record_order_earning(
                db, order, actor_type=str(user.role), actor_id=user.sub,
            )
            (created if earning else skipped).append(order["id"])
    return {"data": {"scanned": len(orders), "created": created, "skipped": skipped}}


# ═══════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════


def _own_merchant_id(user: TokenClaims) -> int:
    if not user.merchant_id:
        raise ForbiddenError("No merchant linked to this account")
    return user.merchant_id


async def _get_merchant(db, merchant_id: int) -> dict:
    merchant = await db.from_("merchants").eq("id", merchant_id).select_one(_ACCOUNT_COLUMNS)
    if not merchant:
        raise NotFoundError("Merchant", merchant_id)
    return merchant


async def _list_earnings(db, merchant_id: int, status, page: int, page_size: int) -> list:
    q = db.from_("merchant_earnings").eq("merchant_id", merchant_id).order("created_at", desc=True)
    if status:
        q = q.eq("status", status.value)
    q = q.offset((page - 1) * page_size).limit(page_size)
    earnings = await q.select()
    await _attach_order_codes(db, earnings)
    return earnings


async def _attach_order_codes(db, earnings: list[dict]) -> None:
    order_ids = list({e["order_id"] for e in earnings if e.get("order_id")})
    if not order_ids:
        return
    orders = await db.from_("orders").in_("id", order_ids).select("id,order_code,status")
    by_id = {o["id"]: o for o in orders}
    for e in earnings:
        o = by_id.get(e.get("order_id")) or {}
        e["order_code"] = o.get("order_code")
        e["order_status"] = o.get("status")


def _account_view(merchant: dict) -> dict:
    return {
        "merchant_id": merchant["id"],
        "aba_account": merchant.get("aba_account"),
        "aba_account_name": merchant.get("aba_account_name"),
        "payout_enabled": bool(merchant.get("payout_enabled")),
        "payout_verification_status": merchant.get("payout_verification_status") or "unverified",
        "payout_verified_at": merchant.get("payout_verified_at"),
        "payout_rejection_reason": merchant.get("payout_rejection_reason"),
        "commission_rate": merchant.get("commission_rate"),
        "effective_commission_rate": str(settlement.effective_commission_rate(merchant)),
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _jsonable(value):
    return str(value) if value is not None and not isinstance(value, (str, int, float, bool)) else value
