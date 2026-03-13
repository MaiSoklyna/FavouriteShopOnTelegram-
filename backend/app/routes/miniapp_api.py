"""Miniapp API endpoints — replaces Supabase Edge Functions.

Each endpoint mirrors the corresponding Edge Function so the miniapp
can call FastAPI instead of Supabase functions/v1/*.
"""

import logging
import time
import secrets
import random
from datetime import datetime, timezone

import jwt as pyjwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from app.config import settings
from app.services.rest import RestClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/functions/v1", tags=["Miniapp API"])

JWT_EXPIRY_SECONDS = 86400  # 24 hours


# ── JWT helpers ──────────────────────────────────────────────────

def _mint_jwt(payload: dict) -> str:
    now = int(time.time())
    app_role = payload.pop("role", "authenticated")
    claims = {
        **payload,
        "role": "authenticated",
        "aud": "authenticated",
        "app_role": app_role,
        "iss": "supabase",
        "iat": now,
        "exp": now + JWT_EXPIRY_SECONDS,
    }
    return pyjwt.encode(claims, settings.SUPABASE_JWT_SECRET, algorithm="HS256")


def _verify_jwt(token: str) -> dict:
    try:
        return pyjwt.decode(token, settings.SUPABASE_JWT_SECRET, algorithms=["HS256"],
                            audience="authenticated")
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _get_jwt_from_request(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return _verify_jwt(auth[7:])


async def _get_user_from_jwt(claims: dict) -> dict:
    """Resolve user row from JWT claims."""
    client = RestClient(service_role=True)
    telegram_id = claims.get("telegram_id")
    if telegram_id:
        rows = await client.get(f"users?telegram_id=eq.{telegram_id}&select=*&limit=1")
        if rows:
            return rows[0]
    sub = claims.get("sub")
    if sub:
        rows = await client.get(f"users?id=eq.{sub}&select=*&limit=1")
        if rows:
            return rows[0]
    raise HTTPException(status_code=404, detail="User not found")


# ── POST /functions/v1/telegram-auth ─────────────────────────────

class TelegramAuthBody(BaseModel):
    telegram_id: int
    username: str = ""
    first_name: str = ""
    last_name: str = ""


@router.post("/telegram-auth")
async def telegram_auth(body: TelegramAuthBody):
    client = RestClient(service_role=True)

    upsert_data = {
        "telegram_id": body.telegram_id,
        "username": body.username or f"user_{body.telegram_id}",
        "first_name": body.first_name or "",
        "last_name": body.last_name or "",
    }

    rows = await client.get(f"users?telegram_id=eq.{body.telegram_id}&select=*&limit=1")
    if rows:
        user = rows[0]
        await client.update(
            f"users?telegram_id=eq.{body.telegram_id}",
            {"username": upsert_data["username"], "first_name": upsert_data["first_name"],
             "last_name": upsert_data["last_name"]},
        )
        user.update(upsert_data)
    else:
        result = await client.insert("users", upsert_data)
        if isinstance(result, list) and result:
            user = result[0]
        else:
            rows = await client.get(f"users?telegram_id=eq.{body.telegram_id}&select=*&limit=1")
            user = rows[0] if rows else upsert_data

    token = _mint_jwt({
        "sub": str(user.get("id", "")),
        "telegram_id": body.telegram_id,
        "role": "authenticated",
    })

    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": JWT_EXPIRY_SECONDS,
        "user": user,
    }


# ── GET /functions/v1/get-me ─────────────────────────────────────

@router.get("/get-me")
async def get_me(request: Request):
    claims = _get_jwt_from_request(request)
    user = await _get_user_from_jwt(claims)
    return user


# ── POST /functions/v1/update-profile ────────────────────────────

@router.post("/update-profile")
async def update_profile(request: Request):
    claims = _get_jwt_from_request(request)
    user = await _get_user_from_jwt(claims)
    body = await request.json()
    client = RestClient(service_role=True)
    await client.update(f"users?id=eq.{user['id']}", body)
    return {"success": True}


