# Shared components — build in `frontend/src/components/shop/`

| Component | Size | Spec |
|---|---|---|
| `ProductCard` | 168×276 (grid: 165.5w) | white, r20, shadow-md, overflow hidden. Image 1:1 on tinted bg. Top-left discount badge (mango pill, 11/800 white). Top-right heart 30² white 90%. Bottom-right of image: add button 32² r12 navy-900 "+". Body pad 10/12/12: name 13/600 1 line ellipsis, `PriceTag`, `RatingPill` + sold pill |
| `PriceTag` | — | USD 17–18/800 tabular-nums; KHR 11px ink-500 below; optional strike-through old price |
| `ShopCard` | 280×214 | r24, shadow-md. Cover 280×120 (7:3). Logo 52² r16 white 3px border overlapping −28px. Name 16/800 + verified ✓. Pills: ★ rating · distance · "Free delivery" (jade tint) · "Open" (mango tint) |
| `CategoryIcon` | 64² + label | r22, product photo on tinted bg, label 11/700 |
| `CategoryTile` | 3:4 | r20, photo full-bleed, scrim bottom 45%→navy 75%, label 14/800 white bottom-left |
| `Badge` / `Pill` | h 20–24 | r999, 11/700. Variants: neutral `#F1F4F8`, jade `#E7F8EF/#067647`, mango `#FFF1E6/#B54708`, gold `#FBF4E4/gold-700` |
| `SectionHeader` | h 30 | title 17/800 + optional extra (timer) + arrow button 30² round white shadow-sm |
| `HeroCarousel` | 343×176 | see HOME_SPEC |
| `TabBar` | 375×84 | see HOME_SPEC |
| `Skeleton` | matches parent | `#E3E8EF → #F6F8FB` shimmer 1.4s linear |
| `EmptyState` | illustration 200² | + one-line title + one button |

## Interaction
- Press: `scale(.97)` 100ms on all cards/buttons
- Add to cart: cart badge bump to 1.35 and back, 240ms
- Heart: spring pop 320ms
- Use Telegram `HapticFeedback.impactOccurred('light')` on add-to-cart if available
