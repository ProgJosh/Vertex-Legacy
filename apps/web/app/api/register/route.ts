import { NextRequest, NextResponse } from "next/server";

const baseUrl = process.env.INTERNAL_API_URL ?? "http://localhost:4000/v1";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.AUTH_PROVIDER !== "mock") {
    return NextResponse.json(
      { message: "Registration is handled by the configured identity provider." },
      { status: 404 },
    );
  }
  const response = await fetch(baseUrl + "/auth/mock/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
  return new NextResponse(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}
