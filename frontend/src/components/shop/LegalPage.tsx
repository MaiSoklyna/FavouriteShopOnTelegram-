import Link from "next/link";
import type { ReactNode } from "react";

/** Who runs the platform, as shown on the legal pages. Change it here only. */
export const OPERATOR = {
  name: "Byme24",
  country: "the Kingdom of Cambodia",
  contact: "the Support page in the app (Me → Support)",
};
export const LEGAL_UPDATED = "25 November 2026";

export interface LegalSection { title: string; body: ReactNode }

/** A long-form legal page (privacy policy, terms) in the shop's look: readable on a phone, numbered sections. */
export function LegalPage({ title, intro, sections, other }: {
  title: string; intro: ReactNode; sections: LegalSection[]; other: { href: string; label: string };
}) {
  return (
    <div className="min-h-screen bg-surface pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 rounded-b-[20px] bg-navy-700 px-gutter py-3 text-white">
        <Link href="/shop/profile" aria-label="Back" className="grid h-9 w-9 place-items-center rounded-full bg-white/15">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-[16px] font-extrabold">{title}</h1>
      </header>

      <article className="mx-auto max-w-[680px] px-gutter pt-4 text-[14px] leading-6 text-ink-900">
        <p className="text-caption text-ink-500">Last updated {LEGAL_UPDATED}</p>
        <div className="mt-3 rounded-hero bg-card p-4 shadow-fos-sm">{intro}</div>

        <nav aria-label="Contents" className="mt-4 rounded-hero bg-card p-4 shadow-fos-sm">
          <div className="mb-2 text-[13px] font-extrabold">Contents</div>
          <ol className="list-decimal space-y-1 pl-5 text-[13px]">
            {sections.map((s, i) => <li key={s.title}><a href={`#s${i + 1}`} className="text-navy-700 underline-offset-2 hover:underline">{s.title}</a></li>)}
          </ol>
        </nav>

        {sections.map((s, i) => (
          <section key={s.title} id={`s${i + 1}`} className="mt-4 scroll-mt-20 rounded-hero bg-card p-4 shadow-fos-sm">
            <h2 className="mb-2 text-[15px] font-extrabold">{i + 1}. {s.title}</h2>
            <div className="space-y-2 [&_li]:ml-5 [&_li]:list-disc">{s.body}</div>
          </section>
        ))}

        <p className="mt-5 text-center text-[13px]">
          <Link href={other.href} className="font-bold text-navy-700 underline">{other.label}</Link>
        </p>
      </article>
    </div>
  );
}
