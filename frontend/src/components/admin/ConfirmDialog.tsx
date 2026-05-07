"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "primary";
  loading?: boolean;
}

export function ConfirmDialog({
  open, onClose, onConfirm, title = "Confirm",
  message, confirmLabel = "Confirm", variant = "danger", loading,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} maxWidth={400}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>
          {variant === "danger" ? "⚠️" : "❓"}
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{title}</h2>
        <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>{message}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="outline" onClick={onClose} style={{ flex: 1 }}>Cancel</Button>
          <Button variant={variant} onClick={onConfirm} loading={loading} style={{ flex: 1 }}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}
