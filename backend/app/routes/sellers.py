"""Seller onboarding routes.

Flow:
  1. A mini-app user submits a store application  (POST /seller-applications)
  2. They can track its status                    (GET  /seller-applications/me)
  3. A super admin reviews the queue              (GET  /seller-applications/admin/list)
  4. Approve -> provision merchant + login + DM   (PATCH .../admin/{id}/approve)
     Reject  -> mark rejected + DM                (PATCH .../admin/{id}/reject)

Mirrors the reviews approval pattern (app/routes/reviews.py).
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone

from fastapi import APIRouter, File, UploadFile

from app.core.constants import Role
from app.core.dependencies import require_role
from app.core.exceptions import BadRequestError, ConflictError, NotFoundError
from app.core.security import TokenClaims, hash_password
from app.db.client import StorageClient, SupabaseClient
from app.models.seller import SellerApplicationCreate, SellerApplicationReview

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/seller-applications", tags=["Seller Applications"])

ALLOWED_LOGO_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_LOGO_BYTES = 2 * 1024 * 1024  # 2 MB

# Statuses an applicant cannot re-apply over / that admins can still act on.
_ACTIVE_STATUSES = ("pending", "under_review")

# Fields returned to clients — never leak password_hash / internal columns.
_PUBLIC_COLS = (
    "id,seller_type,full_name,email,phone,gender,date_of_birth,company_name,"
    "store_name,store_description,logo_url,province,district,commune,"
    "address_line1,address_line2,status,review_note,merchant_id,"
    "created_at,reviewed_at"
)


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "shop"


async def _unique_slug(db, name: str) -> str:
    """Generate a merchants.slug that isn't taken yet."""
    base = _slugify(name)
    slug = base
    i = 2
    while await db.from_("merchants").eq("slug", slug).select("id"):
        slug = f"{base}-{i}"
        i += 1
    return slug


# ═══════════════════════════════════════════════════════════════
#  APPLICANT (mini-app user)
# ═══════════════════════════════════════════════════════════════


@router.post("")
async def submit_application(body: SellerApplicationCreate, user: TokenClaims = require_role(Role.USER)):
    """Submit a seller application (pending super-admin approval)."""
    if not body.agree_terms:
        raise BadRequestError("You must agree to the Terms of Service to apply")
    if body.seller_type == "company" and not (body.company_name and body.company_name.strip()):
        raise BadRequestError("Company name is required for a registered business")

    async with SupabaseClient.service_role() as db:
        db_user = None
        if user.telegram_id:
            db_user = await db.from_("users").eq("telegram_id", user.telegram_id).select_one("id")

        # Block duplicate in-flight applications for the same person.
        if user.telegram_id:
            existing = await (
                db.from_("seller_applications")
                .eq("telegram_id", user.telegram_id)
                .in_("status", list(_ACTIVE_STATUSES))
                .select("id")
            )
            if existing:
                raise ConflictError("You already have an application under review")

        data = {
            "user_id": db_user["id"] if db_user else None,
            "telegram_id": user.telegram_id,
            "seller_type": body.seller_type,
            "full_name": body.full_name.strip(),
            "email": body.email.strip().lower(),
            "phone": body.phone,
            "gender": body.gender,
            "date_of_birth": body.date_of_birth.isoformat() if body.date_of_birth else None,
            "company_name": body.company_name,
            "password_hash": hash_password(body.password),
            "store_name": body.store_name.strip(),
            "store_description": body.store_description,
            "logo_url": body.logo_url,
            "province": body.province,
            "district": body.district,
            "commune": body.commune,
            "address_line1": body.address_line1,
            "address_line2": body.address_line2,
            "status": "pending",
        }
        rows = await db.from_("seller_applications").insert(data)

    app_id = rows[0]["id"] if rows else None
    return {
        "success": True,
        "message": "Application submitted! A Byme24 team member will review it within 1–3 business days.",
        "data": {"id": app_id, "status": "pending"},
    }


@router.post("/logo")
async def upload_application_logo(
    file: UploadFile = File(...),
    user: TokenClaims = require_role(Role.USER),
):
    """Upload a store logo during registration (before the merchant exists).

    Saved to a shared folder; the returned URL is submitted with the
    application and carried over to the merchant on approval.
    """
    if file.content_type not in ALLOWED_LOGO_MIME:
        raise BadRequestError("Logo must be PNG, JPEG, WebP, or GIF")
    content = await file.read()
    if not content:
        raise BadRequestError("Empty file")
    if len(content) > MAX_LOGO_BYTES:
        raise BadRequestError(f"Logo file too large (max {MAX_LOGO_BYTES // 1024 // 1024} MB)")

    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "png").lower()
    if ext not in {"png", "jpg", "jpeg", "webp", "gif"}:
        ext = "png"
    folder = user.telegram_id or "anon"
    path = f"seller-application-logos/{folder}/{int(time.time() * 1000)}.{ext}"

    storage = StorageClient()
    public_url = await storage.upload(
        bucket="product-images",
        path=path,
        content=content,
        content_type=file.content_type or "image/png",
    )
    return {"logo_url": public_url}


@router.get("/me")
async def my_application(user: TokenClaims = require_role(Role.USER)):
    """Return the applicant's most recent application (or null)."""
    if not user.telegram_id:
        return {"data": None}
    async with SupabaseClient.service_role() as db:
        rows = await (
            db.from_("seller_applications")
            .eq("telegram_id", user.telegram_id)
            .order("created_at", desc=True)
            .limit(1)
            .select(_PUBLIC_COLS)
        )
    return {"data": rows[0] if rows else None}


