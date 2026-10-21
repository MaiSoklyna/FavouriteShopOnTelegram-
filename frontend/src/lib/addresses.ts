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
  distance_km: number;
  can_deliver: boolean;
  delivery_fee: string | null;
}

export function fetchNearbyShops(lat: number, lng: number): Promise<NearbyShop[]> {
  return api.get<NearbyShop[]>("/merchants/nearby", { params: { lat, lng } });
}
