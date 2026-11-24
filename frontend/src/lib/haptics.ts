/** Telegram haptic tap, if the Mini App SDK provides it; silently nothing in a normal browser. */
export function lightHaptic(): void {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
  } catch { /* haptics are decoration */ }
}
