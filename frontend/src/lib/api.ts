/**
 * Centralized API client — replaces the Supabase JS client.
 *
 * ALL data flows through the FastAPI backend. The frontend never
 * imports @supabase/supabase-js. This eliminates:
 * - Exposed anon keys in browser
 * - Direct table access bypassing backend validation
 * - Client-side business logic
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "")}/api`
  : "/api";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RequestOptions {
  token?: string | null;
  params?: Record<string, string | number | boolean | undefined>;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

function setToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("token", token);
    // Also set as cookie for middleware auth check
    document.cookie = `admin_token=${token}; path=/; max-age=${60 * 60 * 24}; SameSite=Lax`;
  }
}

function clearToken(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("token");
    document.cookie = "admin_token=; path=/; max-age=0";
  }
}

async function request<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const token = options.token ?? getToken();

  let url = `${API_BASE}${path}`;

  // Append query params
  if (options.params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    let detail = `Request failed with status ${resp.status}`;
    try {
      const err = await resp.json();
      detail = err.detail || detail;
    } catch {
      // response body not JSON
    }
    throw new ApiError(resp.status, detail);
  }

  // Handle empty responses (204, etc.)
  const text = await resp.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * Upload a file via multipart/form-data.
 */
async function upload<T = unknown>(
  path: string,
  formData: FormData,
  token?: string | null,
): Promise<T> {
  const t = token ?? getToken();
  const headers: Record<string, string> = {};
  if (t) headers["Authorization"] = `Bearer ${t}`;

  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!resp.ok) {
    let detail = "Upload failed";
    try {
      const err = await resp.json();
      detail = err.detail || detail;
    } catch { /* ignore */ }
    throw new ApiError(resp.status, detail);
  }

  const text = await resp.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// ── Public API ─────────────────────────────────────────────────

export const api = {
  get: <T = unknown>(path: string, opts?: RequestOptions) =>
    request<T>("GET", path, undefined, opts),

  post: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("POST", path, body, opts),

  patch: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("PATCH", path, body, opts),

  put: <T = unknown>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("PUT", path, body, opts),

  delete: <T = unknown>(path: string, opts?: RequestOptions) =>
    request<T>("DELETE", path, undefined, opts),

  upload,
};

export { ApiError, getToken, setToken, clearToken };
