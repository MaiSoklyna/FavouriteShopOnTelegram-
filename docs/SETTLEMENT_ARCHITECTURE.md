# Merchant Settlement Architecture

Status: implemented, payout execution manual. ABA PayWay Split & Payout is **not enabled** by ABA (it is a separate feature their integration team must switch on). This design records every merchant's earnings now so that, when ABA enables it, only *how money is sent* changes.

| Piece | Where |
|---|---|
| Migration | `supabase/migrations/014_merchant_settlement.sql` |
| Commission math + ledger calls | `backend/app/services/settlement.py` |
| Pydantic schemas | `backend/app/models/settlement.py` |
| API | `backend/app/routes/settlements.py` (`/api/settlements/...`) |
| Payment hook | `backend/app/routes/payments.py` → `_settle()` |
| Order lifecycle hook | `backend/app/routes/orders.py` → cancel / status update |

---

## 1. Data model

```
merchants ──< orders ──1:1── merchant_earnings >── merchant_payouts
   │                         (one 'order' row       │
   │                          per paid order,       └──< merchant_payout_items
   │                          + 'adjustment' rows)        (permanent payout ↔ earning record)
   └── payout settings: aba_account, aba_account_name, payout_enabled,
       payout_verification_status, commission_rate
settlement_audit_log  (append-only; every state change)
merchant_balances     (view; per merchant + currency)
```

### New columns

| Table | Column | Purpose |
|---|---|---|
| merchants | `aba_account`, `aba_account_name` | Where the merchant is paid |
| merchants | `payout_verification_status` | `unverified` → `pending` (merchant submitted) → `verified` / `rejected` (super admin) |
| merchants | `payout_enabled` | Merchant may receive ABA split payouts (only when verified) |
| merchants | `commission_rate` | Per-shop override; NULL = `PLATFORM_COMMISSION_PERCENT` |
| orders | `commission_rate` | Rate frozen when the order is first priced for payment |
| orders | `payout_mode` | `platform` (we collect) or `aba_split` (ABA paid the seller directly) |

### merchant_earnings — one row per paid order

| Status | Meaning | Becomes |
|---|---|---|
| `pending` | Customer paid; order not delivered yet | `ready` on delivery, `reversed` on cancel |
| `ready` | Payable. `payout_id` NULL = available; set = inside an open payout | `paid` when payout completes |
| `paid` | Merchant has the money | refund later → negative `adjustment` row |
| `failed` | Reserved for a failed ABA split; settle manually | `ready` |
| `reversed` | Order cancelled/refunded before payout | — |

Invariant enforced by a CHECK: `net_amount = gross_amount - commission_amount`.
Uniqueness: one `entry_type='order'` row per order → recording is idempotent (callback + poll + backfill can all fire safely).

### merchant_payouts — one transfer to one merchant

`pending` → `paid` (with bank reference) or `failed` / `cancelled` (earnings released back to available). `processing` is reserved for ABA-executed payouts. The destination account is snapshotted on the payout, so later account edits never rewrite history.

---

## 2. How customer payment flows today

```
Customer ──QR──▶ ABA PayWay ──▶ PLATFORM ABA account (100%)
                     │
                     └─ callback / status poll ─▶ backend _settle()
                                                   1. check-transaction (PayWay = source of truth)
                                                   2. amount == order.total ?
                                                   3. order.payment_status = paid
                                                   4. record_order_earning()  → status 'pending'
Merchant marks order delivered ─────────────────▶ mark_order_earning_ready() → 'ready'
```

Multi-shop cart: checkout already creates **one order per shop** and one QR per order, so each order produces exactly one earning for exactly one merchant. Nothing is split across merchants inside a transaction.

Only orders where the platform holds the money produce earnings (`payment_method = 'khqr'`). COD is excluded — see *Open decisions*.

The ledger write is deliberately non-blocking: if it fails, the payment is still marked paid and the failure is logged. `POST /api/settlements/admin/backfill` re-records any paid QR order without an earning.

## 3. How merchant balances are calculated

Per order (`settlement.compute_split`, used for both the ledger and a future ABA payout):

