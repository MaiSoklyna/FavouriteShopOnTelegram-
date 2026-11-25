/** Shop setup wizard: types and helpers shared by the dashboard card and the /setup page. */

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];
export const DAY_LABEL: Record<Day, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export type Hours = Partial<Record<Day, [string, string][]>>;

/** 24/7 is stored as every day 00:00–00:00 (the backend reads start == end as the whole day). */
export const ALWAYS_OPEN: Hours = Object.fromEntries(DAYS.map((d) => [d, [["00:00", "00:00"]]])) as Hours;
export const isAlwaysOpen = (h?: Hours | null) => !!h && DAYS.every((d) => h[d]?.length === 1 && h[d]![0][0] === "00:00" && h[d]![0][1] === "00:00");

export type StepKey = "basics" | "location" | "hours" | "delivery" | "telegram" | "categories" | "products" | "extras";
export const STEPS: { key: StepKey; title: string; required: boolean }[] = [
  { key: "basics", title: "Basics", required: true },
  { key: "location", title: "Location", required: true },
  { key: "hours", title: "Opening hours", required: true },
  { key: "delivery", title: "Delivery", required: true },
  { key: "telegram", title: "Telegram group", required: true },
  { key: "categories", title: "Categories", required: true },
  { key: "products", title: "Products", required: true },
  { key: "extras", title: "Extras", required: false },
];

export interface ChecklistItem { key: string; label: string; step: StepKey; done: boolean }
export interface Checklist {
  merchant_id: number;
  name: string;
  live: boolean;
  setup_completed_at: string | null;
  status: string;
  required: ChecklistItem[];
  optional: ChecklistItem[];
  done: number;
  total: number;
  complete: boolean;
  missing: string[];
  always_open: boolean;
  delivery_fee_mode: "platform" | "custom" | null;
}

export interface SetupShop {
  id: number;
  name: string;
  status: string;
  shop_category_id: number | null;
  shop_subcategory_id: number | null;
  logo_url: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  opening_hours: Hours | null;
  telegram_group_linked: boolean;
  delivery_radius_km: number | null;
  delivery_base_fee: number | null;
  delivery_per_km_fee: number | null;
  min_order_amount: number | null;
  delivery_fee_mode: "platform" | "custom" | null;
  tagline: string | null;
  description: string | null;
  fb_page: string | null;
  instagram: string | null;
  setup_completed_at: string | null;
}

export interface Suggestion { id: number; name: string; icon_emoji: string | null }

export interface SetupData {
  checklist: Checklist;
  shop: SetupShop;
  suggestions: Suggestion[];
  can_edit_settings: boolean;
  can_change_type: boolean;
  bot_username: string;
}

/** Is every required item of a wizard step done? */
export function stepDone(c: Checklist | undefined, step: StepKey): boolean {
  if (!c) return false;
  const items = c.required.filter((r) => r.step === step);
  return items.length > 0 ? items.every((r) => r.done) : c.optional.filter((o) => o.step === step).every((o) => o.done);
}
