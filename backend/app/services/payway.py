"""ABA PayWay client — QR generation and transaction status checks.

Docs: https://developer.payway.com.kh/aba-qr-api-3158158f0

Every request is signed with HMAC-SHA512 over a fixed concatenation of
fields, keyed by the merchant API key, then Base64-encoded. PayWay is the
source of truth for whether money arrived: callers must confirm a payment
via `check_transaction()`, never by trusting a callback body.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GENERATE_QR_PATH = "/api/payment-gateway/v1/payments/generate-qr"
CHECK_TRANSACTION_PATH = "/api/payment-gateway/v1/payments/check-transaction-2"

# payment_status values returned by check-transaction-2
STATUS_APPROVED = "APPROVED"
STATUS_PENDING = "PENDING"

_TIMEOUT = httpx.Timeout(15.0)


class PayWayError(Exception):
    """PayWay rejected the request or could not be reached."""

    def __init__(self, message: str, code: str | None = None):
        self.code = code
        super().__init__(message)


def _clean(value: str) -> str:
    """Strip spaces, line breaks and wrapping quotes pasted into env vars."""
    return (value or "").strip().strip("'\"").strip()


def _base_url() -> str:
    """PAYWAY_BASE_URL tolerant of a missing scheme or trailing slash/path slip-ups.

    "checkout-sandbox.payway.com.kh" → "https://checkout-sandbox.payway.com.kh"
    """
    url = _clean(settings.PAYWAY_BASE_URL).rstrip("/")
    if url and "://" not in url:
        url = "https://" + url
    return url


def _merchant_id() -> str:
    return _clean(settings.PAYWAY_MERCHANT_ID)


def _api_key() -> str:
    return _clean(settings.PAYWAY_API_KEY)


def _callback_url() -> str:
    url = _clean(settings.PAYWAY_CALLBACK_URL)
    if url and "://" not in url:
        url = "https://" + url
    return url


def is_configured() -> bool:
    return bool(_merchant_id() and _api_key() and _base_url())


def to_money(value: Any) -> Decimal:
    """Convert a DB/JSON amount to a 2-dp Decimal without float drift."""
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _b64(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def _b64_json(value: Any) -> str:
    return _b64(json.dumps(value, separators=(",", ":")))


def _sign(*parts: str) -> str:
    message = "".join(parts).encode("utf-8")
    digest = hmac.new(_api_key().encode("utf-8"), message, hashlib.sha512).digest()
    return base64.b64encode(digest).decode("ascii")


def _req_time() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


async def _post(path: str, body: dict) -> dict:
    url = _base_url() + path
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, json=body)
    except httpx.HTTPError as exc:
        raise PayWayError(f"PayWay unreachable: {exc.__class__.__name__}") from exc

    try:
        data = resp.json()
    except ValueError as exc:
        raise PayWayError(f"PayWay returned non-JSON (HTTP {resp.status_code})") from exc
    return data


async def generate_qr(
    *,
    tran_id: str,
    amount: Decimal,
    currency: str,
    first_name: str = "",
    last_name: str = "",
    phone: str = "",
    items: list[dict] | None = None,
    payout: list[dict] | None = None,
    lifetime_minutes: int | None = None,
) -> dict:
    """Create a dynamic ABA KHQR for one transaction.

    Returns PayWay's response: qrString, qrImage, abapay_deeplink, amount, currency.
    """
    req_time = _req_time()
    merchant_id = _merchant_id()
    amount_str = f"{amount:.2f}" if currency == "USD" else f"{amount:.0f}"
    items_b64 = _b64_json(items) if items else ""
    callback_b64 = _b64(_callback_url()) if _callback_url() else ""
    payout_b64 = (
        _b64_json([{"account": p["account"], "amount": float(p["amount"])} for p in payout])
        if payout else ""
    )
    lifetime = str(lifetime_minutes or settings.PAYWAY_QR_LIFETIME_MINUTES)
    first_name, last_name, phone = first_name[:20], last_name[:20], phone[:20]
    email = purchase_type = return_deeplink = custom_fields = return_params = ""
    payment_option = "abapay_khqr"
    qr_image_template = "template3_color"

    body = {
        "req_time": req_time,
        "merchant_id": merchant_id,
        "tran_id": tran_id,
        "amount": amount_str,
        "items": items_b64,
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "phone": phone,
        "purchase_type": purchase_type,
        "payment_option": payment_option,
        "callback_url": callback_b64,
        "return_deeplink": return_deeplink,
        "currency": currency,
        "custom_fields": custom_fields,
        "return_params": return_params,
        "payout": payout_b64,
        "lifetime": lifetime,
        "qr_image_template": qr_image_template,
    }
    # Field order is fixed by the PayWay QR API spec.
    body["hash"] = _sign(
        req_time, merchant_id, tran_id, amount_str, items_b64,
        first_name, last_name, email, phone, purchase_type, payment_option,
        callback_b64, return_deeplink, currency, custom_fields, return_params,
        payout_b64, lifetime, qr_image_template,
    )
    # Drop empty optionals so PayWay doesn't validate blank strings.
    body = {k: v for k, v in body.items() if v != ""}

    data = await _post(GENERATE_QR_PATH, body)
    status = data.get("status") or {}
    code = str(status.get("code", ""))
    if code not in ("0", "00"):
        logger.warning(
            "PayWay generate-qr failed: code=%s message=%s trace=%s tran_id=%s",
            code, status.get("message"), status.get("trace_id"), tran_id,
        )
        raise PayWayError(status.get("message") or "QR generation failed", code)
    return data


async def check_transaction(tran_id: str) -> dict:
    """Ask PayWay for the authoritative status of a transaction.

    Returns the `data` object: payment_status, payment_status_code,
    total_amount, payment_amount, payment_currency, apv, transaction_date, ...
    Only transactions created within the last 7 days can be checked.
    """
    req_time = _req_time()
    merchant_id = _merchant_id()
    body = {
        "req_time": req_time,
        "merchant_id": merchant_id,
        "tran_id": tran_id,
        "hash": _sign(req_time, merchant_id, tran_id),
    }
    data = await _post(CHECK_TRANSACTION_PATH, body)
    result = data.get("data") or {}
    # The docs show `status` both at the top level and nested in `data`.
    status = data.get("status") or result.get("status") or {}
    code = str(status.get("code", ""))
    if code not in ("0", "00"):
        raise PayWayError(status.get("message") or "Transaction check failed", code)
    return result
