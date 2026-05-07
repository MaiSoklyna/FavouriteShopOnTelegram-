"use client";

import { useEffect, useState, useCallback, createContext, useContext, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextValue {
  toast: (message: string, type?: "success" | "error" | "info") => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = ++nextId;
    setItems((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 100, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              padding: "12px 20px",
              borderRadius: 10,
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              animation: "slideIn 0.3s ease",
              background:
                item.type === "success" ? "var(--success)" :
                item.type === "error" ? "var(--danger)" : "var(--info)",
            }}
          >
            {item.message}
          </div>
        ))}
      </div>
      <style>{`@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
