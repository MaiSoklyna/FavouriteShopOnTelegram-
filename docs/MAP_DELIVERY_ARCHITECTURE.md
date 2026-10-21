# Map & Delivery V1 — Architecture

Merchant-delivered orders priced by distance. No riders, no live tracking yet.

## 1. Decisions and how they map onto the existing system

| Spec | In this codebase |
|---|---|
| `shops` table | The existing **`merchants`** table, extended (a second table would split every FK: products, orders, settlements, promos). |
| `orders.shop_id` | Existing `orders.merchant_id`. |
| `delivery_latitude/longitude`, `distance_km`, `delivery_type` | Added to `orders` (migration 016). Existing `delivery_address`, `delivery_fee` reused. |
| `customer_addresses` | New table (migration 016). |
| Pay via PayWay | Unchanged — the QR is generated from `orders.total`, which now includes the distance-based fee. |
| Order statuses (accepted / preparing / ready_for_pickup / delivering) | **Not changed in this step** — see §8. |
| Mapbox | `mapbox-gl` (map) + Mapbox Geocoding REST (reverse geocode). |
| Tailwind | The shop UI uses inline styles + `--shop-*` CSS variables; new components follow that. |

## 2. Data model (ERD)

```
users 1───* customer_addresses
users 1───* orders *───1 merchants
                  orders: delivery_type, delivery_latitude/longitude,
                          distance_km, delivery_fee, delivery_address

merchants (+ address, latitude, longitude, delivery_radius_km)
customer_addresses (id, user_id FK, label, address, latitude, longitude,
                    is_default — unique partial index: one default per user)
```

Migration: `supabase/migrations/016_map_delivery.sql`. CHECK constraints keep coordinates in range and `delivery_radius_km` in 0–10. RLS is enabled on `customer_addresses` with no policies — access is via the backend (service role) only, like the rest of the app.

## 3. Pricing (single source of truth)

`backend/app/services/delivery.py` + `_delivery_fee()` in `routes/orders.py`.

```
pickup                         → $0.00
delivery, no pin / shop unset  → DEFAULT_DELIVERY_FEE ($5.00, legacy behaviour)
distance = haversine(shop, pin)            (straight line, 2 dp)
distance > min(shop radius, 10 km)         → 400 "Delivery unavailable for this location"
0–3 km $0.50 · 3–5 km $0.75 · 5–8 km $1.50 · 8–10 km $3.00      (upper bound inclusive)
subtotal ≥ FREE_DELIVERY_THRESHOLD ($50)   → fee waived (existing rule, kept)
```

Tiers live in `app/core/constants.py` (`DELIVERY_FEE_TIERS`). `/orders/quote` and `POST /orders` both go through `_price_cart`, so the fee shown equals the fee charged and the fee in the PayWay QR. The client never sends a fee or a distance — only the pin; the backend recomputes.

Multi-shop carts: each shop is its own order and gets its own distance and fee.

## 4. API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/merchants/nearby?lat&lng&limit` | public | Active shops with a location, nearest first: `distance_km`, `can_deliver`, `delivery_fee` |
| POST | `/api/orders/quote` | user | + `delivery_type`, `lat`, `lng` → per-shop `delivery_fee`, `distance_km`; 400 when out of range |
| POST | `/api/orders` | user | + `delivery_type`, `lat`, `lng`; stores pin, `distance_km`, `delivery_type` |
| GET/POST | `/api/addresses` | user | List / create (max 10; first becomes default) |
| PATCH/DELETE | `/api/addresses/{id}` | user | Edit / delete (own only; deleting the default promotes the newest) |
| PATCH | `/api/merchants/{id}` | admin | + `address`, `latitude`, `longitude`, `delivery_radius_km` |

## 5. Frontend components

```
lib/mapbox.ts            token, getCurrentPosition, reverseGeocode, distanceKm
lib/addresses.ts         address CRUD + fetchNearbyShops
lib/quote.ts             fetchQuote(promo, {delivery_type, lat, lng})
components/map/
  MapPicker.tsx          tap/drag pin, "use my location", optional shop marker (client-only)
  NearbyShops.tsx        "Shops near you" list on the shop home
app/shop/checkout        Delivery|Pickup toggle, saved-address chips, MapPicker, live fee
app/(admin)/merchants    shop address + pin + radius in the merchant form
```

## 6. Wireframes

Customer checkout, step 1:

```
┌ Checkout ───────────────────┐
│ [🛵 Delivery] [ 🏪 Pickup ] │
│ Full name   [____________]  │
│ Phone  +855 [____________]  │
│ Saved: (★Home ×) (Work ×)   │
│ ┌─────────── map ─────────┐ │
│ │        📍               │ │
│ │ [📍 Use my location]    │ │
│ └─────────────────────────┘ │
│ Delivery fee: $0.75 · 4 km  │
│ Full address [___________]  │
│ ☐ Save this address as [Home]│
│            [ Continue ]     │
└─────────────────────────────┘
```

Shop home: `Shops near you` → rows of logo · name · "1.2 km away" · "Delivery $0.50" or "Pickup only".

Merchant dashboard (Merchants → Edit): address input, map with draggable pin, latitude / longitude / delivery-radius fields, fee-table hint.

## 7. Mapbox setup

1. Create a Mapbox account → Tokens → create a **public** token (`pk.…`), restrict to your production domains (+ `localhost`).
2. `frontend/.env.local`: `NEXT_PUBLIC_MAPBOX_TOKEN=pk.…` (and the same variable in Vercel project settings).
3. Without a token the map shows a notice, checkout still works with the default fee, and merchants can type coordinates by hand.
4. Telegram Mini App: location permission is requested by the WebView; the "Use my location" button degrades to tap-to-pin if denied.

## 8. Open decision — order statuses

The spec's statuses are `pending, accepted, preparing, ready_for_pickup, delivering, delivered, cancelled`. Today's are `pending, confirmed, processing, shipped, delivered, cancelled` and they are wired into the transition table, settlement ledger (`delivered` credits the merchant), Telegram notifications, the order timeline and the dashboard. Renaming is a cross-cutting change, so it is **not** in this step. Proposed mapping when you want it: confirmed→accepted, processing→preparing, shipped→delivering, plus a new `ready_for_pickup` (pickup orders go preparing→ready_for_pickup→delivered).

## 9. Rollout order

1. **Apply migration 016 in Supabase first** (the dashboard merchant form and pickup orders write the new columns).
2. Set `NEXT_PUBLIC_MAPBOX_TOKEN`.
3. Each merchant sets address + pin + radius in the dashboard (shops without a pin still work at the default fee and are hidden from "nearby").
4. Deploy backend, then frontend.
5. Next: status rename (§8) → show distance/type in merchant order views and Telegram order messages → saved-address management page in Profile → ETA.

## 10. Extension points

- **Riders:** add `deliveries` (order_id, rider_id, status, timestamps); orders stay the unit of sale. `delivery_type` can gain `rider`.
- **Live tracking:** `delivery_locations` (delivery_id, lat, lng, at) + Supabase realtime; the customer map reuses `MapPicker`'s marker code.
- **Road distance / ETA:** swap `haversine_km` in `services/delivery.py` for the Mapbox Directions Matrix API; nothing else changes.
- **Per-shop pricing:** move `DELIVERY_FEE_TIERS` to a `delivery_tiers` table keyed by merchant.
