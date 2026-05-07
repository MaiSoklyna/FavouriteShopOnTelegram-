"use client";

import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  maxWidth?: number;
  children: ReactNode;
}

export function Modal({ open, onClose, title, maxWidth = 520, children }: ModalProps) {
  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.5)", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: 16, padding: 24, width: "100%", maxWidth,
          maxHeight: "90vh", overflow: "auto", boxShadow: "var(--shadow-xl)",
          animation: "modalIn 0.2s ease",
        }}
      >
        {title && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{title}</h2>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-muted)", padding: 4 }}
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
      <style>{`@keyframes modalIn{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", background: "var(--bg-card)", borderRadius: "24px 24px 0 0",
          padding: 24, paddingBottom: "max(24px, env(safe-area-inset-bottom))",
          animation: "sheetIn 0.25s ease",
        }}
      >
        {title && <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>{title}</h3>}
        {children}
      </div>
      <style>{`@keyframes sheetIn{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}
