import { cookies } from "next/headers";
import { auth0 } from "./auth0";

const baseUrl = process.env.INTERNAL_API_URL ?? "http://localhost:4000/v1";

export async function apiGet<T>(path: string): Promise<T> {
  const isPublicPath = path === "/public" || path.startsWith("/public/");
  const useAuth0 = process.env.AUTH_PROVIDER === "auth0" || process.env.NODE_ENV === "production";
  const headers: Record<string, string> = {};
  if (isPublicPath) {
    // Public catalogue/configuration endpoints must also render for signed-out
    // visitors. Asking Auth0 for a session token here turns a public page into
    // an empty fallback in production.
  } else if (useAuth0) {
    const { token } = await auth0.getAccessToken();
    headers.authorization = "Bearer " + token;
  } else {
    const jar = await cookies();
    const demoUser = jar.get("vertex_demo_user")?.value;
    if (demoUser) headers["x-demo-user"] = demoUser;
  }
  const response = await fetch(baseUrl + path, {
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Service unavailable" }));
    throw new Error(error.message ?? "Service unavailable");
  }
  return response.json() as Promise<T>;
}

export async function optionalApiGet<T>(path: string, fallback: T): Promise<T> {
  try {
    return await apiGet<T>(path);
  } catch {
    return fallback;
  }
}
