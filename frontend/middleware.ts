import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side auth guard.
 *
 * - Admin routes require a token cookie or header
 * - Shop routes are public (auth handled client-side via Telegram)
 * - Login page redirects to dashboard if already authenticated
 *
 * This is a lightweight check — actual JWT verification happens on the backend.
 * The middleware only checks for token presence to avoid rendering protected
 * pages before the client can verify.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token =
    request.cookies.get("admin_token")?.value ||
    request.headers.get("authorization")?.replace("Bearer ", "");

  // Admin routes — require token presence
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) {
    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Login page — redirect to dashboard if already has token
  if (pathname === "/login" && token) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login"],
};
