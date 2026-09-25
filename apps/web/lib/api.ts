import { cookies } from "next/headers";

const baseUrl = process.env.INTERNAL_API_URL ?? "http://localhost:4000/v1";

export async function apiGet<T>(path: string): Promise<T> {
  const jar = await cookies();
  const demoUser = jar.get("vertex_demo_user")?.value;
  const response = await fetch(baseUrl + path, {
    headers: demoUser ? { "x-demo-user": demoUser } : {},
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
