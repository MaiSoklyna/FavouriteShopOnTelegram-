"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { ActivityEntry, Merchant, ShopRole } from "@/types";
import { BrandLoader } from "@/components/ui/Spinner";

type Person = { id: string; name: string | null; role: ShopRole };
type Page = { data: ActivityEntry[]; page: number; has_more: boolean; people: Person[] };

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All activity" },
  { value: "product", label: "Products" },
  { value: "product.price_changed", label: "Price changes" },
  { value: "product.deleted", label: "Deleted products" },
  { value: "order", label: "Orders" },
  { value: "order.accepted", label: "Accepted orders" },
  { value: "order.rejected", label: "Rejected orders" },
  { value: "order.driver_assigned", label: "Driver assignments" },
  { value: "driver", label: "Drivers" },
  { value: "promotion", label: "Promotions" },
  { value: "coupon", label: "Coupons" },
  { value: "collection", label: "Collections" },
  { value: "shop", label: "Shop settings" },
  { value: "payout", label: "Payout account" },
  { value: "staff", label: "Staff accounts" },
  { value: "staff.role_changed", label: "Role changes" },
  { value: "access", label: "Sign-ins and sign-outs" },
];

/** Who changed what in the shop, and when. Owners and managers (and the platform, per shop).
 *  `?actor_id=<id>` opens one person's history (linked from the Staff page). */
