# Map & Delivery — UX redesign

Mobile-first (360 px), Telegram Mini App. Complements `MAP_DELIVERY_ARCHITECTURE.md`
(data + pricing); this file covers what the customer sees.

## 1. Review of the first implementation

| Problem | Why it hurt | Fix |
|---|---|---|
| Map was a flat grey box while loading | Looks broken; no feedback | Shimmer skeleton + bouncing pin + "Loading map…"; failure shows an explanation |
| Shops were plain text rows | No hierarchy; fee and distance not scannable | Cards: logo, name, status pills, three fact chips, one clear action |
| Nothing said which shop is best | Customer compares every row | "Nearest" badge on the closest open shop that delivers |
| Delivery cost/availability buried | Surprise at checkout | Distance, fee and time tiles right under the address; blocked with a reason when unavailable |
| Delivery/Pickup was two small buttons | Easy to miss, small targets | Two large radio cards (≥ 84 px) |
| Total only visible on the last step | Price anxiety | Sticky bar (or Telegram MainButton) shows the total on every step |
| "0 m away" | Meant the customer was exactly on the shop's pin | Shown as "< 50 m"; the math itself was correct |

## 2. Component hierarchy

```
shop/page.tsx
└─ NearbyShops                     components/map/NearbyShops.tsx
   ├─ StateCard (idle | denied | error | empty)
   │   └─ ManualAddress            (denied: type an address instead)
   ├─ ShopCardSkeleton ×2          (loading)
   └─ ShopCard ×n                  logo/initials · pills · chips · "View shop"

shop/checkout/page.tsx
├─ TopBar · progress steps
├─ Step 1  Delivery method (radio cards) → Contact → Pickup location | Delivery address
│          Delivery address: saved chips · [Use my location] [Choose on map]
│                            └─ MapPicker (lazy, opens on demand)
│                            └─ DeliveryInfo  (distance · fee · time | unavailable | prompt)
│          Note → Order summary
├─ Step 2  Payment   · Step 3 Review   · Step 4 KHQR
├─ Blockers                        closed shop / below minimum order
└─ BottomBar (browser)  |  Telegram MainButton ("Place order · $12.75")

components/map/MapPicker.tsx
├─ MapSkeleton · customer pin (pulse) · shop pin (logo) · radius circle
├─ route line · distance chip ("📍 3.2 km from ITE_Store" / "⚠️ Too far to deliver")
└─ unavailable fallback (no token, auth error, 15 s stall) — checkout still works
```

## 3. Wireframes (360 px)

Nearby shop card

```
┌──────────────────────────────────────┐
│ [IS]  ITE_Store  NEAREST  OPEN       │
│       ★ 4.8 (12) · Gadgets & tech    │
│                                      │
│ (📍 300 m away) (🚚 $0.50) (⏱ 10–20)│
│ ┌──────────────────────────────────┐ │
│ │            View shop             │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
 closed → whole card at 60 %, red CLOSED pill, listed last
 too far → red chip "🏪 Pickup only · too far to deliver"
```

Checkout step 1 (delivery)

```
Delivery method
┌───────────────┐ ┌───────────────┐
│ 🛵        (●) │ │ 🏪        ( ) │
│ Delivery      │ │ Pickup        │
│ To your door  │ │ Collect · Free│
└───────────────┘ └───────────────┘
┌ Contact ─────────────────────────┐
│ Full name / Phone                │
└──────────────────────────────────┘
┌ 📍 Delivery address ─────────────┐
│ (🏠 Home) (★ Work) →             │  saved chips, scroll sideways
│ [🎯 Use my location][🗺 Choose on map]
│ ┌ map 260 px ────────────────────┐
│ │ ◎ radius   📍 pin ‑‑‑‑ 🏪 shop │
│ └────────────────────────────────┘
│ Address [ Street 123, Phnom Penh ]│
│ ┌Distance──┐┌Delivery fee┐┌Est. time┐
│ │ 3.2 km   ││ $0.75      ││ 20–30 m ││   green tiles
│ └──────────┘└────────────┘└─────────┘
└──────────────────────────────────┘
Order summary: Products / Delivery / Total
════════════════════════════════════
 Total $12.75          [  Continue  ]      ← sticky / MainButton
```

