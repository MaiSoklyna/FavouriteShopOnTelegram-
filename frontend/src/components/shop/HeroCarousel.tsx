"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export interface HeroSlide {
  key: string | number;
  /** Small gold label (12/700). */
  label?: string | null;
  /** The big number or word (30/800), two lines at most. */
  title: string;
  image?: string | null;
  cta?: string;
  href?: string;
  onClick?: () => void;
}

const AUTOPLAY_MS = 5000;

/**
 * 343×176, r24. Scroll-snap so it swipes natively; dots bottom-left (active
 * 18×6); advances every 5s unless the customer prefers reduced motion or is
 * touching it. Slides without an image use the navy gradient.
 */
export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const paused = useRef(false);

  function goTo(i: number) {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  useEffect(() => {
    if (slides.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      if (paused.current) return;
      goTo((active + 1) % slides.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, slides.length]);

  if (slides.length === 0) return null;

  return (
    <div className="relative">
      <div
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
        onTouchStart={() => { paused.current = true; }}
        onTouchEnd={() => { paused.current = false; }}
        className="fos-no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-hero"
      >
        {slides.map((s) => {
          const cta = (
            <span className="inline-flex h-11 items-center rounded-full bg-white px-5 text-[14px] font-extrabold text-[#081D3C]">
              {s.cta || "Shop now"}
            </span>
          );
          return (
            <div key={s.key} className="relative h-[176px] w-full shrink-0 snap-start overflow-hidden bg-grad-hero">
              {s.image && <img src={s.image} alt="" className="absolute inset-0 h-full w-full object-cover" />}
              {s.image && <div className="absolute inset-0 bg-gradient-to-r from-navy-900/70 via-navy-900/25 to-transparent" />}
              <div className="relative flex h-full flex-col items-start justify-center gap-1 px-5 pb-5">
                {s.label && <span className="text-[12px] font-bold text-gold-400">{s.label}</span>}
                <p className="line-clamp-2 max-w-[70%] text-[24px] font-extrabold leading-[28px] tracking-[-0.02em] text-white">{s.title}</p>
                <div className="mt-2">
                  {s.href
                    ? <Link href={s.href} className="fos-press inline-block">{cta}</Link>
                    : <button type="button" onClick={s.onClick} className="fos-press">{cta}</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {slides.length > 1 && (
        <div className="pointer-events-none absolute bottom-3 left-5 flex gap-1.5" aria-hidden>
          {slides.map((s, i) => (
            <span key={s.key} className={`h-1.5 rounded-full transition-all duration-200 ${i === active ? "w-[18px] bg-white" : "w-1.5 bg-white/50"}`} />
          ))}
        </div>
      )}
    </div>
  );
}
