const usesAuth0 = () =>
  process.env.AUTH_PROVIDER === "auth0" || process.env.NODE_ENV === "production";

function canonicalAuthUrl(pathname: string, searchParams?: URLSearchParams) {
  if (!usesAuth0()) return pathname;

  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) return pathname + (searchParams?.size ? `?${searchParams}` : "");

  const url = new URL(pathname, baseUrl);
  if (searchParams) url.search = searchParams.toString();
  return url.toString();
}

export function signInHref(returnTo?: string) {
  const searchParams = new URLSearchParams();
  if (returnTo) searchParams.set("returnTo", returnTo);
  return canonicalAuthUrl("/auth/login", searchParams);
}

export function signUpHref(returnTo = "/investor/onboarding") {
  const searchParams = new URLSearchParams({
    screen_hint: "signup",
    returnTo,
  });
  return canonicalAuthUrl("/auth/login", searchParams);
}

export function auth0Enabled() {
  return usesAuth0();
}