# ── POST /functions/v1/create-login-session ──────────────────────

@router.post("/create-login-session")
async def create_login_session():
    client = RestClient(service_role=True)
    session_id = secrets.token_urlsafe(32)
    await client.insert("login_sessions", {"session_id": session_id, "status": "pending"})
    return {"session_id": session_id}


# ── GET /functions/v1/poll-login-session ─────────────────────────

@router.get("/poll-login-session")
async def poll_login_session(session_id: str):
    client = RestClient(service_role=True)
    rows = await client.get(
        f"login_sessions?session_id=eq.{session_id}&select=*&limit=1"
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found")

    session = rows[0]

    # Expire old sessions
    created = datetime.fromisoformat(session["created_at"].replace("Z", "+00:00"))
    age = (datetime.now(timezone.utc) - created).total_seconds()
    if age > 300 and session["status"] == "pending":
        await client.update(
            f"login_sessions?session_id=eq.{session_id}",
            {"status": "expired"},
        )
        return {"status": "expired"}

    if session["status"] == "completed":
        user = None
        if session.get("user_id"):
            users = await client.get(f"users?id=eq.{session['user_id']}&select=*&limit=1")
            if users:
                user = users[0]

        return {
            "status": "completed",
            "token": session.get("jwt_token"),
            "user": user,
        }

    return {"status": session["status"]}


# ── POST /functions/v1/cart-add ──────────────────────────────────

@router.post("/cart-add")
async def cart_add(request: Request):
    claims = _get_jwt_from_request(request)
    user = await _get_user_from_jwt(claims)
    body = await request.json()

    product_id = body.get("product_id")
    quantity = body.get("quantity", 1)
    if not product_id:
        raise HTTPException(status_code=400, detail="product_id required")

    client = RestClient(service_role=True)

    # Get product
    products = await client.get(
        f"products?id=eq.{product_id}&select=id,merchant_id,base_price,stock,is_active&limit=1"
    )
    if not products or not products[0].get("is_active"):
        raise HTTPException(status_code=404, detail="Product not found or inactive")
    product = products[0]

    if product["stock"] < quantity:
        raise HTTPException(status_code=400, detail="Insufficient stock")

    # Get or create cart
    carts = await client.get(
        f"cart?user_id=eq.{user['id']}&merchant_id=eq.{product['merchant_id']}&select=id&limit=1"
    )
    if carts:
        cart_id = carts[0]["id"]
    else:
        result = await client.insert("cart", {
            "user_id": user["id"],
            "merchant_id": product["merchant_id"],
        })
        if isinstance(result, list) and result:
            cart_id = result[0]["id"]
        else:
            carts = await client.get(
                f"cart?user_id=eq.{user['id']}&merchant_id=eq.{product['merchant_id']}&select=id&limit=1"
            )
            cart_id = carts[0]["id"]

    # Check existing item
    existing = await client.get(
        f"cart_items?cart_id=eq.{cart_id}&product_id=eq.{product_id}&select=id,quantity&limit=1"
    )

    if existing:
        await client.update(
            f"cart_items?id=eq.{existing[0]['id']}",
            {"quantity": existing[0]["quantity"] + quantity},
        )
    else:
        await client.insert("cart_items", {
            "cart_id": cart_id,
            "product_id": product_id,
            "quantity": quantity,
            "unit_price": float(product["base_price"]),
            "selected_variants": body.get("selected_variants"),
        })

    return {"success": True}


# ── POST /functions/v1/validate-promo ────────────────────────────

@router.post("/validate-promo")
async def validate_promo(request: Request):
    claims = _get_jwt_from_request(request)
    body = await request.json()
    code = body.get("code")
    merchant_id = body.get("merchant_id")
    cart_total = float(body.get("cart_total", 0))

    if not code or not merchant_id:
        raise HTTPException(status_code=400, detail="code and merchant_id required")

    client = RestClient(service_role=True)
    promos = await client.get(
        f"promo_codes?merchant_id=eq.{merchant_id}&code=eq.{code}&select=*&limit=1"
    )
    if not promos:
        raise HTTPException(status_code=404, detail="PROMO_NOT_FOUND")
    promo = promos[0]

    if not promo.get("is_active"):
        raise HTTPException(status_code=404, detail="PROMO_NOT_FOUND")
    if promo.get("expires_at") and datetime.fromisoformat(
        promo["expires_at"].replace("Z", "+00:00")
    ) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="PROMO_EXPIRED")
    if promo.get("max_uses") and promo.get("used_count", 0) >= promo["max_uses"]:
        raise HTTPException(status_code=400, detail="PROMO_EXHAUSTED")
    if cart_total < float(promo.get("min_order", 0)):
        raise HTTPException(status_code=400, detail="PROMO_MIN_ORDER")

    value = float(promo["value"])
    if promo["type"] == "percent":
        discount_amount = round(cart_total * value / 100, 2)
    else:
        discount_amount = min(value, cart_total)

    return {
        "data": {
            "promo_id": promo["id"],
            "code": promo["code"],
            "type": promo["type"],
            "value": promo["value"],
            "discount_amount": discount_amount,
        }
    }


