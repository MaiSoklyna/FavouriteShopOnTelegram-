"use client";

import { useState } from "react";
import { CategoryIcon, icons8Url } from "@/components/shop";

interface IconPickerProps {
  value: string;
  onChange: (value: string) => void;
}

const ICONS8_PRESETS = [
  "box", "shop", "shopping-bag", "tag", "store-front",
  "hamburger", "pizza", "coffee-to-go", "cake", "bottle-of-water",
  "t-shirt", "high-heel", "shoes", "watch", "diamond",
  "smartphone", "laptop", "headphones", "camera", "gamepad",
  "lipstick", "perfume", "spa-flower", "salon", "haircut",
  "sofa", "lamp", "broom", "kitchen-room", "potted-plant",
  "soccer-ball", "dumbbell", "bicycle", "tennis-ball", "swimming",
  "book-shelf", "graduation-cap", "ruler-combined", "paint-palette",
  "teddy-bear", "baby-bottle", "stroller", "rattle",
  "car", "motorcycle", "wheelbarrow", "garden",
  "ring", "gold-bars", "wedding-rings",
  "gift", "birthday", "christmas-tree",
  "pet-commands-sit", "cat", "dog",
];

const EMOJI_PRESETS = [
  "🛍️", "🏪", "🛒", "🏷️", "📦",
  "🍔", "🍕", "☕", "🍰", "🥤",
  "👕", "👠", "👟", "⌚", "💎",
  "📱", "💻", "🎧", "📷", "🎮",
  "💄", "🧴", "🌸", "💅", "✂️",
  "🛋️", "💡", "🧹", "🍳", "🪴",
  "⚽", "🏋️", "🚲", "🎾", "🏊",
  "📚", "🎓", "📐", "🎨",
  "🧸", "🍼", "👶", "🪀",
  "🚗", "🏍️", "🚲", "🌱",
  "💍", "🪙", "💐",
  "🎁", "🎂", "🎄",
  "🐾", "🐱", "🐶",
];

export function IconPicker({ value, onChange }: IconPickerProps) {
  const initialMode: "icons8" | "emoji" = value && !/^https?:\/\//i.test(value.trim())
    ? "emoji"
    : "icons8";
  const [mode, setMode] = useState<"icons8" | "emoji">(initialMode);

  return (
    <div>
      {/* Mode switcher */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <ModeTab active={mode === "icons8"} onClick={() => setMode("icons8")}>
          Icons8 URL
        </ModeTab>
        <ModeTab active={mode === "emoji"} onClick={() => setMode("emoji")}>
          Emoji
        </ModeTab>
      </div>

      {/* Live preview */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: 12, borderRadius: 10,
        background: "var(--bg-secondary)", marginBottom: 10,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 10,
          background: "var(--bg-card)", display: "flex",
          alignItems: "center", justifyContent: "center",
          border: "1px solid var(--border)",
        }}>
          <CategoryIcon icon={value} size={32} alt="preview" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Preview</div>
          <div style={{
            fontSize: 12, color: "var(--text)", fontFamily: "monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {value || "(no icon)"}
          </div>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
          >
            Clear
          </button>
        )}
      </div>

      {mode === "icons8" ? (
        <div>
          <input
            className="admin-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://img.icons8.com/fluency/96/box.png"
            style={{ marginBottom: 10 }}
          />
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
            Or pick a preset:
          </p>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))",
            gap: 8, maxHeight: 220, overflowY: "auto", padding: 4,
          }}>
            {ICONS8_PRESETS.map(slug => {
              const url = icons8Url(slug, 48);
              const selected = value === url;
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => onChange(url)}
                  title={slug}
                  style={{
                    width: 48, height: 48, borderRadius: 8,
                    background: selected ? "var(--accent-light, #e8f0ff)" : "var(--bg-card)",
                    border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    padding: 6, transition: "transform 0.15s",
                  }}
                >
                  <img
                    src={url}
                    alt={slug}
                    loading="lazy"
                    style={{ width: 32, height: 32, objectFit: "contain" }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div>
          <input
            className="admin-input"
            value={value && !/^https?:\/\//i.test(value) ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="🛍️"
            style={{ textAlign: "center", fontSize: 22, marginBottom: 10 }}
          />
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
            Or pick a preset:
          </p>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))",
            gap: 6, maxHeight: 220, overflowY: "auto", padding: 4,
          }}>
            {EMOJI_PRESETS.map((emoji, i) => {
              const selected = value === emoji;
              return (
                <button
                  key={`${emoji}-${i}`}
                  type="button"
                  onClick={() => onChange(emoji)}
                  style={{
                    width: 40, height: 40, borderRadius: 8,
                    background: selected ? "var(--accent-light, #e8f0ff)" : "var(--bg-card)",
                    border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: 22, padding: 0,
                  }}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: "8px 12px", borderRadius: 8,
        border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: active ? "var(--accent-light, #e8f0ff)" : "var(--bg-card)",
        color: active ? "var(--accent)" : "var(--text)",
        fontWeight: 600, fontSize: 13, cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