States: loading (skeleton cards, skeleton map) · empty ("No shops nearby" + Refresh) ·
denied ("Location is off" + Try again + type an address) · error + Retry ·
unavailable (red card: reason, "Move the pin closer, or switch to Pickup") ·
blocked (shop closed / minimum order not met).

## 4. Design tokens

The shop UI already themes through `--shop-*` CSS variables with a light and dark set
(`globals.css`); the redesign reuses them so it matches the rest of the app and follows
dark mode (in Telegram, `colorScheme` drives `data-theme` unless the customer chose one).

| Role | Variable | Light | Dark |
|---|---|---|---|
| Primary / actions | `--shop-primary` | #71541A | #D6BA80 |
| Primary tint (selected, soft buttons) | `--shop-primary-tint` | 10 % primary | 12 % |
| Text | `--shop-black` / `--shop-text` / `--shop-muted` | #081D3C / #081D3C / #746D6D | #EAEFF3 / #D6DDE6 / 50 % |
| Surface / page / divider | `--shop-surface` / `--shop-bg` / `--shop-divider` | #FFF / #EAEFF3 / #EAEFF3 | #132744 / #0A1628 / #1A3052 |
| **Success** (fee, open) | `--shop-success(-tint)` | #1B7F46 | #4ADE80 |
| **Warning** (rating) | `--shop-warning(-tint)` | #B45309 | #FBBF24 |
| **Danger** (closed, too far) | `--shop-danger(-tint)` | #C62828 | #F87171 |
| Radius | `--shop-r-card` 8 · `--shop-r-input` 20 · pill 999 | | |

Map: Mapbox `light-v11` (muted roads, few POIs), primary-coloured pin/radius/route.
For a fully branded look, create a style in Mapbox Studio and set `MAP_STYLE` in `lib/mapbox.ts`.

## 5. Typography

Inherited app font (Kantumruy Pro / Inter). Scale used by these screens:

| Use | Size / weight |
|---|---|
| Card title, section title | 15 / 700 |
| Total in bar | 19 / 700 |
| Body, buttons | 14 / 600–700 |
| Chips, helper text | 12 / 600 |
| Pills (OPEN, NEAREST) | 10 / 700 uppercase |

Touch targets ≥ 44 px (chips and buttons use `minHeight` 40–50, radio cards 84).

## 6. Tailwind equivalents

The shop screens use inline styles + CSS variables (Tailwind is installed but unused
there), so the components follow that. If the team moves them to Tailwind, map the
variables in `tailwind.config.js` (`colors: { primary: "var(--shop-primary)", … }`):

```tsx
// Shop card
<a className="block rounded-lg bg-surface p-3.5 shadow-card shop-press border-[1.5px] border-primary">
  <div className="flex items-center gap-3">
    <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-tint font-bold text-primary">IS</div>
    <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-bold">ITE_Store</p></div>
  </div>
  <div className="mt-3 flex flex-wrap gap-2">
    <span className="rounded-full bg-bg px-2.5 py-1 text-xs font-semibold">📍 300 m away</span>
    <span className="rounded-full bg-success-tint px-2.5 py-1 text-xs font-semibold text-success">🚚 $0.50</span>
  </div>
  <div className="mt-3 grid min-h-[44px] place-items-center rounded-[20px] bg-primary font-bold text-white">View shop</div>
</a>
```

## 7. Motion

Short and subtle: `shop-fade-up` (0.4 s) on cards, `shop-press` scale on tap, skeleton
shimmer 1.4 s, pin bounce 1 s, customer-pin pulse 1.8 s. All disabled under
`prefers-reduced-motion`. Telegram haptics: selection on toggles/card taps, success/error
on location, validation and order results.