# ── POST /functions/v1/place-order ───────────────────────────────

@router.post("/place-order")
async def place_order(request: Request):
    claims = _get_jwt_from_request(request)
    user = await _get_user_from_jwt(claims)
    body = await request.json()

    merchant_id = body.get("merchant_id")
    delivery_address = body.get("delivery_address")
    if not merchant_id or not delivery_address:
        raise HTTPException(status_code=400, detail="merchant_id and delivery_address required")

    # Build delivery address with contact info
    delivery_name = body.get("delivery_name", "")
    delivery_phone = body.get("delivery_phone", "")
    full_address = delivery_address
    if delivery_name or delivery_phone:
        contact_line = " | ".join(filter(None, [delivery_name, delivery_phone]))
        full_address = f"{contact_line}\n{delivery_address}"

    customer_note = body.get("note", "") or None
    payment_method = body.get("payment_method", "cod")
    promo_code = body.get("promo_code")
    delivery_province = body.get("delivery_province")

    client = RestClient(service_role=True)

    # 1. Find cart
    carts = await client.get(
        f"cart?user_id=eq.{user['id']}&merchant_id=eq.{merchant_id}&select=id&limit=1"
    )
    if not carts:
        raise HTTPException(status_code=400, detail="CART_EMPTY")
    cart_id = carts[0]["id"]

    # 2. Get cart items
    cart_items = await client.get(
        f"cart_items?cart_id=eq.{cart_id}&select=*"
    )
    if not cart_items:
        raise HTTPException(status_code=400, detail="CART_EMPTY")

    # 3. Calculate subtotal
    subtotal = sum(float(i["unit_price"]) * i["quantity"] for i in cart_items)
    if subtotal == 0:
        raise HTTPException(status_code=400, detail="CART_EMPTY")

    # 4. Delivery fee
    delivery_fee = 0.0 if subtotal > 50 else 5.0

    # 5. Promo code
    discount = 0.0
    promo_id = None
    if promo_code:
        promos = await client.get(
            f"promo_codes?merchant_id=eq.{merchant_id}&code=eq.{promo_code}"
            f"&is_active=eq.true&select=*&limit=1"
        )
        if promos:
            promo = promos[0]
            expired = promo.get("expires_at") and datetime.fromisoformat(
                promo["expires_at"].replace("Z", "+00:00")
            ) < datetime.now(timezone.utc)
            exhausted = promo.get("max_uses") and promo.get("used_count", 0) >= promo["max_uses"]
            if not expired and not exhausted and subtotal >= float(promo.get("min_order", 0)):
                if promo["type"] == "percent":
                    discount = round(subtotal * float(promo["value"]) / 100, 2)
                else:
                    discount = min(float(promo["value"]), subtotal)
                promo_id = promo["id"]

    total = round(subtotal + delivery_fee - discount, 2)

    # 6. Generate order code
    order_code = f"FS-{datetime.now().strftime('%y%m%d')}-{random.randint(0, 9999):04d}"

    # 7. Insert order
    order_data = {
        "order_code": order_code,
        "user_id": user["id"],
        "merchant_id": int(merchant_id),
        "subtotal": subtotal,
        "discount_amount": discount,
        "delivery_fee": delivery_fee,
        "total": total,
        "status": "pending",
        "payment_method": payment_method,
        "payment_status": "unpaid",
        "delivery_address": full_address,
        "customer_note": customer_note,
    }
    if delivery_province:
        order_data["delivery_province"] = delivery_province
    if promo_id:
        order_data["promo_code_id"] = promo_id

    inserted = await client.insert("orders", order_data)
    if not inserted or not isinstance(inserted, list):
        raise HTTPException(status_code=500, detail="Failed to create order")
    order_id = inserted[0]["id"]

    # 8. Get product details for order items
    product_ids = [i["product_id"] for i in cart_items]
    id_filter = ",".join(str(pid) for pid in product_ids)
    products_rows = await client.get(
        f"products?id=in.({id_filter})&select=id,name,sku,stock"
    )
    product_map = {p["id"]: p for p in (products_rows or [])}

    # 9. Insert order items and update stock
    for item in cart_items:
        product = product_map.get(item["product_id"], {})
        await client.insert("order_items", {
            "order_id": order_id,
            "product_id": item["product_id"],
            "product_name": product.get("name", ""),
            "product_sku": product.get("sku"),
            "selected_variants": item.get("selected_variants"),
            "quantity": item["quantity"],
            "unit_price": float(item["unit_price"]),
            "subtotal": round(float(item["unit_price"]) * item["quantity"], 2),
        })
        current_stock = product.get("stock", 0)
        new_stock = max(current_stock - item["quantity"], 0)
        await client.update(
            f"products?id=eq.{item['product_id']}",
            {"stock": new_stock},
        )

    # 10. Record promo usage
    if promo_id and discount > 0:
        await client.insert("promo_usages", {
            "promo_code_id": promo_id,
            "user_id": user["id"],
            "order_id": order_id,
            "discount_applied": discount,
        })
        promos_rows = await client.get(f"promo_codes?id=eq.{promo_id}&select=used_count&limit=1")
        if promos_rows:
            await client.update(
                f"promo_codes?id=eq.{promo_id}",
                {"used_count": promos_rows[0]["used_count"] + 1},
            )

    # 11. Clear cart
    await client.delete(f"cart_items?cart_id=eq.{cart_id}")
    await client.delete(f"cart?id=eq.{cart_id}")

    result = {
        "order_id": order_id,
        "order_code": order_code,
        "subtotal": subtotal,
        "discount_amount": discount,
        "delivery_fee": delivery_fee,
        "total": total,
        "status": "pending",
        "payment_method": payment_method,
    }
    return {"success": True, "data": result}


