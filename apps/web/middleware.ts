import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "./lib/auth0";

function withCsp(response: NextResponse, csp: string) {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export async function middleware(request: NextRequest) {
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
  const forwardedRequest = new NextRequest(request, { headers });

  const protectedPath =
    request.nextUrl.pathname.startsWith("/investor") ||
    request.nextUrl.pathname.startsWith("/admin");

  const useAuth0 = process.env.AUTH_PROVIDER === "auth0" || process.env.NODE_ENV === "production";
  if (useAuth0) {
    const authResponse = await auth0.middleware(forwardedRequest);
    if (protectedPath) {
      const session = await auth0.getSession(forwardedRequest);
      if (!session) {
        const login = new URL("/auth/login", request.url);
        login.searchParams.set("returnTo", request.nextUrl.pathname + request.nextUrl.search);
        return withCsp(NextResponse.redirect(login), csp);
      }
      try {
        await auth0.getAccessToken(forwardedRequest, authResponse);
      } catch {
        const login = new URL("/auth/login", request.url);
        login.searchParams.set("returnTo", request.nextUrl.pathname + request.nextUrl.search);
        return withCsp(NextResponse.redirect(login), csp);
      }
    }
    return withCsp(authResponse, csp);
  }

  if (protectedPath && !request.cookies.get("vertex_demo_user")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("returnTo", request.nextUrl.pathname);
    return withCsp(NextResponse.redirect(login), csp);
  }

  const response = NextResponse.next({ request: { headers } });
  return withCsp(response, csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.jfif).*)"],
};
