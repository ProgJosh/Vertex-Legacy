import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const baseUrl = process.env.INTERNAL_API_URL ?? "http://localhost:4000/v1";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.AUTH_PROVIDER !== "mock") {
    return NextResponse.json(
      { message: "Use the configured enterprise identity provider." },
      { status: 404 },
    );
  }
  const { email } = z.object({ email: z.string().email() }).parse(await request.json());
  const response = await fetch(baseUrl + "/auth/mock/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const result = await response.json();
  if (!response.ok) return NextResponse.json(result, { status: response.status });
  const jar = await cookies();
  jar.set("vertex_demo_user", result.userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return NextResponse.json(result);
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete("vertex_demo_user");
  return NextResponse.json({ signedOut: true });
}
