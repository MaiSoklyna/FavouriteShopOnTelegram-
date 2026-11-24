"""Promotion Center: public coupons to claim, "My Coupons", the coupons a cart can use, and private grants."""

from __future__ import annotations

from decimal import Decimal

import httpx
from fastapi import APIRouter, Depends

from app.core.constants import Role
from app.core.dependencies import get_optional_user, require_any_admin, require_role
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.security import TokenClaims
from app.db.client import SupabaseClient
from app.models.coupon import GrantRequest
from app.routes.orders import _discount, _eligible_base
from app.services import audit, coupons, notify, promo_schedule

router = APIRouter(prefix="/coupons", tags=["Coupons"])

LIST_CAP = 100


# ── helpers ─────────────────────────────────────────────────────────

async def _person_id(db, user: TokenClaims | None) -> int | None:
    if not user or not getattr(user, "telegram_id", None):
        return None
    row = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id")
    return row["id"] if row else None


async def _require_person(db, user: TokenClaims) -> int:
    uid = await _person_id(db, user)
    if uid is None:
        raise NotFoundError("User")
    return uid


async def _shop_names(db, rows: list[dict]) -> dict[int, str]:
    ids = list({r["merchant_id"] for r in rows if r.get("merchant_id")})
    if not ids:
        return {}
    return {m["id"]: m["name"] for m in await db.from_("merchants").in_("id", ids).select("id,name")}


def _live(promotion: dict | None) -> bool:
    return promotion is None or promo_schedule.window(promotion)[0]


def _view(code: dict, promotion: dict | None, shops: dict[int, str]) -> dict:
    """What the app shows for a coupon (no internal counters beyond what a customer should know)."""
    left = (code["max_uses"] - (code.get("used_count") or 0)) if code.get("max_uses") else None
    return {
        "id": code["id"], "code": code["code"],
        "title": (promotion or {}).get("title") or code.get("title") or coupons.discount_text(code),
        "subtitle": (promotion or {}).get("subtitle"),
        "type": code["type"], "value": code["value"], "discount_text": coupons.discount_text(code),
        "min_order": float(code.get("min_order") or 0), "expires_at": code.get("expires_at"),
        "merchant_id": code.get("merchant_id"), "shop_name": shops.get(code.get("merchant_id")) if code.get("merchant_id") else None,
        "per_user_limit": code.get("per_user_limit"), "remaining": left,
        "audience": code.get("audience", "public"), "auto_apply": bool((promotion or {}).get("auto_apply")),
    }


async def _public_codes(db, merchant_id: int | None) -> list[dict]:
    """Active, public codes (every shop's, or one shop's plus the platform's)."""
    def query(with_audience: bool):
        q = db.from_("promo_codes").eq("is_active", True)
        if with_audience:
            q = q.eq("audience", "public")
        if merchant_id is not None:
            q = q.or_(f"merchant_id.eq.{merchant_id}", "merchant_id.is.null")
        return q.order("created_at", desc=True).limit(LIST_CAP).select()

    try:
        return await query(True)
    except httpx.HTTPStatusError as exc:
        if coupons._not_set_up(exc):
            return await query(False)  # before migration 030 every code is public
        raise


# ── Everyone: coupons you can get ───────────────────────────────────


@router.get("/public")
async def public_coupons(merchant_id: int | None = None, user: TokenClaims | None = Depends(get_optional_user)):
    """Public coupons that can still be used, with whether the caller has claimed them or used them up."""
    async with SupabaseClient.service_role() as db:
        codes = [c for c in await _public_codes(db, merchant_id) if coupons.status_of(c, uses_by_user=0) == "available"]
        promotions = await coupons.promotions_by_code(db, [c["id"] for c in codes])
        codes = [c for c in codes if _live(promotions.get(c["id"]))]
        uid = await _person_id(db, user)
        wallet = await coupons.wallet_code_ids(db, uid)
        uses = await coupons.user_use_counts(db, uid, [c["id"] for c in codes])
        shops = await _shop_names(db, codes)
    out = []
    for c in codes:
        ok, reason = coupons.check(c, subtotal=None, uses_by_user=uses.get(c["id"], 0), in_wallet=c["id"] in wallet)
        out.append({**_view(c, promotions.get(c["id"]), shops), "claimed": c["id"] in wallet,
                    "used_by_me": uses.get(c["id"], 0), "usable": ok, "reason": reason})
    return {"data": out}