export default function ActivityPage() {
  const { isSuperAdmin } = useAuth();
  const [shops, setShops] = useState<Merchant[]>([]);
  const [shopId, setShopId] = useState("");
  const [action, setAction] = useState("");
  const [person, setPerson] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");  // the search box, applied after a pause
  const [rows, setRows] = useState<ActivityEntry[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isSuperAdmin) api.get<Merchant[]>("/merchants").then(setShops).catch(() => {});
  }, [isSuperAdmin]);
  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  // One person's history, opened from the Staff page
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("actor_id");
    if (id && /^\d+$/.test(id)) setPerson(id);
  }, []);

  const load = useCallback(async (nextPage: number) => {
    if (isSuperAdmin && !shopId) { setRows([]); setLoading(false); return; }
    const p = new URLSearchParams({ page: String(nextPage), page_size: "50" });
    if (isSuperAdmin) p.set("merchant_id", shopId);
    if (action) p.set("action", action);
    if (person) p.set("actor_id", person);
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    if (query) p.set("q", query);
    setLoading(true);
    try {
      const r = await api.get<Page>(`/merchant-activity?${p}`);
      setRows(prev => nextPage === 1 ? r.data : [...prev, ...r.data]);
      setPeople(r.people);
      setHasMore(r.has_more);
      setPage(nextPage);
      setError("");
    } catch (e: any) {
      setError(e?.detail || "Could not load the activity log");
    } finally { setLoading(false); }
  }, [isSuperAdmin, shopId, action, person, from, to, query]);

  useEffect(() => { load(1); }, [load]);

  const filtered = action || person || from || to || query;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Activity Log</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Who changed what in the shop, and when. Entries cannot be edited or deleted.
        </p>
      </div>

      <div className="admin-card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
        {isSuperAdmin && (
          <label style={{ flex: "1 1 180px", fontSize: 12 }}>Shop
            <select className="admin-input" value={shopId} onChange={e => { setShopId(e.target.value); setPerson(""); }}>
              <option value="">Choose a shop…</option>
              {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label style={{ flex: "1 1 170px", fontSize: 12 }}>What
          <select className="admin-input" data-testid="filter-action" value={action} onChange={e => setAction(e.target.value)}>
            {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 150px", fontSize: 12 }}>Who
          <select className="admin-input" data-testid="filter-person" value={person} onChange={e => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name} ({roleName(p.role).toLowerCase()})</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 140px", fontSize: 12 }}>From
          <input className="admin-input" type="date" data-testid="filter-from" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
        </label>
        <label style={{ flex: "1 1 140px", fontSize: 12 }}>To
          <input className="admin-input" type="date" data-testid="filter-to" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
        </label>
        <label style={{ flex: "2 1 200px", fontSize: 12 }}>Search
          <input className="admin-input" data-testid="filter-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Product, order, coupon or person" />
        </label>
        {filtered && (
          <button className="btn-outline" onClick={() => { setAction(""); setPerson(""); setFrom(""); setTo(""); setSearch(""); }}>Clear</button>
        )}
      </div>

      <div className="admin-card" style={{ padding: 0 }}>
        {error ? (
          <p style={{ padding: 24, color: "var(--danger, #EF4444)", fontSize: 13 }}>{error}</p>
        ) : isSuperAdmin && !shopId ? (
          <p style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>Choose a shop to see its activity.</p>
        ) : rows.length === 0 && loading ? <BrandLoader /> : rows.length === 0 ? (
          <p style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
            {filtered ? "Nothing matches these filters." : "Nothing yet. Changes to products, orders, drivers, promotions, coupons, settings and staff will appear here."}
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="activity-feed">
            {rows.map(e => <Entry key={e.id} e={e} />)}
          </ul>
        )}
      </div>

      {hasMore && (
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button className="btn-outline" onClick={() => load(page + 1)} disabled={loading}>{loading ? "Loading…" : "Show older"}</button>
        </div>
      )}
    </div>
  );
}

function Entry({ e }: { e: ActivityEntry }) {
  const changes = changeLines(e);
  return (
    <li data-testid={`activity-${e.id}`} style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 12 }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, flexShrink: 0, background: dot(e.action) }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "var(--text)" }}>{sentence(e)}</span>
          <time dateTime={e.created_at} title={new Date(e.created_at).toLocaleString()} style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {new Date(e.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </time>
        </div>
        {changes.length > 0 && (
          <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
            {changes.map((c, i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                <span style={{ color: "var(--text-secondary)" }}>{c.field}:</span>{" "}
                {c.old !== undefined && <><span style={{ textDecoration: "line-through" }}>{c.old}</span>{" → "}</>}
                <strong style={{ color: "var(--text)" }}>{c.new}</strong>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{roleName(e.actor_type)}</div>
      </div>
    </li>
  );
}

// ── Reading an entry ───────────────────────────────────────────

function roleName(t: ActivityEntry["actor_type"]): string {
  return t === "owner" ? "Owner" : t === "manager" ? "Manager" : t === "staff" ? "Staff"
    : t === "super_admin" ? "Platform admin" : t === "system" ? "System" : "";
}

function dot(action: string): string {
  if (action.endsWith("deleted") || action.endsWith("removed") || action === "order.rejected" || action.endsWith("deactivated") || action.endsWith("disabled")) return "var(--danger, #EF4444)";
  if (action.startsWith("payout.") || action === "product.price_changed") return "var(--warning, #F59E0B)";
  if (action.endsWith("created") || action.endsWith("added") || action === "order.accepted") return "var(--success, #10B981)";
  return "var(--info, #3B82F6)";
}

const STATUS: Record<string, string> = { pending: "New", confirmed: "Accepted", processing: "Preparing", shipped: "On the way", delivered: "Delivered", cancelled: "Cancelled" };

function sentence(e: ActivityEntry): string {
  const who = e.actor_name || "Someone";
  const what = e.target_label || (e.target_id ? `#${e.target_id}` : "");
  const n = (e.new_value || {}) as Record<string, any>;
  switch (e.action) {
    case "product.created": return `${who} added product ${what}`;
    case "product.updated": return `${who} edited product ${what}`;
    case "product.price_changed": return `${who} changed the price of ${what}`;
    case "product.deleted": return `${who} deleted product ${what}`;
    case "product.variants_changed": return `${who} changed the options of ${what}`;
    case "product.image_added": return `${who} added a photo to ${what}`;
    case "product.image_removed": return `${who} removed a photo from ${what}`;
    case "order.accepted": return `${who} accepted order ${what}`;
    case "order.rejected": return `${who} rejected order ${what}`;
    case "order.status_changed": return `${who} marked order ${what} as ${STATUS[n.status] || n.status}`;
    case "order.driver_assigned": return `${who} gave order ${what} to ${n.driver || "a driver"}`;
    case "order.driver_unassigned": return `${who} took order ${what} back from its driver`;
    case "driver.added": return `${who} added driver ${what}`;
    case "driver.updated": return `${who} edited driver ${what}`;
    case "driver.activated": return `${who} switched on driver ${what}`;
    case "driver.deactivated": return `${who} switched off driver ${what}`;
    case "promotion.created": return `${who} created promotion ${what}`;
    case "promotion.updated": return `${who} edited promotion ${what}`;
    case "promotion.disabled": return `${who} turned off promotion ${what}`;
    case "promotion.deleted": return `${who} deleted promotion ${what}`;
    case "collection.created": return `${who} created collection ${what}`;
    case "collection.updated": return `${who} edited collection ${what}`;
    case "collection.products_changed": return `${who} changed the products in collection ${what}`;
    case "collection.deleted": return `${who} deleted collection ${what}`;
    case "coupon.created": return `${who} created coupon ${what}`;
    case "coupon.updated": return `${who} edited coupon ${what}`;
    case "coupon.disabled": return `${who} turned off coupon ${what}`;
    case "coupon.deleted": return `${who} deleted coupon ${what}`;
    case "coupon.granted": return `${who} gave coupon ${what} to ${n.customers ?? "some"} customer${n.customers === 1 ? "" : "s"}`;
    case "shop.profile_updated": return `${who} updated the shop profile`;
    case "shop.settings_updated": return `${who} changed shop settings${e.target_label && e.target_label.startsWith("Hero") ? ` (${e.target_label.toLowerCase()})` : ""}`;
    case "payout.account_updated": return `${who} changed the payout account`;
    case "payout.verification_changed": return `${who} changed the payout verification`;
    case "staff.added": return `${who} added staff member ${what}`;
    case "staff.updated": return `${who} edited staff member ${what}`;
    case "staff.deactivated": return `${who} deactivated staff member ${what}`;
    case "staff.reactivated": return `${who} reactivated staff member ${what}`;
    case "staff.removed": return `${who} removed staff member ${what}`;
    case "staff.role_changed": return `${who} changed the role of ${what}`;
    case "account.login": return `${who} signed in${n.method === "telegram" ? " with Telegram" : ""}`;
    case "account.logout": return `${who} signed out`;
    default: return `${who}: ${e.action} ${what}`;
  }
}

const LABELS: Record<string, string> = {
  base_price: "Price", compare_price: "Compare-at price", stock: "Stock", name: "Name", description: "Description",
  category_id: "Category", is_active: "Active", is_featured: "Featured", sku: "SKU", status: "Status", note: "Note",
  payment_status: "Payment", driver: "Driver", full_name: "Name", phone: "Phone", vehicle: "Vehicle", email: "Email",
  telegram_id: "Telegram ID", password: "Password", aba_account: "ABA account", aba_account_name: "Account name",
  payout_verification_status: "Verification", payout_enabled: "Payouts", payout_rejection_reason: "Reason",
  code: "Code", type: "Type", value: "Value", discount_type: "Discount type", discount_value: "Discount",
  min_order: "Minimum order", max_uses: "Max uses", expires_at: "Expires", title: "Title", starts_at: "Starts", ends_at: "Ends",
  customers: "Customers", variants: "Options", products: "Products", sort_order: "Position", cover_url: "Cover", image: "Photo", hero_image: "Hero image", logo_url: "Logo",
  opening_hours: "Opening hours", delivery_base_fee: "Delivery fee", delivery_per_km_fee: "Fee per km",
  delivery_radius_km: "Delivery radius (km)", tagline: "Tagline", address: "Address", role: "Role",
};
const ROLE_NAMES: Record<string, string> = { owner: "Owner", manager: "Manager", staff: "Staff" };
const MONEY = new Set(["base_price", "compare_price", "min_order", "delivery_base_fee", "delivery_per_km_fee"]);
const SKIP = new Set(["user_ids", "driver_id", "primary", "method"]);

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "status" && typeof v === "string") return STATUS[v] || v;
  if (field === "role" && typeof v === "string") return ROLE_NAMES[v] || v;
  if (MONEY.has(field) && !isNaN(Number(v))) return `$${Number(v).toFixed(2)}`;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if ((field === "starts_at" || field === "ends_at") && typeof v === "string") return new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  if (field === "variants" && Array.isArray(v)) return v.map((g: any) => `${g.group}: ${(g.options || []).join(", ")}`).join(" · ") || "none";
  if (Array.isArray(v)) return v.join(", ") || "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (/^https?:\/\//.test(s)) return "image";
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

function changeLines(e: ActivityEntry): { field: string; old?: string; new: string }[] {
  const o = (e.old_value || {}) as Record<string, unknown>;
  const n = (e.new_value || {}) as Record<string, unknown>;
  // Removals show what was there; additions and edits show old → new
  const keys = Object.keys(n).length ? Object.keys(n) : Object.keys(o);
  const removal = !Object.keys(n).length;
  return keys
    .filter(k => !SKIP.has(k) && !(e.action === "order.driver_assigned" && k === "driver" && !(k in o)))
    .filter(k => !(e.action.startsWith("order.") && k === "status" && e.action !== "order.status_changed"))
    .map(k => removal
      ? { field: LABELS[k] || k, new: show(k, o[k]) }
      : { field: LABELS[k] || k, old: k in o ? show(k, o[k]) : undefined, new: show(k, n[k]) });
}
