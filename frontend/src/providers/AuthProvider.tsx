"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { api, setToken, clearToken, getToken } from "@/lib/api";
import { getTelegramUser, initTelegram, isInTelegram } from "@/lib/telegram";
import type { AdminUser, TelegramUser } from "@/types";

type AuthUser = AdminUser | TelegramUser | null;

interface AuthContextValue {
  user: AuthUser;
  loading: boolean;
  loginPending: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isShopUser: boolean;
  adminLogin: (email: string, password: string) => Promise<void>;
  startTgSession: () => Promise<string>;
  pollSession: (sessionId: string) => void;
  stopPolling: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState(true);
  const [loginPending, setLoginPending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve user type helpers
  const isAdmin = !!user && "email" in user;
  const isSuperAdmin = isAdmin && (user as AdminUser).role === "super_admin";
  const isShopUser = !!user && "telegram_id" in user;

  // ── Init: restore session on mount ───────────────────────────
  useEffect(() => {
    initAuth();
  }, []);

  async function initAuth() {
    try {
      // 1. Check URL token (from Telegram bot "Open Shop" button)
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get("auth");
        if (urlToken) {
          setToken(urlToken);
          window.history.replaceState({}, "", window.location.pathname);
        }
      }

      // 2. Check existing token
      const token = getToken();
      if (token) {
        try {
          const me = await api.get<AdminUser | TelegramUser>("/auth/me");
          setUser(me);
          setLoading(false);
          return;
        } catch {
          clearToken();
        }
      }

      // 3. Telegram WebApp auto-auth
      if (isInTelegram()) {
        initTelegram();
        const tgUser = getTelegramUser();
        if (tgUser) {
          const resp = await api.post<{ access_token: string; user: TelegramUser }>(
            "/auth/telegram",
            {
              telegram_id: tgUser.id,
              username: tgUser.username || `user_${tgUser.id}`,
              first_name: tgUser.first_name,
              last_name: tgUser.last_name || "",
            },
            { token: null },
          );
          setToken(resp.access_token);
          setUser(resp.user);
        }
      }
    } catch (err) {
      console.error("Auth init failed:", err);
    } finally {
      setLoading(false);
    }
  }

  // ── Admin email/password login ───────────────────────────────
  // Role is detected automatically by the backend from the credentials —
  // the UI no longer asks the user to pick Merchant / Super Admin.
  async function adminLogin(email: string, password: string) {
    const resp = await api.post<{ access_token: string; user: AdminUser }>(
      "/auth/admin-login",
      { email, password },
      { token: null },
    );
    setToken(resp.access_token);
    setUser(resp.user);
  }

  // ── Telegram session login (dashboard) ───────────────────────
  async function startTgSession(): Promise<string> {
    const resp = await api.post<{ session_id: string }>("/auth/tg-session", {}, { token: null });
    return resp.session_id;
  }

  function pollSession(sessionId: string) {
    setLoginPending(true);
    stopPolling();

    pollRef.current = setInterval(async () => {
      try {
        const resp = await api.get<{ status: string; token?: string; user?: AdminUser }>(
          "/auth/poll-session",
          { params: { session_id: sessionId }, token: null },
        );
        if (resp.status === "completed" && resp.token && resp.user) {
          stopPolling();
          setToken(resp.token);
          setUser(resp.user);
          setLoginPending(false);
        } else if (resp.status === "expired") {
          stopPolling();
          setLoginPending(false);
        }
      } catch {
        // Keep polling
      }
    }, 2000);

    // 5 min timeout
    timeoutRef.current = setTimeout(() => {
      stopPolling();
      setLoginPending(false);
    }, 5 * 60 * 1000);
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  }, []);

  function logout() {
    clearToken();
    setUser(null);
    stopPolling();
  }

  return (
    <AuthContext.Provider
      value={{
        user, loading, loginPending, isAdmin, isSuperAdmin, isShopUser,
        adminLogin, startTgSession, pollSession, stopPolling, logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
