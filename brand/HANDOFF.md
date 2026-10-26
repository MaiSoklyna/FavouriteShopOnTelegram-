# Byme24 brand rollout — handoff for Claude Code

The icon system lives in `brand/` (source) and is copied to `frontend/public/brand/` (served at `/brand/...`).
Showcase page with every spec: `brand/index.html` (published: https://claude.ai/artifact/2GoDfdYirf5jpMJbvpz17R).

## Task: replace the current visuals with the Byme24 system in `frontend/` (Next.js)

1. **Favicon / app icon** — in `frontend/src/app/layout.tsx` set Next `metadata.icons`:
   `icon: "/brand/favicon.svg"`, `apple: "/brand/app-icon.svg"`. Add a PNG 180×180 apple-touch export if needed.
2. **Spinner** — rewrite `frontend/src/components/ui/Spinner.tsx` so `Spinner` renders the knot symbol
   (paths from `brand/symbol.svg`) with the **Rotate** animation: three 120° steps per 2.4s,
   `cubic-bezier(.65,0,.35,1)`, `transform-origin: 50% 58%`. Keep the `size` prop and the `FullPageSpinner` export
   (navy #081D3C background + gold progress sweep, as in the "Loading screen" mock). Stop animation under
   `prefers-reduced-motion`. Add `pulse` and `glow` variants via a `variant` prop.
3. **Icons** — create `frontend/src/components/brand/Icons.tsx` with React components `StoreIcon`, `PromoIcon`,
   `OrdersIcon`, `RewardsIcon`, `DeliveryIcon`, `EmptyStateIcon`, `SuccessIcon` from `brand/icons.svg`
   (`stroke="currentColor"`, 24px default). Replace the matching lucide/emoji icons in the shop nav, orders,
   promotions, rewards and delivery screens.
4. **Empty / success states** — use `EmptyStateIcon` for empty cart / no orders / no shops, and `SuccessIcon`
   (with glow) on the order-placed screen.
5. **Colours** — add tokens `--brand-navy:#081D3C; --brand-gold:#D6BA80; --brand-gold-dark:#71541A` to `globals.css`.

## Rules
- Push the feature branch only; never merge to main (the user merges).
- Verify in the browser (shop pages + admin) before committing.
