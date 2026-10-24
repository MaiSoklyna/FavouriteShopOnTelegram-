"use client";

import { useEffect } from "react";
import { Skeleton } from "./Skeleton";
import { Icon } from "./Icon";
import { formatKhr } from "@/lib/currency";

export interface KhqrData {
  qr_image?: string;
  amount?: string | number;
  deeplink?: string;
  order_code?: string;
  expires_in?: number;
  payment_status?: string;
}

/** PayWay QRs live 15 minutes unless the backend says otherwise. */
const QR_LIFETIME = 900;

/**
 * The KHQR card from the handoff: red header, 260² QR with a quiet zone, amount
 * with the KHR caption, a countdown ring, then Open ABA Mobile / Save QR. When
 * the QR expires it fades and offers a new one.
 */
export function KhqrCard({ data, loading, error, timer, onRetry }: {
  data: KhqrData | null; loading: boolean; error?: string; timer: number; onRetry: () => void;
}) {
  const left = Math.max(timer, 0);
  const expired = !!data && left <= 0;
  const lifetime = data?.expires_in || QR_LIFETIME;
  const mmss = `${Math.floor(left / 60)}:${(left % 60).toString().padStart(2, "0")}`;
  const C = 2 * Math.PI * 15;
  const amount = data?.amount != null ? Number(data.amount) : null;
  const fileName = `KHQR-${data?.order_code || "order"}.png`;

  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-sheet bg-card text-ink-900 shadow-fos-lg">
      <div className="flex h-[34px] items-center justify-center gap-1.5 bg-[#E1232E] text-[14px] font-extrabold tracking-[.06em] text-white">
        KHQR
      </div>
      <div className="p-4">
        <div className="relative mx-auto h-[260px] w-[260px]">
          {loading ? (
            <Skeleton className="h-full w-full rounded-thumb" />
          ) : data?.qr_image ? (
            <>
              <img src={data.qr_image} alt="KHQR code" className={`h-full w-full object-contain transition-opacity duration-300 ${expired ? "opacity-15" : ""}`} />
              {expired && (
                <button type="button" onClick={onRetry}
                  className="fos-press absolute inset-0 m-auto flex h-12 w-40 items-center justify-center gap-2 rounded-full bg-navy-700 text-[14px] font-extrabold text-white shadow-fos-cta">
                  <Icon name="clock" size={18} strokeWidth={2.2} />New QR
                </button>
              )}
            </>
          ) : (
            <div className="grid h-full place-items-center rounded-thumb bg-surface p-6 text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-tint-ruby text-ruby-500"><Icon name="alert" size={24} /></span>
                <p className="mt-2 text-[14px] font-bold text-ink-900">{error || "Could not create the QR"}</p>
                <button type="button" onClick={onRetry} className="fos-press mt-3 h-10 rounded-full bg-navy-700 px-5 text-[13px] font-extrabold text-white">Try again</button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div>
            <div className="text-[26px] font-extrabold leading-8 tabular-nums">{amount != null ? `$${amount.toFixed(2)}` : "…"}</div>
            {amount != null && <div className="text-caption tabular-nums text-ink-500">{formatKhr(amount)}</div>}
          </div>
          {data && (
            <span className={`flex items-center gap-1.5 text-[13px] font-extrabold tabular-nums ${expired ? "text-ruby-500" : "text-ink-900"}`}
              aria-label={expired ? "QR expired" : `Expires in ${mmss}`}>
              <svg width="28" height="28" viewBox="0 0 36 36" aria-hidden>
                <circle cx="18" cy="18" r="15" fill="none" stroke="#E3E8EF" strokeWidth="4" />
                <circle cx="18" cy="18" r="15" fill="none" stroke={left < 60 ? "#E5484D" : "#FF7A1A"} strokeWidth="4" strokeLinecap="round"
                  transform="rotate(-90 18 18)" strokeDasharray={C} strokeDashoffset={C * (1 - left / lifetime)}
                  className="transition-[stroke-dashoffset] duration-1000 ease-linear" />
              </svg>
              {expired ? "Expired" : mmss}
            </span>
          )}
        </div>

        {data && !expired && (
          <p className="mt-2 flex items-center gap-2 text-caption text-ink-500">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-jade-500 opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-jade-500" />
            </span>
            Waiting for payment · updates by itself
          </p>
        )}

        {data?.qr_image && !expired && (
          <div className="mt-4 flex gap-2.5">
            {data.deeplink && (
              <a href={data.deeplink} className="fos-press flex h-[52px] flex-1 items-center justify-center rounded-thumb bg-grad-promo text-[15px] font-extrabold text-white">
                Open ABA Mobile
              </a>
            )}
            <a href={data.qr_image} download={fileName}
              className={`fos-press flex h-[52px] items-center justify-center gap-1.5 rounded-thumb bg-surface text-[14px] font-extrabold text-navy-700 ${data.deeplink ? "w-[112px]" : "flex-1"}`}>
              <Icon name="download" size={18} strokeWidth={2.2} />Save QR
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

const CONFETTI = ["#FF7A1A", "#12B76A", "#D6BA80", "#1B4B8A", "#E5484D", "#FFB547"];

/**
 * Full-screen "Paid" moment: jade check, confetti, amount and ETA. Moves on by
 * itself after `autoMs`, or straight away from the button.
 */
export function PaidSuccess({ amount, eta, note, cta = "View order", onDone, autoMs = 2600 }: {
  amount?: number | null; eta?: string | null; note?: string; cta?: string; onDone: () => void; autoMs?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, autoMs);
    return () => clearTimeout(t);
  }, [onDone, autoMs]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-[linear-gradient(160deg,rgb(var(--fos-c-tint-jade)),rgb(var(--fos-c-card))_60%)] px-gutter text-center"
      role="status" aria-live="polite">
      <div className="pointer-events-none absolute inset-x-0 top-1/3 h-0 motion-reduce:hidden" aria-hidden>
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} className="fos-confetti absolute left-1/2 block h-2.5 w-1.5 rounded-[2px]"
            style={{
              background: CONFETTI[i % CONFETTI.length],
              ["--dx" as string]: `${Math.cos((i / 18) * 2 * Math.PI) * (110 + (i % 3) * 30)}px`,
              ["--dy" as string]: `${Math.sin((i / 18) * 2 * Math.PI) * (90 + (i % 4) * 25) - 40}px`,
              ["--rot" as string]: `${(i * 67) % 360}deg`,
              animationDelay: `${(i % 5) * 30}ms`,
            }} />
        ))}
      </div>
      <span className="fos-pop grid h-24 w-24 place-items-center rounded-full bg-jade-500 shadow-[0_14px_32px_rgba(18,183,106,.4)]">
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12l5 5 9-10" className="fos-draw" />
        </svg>
      </span>
      <h1 className="mt-5 text-display text-ink-900">Paid</h1>
      {amount != null && <p className="mt-1 text-[15px] font-bold tabular-nums text-ink-500">${amount.toFixed(2)} · {formatKhr(amount)}</p>}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {eta && <span className="inline-flex h-7 items-center gap-1 rounded-full bg-tint-jade px-3 text-[12px] font-extrabold text-tone-jade"><Icon name="truck" size={14} />Arrives in {eta}</span>}
        {note && <span className="inline-flex h-7 items-center rounded-full bg-tint-neutral px-3 text-[12px] font-bold text-ink-500">{note}</span>}
      </div>
      <button type="button" onClick={onDone}
        className="fos-press mt-8 h-[52px] w-full max-w-[340px] rounded-thumb bg-grad-cta text-[15px] font-extrabold text-white shadow-fos-cta">
        {cta}
      </button>
    </div>
  );
}
