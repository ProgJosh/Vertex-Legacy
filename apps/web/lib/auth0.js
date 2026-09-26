import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";

const audience = process.env.AUTH0_AUDIENCE ?? "https://api.vertex-legacy.com";
const apiBaseUrl = process.env.INTERNAL_API_URL ?? "http://localhost:4000/v1";

export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience,
    scope: "openid profile email",
  },
  routes: {
    callback: "/auth/callback",
  },
  enableAccessTokenEndpoint: false,
  signInReturnToPath: "/investor",
  onCallback: async (error, context, session) => {
    const baseUrl =
      context.appBaseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000";

    if (error || !session?.tokenSet.accessToken) {
      return NextResponse.redirect(
        new URL("/login?error=authentication", baseUrl),
      );
    }

    const provision = await fetch(apiBaseUrl + "/auth/provision", {
      method: "POST",
      headers: {
        authorization: "Bearer " + session.tokenSet.accessToken,
      },
      cache: "no-store",
    });

    if (!provision.ok) {
      return NextResponse.redirect(
        new URL("/login?error=provisioning", baseUrl),
      );
    }

    const returnTo =
      context.returnTo?.startsWith("/") && !context.returnTo.startsWith("//")
        ? context.returnTo
        : "/investor";
    return NextResponse.redirect(new URL(returnTo, baseUrl));
  },
});
