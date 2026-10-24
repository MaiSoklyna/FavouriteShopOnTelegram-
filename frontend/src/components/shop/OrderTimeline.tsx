import { Icon } from "./Icon";
import { formatWhen, headline, progress, trackSteps, type TrackOrder } from "@/lib/orderStatus";

const TONE = {
  navy: "bg-grad-hero",
  mango: "bg-[linear-gradient(135deg,#B54708,#FF7A1A_60%,#FFB547)]",
  jade: "bg-[linear-gradient(135deg,#05603A,#12B76A)]",
  ruby: "bg-[linear-gradient(135deg,#912018,#E5484D)]",
} as const;

/** Big status card at the top of the order page: what's happening now + segmented progress. */
export function OrderStatusHero({ order, eta }: { order: TrackOrder; eta?: string | null }) {
  const h = headline(order);
  const steps = trackSteps(order);
  const cancelled = order.status === "cancelled";
  return (
    <section className={`relative overflow-hidden rounded-hero p-4 text-white shadow-fos-md ${TONE[h.tone]}`}>
      <span className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10" aria-hidden />
      <div className="relative flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-thumb bg-white/15">
          <Icon name={h.icon} size={24} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-title">{h.title}</h2>
          <p className="truncate text-[13px] font-medium text-white/80">{h.sub}</p>
        </div>
        {eta && !cancelled && order.status !== "delivered" && (
          <span className="shrink-0 rounded-full bg-card px-2.5 py-1 text-[12px] font-extrabold text-ink-900">{eta}</span>
        )}
      </div>
      {!cancelled && (
        <div className="relative mt-4 flex gap-1.5" role="progressbar" aria-label="Order progress"
          aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={steps.filter((s) => s.state === "done").length}>
          {steps.map((s) => (
            <span key={s.key} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
              <i className={`block h-full rounded-full bg-card ${s.state === "done" ? "w-full" : s.state === "current" ? "w-1/2 animate-pulse motion-reduce:animate-none" : "w-0"}`} />
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/** Vertical tracking timeline: done steps in jade with their time, the current one pulsing mango. */
export function OrderTimeline({ order }: { order: TrackOrder }) {
  const steps = trackSteps(order);
  return (
    <section className="rounded-hero bg-card p-4 shadow-fos-sm">
      <h3 className="mb-3 text-section text-ink-900">Tracking</h3>
      <ol>
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={s.key} className="flex gap-3" aria-current={s.state === "current" ? "step" : undefined}>
              <div className="flex w-8 flex-col items-center">
                <span className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                  s.state === "done" ? "bg-jade-500 text-white" : s.state === "current" ? "bg-mango-500 text-white" : "bg-surface text-ink-500"}`}>
                  {s.state === "current" && <span className="absolute inset-0 animate-ping rounded-full bg-mango-500/40 motion-reduce:animate-none" aria-hidden />}
                  <Icon name={s.state === "done" ? "check" : s.icon} size={16} strokeWidth={s.state === "done" ? 3 : 2} />
                </span>
                {!last && <span className={`my-1 w-0.5 flex-1 rounded-full ${s.state === "done" ? "bg-jade-500" : "bg-line"}`} />}
              </div>
              <div className={`min-w-0 flex-1 ${last ? "" : "pb-4"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[14px] font-extrabold ${s.state === "todo" ? "text-ink-500" : "text-ink-900"}`}>{s.label}</span>
                  {s.at && s.state === "done" && <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink-500">{formatWhen(s.at)}</span>}
                  {s.state === "current" && <span className="shrink-0 text-[11px] font-extrabold text-tone-mango">Now</span>}
                </div>
                <p className="text-caption text-ink-500">{s.state === "current" && s.waiting ? s.waiting : s.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Thin progress bar for order cards in the list. */
export function OrderProgress({ order }: { order: TrackOrder }) {
  const p = progress(order);
  const done = order.status === "delivered";
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
      <i className={`block h-full rounded-full transition-[width] duration-300 ${done ? "bg-jade-500" : "bg-mango-500"}`} style={{ width: `${p * 100}%` }} />
    </span>
  );
}
