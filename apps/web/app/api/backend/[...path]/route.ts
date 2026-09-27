import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { isAllowedOrigin } from "@/lib/origins";

const baseUrl = process.env.INTERNAL_API_URL ?? "http://localhost:4000/v1";

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  if (
    request.method !== "GET" &&
    !isAllowedOrigin(request.headers.get("origin"))
  ) {
    return NextResponse.json({ message: "Origin rejected." }, { status: 403 });
  }

  const { path } = await context.params;
  const headers = new Headers();
  headers.set(
    "content-type",
    request.headers.get("content-type") ?? "application/json",
  );
  const useAuth0 =
    process.env.AUTH_PROVIDER === "auth0" ||
    process.env.NODE_ENV === "production";
  if (useAuth0) {
    try {
      const { token } = await auth0.getAccessToken();
      headers.set("authorization", "Bearer " + token);
    } catch {
      return NextResponse.json(
        { message: "Sign in to continue." },
        { status: 401 },
      );
    }
  } else {
    const jar = await cookies();
    const demoUser = jar.get("vertex_demo_user")?.value;
    if (!demoUser)
      return NextResponse.json(
        { message: "Sign in to continue." },
        { status: 401 },
      );
    headers.set("x-demo-user", demoUser);
  }
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
  const url = baseUrl + "/" + path.join("/") + request.nextUrl.search;
  let response = await fetch(url, init);
  if (request.method === "GET" || request.method === "HEAD") {
    for (const delay of [500, 1_000, 2_000, 4_000]) {
      if (response.status !== 503) break;
      await wait(delay);
      response = await fetch(url, init);
    }
  }
  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
    },
  });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
