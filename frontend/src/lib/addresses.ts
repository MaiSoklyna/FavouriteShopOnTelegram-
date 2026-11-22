import { api } from "@/lib/api";

export interface SavedAddress {
  id: number;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  is_default: boolean;
}

export type NewAddress = Omit<SavedAddress, "id">;

export async function listAddresses(): Promise<SavedAddress[]> {
  const res = await api.get<{ data: SavedAddress[] }>("/addresses");
  return res.data;
}

export async function saveAddress(a: NewAddress): Promise<SavedAddress> {
  const res = await api.post<{ data: SavedAddress }>("/addresses", a);
  return res.data;
}

export async function deleteAddress(id: number): Promise<void> {
  await api.delete(`/addresses/${id}`);
}

export interface NearbyShop {
  id: number;
  name: string;
  slug: string;
  tagline?: string;
  icon_emoji?: string;
  logo_url?: string;
  address?: string;
  shop_category_id?: number | null;
  shop_subcategory_id?: number | null;
  shop_category?: string | null;
  shop_subcategory?: string | null;
  /** All computed by the server — the client never derives distance, fee, time or availability. */
  distance_km: number;
  distance_m: number;
  can_deliver: boolean;
  delivery_fee: string | null;
  delivery_unavailable_reason?: string | null;
  eta_minutes: number;
  eta_max_minutes: number;
  is_open: boolean;
  min_order_amount?: string | null;
  /** Shown only when the backend sends one. */
  rating?: number | null;
  review_count?: number;
}

/** `shopCategoryId` narrows the list to one kind of shop (the backend does the filtering). */
export function fetchNearbyShops(lat: number, lng: number, offset = 0, limit = 20, shopCategoryId?: number | null): Promise<NearbyShop[]> {
  return api.get<NearbyShop[]>("/merchants/nearby", {
    params: { lat, lng, offset, limit, ...(shopCategoryId != null ? { shop_category_id: shopCategoryId } : {}) },
  });
}