# ═══════════════════════════════════════════════════════════════
#  SUPER ADMIN
# ═══════════════════════════════════════════════════════════════


@router.get("/admin/list")
async def list_applications(
    status: str | None = None,
    page: int = 1,
    page_size: int = 25,
    user: TokenClaims = require_role(Role.SUPER_ADMIN),
):
    """List applications for the review queue."""
    async with SupabaseClient.service_role() as db:
        q = db.from_("seller_applications").order("created_at", desc=True)
        if status and status != "all":
            q = q.eq("status", status)
        q = q.offset((page - 1) * page_size).limit(page_size)
        return await q.select(_PUBLIC_COLS)


@router.patch("/admin/{application_id}/approve")
async def approve_application(
    application_id: int,
    body: SellerApplicationReview | None = None,
    user: TokenClaims = require_role(Role.SUPER_ADMIN),
):
    """Approve an application: provision merchant + owner login, then notify."""
    async with SupabaseClient.service_role() as db:
        rows = await db.from_("seller_applications").eq("id", application_id).select("*")
        if not rows:
            raise NotFoundError("Application", application_id)
        app = rows[0]

        if app["status"] == "approved":
            return {"success": True, "message": "Already approved", "merchant_id": app.get("merchant_id")}
        if app["status"] not in _ACTIVE_STATUSES:
            raise BadRequestError(f"Cannot approve an application with status '{app['status']}'")

        email = (app["email"] or "").strip().lower()

        # Guard against collisions with existing accounts before we write anything.
        if await db.from_("merchants").eq("email", email).select("id"):
            raise ConflictError("A merchant with this email already exists")
        if await db.from_("merchant_admins").eq("email", email).select("id"):
            raise ConflictError("An admin login with this email already exists")
        if app.get("telegram_id"):
            if await db.from_("merchant_admins").eq("telegram_id", app["telegram_id"]).select("id"):
                raise ConflictError("This Telegram account is already a shop admin")

        merchant_data = {
            "name": app["store_name"],
            "slug": await _unique_slug(db, app["store_name"]),
            "owner_name": app["full_name"],
            "email": email,
            "phone": app.get("phone"),
            "description": app.get("store_description"),
            "logo_url": app.get("logo_url"),
            "status": "active",
        }
        merchant_rows = await db.from_("merchants").insert(merchant_data)
        if not merchant_rows:
            raise BadRequestError("Failed to create merchant")
        merchant_id = merchant_rows[0]["id"]

        admin_data = {
            "merchant_id": merchant_id,
            "full_name": app["full_name"],
            "email": email,
            "password_hash": app["password_hash"],  # already hashed at submit time
            "role": "owner",
        }
        if app.get("telegram_id"):
            admin_data["telegram_id"] = app["telegram_id"]
        await db.from_("merchant_admins").insert(admin_data)

        note = body.note if body else None
        await db.from_("seller_applications").eq("id", application_id).update({
            "status": "approved",
            "merchant_id": merchant_id,
            "review_note": note,
            "reviewed_by": int(user.sub) if user.sub else None,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        })

        # In-app notification (best-effort).
        if app.get("user_id"):
            try:
                await db.from_("notifications").insert({
                    "user_id": app["user_id"],
                    "type": "system",
                    "title": "Your shop is approved! 🎉",
                    "body": f"{app['store_name']} is now live. Tap /start in the bot to manage your shop.",
                    "ref_id": merchant_id,
                })
            except Exception:
                logger.warning("Approval notification insert failed", exc_info=True)

    # Telegram DM (best-effort, outside the DB context).
    try:
        from bot.notifications import send_seller_application_update
        await send_seller_application_update(
            app.get("telegram_id"), approved=True, store_name=app["store_name"],
        )
    except Exception:
        logger.warning("Approval DM dispatch failed", exc_info=True)

    return {"success": True, "merchant_id": merchant_id}


@router.patch("/admin/{application_id}/reject")
async def reject_application(
    application_id: int,
    body: SellerApplicationReview | None = None,
    user: TokenClaims = require_role(Role.SUPER_ADMIN),
):
    """Reject an application and notify the applicant."""
    async with SupabaseClient.service_role() as db:
        rows = await db.from_("seller_applications").eq("id", application_id).select(
            "id,status,telegram_id,store_name,user_id"
        )
        if not rows:
            raise NotFoundError("Application", application_id)
        app = rows[0]
        if app["status"] == "approved":
            raise BadRequestError("Cannot reject an already-approved application")

        note = body.note if body else None
        await db.from_("seller_applications").eq("id", application_id).update({
            "status": "rejected",
            "review_note": note,
            "reviewed_by": int(user.sub) if user.sub else None,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        })

        if app.get("user_id"):
            try:
                await db.from_("notifications").insert({
                    "user_id": app["user_id"],
                    "type": "system",
                    "title": "Update on your shop application",
                    "body": note or "Your application was not approved at this time.",
                })
            except Exception:
                logger.warning("Rejection notification insert failed", exc_info=True)

    try:
        from bot.notifications import send_seller_application_update
        await send_seller_application_update(
            app.get("telegram_id"), approved=False, store_name=app["store_name"], note=note,
        )
    except Exception:
        logger.warning("Rejection DM dispatch failed", exc_info=True)

    return {"success": True}
