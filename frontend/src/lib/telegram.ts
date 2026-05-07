/**
 * Telegram WebApp SDK helpers.
 *
 * Wraps window.Telegram.WebApp with type-safe accessors and graceful
 * fallbacks when running outside Telegram (e.g. in a browser for testing).
 */

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
}
