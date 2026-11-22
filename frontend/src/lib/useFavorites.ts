"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";

/**
 * Favorites: saved products and shops.
 *
 * Signed in, they live on the account (the server is the source of truth, so they follow the customer to a
 * new phone). Signed out, products can still be hearted and stay on this device only; the first time the
 * customer signs in, those are added to the account and cleared from the device.
 *
 * One shared store, so every heart on a page reads the same list from a single request. Taps update the
 * screen at once and are sent in order per item (a fast double tap cannot arrive reversed); if the server
 * refuses, the heart goes back.
 */

const DEVICE_KEY = "fos_wishlist";

interface State { products: number[]; shops: number[]; ready: boolean }

let state: State = { products: [], shops: [], ready: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: Partial<State>) => { state = { ...state, ...next }; emit(); };

function readDevice(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(DEVICE_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : [];
  } catch { return []; }
}
function writeDevice(ids: number[]) {
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(ids)); } catch { /* private mode: the heart still toggles for this visit */ }
}

// ── who the store is loaded for ──
let loadedFor: string | null | undefined; // undefined = never loaded
let loadToken = 0;                         // a stale answer (user changed meanwhile) is ignored

async function load(account: string | null) {
  const token = ++loadToken;
  loadedFor = account;
  if (!account) { set({ products: readDevice(), shops: [], ready: true }); return; }
  try {
    const device = readDevice();
    const r = device.length
      ? await api.post<{ products: number[]; shops: number[] }>("/favorites/sync", { product_ids: device })
      : await api.get<{ products: number[]; shops: number[] }>("/favorites/ids");
    if (token !== loadToken) return;
    if (device.length) writeDevice([]);           // now on the account
    set({ products: r.products ?? [], shops: r.shops ?? [], ready: true });
  } catch {
    if (token === loadToken) set({ products: [], shops: [], ready: true });
  }
}

// ── taps: optimistic, then sent in order per item ──
const queue = new Map<string, Promise<unknown>>();

async function toggle(kind: "products" | "shops", id: number, account: boolean): Promise<boolean> {
  const on = !state[kind].includes(id);
  const apply = (want: boolean) => set({ [kind]: want ? [id, ...state[kind].filter((x) => x !== id)] : state[kind].filter((x) => x !== id) } as Partial<State>);
  apply(on);
  if (!account) { writeDevice(state.products); return true; }
  const path = `/favorites/${kind}/${id}`;
  const key = `${kind}:${id}`;
  const run = (queue.get(key) ?? Promise.resolve()).catch(() => {}).then(() => (on ? api.put(path) : api.delete(path)));
  queue.set(key, run);
  try { await run; return true; }
  catch { apply(!on); return false; }              // the server said no: put the heart back
  finally { if (queue.get(key) === run) queue.delete(key); }
}

export function useFavorites() {
  const { user, isShopUser } = useAuth();
  const account = isShopUser && user ? String((user as { id?: number | string }).id ?? "me") : null;
  const snap = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
    () => state,
  );

  useEffect(() => {
    if (loadedFor !== account) void load(account);
  }, [account]);

  const toggleProduct = useCallback((id: number) => toggle("products", id, !!account), [account]);
  const toggleShop = useCallback((id: number) => toggle("shops", id, !!account), [account]);

  return {
    ready: snap.ready,
    /** True when hearts are saved to the account (false = this device only) */
    onAccount: !!account,
    hasProduct: (id: number) => snap.products.includes(id),
    hasShop: (id: number) => snap.shops.includes(id),
    toggleProduct,
    toggleShop,
    productCount: snap.products.length,
    shopCount: snap.shops.length,
  };
}
