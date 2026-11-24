# Home screen spec — `frontend/src/app/shop/page.tsx`

Frame: 375×812, background `surface #F6F8FB`. Vertical stack, side padding 16.
Visual reference: `visual-reference.html` section 11.

## Layout (top → bottom)

| # | Block | Size / style | Notes |
|---|---|---|---|
| 1 | **TopBar** | h 56, pad 4/16/10, space-between | Left: LocationChip (pin icon in 32² r12 mango-tint `#FFF1E6` box + area name 15/800 + ▾). Right: bell IconButton 40² r14 white, shadow-sm, mango dot 8px when unread |
| 2 | **SearchBar** | 343×48, r16, white, shadow-sm | Search icon 20, placeholder "Search", camera button 32² r10 `#F1F4F8` on the right. Sticky on scroll |
| 3 | **HeroCarousel** | 343×176, r24, mt 14 | Use admin `banners` data. Image full-bleed + `grad-hero` fallback. Text max 2 items: small gold label (12/700) + big number/word (30/800). One white pill CTA "Shop now". Dots bottom-left (active 18×6, others 6×6). Auto-swipe 5s. Export art 1029×528 |
| 4 | **CategoryGrid** | 4 columns, gap 14 row / 8 col, mt 18 | 8 items. Each: photo 64×64 r22 (category image, tinted bg) + label 11/700, one word |
| 5 | **Flash deals** | SectionHeader h 30, mt 22 | "⚡ Flash" + countdown (3 navy boxes, 11px white, r6) + round arrow button 30² |
| 6 | Flash rail | horizontal scroll, gap 10 | FlashCard 128×196: image 128² + mango discount badge top-left + price 15/800 + progress bar 6h (`grad-promo`) + "82% sold" 10/700 `#B54708` |
| 7 | **Shops near you** | SectionHeader + rail | ShopCard 280×214 (see COMPONENTS.md). Sort by distance from saved address |
| 8 | **Promo strip** | 343×96, r24, `grad-promo` | Icon + one line ("Free delivery over $15") |
| 9 | **For you** | 2-col grid, gap 12 | ProductCard 165.5 wide, image 1:1. Infinite scroll with skeletons |
| 10 | **TabBar** | fixed, 375×84, white 86% + backdrop-blur 20, border-top `line` | 5 tabs: Home · Shop · **Cart (center 56² r20, `grad-cta`, raised −22px, mango count badge)** · Orders · Me. Icons 24, stroke 1.8, labels 10/700. Active = `navy-700`. Add `env(safe-area-inset-bottom)` |

## Hierarchy (what the eye hits first)
1. Hero number · 2. Category photos · 3. Flash timer · 4. Prices · 5. Location

## Remove from current Home
- Any paragraph / welcome text
- Text-only category lists
- "View all" text links → arrow button
- Gray `#746D6D` text

## States
- Loading: shimmer skeletons matching each block's exact size
- Empty For-you: illustration 200² + one button
- No location yet: LocationChip reads "Set location" and opens the map pin picker

## Acceptance
- Text ≤ 30% of first viewport
- No horizontal page scroll at 360px width
- Every tap target ≥ 44px
- Prices show USD + KHR caption
