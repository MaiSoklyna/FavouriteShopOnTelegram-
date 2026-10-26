"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

const LEAF = "M50 18A26 26 0 0 1 50 58A26 26 0 0 1 50 18Z";
const SEEN_KEY = "byme24-splash-seen";

/**
 * First-load launch sequence (brand/index.html, "Splash and loading screens"):
 * static splash for 600 ms, then the loading screen (knot turning above a gold
 * sweep) until the page has loaded, then a short fade. Shown once per session.
 */
export function BrandSplash() {
  const [phase, setPhase] = useState<"splash" | "loading" | "out" | "done">("splash");

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SEEN_KEY)) { setPhase("done"); return; }
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch { /* storage blocked: still show it once */ }

    const t1 = setTimeout(() => setPhase("loading"), 600);
    let t2: ReturnType<typeof setTimeout>;
    const finish = () => { t2 = setTimeout(() => setPhase("out"), 900); };
    if (document.readyState === "complete") finish();
    else window.addEventListener("load", finish, { once: true });
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener("load", finish); };
  }, []);

  useEffect(() => {
    if (phase !== "out") return;
    const t = setTimeout(() => setPhase("done"), 400);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "done") return null;

  return (
    <div className={`brand-splash${phase === "out" ? " brand-splash--out" : ""}`} role="status" aria-label="Loading Byme24">
      {phase === "splash" ? (
        <>
          <svg viewBox="0 0 100 100" width={150} height={150} fill="none" style={{ marginBottom: "18vh" }} aria-hidden="true">
            <defs>
              <linearGradient id="splash-foil" x1="20" y1="10" x2="80" y2="90" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#F0DEB4" /><stop offset=".5" stopColor="#D6BA80" /><stop offset="1" stopColor="#71541A" />
              </linearGradient>
            </defs>
            <g stroke="url(#splash-foil)" strokeWidth="6" strokeLinejoin="round">
              <path d={LEAF} />
              <path d={LEAF} transform="rotate(120 50 58)" />
              <path d={LEAF} transform="rotate(240 50 58)" />
              <circle cx="50" cy="58" r="14" />
            </g>
          </svg>
          <div className="brand-splash__word">Byme<span>24</span></div>
          <div className="brand-splash__tag">Shop the city</div>
        </>
      ) : (
        <>
          <Spinner size={72} />
          <div className="brand-sweep" aria-hidden="true" style={{ marginTop: 28 }}><span /></div>
        </>
      )}
    </div>
  );
}
