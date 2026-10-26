# Favourite Of Shop — Design Handoff (for Claude Code)

This folder contains the approved visual direction "Night Market Premium".
It is a **spec only**. Nothing in `frontend/` has been changed yet.

## How to use it from the terminal

From the repo root, run `claude` and paste:

```
Read design-handoff/README.md and every file in design-handoff/.
Then implement step 1 (tokens) and step 2 (Home screen) in frontend/ exactly as specified.
Keep existing data fetching and routes; change only presentation.
Run the type-check when done and show me the diff.
```

## Files

| File | What it is |
|---|---|
| `tokens.css` | CSS custom properties: colors, gradients, radius, shadow, spacing, type |
| `tailwind.tokens.ts` | Same tokens as a Tailwind `theme.extend` block |
| `HOME_SPEC.md` | Home screen: layout, component sizes, image ratios, spacing |
| `COMPONENTS.md` | Shared components to build (ProductCard, ShopCard, TabBar…) |
| `visual-reference.html` | Open in a browser: moodboard + phone mockups of Home, Product, Cart, Checkout |

## Implementation order

1. **Tokens.** Import `tokens.css` in the shop layout's global CSS. Merge `tailwind.tokens.ts` into `frontend/tailwind.config.ts` under `theme.extend`. Load fonts Manrope (400–800) and Kantumruy Pro (400–700) via `next/font/google`.
2. **Home screen** `frontend/src/app/shop/page.tsx`. Follow `HOME_SPEC.md`.
3. **Shared components** in `frontend/src/components/shop/`. Follow `COMPONENTS.md`.
4. Later: Product → Cart → Checkout (mockups are in `visual-reference.html`, sections 12–14).

## Rules (non-negotiable)

- Images and visuals take ≥ 70% of the screen; text ≤ 30%.
- No text block longer than one line. Turn it into an icon, chip, badge or image.
- Prices: USD large (`$12.90`), KHR below as a caption (`៛52,900`). Use `tabular-nums`.
- Side gutter 16px. Section gap 24px. Touch targets ≥ 44px.
- Replace gray `#746D6D` with `ink-500 #5B6472` everywhere (contrast).
- Mango `#FF7A1A` only for deals, discount badges and the Pay button.
- Respect `prefers-reduced-motion`.
- Do not change backend calls, Supabase queries or routes.
