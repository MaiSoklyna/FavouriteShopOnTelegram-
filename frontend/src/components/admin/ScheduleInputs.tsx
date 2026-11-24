"use client";

/**
 * Schedule pickers shared by Promo Banners and Home Categories. Values match the
 * backend (services/promo_schedule.py): weekdays 0 = Sunday … 6 = Saturday,
 * month_days 1 … 31, yearly ranges as "MM-DD". Days are counted in Cambodia time.
 */

export type ScheduleType = "once" | "weekly" | "monthly" | "yearly";
export interface YearlyRange { start: string; end: string }
export interface ScheduleFields { schedule_type: ScheduleType; weekdays: number[]; month_days: number[]; yearly_ranges: YearlyRange[] }

export const SCHEDULES: { key: ScheduleType; label: string; hint: string }[] = [
  { key: "once", label: "One Time", hint: "Runs once, between two dates" },
  { key: "weekly", label: "Weekly", hint: "On chosen days every week" },
  { key: "monthly", label: "Monthly", hint: "On chosen dates every month" },
  { key: "yearly", label: "Yearly", hint: "On chosen dates every year" },
];

// Monday first, as people read a week; values are 0 = Sunday … 6 = Saturday
const WEEK = [{ d: 1, n: "Mon" }, { d: 2, n: "Tue" }, { d: 3, n: "Wed" }, { d: 4, n: "Thu" }, { d: 5, n: "Fri" }, { d: 6, n: "Sat" }, { d: 0, n: "Sun" }];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const YEARLY_PRESETS: { label: string; range: YearlyRange }[] = [
  { label: "Christmas · 25 Dec", range: { start: "12-25", end: "12-25" } },
  { label: "Khmer New Year · 14–16 Apr", range: { start: "04-14", end: "04-16" } },
  { label: "New Year · 1 Jan", range: { start: "01-01", end: "01-01" } },
];
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const mdText = (md: string) => { const [m, d] = md.split("-").map(Number); return `${d} ${MONTH_NAMES[m - 1]}`; };

/** The schedule in plain words, as the customer and the admin list will see it. */
export function scheduleText(f: ScheduleFields): string {
  if (f.schedule_type === "weekly") {
    if (f.weekdays.length === 0) return "Pick the days of the week";
    if (f.weekdays.length === 2 && f.weekdays.includes(6) && f.weekdays.includes(0)) return "Every weekend (Saturday and Sunday)";
    return "Every " + joinWords(WEEK.filter(w => f.weekdays.includes(w.d)).map(w => DAY_NAMES[w.d]));
  }
  if (f.schedule_type === "monthly") return f.month_days.length ? `Every ${joinWords([...f.month_days].sort((a, b) => a - b).map(ordinal))} of the month` : "Pick the days of the month";
  if (f.schedule_type === "yearly") return f.yearly_ranges.length ? "Every year: " + joinWords(f.yearly_ranges.map(r => (r.start === r.end ? mdText(r.start) : `${mdText(r.start)} – ${mdText(r.end)}`))) : "Add the dates";
  return "Runs once between the start and end date";
}

/** <input type="datetime-local"> value ↔ ISO string, in the admin's own time zone */
export const toLocal = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

const hint: React.CSSProperties = { display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 4 };
const small: React.CSSProperties = { padding: "4px 10px", fontSize: 12 };
const chip = (on: boolean): React.CSSProperties => ({
  minWidth: 46, padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: on ? 700 : 500,
  border: on ? "1.5px solid #103562" : "1px solid var(--border)", background: on ? "#103562" : "transparent", color: on ? "#FFFFFF" : "var(--text)",
});
const toggle = (xs: number[], x: number) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {WEEK.map(w => {
        const on = value.includes(w.d);
        return <button key={w.d} type="button" aria-pressed={on} onClick={() => onChange(toggle(value, w.d))} style={chip(on)}>{w.n}</button>;
      })}
      <button type="button" className="btn-outline" style={small} onClick={() => onChange([6, 0])}>Weekend</button>
    </div>
  );
}

export function MonthDaysPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, maxWidth: 340 }}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map(d => {
          const on = value.includes(d);
          return <button key={d} type="button" aria-pressed={on} onClick={() => onChange(toggle(value, d))} style={{ ...chip(on), padding: 0, height: 34 }}>{d}</button>;
        })}
      </div>
      <small style={hint}>The 31st also runs on the last day of shorter months.</small>
    </>
  );
}

export function YearlyRangesPicker({ value, onChange }: { value: YearlyRange[]; onChange: (v: YearlyRange[]) => void }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {value.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <MonthDay value={r.start} onChange={v => onChange(value.map((x, j) => (j === i ? { start: v, end: x.end < v && x.end === x.start ? v : x.end } : x)))} />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>to</span>
          <MonthDay value={r.end} onChange={v => onChange(value.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
          <button type="button" className="btn-outline" style={{ ...small, color: "#EF4444" }} onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn-outline" style={small} onClick={() => onChange([...value, { start: "01-01", end: "01-01" }])}>+ Add a date</button>
        {YEARLY_PRESETS.map(pr => (
          <button key={pr.label} type="button" className="btn-outline" style={small} onClick={() => onChange([...value, pr.range])}>{pr.label}</button>
        ))}
      </div>
      <small style={hint}>Khmer New Year moves a day some years (13 or 14 April). Check the dates each January.</small>
    </div>
  );
}

/** Month + day picker for yearly dates; value is "MM-DD". */
function MonthDay({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [m, d] = value.split("-").map(Number);
  const days = new Date(2024, m, 0).getDate(); // 2024 is a leap year, so February offers the 29th
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      <select className="admin-input" style={{ width: 70 }} value={d} onChange={e => onChange(`${pad(m)}-${pad(+e.target.value)}`)}>
        {Array.from({ length: days }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <select className="admin-input" style={{ width: 130 }} value={m} onChange={e => { const nm = +e.target.value; onChange(`${pad(nm)}-${pad(Math.min(d, new Date(2024, nm, 0).getDate()))}`); }}>
        {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </select>
    </span>
  );
}
