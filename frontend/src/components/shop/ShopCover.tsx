import { Icon } from "./Icon";
import { THEMES, type ShopTheme } from "@/lib/shopTheme";

// Where the five cover icons sit (% of the cover), how big and how tilted — one hero icon on the right.
const SPOTS = [
  { left: 64, top: 18, size: 64, rotate: -10, opacity: 0.55 },
  { left: 12, top: 14, size: 26, rotate: 12, opacity: 0.35 },
  { left: 38, top: 52, size: 30, rotate: -16, opacity: 0.4 },
  { left: 86, top: 64, size: 22, rotate: 18, opacity: 0.35 },
  { left: 22, top: 70, size: 18, rotate: -6, opacity: 0.3 },
];

/**
 * Cover photo, or generated art for the shop's category when it has none:
 * theme colour, a soft halo and the category's line icons scattered across.
 */
export function ShopCover({ url, theme, className = "" }: { url?: string | null; theme: ShopTheme; className?: string }) {
  if (url) return <img src={url} alt="" loading="lazy" className={`h-full w-full object-cover ${className}`} />;
  const t = THEMES[theme];
  return (
    <div className={`fos-gen-cover relative h-full w-full overflow-hidden ${className}`} style={{ background: t.bg, color: t.ink }} aria-hidden="true">
      <span className="absolute -right-8 -top-10 h-40 w-40 rounded-full" style={{ background: "rgba(255,255,255,0.45)" }} />
      <span className="absolute -bottom-12 -left-6 h-32 w-32 rounded-full" style={{ background: "rgba(255,255,255,0.3)" }} />
      {t.icons.map((name, i) => {
        const s = SPOTS[i];
        return (
          <span key={name + i} className="absolute" style={{ left: `${s.left}%`, top: `${s.top}%`, opacity: s.opacity, transform: `translate(-50%, 0) rotate(${s.rotate}deg)` }}>
            <Icon name={name} size={s.size} strokeWidth={1.6} />
          </span>
        );
      })}
    </div>
  );
}