# ── POST /functions/v1/cancel-order ──────────────────────────────

@router.post("/cancel-order")
async def cancel_order(request: Request):
    claims = _get_jwt_from_request(request)
    user = await _get_user_from_jwt(claims)
    body = await request.json()
    order_id = body.get("order_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id required")

    client = RestClient(service_role=True)

    orders = await client.get(
        f"orders?id=eq.{order_id}&user_id=eq.{user['id']}&select=*&limit=1"
    )
    if not orders:
        raise HTTPException(status_code=404, detail="Order not found")
    order = orders[0]

    if order["status"] != "pending":
        raise HTTPException(status_code=400, detail="Only pending orders can be cancelled")

    # Restore stock
    items = await client.get(
        f"order_items?order_id=eq.{order_id}&select=product_id,quantity"
    )
    if items:
        for item in items:
            if item.get("product_id"):
                prods = await client.get(
                    f"products?id=eq.{item['product_id']}&select=stock&limit=1"
                )
                if prods:
                    await client.update(
                        f"products?id=eq.{item['product_id']}",
                        {"stock": prods[0]["stock"] + item["quantity"]},
                    )

    await client.update(f"orders?id=eq.{order_id}", {"status": "cancelled"})
    return {"success": True, "message": "Order cancelled"}


# ── GET /functions/v1/generate-khqr ──────────────────────────────

