import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const baseUrl = process.env.INTERNAL_API_URL ?? "http://localhost:4000/v1";

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const origin = request.headers.get("origin");
  const allowedOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  if (request.method !== "GET" && origin && origin !== allowedOrigin) {
    return NextResponse.json({ message: "Origin rejected." }, { status: 403 });
  }
  const { path } = await context.params;
  const jar = await cookies();
  const demoUser = jar.get("vertex_demo_user")?.value;
  if (!demoUser) return NextResponse.json({ message: "Sign in to continue." }, { status: 401 });
  const headers = new Headers();
  headers.set("content-type", request.headers.get("content-type") ?? "application/json");
  headers.set("x-demo-user", demoUser);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }
  const response = await fetch(baseUrl + "/" + path.join("/") + request.nextUrl.search, init);
  return new NextResponse(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
