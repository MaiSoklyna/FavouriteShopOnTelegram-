"use client";

import { useEffect, useRef, useState } from "react";

/** Emoji only: product cards show the icon as text, so image icons (the category IconPicker) don't fit. */
const GROUPS: { label: string; emojis: string[] }[] = [
  { label: "Food & drink", emojis: ["🍰", "🎂", "🧁", "🍪", "🍩", "🍫", "🍬", "🍔", "🍕", "🍜", "🍣", "🥗", "🍞", "🥐", "🍗", "🍎", "🍓", "🥭", "🥥", "☕", "🧋", "🥤", "🍵", "🍺"] },
  { label: "Fashion", emojis: ["👕", "👚", "👗", "👖", "🧥", "👔", "🩳", "👙", "👠", "👟", "👞", "👜", "👛", "🎒", "🧢", "👒", "🧣", "🧦", "💍", "💎", "⌚", "🕶️"] },
  { label: "Beauty & health", emojis: ["💄", "💅", "🧴", "🧼", "🪥", "🌸", "🌹", "🌷", "💐", "🌿", "💊", "🩹", "🧪", "🪞"] },
  { label: "Electronics", emojis: ["📱", "💻", "🖥️", "⌨️", "🖱️", "🎧", "🎮", "📷", "🔌", "🔋", "💡", "📺", "🔊", "⏰"] },
  { label: "Home & other", emojis: ["📦", "🛍️", "🎁", "🏷️", "🛋️", "🛏️", "🪴", "🧹", "🍳", "🧸", "📚", "✏️", "⚽", "🚲", "🐶", "🐱", "⭐", "❤️"] },
];

export function EmojiPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" className="admin-input" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        data-testid="emoji-picker" title="Choose an icon"
        style={{ width: "100%", textAlign: "center", fontSize: 20, cursor: "pointer", color: value ? undefined : "var(--text-muted)" }}>
        {value || <span style={{ fontSize: 13 }}>Choose</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Choose an icon"
          style={{ position: "absolute", zIndex: 60, top: "calc(100% + 6px)", right: 0, width: 300, maxHeight: 320, overflowY: "auto",
            background: "var(--card, #fff)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.15)", padding: 10 }}>
          {GROUPS.map((g) => (
            <div key={g.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", margin: "2px 2px 4px" }}>{g.label}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
                {g.emojis.map((e) => (
                  <button key={e} type="button" onClick={() => { onChange(e); setOpen(false); }} aria-label={e}
                    style={{ fontSize: 20, lineHeight: "32px", height: 32, borderRadius: 8, border: "none", cursor: "pointer",
                      background: e === value ? "var(--accent-soft, #E8F0FF)" : "transparent" }}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {value && (
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}
              style={{ width: "100%", marginTop: 4, padding: "6px 0", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 12 }}>
              No icon
            </button>
          )}
        </div>
      )}
    </div>
  );
}
