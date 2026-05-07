"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import type { Cart, CartItem } from "@/types";

interface CartContextValue {
  items: CartItem[];
  count: number;
  total: number;
  loading: boolean;
  fetchCart: () => Promise<void>;
  addToCart: (productId: number, quantity?: number, variants?: unknown[]) => Promise<void>;
  updateQuantity: (itemId: number, quantity: number) => Promise<void>;
  removeItem: (itemId: number) => Promise<void>;
  clearCart: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, isShopUser } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchCart = useCallback(async () => {
    try {
      setLoading(true);
      const cart = await api.get<Cart>("/cart");
      setItems(cart.items);
      setCount(cart.item_count);
      setTotal(cart.subtotal);
    } catch {
      // User might not be logged in
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch cart when user changes
  useEffect(() => {
    if (user && isShopUser) {
      fetchCart();
    } else {
      setItems([]);
      setCount(0);
      setTotal(0);
    }
  }, [user, isShopUser, fetchCart]);

  async function addToCart(productId: number, quantity = 1, variants: unknown[] = []) {
    await api.post("/cart/add", {
      product_id: productId,
      quantity,
      selected_variants: variants,
    });
    await fetchCart();
  }

  async function updateQuantity(itemId: number, quantity: number) {
    if (quantity <= 0) {
      await removeItem(itemId);
      return;
    }
    await api.patch(`/cart/items/${itemId}`, { quantity });
    await fetchCart();
  }

  async function removeItem(itemId: number) {
    await api.delete(`/cart/items/${itemId}`);
    await fetchCart();
  }

  async function clearCart() {
    await api.delete("/cart");
    setItems([]);
    setCount(0);
    setTotal(0);
  }

  return (
    <CartContext.Provider
      value={{ items, count, total, loading, fetchCart, addToCart, updateQuantity, removeItem, clearCart }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
