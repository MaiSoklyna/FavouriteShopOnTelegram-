/**
 * Settlement API client + types.
 *
 * Amounts arrive from the backend as numeric strings (Postgres numeric /
 * Python Decimal). They are only ever formatted for display here — never
 * summed with floats. Totals come from the server.
 */

import { api } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────

export type EarningStatus = "pending" | "ready" | "paid" | "failed" | "reversed";
export type PayoutStatus = "pending" | "processing" | "paid" | "failed" | "cancelled" | "reversed";
export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";
type Money = string | number;

export interface MerchantBalance {
  merchant_id: number;
  merchant_name?: string | null;
  currency: string;
  pending_amount: Money;
  available_amount: Money;
  in_payout_amount: Money;
  owed_amount: Money;
  paid_amount: Money;
  failed_amount: Money;
  gross_total: Money;
  commission_total: Money;
  last_earning_at?: string | null;
  // admin list only
  aba_account_masked?: string | null;
  aba_account_name?: string | null;
  payout_verification_status?: VerificationStatus | null;
  payout_enabled?: boolean | null;
}

export interface Earning {
  id: number;
  merchant_id: number;
  order_id: number | null;
  order_code?: string | null;
  order_status?: string | null;
  entry_type: "order" | "adjustment";
  currency: string;
  gross_amount: Money;
  commission_base: Money;
  commission_rate: Money;
  commission_amount: Money;
  net_amount: Money;
  settlement_method: "manual" | "aba_split";
  status: EarningStatus;
  payout_id: number | null;
  description?: string | null;
  created_at: string;
  ready_at?: string | null;
  paid_at?: string | null;
}

export interface Payout {
  id: number;
  merchant_id: number;
  currency: string;
  amount: Money;
  item_count: number;
  method: "manual_transfer" | "aba_payway_payout";
  status: PayoutStatus;
  aba_account?: string | null;
  aba_account_name?: string | null;
  reference?: string | null;
  note?: string | null;
  failure_reason?: string | null;
  created_by?: string | null;
  completed_by?: string | null;
  created_at: string;
  paid_at?: string | null;
  failed_at?: string | null;
  reversed_at?: string | null;
  reversed_by?: string | null;
  reversal_reason?: string | null;
  items?: Earning[];
}

export interface PayoutAccount {
  merchant_id: number;
  aba_account: string | null;
  aba_account_name: string | null;
  payout_enabled: boolean;
  payout_verification_status: VerificationStatus;
  payout_verified_at: string | null;
  payout_rejection_reason: string | null;
  commission_rate: Money | null;
  effective_commission_rate: Money;
}

export interface AuditEntry {
  id: number;
  entity_type: string;
  entity_id: number;
  merchant_id: number | null;
  action: string;
  actor_type: string;
  actor_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  note: string | null;
  created_at: string;
}

export interface ReportRow {
  merchant_id?: number;
  merchant_name?: string | null;
  currency: string;
  orders: number;
  gross: Money;
  commission: Money;
  net: Money;
  paid_out: Money;
  payouts: number;
}

export interface SettlementReport {
  date_from: string;
  date_to: string;
  totals: ReportRow[];
  merchants: ReportRow[];
}

type Envelope<T> = { data: T };
const unwrap = <T,>(p: Promise<Envelope<T>>) => p.then((r) => r.data);

// ── Merchant ───────────────────────────────────────────────────

export const merchantSettlements = {
  balance: () => unwrap(api.get<Envelope<MerchantBalance[]>>("/settlements/merchant/balance")),
  earnings: (params: { status?: EarningStatus; page?: number; page_size?: number }) =>
    unwrap(api.get<Envelope<Earning[]>>("/settlements/merchant/earnings", { params })),
  payouts: (params: { page?: number; page_size?: number }) =>
    unwrap(api.get<Envelope<Payout[]>>("/settlements/merchant/payouts", { params })),
  account: () => unwrap(api.get<Envelope<PayoutAccount>>("/settlements/merchant/payout-account")),
  updateAccount: (body: { aba_account: string; aba_account_name: string }) =>
    unwrap(api.put<Envelope<PayoutAccount>>("/settlements/merchant/payout-account", body)),
};

