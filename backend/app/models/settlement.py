"""Settlement schemas — merchant earnings, payouts, payout accounts."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, Field


class EarningStatus(StrEnum):
    PENDING = "pending"      # paid by customer, order not yet delivered
    READY = "ready"          # delivered — payable to merchant
    PAID = "paid"            # merchant has received it
    FAILED = "failed"        # ABA split failed; needs manual settlement
    REVERSED = "reversed"    # order cancelled/refunded before payout


class PayoutStatus(StrEnum):
    PENDING = "pending"          # created, transfer not yet confirmed
    PROCESSING = "processing"    # submitted to ABA (future)
    PAID = "paid"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REVERSED = "reversed"        # was marked paid, but no money reached the merchant


class PayoutMethod(StrEnum):
    MANUAL_TRANSFER = "manual_transfer"
    ABA_PAYWAY_PAYOUT = "aba_payway_payout"


class SettlementMethod(StrEnum):
    MANUAL = "manual"
    ABA_SPLIT = "aba_split"


class VerificationStatus(StrEnum):
    UNVERIFIED = "unverified"
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"


# ── Requests ────────────────────────────────────────────────────


class PayoutAccountUpdate(BaseModel):
    """Merchant sets the ABA account they want to be paid into."""

    aba_account: str = Field(..., min_length=6, max_length=30, pattern=r"^[0-9 ]+$")
    aba_account_name: str = Field(..., min_length=2, max_length=100)


class PayoutSettingsUpdate(BaseModel):
    """Super admin reviews a merchant's payout setup."""

    payout_verification_status: VerificationStatus | None = None
    payout_rejection_reason: str | None = Field(None, max_length=500)
    payout_enabled: bool | None = None
    commission_rate: Decimal | None = Field(None, ge=0, le=100)
    clear_commission_rate: bool = False


class PayoutCreate(BaseModel):
    currency: str = Field("USD", pattern=r"^(USD|KHR)$")
    note: str | None = Field(None, max_length=500)


class PayoutComplete(BaseModel):
    reference: str = Field(..., min_length=3, max_length=100)


class PayoutReverse(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class PayoutFail(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)
    cancel: bool = False


# ── Responses ───────────────────────────────────────────────────


class PayoutAccount(BaseModel):
    merchant_id: int
    aba_account: str | None = None
    aba_account_name: str | None = None
    payout_enabled: bool = False
    payout_verification_status: VerificationStatus = VerificationStatus.UNVERIFIED
    payout_verified_at: datetime | None = None
    payout_rejection_reason: str | None = None
    commission_rate: Decimal | None = None
    effective_commission_rate: Decimal


class MerchantBalance(BaseModel):
    merchant_id: int
    merchant_name: str | None = None
    currency: str = "USD"
    pending_amount: Decimal = Decimal("0")
    available_amount: Decimal = Decimal("0")
    in_payout_amount: Decimal = Decimal("0")
    owed_amount: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    failed_amount: Decimal = Decimal("0")
    gross_total: Decimal = Decimal("0")
    commission_total: Decimal = Decimal("0")
    last_earning_at: datetime | None = None


class Earning(BaseModel):
    id: int
    merchant_id: int
    order_id: int | None = None
    entry_type: str
    currency: str
    gross_amount: Decimal
    commission_base: Decimal
    commission_rate: Decimal
    commission_amount: Decimal
    net_amount: Decimal
    collected_by: str
    settlement_method: SettlementMethod
    status: EarningStatus
    payway_tran_id: str | None = None
    payout_id: int | None = None
    description: str | None = None
    ready_at: datetime | None = None
    paid_at: datetime | None = None
    reversed_at: datetime | None = None
    created_at: datetime


class Payout(BaseModel):
    id: int
    merchant_id: int
    currency: str
    amount: Decimal
    item_count: int
    method: PayoutMethod
    status: PayoutStatus
    aba_account: str | None = None
    aba_account_name: str | None = None
    reference: str | None = None
    note: str | None = None
    failure_reason: str | None = None
    created_by: str | None = None
    completed_by: str | None = None
    created_at: datetime
    paid_at: datetime | None = None
    failed_at: datetime | None = None
    reversed_at: datetime | None = None
    reversed_by: str | None = None
    reversal_reason: str | None = None
