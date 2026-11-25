"""The delivery confirmation code: proof the order reached the customer.

Each delivery order has a 4-digit code. The customer sees it on their order page and in the "out for
delivery" message, and gives it to the driver at the door; the driver types it to mark the order
delivered. Neither the driver nor the shop is shown the code.

The code is derived from the order id with a key derived from SUPABASE_JWT_SECRET that is used for
nothing else, so it is not stored anywhere and cannot be read from the database. Wrong tries are
counted on the delivery (deliveries.code_attempts, migration 040); after MAX_ATTEMPTS the driver
must ask the shop, which can still confirm the delivery from the dashboard.
"""

from __future__ import annotations

import hashlib
import hmac

from app.config import settings

DIGITS = 4
MAX_ATTEMPTS = 5


def _key() -> bytes:
    return hmac.new(settings.SUPABASE_JWT_SECRET.encode(), b"byme24:delivery-code:v1", hashlib.sha256).digest()


def code_for(order_id: int) -> str:
    """The order's code, e.g. "0427"."""
    digest = hmac.new(_key(), str(int(order_id)).encode(), hashlib.sha256).digest()
    return str(int.from_bytes(digest[:8], "big") % 10 ** DIGITS).zfill(DIGITS)


def matches(order_id: int, given: str | None) -> bool:
    cleaned = "".join(ch for ch in str(given or "") if ch.isdigit())
    return len(cleaned) == DIGITS and hmac.compare_digest(cleaned, code_for(order_id))
