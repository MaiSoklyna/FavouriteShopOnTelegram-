/**
 * Telegram WebApp SDK helpers.
 *
 * Wraps window.Telegram.WebApp with type-safe accessors and graceful
 * fallbacks when running outside Telegram (e.g. in a browser for testing).
 */

import { useEffect, useRef, useState } from "react";

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: TelegramUser;
    auth_date?: number;
    hash?: string;
  };
  ready: () => void;
  expand: () => void;
  close: () => void;
  MainButton: {
    text: string;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    isVisible: boolean;
  };
  HapticFeedback: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
  colorScheme: "light" | "dark";
  viewportHeight: number;
  viewportStableHeight: number;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/**
 * Get the Telegram WebApp instance, or null if not in Telegram.
 */
export function getTelegram(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/**
 * Get the current Telegram user from initDataUnsafe, or null.
 */
export function getTelegramUser(): TelegramUser | null {
  return getTelegram()?.initDataUnsafe?.user ?? null;
}

/**
 * Returns true if running inside a Telegram Mini App.
 */
export function isInTelegram(): boolean {
  return getTelegram() !== null && !!getTelegram()?.initData;
}

let telegramInitialized = false;

/**
 * Initialize the Telegram WebApp (call ready + expand). Idempotent — safe
 * to call multiple times across components/effects.
 */
export function initTelegram(): void {
  if (telegramInitialized) return;
  const tg = getTelegram();
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    telegramInitialized = true;
  } catch {
    // Older Telegram clients may not support all methods — fail silent.
  }

  // Follow Telegram's light/dark scheme, unless the customer picked a theme in the app
  const applyScheme = () => {
    try {
      if (!localStorage.getItem("theme")) document.documentElement.setAttribute("data-theme", tg.colorScheme);
    } catch { /* storage blocked — keep the default theme */ }
  };
  applyScheme();
  try { tg.onEvent("themeChanged", applyScheme); } catch { /* older client */ }
}

type HapticKind = "light" | "medium" | "success" | "error" | "warning" | "select";

/** Short vibration on key actions. A no-op outside Telegram or on clients without haptics. */
export function haptic(kind: HapticKind = "light"): void {
  try {
    const h = getTelegram()?.HapticFeedback;
    if (!h) return;
    if (kind === "success" || kind === "error" || kind === "warning") h.notificationOccurred(kind);
    else if (kind === "select") h.selectionChanged();
    else h.impactOccurred(kind);
  } catch { /* haptics are decoration — never break the action */ }
}

/**
 * Drive Telegram's native MainButton (the big button at the bottom of the
 * screen). Returns true when it is in use, so the page can hide its own
 * fallback button; false in a normal browser.
 */
export function useMainButton(opts: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  visible?: boolean;
}): boolean {
  const { text, onClick, disabled, loading, visible = true } = opts;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const [active, setActive] = useState(false);

  useEffect(() => {
    const tg = getTelegram();
    // initData is empty when the page is merely opened in a browser that has the SDK loaded
    if (!tg?.MainButton || !tg.initData) { setActive(false); return; }
    const handler = () => { haptic("light"); onClickRef.current(); };
    tg.MainButton.onClick(handler);
    setActive(true);
    return () => { tg.MainButton.offClick(handler); tg.MainButton.hide(); };
  }, []);

  useEffect(() => {
    const mb = getTelegram()?.MainButton;
    if (!mb || !active) return;
    if (!visible) { mb.hide(); return; }
    mb.show();
    mb.text = text;
    if (disabled) mb.disable(); else mb.enable();
    if (loading) mb.showProgress(false); else mb.hideProgress();
  }, [active, visible, text, disabled, loading]);

  return active;
}
