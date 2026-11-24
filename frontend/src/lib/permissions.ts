"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { AdminUser, ShopRole } from "@/types";

/**
 * What the signed-in shop account may do. The table itself lives on the server
 * (backend/app/core/permissions.py) and is enforced there; the dashboard only uses it to hide
 * buttons and pages a role cannot use.
 */

export type Perm =
  | "products.edit" | "products.price" | "products.delete"
  | "orders.process" | "orders.cancel"
  | "drivers.manage" | "marketing.manage" | "reviews.moderate"
  | "sales.view" | "activity.view"
  | "staff.manage" | "finance.manage" | "shop.settings";

export interface PermissionMatrix {
  roles: { key: ShopRole; label: string }[];
  permissions: { key: Perm; label: string; roles: ShopRole[] }[];
}

interface PermissionsResponse {
  role: ShopRole | null;
  permissions: Perm[];
  matrix: PermissionMatrix;
}

// Used until the server answers (and if it cannot be reached): the same table as the server's
const FALLBACK: Record<ShopRole, Perm[]> = {
  owner: ["products.edit", "products.price", "products.delete", "orders.process", "orders.cancel",
    "drivers.manage", "marketing.manage", "reviews.moderate", "sales.view", "activity.view",
    "staff.manage", "finance.manage", "shop.settings"],
  manager: ["products.edit", "products.price", "products.delete", "orders.process", "orders.cancel",
    "drivers.manage", "marketing.manage", "reviews.moderate", "sales.view", "activity.view"],
  staff: ["products.edit", "orders.process"],
};

// One request per signed-in account
const cache = new Map<string, Promise<PermissionsResponse>>();

export function usePermissions() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const admin = isAdmin ? (user as AdminUser) : null;
  const role: ShopRole | null = isSuperAdmin ? null : (admin?.merchant_role ?? (admin ? "owner" : null));
  const key = admin ? `${admin.role}:${admin.id}:${role}` : "";
  const [data, setData] = useState<PermissionsResponse | null>(null);

  useEffect(() => {
    if (!key) return;
    let live = true;
    let p = cache.get(key);
    if (!p) {
      p = api.get<PermissionsResponse>("/merchant-permissions");
      cache.set(key, p);
      p.catch(() => cache.delete(key));
    }
    p.then((r) => { if (live) setData(r); }).catch(() => {});
    return () => { live = false; };
  }, [key]);

  const granted = new Set<Perm>(data?.permissions ?? (role ? FALLBACK[role] : []));
  return {
    role,
    matrix: data?.matrix ?? null,
    /** Super admins may do everything; shop accounts per their role. */
    can: (perm: Perm) => isSuperAdmin || granted.has(perm),
  };
}

export const ROLE_LABEL: Record<ShopRole, string> = { owner: "Owner", manager: "Manager", staff: "Staff" };