@router.post("/{code_id}/claim")
async def claim_coupon(code_id: int, user: TokenClaims = require_role(Role.USER)):
    """Save a public coupon to My Coupons (saving it twice is fine)."""
    async with SupabaseClient.service_role() as db:
        uid = await _require_person(db, user)
        code = await db.from_("promo_codes").eq("id", code_id).select_one()
        # A private coupon looks exactly like one that does not exist
        if not code or code.get("audience") == "private" or coupons.status_of(code, uses_by_user=0) != "available":
            raise NotFoundError("Coupon", code_id)
        promotion = (await coupons.promotions_by_code(db, [code_id])).get(code_id)
        if not _live(promotion):
            raise BadRequestError("This coupon isn't available right now")
        try:
            await db.from_("coupon_wallet").insert({"promo_code_id": code_id, "user_id": uid, "source": "claimed"})
        except httpx.HTTPStatusError as exc:
            if notify._error_code(exc) == "23505":
                pass  # already in the wallet
            elif coupons._not_set_up(exc):
                raise BadRequestError("Coupons are not set up on the server yet. Please try again later.")
            else:
                raise
        shops = await _shop_names(db, [code])
    return {"success": True, "data": {**_view(code, promotion, shops), "claimed": True}}


# ── The customer's wallet ───────────────────────────────────────────


@router.get("/mine")
async def my_coupons(user: TokenClaims = require_role(Role.USER)):
    """The caller's coupons: available first (soonest to expire first), then used / expired."""
    async with SupabaseClient.service_role() as db:
        uid = await _require_person(db, user)
        try:
            wallet = await db.from_("coupon_wallet").eq("user_id", uid).limit(LIST_CAP).select("promo_code_id,source,created_at")
        except httpx.HTTPStatusError as exc:
            if coupons._not_set_up(exc):
                return {"data": []}
            raise
        if not wallet:
            return {"data": []}
        ids = [w["promo_code_id"] for w in wallet]
        codes = {c["id"]: c for c in await db.from_("promo_codes").in_("id", ids).select()}
        promotions = await coupons.promotions_by_code(db, ids)
        uses = await coupons.user_use_counts(db, uid, ids)
        shops = await _shop_names(db, list(codes.values()))
    out = []
    for w in wallet:
        code = codes.get(w["promo_code_id"])
        if not code:
            continue
        status = coupons.status_of(code, uses_by_user=uses.get(code["id"], 0))
        if status == "available" and not _live(promotions.get(code["id"])):
            status = "inactive"
        out.append({**_view(code, promotions.get(code["id"]), shops), "status": status, "source": w["source"],
                    "used_by_me": uses.get(code["id"], 0)})
    rank = {"available": 0}
    out.sort(key=lambda c: (rank.get(c["status"], 1), c["expires_at"] is None, c["expires_at"] or ""))
    return {"data": out}


# ── At checkout: what can this cart use? ────────────────────────────


