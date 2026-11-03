"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { api, ApiError, setToken, clearToken, getToken, tokenArea, type Area } from "@/lib/api";
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
  // The Telegram session being signed in. A second tap (or a double tap while the first
  // request is still in flight) reuses it, so the bot and the browser always wait on the same one.
  const sessionRef = useRef<Promise<string> | null>(null);

  // The shop (/shop/*) and the dashboard keep separate sessions (see lib/api.ts).
  // Moving between them swaps which account this provider holds.
  const pathname = usePathname();
  const area: Area = pathname?.startsWith("/shop") ? "shop" : "admin";
  // Bumped on every area switch so a slow restore for the old area is dropped.
  const initGen = useRef(0);

  // Resolve user type helpers
  const isAdmin = !!user && "email" in user;
  const isSuperAdmin = isAdmin && (user as AdminUser).role === "super_admin";
  const isShopUser = !!user && "telegram_id" in user;

  // ── Init: restore the session for this area (on mount and on area switch) ──
  useEffect(() => {
    const gen = ++initGen.current;
    stopPolling();
    setLoginPending(false);
    setUser(null);
    setLoading(true);
    initAuth(area, () => gen === initGen.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  async function initAuth(area: Area, isCurrent: () => boolean) {
    const done = (u: AuthUser) => {
      if (!isCurrent()) return;
      setUser(u);
      setLoading(false);
    };
    try {
      // 1. Check URL token (from Telegram bot "Open Shop" button)
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get("auth");
        if (urlToken) {
          // Filed under its own role, so an admin link never lands in the shop slot.
          setToken(urlToken);
          window.history.replaceState({}, "", window.location.pathname);
        }
      }

      // 2. Check existing token
      const token = getToken();
      if (token) {
        try {
          const me = await api.get<AdminUser | TelegramUser>("/auth/me", { token });
          done(me);
          return;
        } catch (e) {
          // Only a rejected token logs you out; a slow or dropped request keeps it for the next load.
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) clearToken();
        }
      }

      // 3. Telegram WebApp auto-auth — customer accounts only, so shop pages only
      if (area === "shop" && isInTelegram()) {
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
          done(resp.user);
          return;
        }
      }
      done(null);
    } catch (err) {
      console.error("Auth init failed:", err);
      done(null);
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

  // ── Telegram session login (dashboard or shop) ───────────────
  // The bot signs a dashboard session in as an admin and a shop session in as a customer.
  function startTgSession(): Promise<string> {
    if (!sessionRef.current) {
      const started = api
        .post<{ session_id: string }>("/auth/tg-session", { area }, { token: null })
        .then((r) => r.session_id);
      started.catch(() => { if (sessionRef.current === started) sessionRef.current = null; });
      sessionRef.current = started;
    }
    return sessionRef.current;
  }

  function clearTimers() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  }

  function pollSession(sessionId: string) {
    setLoginPending(true);
    clearTimers();

    pollRef.current = setInterval(async () => {
      try {
        const resp = await api.get<{ status: string; token?: string; user?: AdminUser | TelegramUser | null }>(
          "/auth/poll-session",
          { params: { session_id: sessionId }, token: null },
        );
        if (resp.status === "completed" && resp.token) {
          stopPolling();
          setToken(resp.token);
          // Only sign this page in if the token is for this page's area.
          try {
            if (tokenArea(resp.token) === area) {
              setUser(resp.user ?? (await api.get<AdminUser | TelegramUser>("/auth/me", { token: resp.token })));
            }
          } finally {
            setLoginPending(false);
          }
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

  /** Ends the login attempt: timers stop and the next tap starts a fresh session. */
  const stopPolling = useCallback(() => {
    clearTimers();
    sessionRef.current = null;
    setLoginPending(false);
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
