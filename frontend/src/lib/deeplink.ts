/**
 * Telegram deep links to a product or a shop.
 *
 *   https://t.me/<bot>?startapp=p_123   opens the Mini App straight on product 123
 *   https://t.me/<bot>?startapp=s_45    opens the Mini App on shop 45
 *
 * Telegram passes the value to the Mini App as `start_param` (initDataUnsafe.start_param, and as
 * `tgWebAppStartParam` in the page URL). `useDeepLinkRouter` sends the customer to the right page.
 * The same values work as `?start=` chat links, answered by the bot (backend/app/services/deeplinks.py).
 */

export const BOT_USERNAME = (process.env.NEXT_PUBLIC_BOT_USERNAME || "byme24_bot").replace(/^@/, "");

export type DeepLinkKind = "product" | "shop";
const PREFIX: Record<DeepLinkKind, string> = { product: "p", shop: "s" };

export function telegramLink(kind: DeepLinkKind, id: number): string {
  return `https://t.me/${BOT_USERNAME}?startapp=${PREFIX[kind]}_${id}`;
}
export const productLink = (id: number) => telegramLink("product", id);
export const shopLink = (id: number) => telegramLink("shop", id);

/** "p_123" -> "/shop/product/123", "s_45" -> "/shop/merchant/45"; anything else -> null. */
export function pathForStartParam(param: string | null | undefined): string | null {
  const m = /^(p|s)_([1-9]\d{0,9})$/.exec((param || "").trim());
  if (!m) return null;
  return m[1] === "p" ? `/shop/product/${m[2]}` : `/shop/merchant/${m[2]}`;
}

/** The start parameter Telegram opened the Mini App with, if any. */
export function readStartParam(): string | null {
  if (typeof window === "undefined") return null;
  const fromSdk = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (fromSdk) return fromSdk;
  const fromQuery = new URLSearchParams(window.location.search).get("tgWebAppStartParam");
  if (fromQuery) return fromQuery;
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  return new URLSearchParams(hash).get("tgWebAppStartParam");
}

const HANDLED_KEY = "deeplink:handled";

/**
 * Where to go for the start parameter, once per Mini App session: going back to Home after
 * following a link must not send the customer to the product again.
 */
export function takeDeepLinkPath(): string | null {
  const param = readStartParam();
  const path = pathForStartParam(param);
  if (!path) return null;
  try {
    if (sessionStorage.getItem(HANDLED_KEY) === param) return null;
    sessionStorage.setItem(HANDLED_KEY, param!);
  } catch { /* storage blocked: following the link is still right */ }
  return path;
}

/** Copy a link, falling back to the share sheet or a prompt-free no-op. True if copied. */
export async function copyLink(url: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(url); return true; } catch { return false; }
}

export type ShareResult = "telegram" | "native" | "copied" | "failed";

/**
 * Share a product or shop link the best way available:
 * - inside Telegram: the "send to a chat" picker (t.me/share/url), so it lands in a chat as a link that
 *   opens the Mini App;
 * - elsewhere: the phone's share sheet, or copy the link.
 */
export async function shareLink(url: string, text: string): Promise<ShareResult> {
  if (typeof window === "undefined") return "failed";
  text = text.replace(/\s+/g, " ").trim(); // names and taglines may carry stray spaces and line breaks
  const tg = window.Telegram?.WebApp;
  if (tg?.initData && tg.openTelegramLink) {
    try {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
      return "telegram";
    } catch { /* older clients: fall through */ }
  }
  if (navigator.share) {
    try { await navigator.share({ title: text, text, url }); return "native"; }
    catch (e) { if ((e as Error)?.name === "AbortError") return "native"; }
  }
  return (await copyLink(url)) ? "copied" : "failed";
}
