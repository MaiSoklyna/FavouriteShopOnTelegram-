import hashlib
import hmac
import time

from app.config import settings
from app.services import stripe_pay


def _sign(payload: bytes, secret: str, ts: int) -> str:
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def test_minor_units_rounds_to_cents():
    assert stripe_pay.to_minor_units("12.34") == 1234
    assert stripe_pay.to_minor_units(0.1 + 0.2) == 30


def test_live_key_is_never_configured(monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_live_abc")
    assert not stripe_pay.is_configured()
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_abc")
    assert stripe_pay.is_configured()


def test_webhook_signature(monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    body = b'{"type":"payment_intent.succeeded"}'
    now = int(time.time())
    assert stripe_pay.verify_webhook(body, _sign(body, "whsec_test", now))
    assert not stripe_pay.verify_webhook(body, _sign(body, "wrong", now))
    assert not stripe_pay.verify_webhook(b"tampered", _sign(body, "whsec_test", now))
    assert not stripe_pay.verify_webhook(body, _sign(body, "whsec_test", now - 3600))
    assert not stripe_pay.verify_webhook(body, "")