```
gross            = order.total                       (what the customer paid)
commission_base  = order.total - order.delivery_fee  (or total if COMMISSION_INCLUDES_DELIVERY)
commission       = round(commission_base × rate / 100, 2)
net (merchant)   = gross - commission
rate             = order.commission_rate  ?? merchant.commission_rate ?? PLATFORM_COMMISSION_PERCENT
```

Example — total $55.50, delivery $5.00, rate 10% → base $50.50, commission $5.05, merchant net **$50.45**.

Promo discounts are already inside `order.total`; promos are per merchant, so the merchant funds them.

Balance view (`merchant_balances`):

| Field | = sum of net_amount where |
|---|---|
| `pending_amount` | status = pending (paid, not delivered) |
| `available_amount` | status = ready, not in a payout, settlement_method = manual |
| `in_payout_amount` | status = ready, in an open payout |
| `owed_amount` | available + in_payout — **what the platform owes now** |
| `paid_amount` | status = paid |
| `commission_total` | platform revenue (excl. reversed) |

Negative adjustments (refund after payout) count as `ready`, so they reduce the next payout automatically.

## 4. How manual settlement works

1. Merchant enters ABA account + holder name → verification `pending`, payout off.
2. Super admin checks the account (e.g. a $0.01 test transfer, name matches the KYC'd owner) → `verified` or `rejected` with reason.
3. Super admin opens **Balances**, picks a merchant, clicks **Create payout** → `create_merchant_payout()` locks the merchant, bundles every available earning, snapshots the account, payout = `pending`.
4. Admin sends the ABA transfer for exactly `payout.amount` to `payout.aba_account`.
5. Admin clicks **Mark paid** and enters the ABA transfer reference → payout `paid`, its earnings `paid`.
6. If the transfer bounces: **Mark failed** with a reason → earnings return to *available* and can be re-paid; the failed payout and its items stay on record.

7. If a payout was marked paid but no money actually arrived (test run, mistake, bank returned it): **Reverse payout** with a reason → payout `reversed` (kept on record with its original reference), earnings back to *available*.

Every step writes `settlement_audit_log` (who, when, before/after). Audit rows cannot be updated or deleted (trigger).

Guards: payouts need a verified account; a payout can't be marked paid twice or without a reference; an order whose earning is inside an open payout can't be cancelled until that payout is failed/cancelled.

## 5. Future ABA Split & Payout

When ABA enables it on the PayWay profile:

1. Set `PAYWAY_PAYOUT_ENABLED=true`.
2. For each merchant: verified account + `payout_enabled = true`.

What then happens automatically (code already in place):

- `create_qr` sees `split_payout_allowed(merchant)` and sends PayWay `payout=[{account, amount: net}]` using the same `compute_split`, storing `orders.payout_mode='aba_split'`.
- On payment the earning is recorded with `settlement_method='aba_split'`; it is excluded from manual payouts (ABA already paid the seller).
- Merchants without a verified account keep `payout_mode='platform'` and are paid manually — both modes coexist.

Still to build at that point (execution only — no schema change):

- A reconciliation job that confirms ABA split transfers and moves `aba_split` earnings to `paid` (creating a `merchant_payouts` row with `method='aba_payway_payout'` linked via `merchant_payout_items`), or to `failed` → manual settlement.
- Refund handling for split payments (ABA's reversal behaviour for split transactions is not documented — confirm with ABA).

---

## 6. API

All under `/api/settlements`.

### Merchant admin (own shop only)

| Method | Path | Purpose |
|---|---|---|
| GET | `/merchant/balance` | Balance per currency |
| GET | `/merchant/earnings?status=&page=` | Per-order earnings with order code |
| GET | `/merchant/payouts` | Payout history |
| GET | `/merchant/payout-account` | ABA account + verification state + effective commission |
| PUT | `/merchant/payout-account` | `{aba_account, aba_account_name}` — resets verification |

### Super admin

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/balances?only_owed=true` | Owed per merchant, largest first, masked account |
| GET | `/admin/merchants/{id}/payout-account` | Full account details |
| PATCH | `/admin/merchants/{id}/payout-settings` | Verify/reject, enable payout, set/clear commission |
| GET | `/admin/merchants/{id}/earnings` | Earnings ledger |
| POST | `/admin/merchants/{id}/payouts` | Create payout from available earnings |
| GET | `/admin/payouts?status=&merchant_id=` | All payouts |
| GET | `/admin/payouts/{id}` | Payout + covered earnings (statement) |
| POST | `/admin/payouts/{id}/complete` | `{reference}` |
| POST | `/admin/payouts/{id}/fail` | `{reason, cancel}` |
| POST | `/admin/payouts/{id}/reverse` | `{reason}` — undo a *paid* payout where no money reached the merchant (migration 015) |
| GET | `/admin/audit?merchant_id=&entity_type=&entity_id=` | Audit trail |
| GET | `/admin/report?date_from=&date_to=` | Per-merchant sales / commission / payouts for a period (max 1 year) |
| POST | `/admin/backfill` | Record missing earnings for paid QR orders |

---

## 7. Dashboards

Implemented:

- Super admin: `frontend/src/app/(admin)/settlements/page.tsx` — tabs Balances · Payouts · Verification · Reports · Audit log; dialogs in `frontend/src/components/settlement/admin/`.
- Merchant admin: `frontend/src/app/(admin)/earnings/page.tsx`.
- Shared: `frontend/src/lib/settlements.ts` (API + types), `frontend/src/components/settlement/`.

Requirements they implement:

### Super admin — "Settlements" section

1. **Balances table** — merchant, pending, available, in payout, owed, paid to date, commission earned, account (masked) + verification badge. Sort by owed. Row action: *Create payout* (disabled unless verified and available > 0).
2. **Payout queue** — tabs Pending / Paid / Failed. Pending row shows amount, destination account + holder name (full), created by/at, with *Mark paid* (reference required) and *Mark failed* (reason required). Confirm dialog shows amount and account before marking paid.
3. **Payout detail** — the orders it covers (order code, gross, commission, net) — printable/exportable as the merchant's statement.
4. **Verification inbox** — merchants with status `pending`: account number, holder name, shop owner name for comparison; *Verify* / *Reject (reason)*.
5. **Merchant settlement settings** — commission override, payout enabled toggle (only when verified).
6. **Audit log** — filter by merchant/entity; read-only.
7. **Backfill** — one button, shows created/skipped counts.
8. Platform totals: total collected, total owed, total commission (sum of balances).

### Merchant admin — "Earnings" section

1. **Summary cards** — Pending (awaiting delivery), Available (next payout), In payout, Paid to date. Show effective commission rate.
2. **Earnings list** — order code, date, gross, commission, net, status chip; filter by status.
3. **Payouts list** — date, amount, status, reference, account (masked).
4. **Payout account form** — ABA account number + holder name; status banner (Unverified / Pending review / Verified / Rejected + reason). Warn that changing the account pauses payouts until re-verified.

---

## 8. Open decisions (business, not code)

| Decision | Current default |
|---|---|
| Commission on delivery fee? | No (`COMMISSION_INCLUDES_DELIVERY=false`) |
| When is an earning payable? | When the order is marked `delivered` (no hold period) |
| COD orders — merchant collects cash; does merchant owe commission? | Not recorded. Schema supports it (`collected_by='merchant'`, negative balance) |
| Payout schedule (weekly? threshold?) | Manual, on demand |
| Which merchant admins may change the payout account? | Any merchant admin of the shop; change forces re-verification |
| Record retention period for payout/bank data | Unknown — confirm local accounting requirement |

## 9. Deployment order

1. Run `014_merchant_settlement.sql` in Supabase **before** deploying the backend (the QR route writes `orders.commission_rate` / `payout_mode`).
2. Set `PLATFORM_COMMISSION_PERCENT` on the Vercel backend (old name `PAYWAY_PLATFORM_FEE_PERCENT` still read).
3. Deploy backend.
4. Call `POST /api/settlements/admin/backfill` once to record earnings for orders already paid by QR.