@router.get("/eligible")
async def eligible_coupons(merchant_id: int, user: TokenClaims = require_role(Role.USER)):
    """Coupons the caller could apply to their cart at this shop (their wallet plus public coupons), best
    discount first, each with the reason it cannot be used yet (e.g. "Spend $4.20 more")."""
    async with SupabaseClient.service_role() as db:
        uid = await _require_person(db, user)
        cart = await db.from_("cart").eq("user_id", uid).eq("merchant_id", merchant_id).select_one("id")
        items = await db.from_("cart_items").eq("cart_id", cart["id"]).select() if cart else []
        subtotal = sum((Decimal(str(i.get("unit_price") or 0)) * int(i.get("quantity") or 0) for i in items), Decimal("0.00"))

        wallet_ids = await coupons.wallet_code_ids(db, uid)
        found = {c["id"]: c for c in await _public_codes(db, merchant_id)}
        if wallet_ids:
            for c in await db.from_("promo_codes").in_("id", list(wallet_ids)).eq("is_active", True) \
                    .or_(f"merchant_id.eq.{merchant_id}", "merchant_id.is.null").select():
                found[c["id"]] = c
        ids = list(found)
        promotions = await coupons.promotions_by_code(db, ids)
        uses = await coupons.user_use_counts(db, uid, ids)
        shops = await _shop_names(db, list(found.values()))

        rows = []
        for cid, code in found.items():
            promotion = promotions.get(cid)
            # A promotion that applies by itself needs no picking, and one that is not on now is not offered
            if not _live(promotion) or (promotion and promotion.get("auto_apply")):
                continue
            # Expired, fully used or switched off: nothing the customer can do about it, so don't clutter checkout
            if coupons.status_of(code, uses_by_user=uses.get(cid, 0)) in ("expired", "used_up", "inactive"):
                continue
            ok, reason = coupons.check(code, subtotal=subtotal, uses_by_user=uses.get(cid, 0), in_wallet=cid in wallet_ids)
            discount = Decimal("0.00")
            if ok:
                base = await _eligible_base(db, promotion, items, subtotal) if promotion else subtotal
                if base <= 0:
                    ok, reason = False, "Only for selected products"
                else:
                    discount = _discount(code, base)
            rows.append({**_view(code, promotion, shops), "eligible": ok, "reason": reason,
                         "discount": float(discount), "in_wallet": cid in wallet_ids})
    rows.sort(key=lambda r: (not r["eligible"], -r["discount"], r["min_order"]))
    best = next((r["id"] for r in rows if r["eligible"]), None)
    return {"data": rows, "best_id": best, "subtotal": float(subtotal)}


# ── Shops and the platform: give a coupon to specific customers ─────


@router.post("/{code_id}/grant")
async def grant_coupon(code_id: int, body: GrantRequest, user: TokenClaims = require_any_admin()):
    """Put a coupon in specific customers' wallets (usually a private coupon) and tell them."""
    async with SupabaseClient.service_role() as db:
        code = await db.from_("promo_codes").eq("id", code_id).select_one()
        if not code:
            raise NotFoundError("Coupon", code_id)
        if user.role == Role.MERCHANT_ADMIN and code.get("merchant_id") != user.merchant_id:
            raise ForbiddenError("This coupon belongs to another shop")

        people = []
        if body.user_ids:
            people += await db.from_("users").in_("id", body.user_ids).select("id,telegram_id")
        if body.telegram_ids:
            people += await db.from_("users").in_("telegram_id", body.telegram_ids).select("id,telegram_id")
        people = list({p["id"]: p for p in people}.values())
        known = {p["id"] for p in people} | {p["telegram_id"] for p in people}
        not_found = [i for i in [*body.user_ids, *body.telegram_ids] if i not in known]

        try:
            have = {r["user_id"] for r in await db.from_("coupon_wallet").eq("promo_code_id", code_id).select("user_id")}
            new = [p for p in people if p["id"] not in have]
            if new:
                await db.from_("coupon_wallet").insert([{"promo_code_id": code_id, "user_id": p["id"], "source": "granted"} for p in new])
        except httpx.HTTPStatusError as exc:
            if coupons._not_set_up(exc):
                raise BadRequestError("Coupons are not set up on the server yet. Run supabase/migrations/030_coupons.sql")
            raise

        promotion = (await coupons.promotions_by_code(db, [code_id])).get(code_id)
        title = (promotion or {}).get("title") or coupons.discount_text(code)
        for p in new:
            await notify.notify_user(db, p["id"], "promo", "You got a coupon", f"{title}: {coupons.discount_text(code)}. Find it in My Coupons.",
                                     link="/shop/coupons", ref_id=code_id, dedupe_key=f"coupon:{code_id}:{p['id']}")
        if new:
            await audit.record(
                db, user, merchant_id=code.get("merchant_id"), action="coupon.granted", target_type="coupon",
                target_id=code_id, target_label=code.get("code"),
                new={"customers": len(new), "user_ids": [p["id"] for p in new]},
            )
    return {"success": True, "granted": len(new), "already_had": len(people) - len(new), "not_found": not_found}
