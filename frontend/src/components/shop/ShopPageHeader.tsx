"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

interface ShopPageHeaderProps {
  title: string;
  showBack?: boolean;
  rightAction?: ReactNode;
}

export function ShopPageHeader({ title, showBack = true, rightAction }: ShopPageHeaderProps) {
  const router = useRouter();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 56,
        padding: "0 16px",
        position: "sticky",
        top: 0,
        background: "var(--shop-surface, #FFFFFF)",
        borderBottom: "1px solid var(--shop-divider, #ECEEF3)",
        zIndex: 10,
      }}
    >
      {showBack && (
        <button
          onClick={() => router.back()}
          style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "transparent", border: "none",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--shop-black, #0B0B0F)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <h1 style={{ flex: 1, fontSize: 17, fontWeight: 600, color: "var(--shop-black, #0B0B0F)", margin: 0 }}>{title}</h1>
      {rightAction}
    </div>
  );
}