@router.get("/generate-khqr")
async def generate_khqr_endpoint(order_id: int, request: Request):
    claims = _get_jwt_from_request(request)
    user = await _get_user_from_jwt(claims)

    client = RestClient(service_role=True)
    orders = await client.get(
        f"orders?id=eq.{order_id}&user_id=eq.{user['id']}&select=*&limit=1"
    )
    if not orders:
        raise HTTPException(status_code=404, detail="Order not found")
    order = orders[0]

    amount = float(order["total"])
    order_code = order["order_code"]

    try:
        from app.utils.khqr import generate_khqr, generate_payment_deeplink
        qr_code = await generate_khqr(amount, order_code, order.get("merchant_id"))
        deeplink = await generate_payment_deeplink(amount, order_code, order.get("merchant_id"))
    except Exception:
        # Fallback SVG
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
            <rect width="200" height="200" fill="white"/>
            <text x="100" y="90" text-anchor="middle" font-size="14" fill="#333">KHQR</text>
            <text x="100" y="115" text-anchor="middle" font-size="18" font-weight="bold" fill="#00BFA5">${amount:.2f}</text>
            <text x="100" y="140" text-anchor="middle" font-size="10" fill="#666">{order_code}</text>
        </svg>'''
        import base64
        qr_code = f"data:image/svg+xml;base64,{base64.b64encode(svg.encode()).decode()}"
        deeplink = f"https://bakong.nbc.gov.kh/pay?amount={amount}&ref={order_code}"

    return {
        "data": {
            "qr_code": qr_code,
            "amount": amount,
            "order_code": order_code,
            "expires_in": 900,
            "deeplink": deeplink,
        }
    }


# ── POST /functions/v1/confirm-payment ───────────────────────────

@router.post("/confirm-payment")
async def confirm_payment(request: Request):
    claims = _get_jwt_from_request(request)
    user = await _get_user_from_jwt(claims)
    body = await request.json()
    order_id = body.get("order_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id required")

    client = RestClient(service_role=True)
    orders = await client.get(
        f"orders?id=eq.{order_id}&user_id=eq.{user['id']}&select=*&limit=1"
    )
    if not orders:
        raise HTTPException(status_code=404, detail="Order not found")

    await client.update(
        f"orders?id=eq.{order_id}",
        {"payment_status": "paid", "status": "confirmed"},
    )

    return {"success": True, "message": "Payment confirmed"}


# ── POST /functions/v1/create-review ─────────────────────────────

@router.post("/create-review")
async def create_review(request: Request):
    claims = _get_jwt_from_request(request)
    user = await _get_user_from_jwt(claims)
    body = await request.json()

    product_id = body.get("product_id")
    rating = body.get("rating")
    if not product_id or not rating:
        raise HTTPException(status_code=400, detail="product_id and rating required")
    if rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be 1-5")

    client = RestClient(service_role=True)

    result = await client.insert("reviews", {
        "product_id": product_id,
        "user_id": user["id"],
        "order_id": body.get("order_id"),
        "rating": rating,
        "comment": body.get("comment"),
    })

    # Update product rating
    reviews = await client.get(
        f"reviews?product_id=eq.{product_id}&is_visible=eq.true&select=rating"
    )
    if reviews:
        avg = sum(r["rating"] for r in reviews) / len(reviews)
        await client.update(
            f"products?id=eq.{product_id}",
            {"rating_avg": round(avg, 2), "review_count": len(reviews)},
        )

    return {"success": True, "data": result}
