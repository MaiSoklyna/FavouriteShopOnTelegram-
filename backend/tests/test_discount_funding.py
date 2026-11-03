"""Who pays a discount: platform-funded discounts never reduce the merchant's payout."""

from decimal import Decimal

from app.core.constants import Role
from app.core.security import TokenClaims
from app.routes.analytics import order_revenue
from app.routes.orders import discount_funder, discount_parts
from app.routes.promotions import PromotionIn, funded_by_for
from app.services import settlement

D = Decimal
MERCHANT = TokenClaims(sub="7", role=Role.MERCHANT_ADMIN, merchant_id=1)
SUPER = TokenClaims(sub="1", role=Role.SUPER_ADMIN)
VERIFIED = {"payout_enabled": True, "payout_verification_status": "verified", "aba_account": "000 111 222"}


def order(total, delivery="0", platform="0", rate="0"):
    return {"total": total, "delivery_fee": delivery, "platform_discount_amount": platform, "commission_rate": rate}


# ── Settlement split ────────────────────────────────────────────


def test_platform_discount_paid_to_merchant_in_full():
    # $100 product, $10 platform discount: customer pays $90, merchant is owed $100
    s = settlement.compute_split(order("90.00", platform="10.00"))
    assert (s.gross, s.subsidy, s.net) == (D("90.00"), D("10.00"), D("100.00"))


def test_commission_is_on_the_full_sale_not_the_discounted_one():
    s = settlement.compute_split(order("92.00", delivery="2.00", platform="10.00", rate="5"))
    # sale worth 100 to the shop (+2 delivery); commission 5% of 100
    assert s.commission_base == D("100.00")
    assert s.commission == D("5.00")
    assert s.net == D("97.00")
    assert s.net == s.gross + s.subsidy - s.commission  # the ledger's check


def test_shop_discount_still_comes_out_of_the_payout():
    s = settlement.compute_split(order("90.00"))
    assert (s.subsidy, s.net) == (D("0.00"), D("90.00"))


def test_cod_order_owes_only_the_subsidy():
    s = settlement.subsidy_only_split(order("90.00", platform="10.00", rate="5"))
    assert (s.gross, s.subsidy, s.commission, s.net) == (D("0.00"), D("10.00"), D("0.00"), D("10.00"))


def test_subsidised_order_never_uses_aba_split(monkeypatch):
    monkeypatch.setattr(settlement.settings, "PAYWAY_PAYOUT_ENABLED", True)
    assert settlement.split_payout_allowed(VERIFIED, order("90.00"))
    assert not settlement.split_payout_allowed(VERIFIED, order("90.00", platform="10.00"))


# ── Who funds the discount ──────────────────────────────────────


def test_platform_promotion_is_platform_funded():
    assert discount_funder({"merchant_id": None}, {"scope": "platform", "merchant_id": None}) == "platform"


def test_shop_promotion_is_shop_funded():
    assert discount_funder({"merchant_id": 1}, {"scope": "shop", "merchant_id": 1}) == "shop"


def test_promotion_funded_by_wins():
    assert discount_funder({"merchant_id": 1}, {"scope": "shop", "merchant_id": 1, "funded_by": "platform"}) == "platform"


def test_plain_codes_follow_their_owner():
    assert discount_funder({"merchant_id": None}, None) == "platform"
    assert discount_funder({"merchant_id": 3}, None) == "shop"


def test_discount_parts_add_up():
    assert discount_parts(D("10.00"), "platform") == (D("0.00"), D("10.00"))
    assert discount_parts(D("10.00"), "shop") == (D("10.00"), D("0.00"))
    assert discount_parts(D("0.00"), "platform") == (D("0.00"), D("0.00"))


# ── Who may choose ──────────────────────────────────────────────


def _body(**kw):
    return PromotionIn(title="Sale", scope=kw.pop("scope", "shop"), **kw)


def test_merchant_admin_cannot_make_platform_pay():
    assert funded_by_for(_body(funded_by="platform"), 1, MERCHANT) == "shop"


def test_super_admin_defaults_by_scope_and_can_override():
    assert funded_by_for(_body(scope="platform"), None, SUPER) == "platform"
    assert funded_by_for(_body(), 1, SUPER) == "shop"
    assert funded_by_for(_body(funded_by="platform"), 1, SUPER) == "platform"


# ── Reports ─────────────────────────────────────────────────────


def test_shop_revenue_includes_platform_discount():
    o = {"total": 90, "platform_discount_amount": 10}
    assert order_revenue(o, for_merchant=True) == 100
    assert order_revenue(o, for_merchant=False) == 90