// ── Super admin ────────────────────────────────────────────────

export const adminSettlements = {
  balances: (only_owed: boolean) =>
    unwrap(api.get<Envelope<MerchantBalance[]>>("/settlements/admin/balances", { params: { only_owed } })),
  account: (merchantId: number) =>
    unwrap(api.get<Envelope<PayoutAccount>>(`/settlements/admin/merchants/${merchantId}/payout-account`)),
  updateSettings: (merchantId: number, body: {
    payout_verification_status?: VerificationStatus;
    payout_rejection_reason?: string;
    payout_enabled?: boolean;
    commission_rate?: string;
    clear_commission_rate?: boolean;
  }) => unwrap(api.patch<Envelope<PayoutAccount>>(`/settlements/admin/merchants/${merchantId}/payout-settings`, body)),
  earnings: (merchantId: number, params: { status?: EarningStatus; page?: number; page_size?: number }) =>
    unwrap(api.get<Envelope<Earning[]>>(`/settlements/admin/merchants/${merchantId}/earnings`, { params })),
  createPayout: (merchantId: number, body: { currency: string; note?: string }) =>
    unwrap(api.post<Envelope<Payout>>(`/settlements/admin/merchants/${merchantId}/payouts`, body)),
  payouts: (params: { status?: PayoutStatus; merchant_id?: number; page?: number; page_size?: number }) =>
    unwrap(api.get<Envelope<Payout[]>>("/settlements/admin/payouts", { params })),
  payout: (payoutId: number) => unwrap(api.get<Envelope<Payout>>(`/settlements/admin/payouts/${payoutId}`)),
  completePayout: (payoutId: number, reference: string) =>
    unwrap(api.post<Envelope<Payout>>(`/settlements/admin/payouts/${payoutId}/complete`, { reference })),
  failPayout: (payoutId: number, reason: string, cancel: boolean) =>
    unwrap(api.post<Envelope<Payout>>(`/settlements/admin/payouts/${payoutId}/fail`, { reason, cancel })),
  reversePayout: (payoutId: number, reason: string) =>
    unwrap(api.post<Envelope<Payout>>(`/settlements/admin/payouts/${payoutId}/reverse`, { reason })),
  audit: (params: { merchant_id?: number; entity_type?: string; page?: number; page_size?: number }) =>
    unwrap(api.get<Envelope<AuditEntry[]>>("/settlements/admin/audit", { params })),
  report: (date_from: string, date_to: string) =>
    unwrap(api.get<Envelope<SettlementReport>>("/settlements/admin/report", { params: { date_from, date_to } })),
  backfill: () =>
    unwrap(api.post<Envelope<{ scanned: number; created: number[]; skipped: number[] }>>("/settlements/admin/backfill")),
};

// ── Formatting ─────────────────────────────────────────────────

export function formatMoney(value: Money | null | undefined, currency = "USD"): string {
  const n = Number(value ?? 0);
  if (currency === "KHR") {
    return `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} ៛`;
  }
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function isNonZero(value: Money | null | undefined): boolean {
  return Number(value ?? 0) !== 0;
}

export function formatDate(value?: string | null, withTime = true): string {
  if (!value) return "—";
  const d = new Date(value);
  return withTime
    ? d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function maskAccount(account?: string | null): string {
  if (!account) return "—";
  const digits = account.replace(/\s/g, "");
  return digits.length > 4 ? `•••${digits.slice(-4)}` : "•••";
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err && typeof err === "object" && "detail" in err && typeof (err as any).detail === "string") {
    return (err as any).detail;
  }
  return err instanceof Error ? err.message : fallback;
}

/** Download rows as a CSV file (client-side). */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralise spreadsheet formula injection
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
