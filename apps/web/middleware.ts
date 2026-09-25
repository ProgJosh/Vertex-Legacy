import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'nonce-" + nonce + "'" + (development ? " 'unsafe-eval'" : ""),
    "connect-src 'self' " + (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"),
    "upgrade-insecure-requests",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);

  const protectedPath =
    request.nextUrl.pathname.startsWith("/investor") ||
    request.nextUrl.pathname.startsWith("/admin");
  if (protectedPath && !request.cookies.get("vertex_demo_user")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("returnTo", request.nextUrl.pathname);
    return NextResponse.redirect(login, { headers: { "Content-Security-Policy": csp } });
  }

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.jfif).*)"],
};
