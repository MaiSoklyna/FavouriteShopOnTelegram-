/**
 * Display-only price helpers. The shop charges in USD; the KHR line under a
 * price is a caption for convenience, never what the customer is billed.
 *
 * The rate is not stored anywhere in the system. 4,100 ៛/$ is the rate the
 * design handoff's examples use ($12.90 → ៛52,900); set NEXT_PUBLIC_KHR_RATE
 * to change it.
 */
export const KHR_PER_USD = Number(process.env.NEXT_PUBLIC_KHR_RATE) || 4100;

/** Free-delivery threshold shown in the Home promo strip. Mirrors the backend's FREE_DELIVERY_THRESHOLD. */
export const FREE_DELIVERY_OVER_USD = 50;

export const formatUsd = (usd: number) => `$${Number(usd).toFixed(2)}`;

/** "៛52,900" — rounded to the nearest 100 ៛ like a price tag would show. */
export const formatKhr = (usd: number) =>
  `៛${(Math.round((Number(usd) * KHR_PER_USD) / 100) * 100).toLocaleString("en-US")}`;
