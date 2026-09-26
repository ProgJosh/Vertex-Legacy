import { normalizeOrigin } from "@vertex/config";

/**
 * The browser sends an `Origin` header that never contains a trailing slash or
 * an explicit default port. Deployment configuration frequently does, which
 * silently rejects every state-changing request with 403. Both sides are
 * normalized to a bare origin before comparison, and a comma-separated
 * allow-list is supported so staging and production can share one variable.
 */
const configuredOrigins = () =>
  [process.env.WEB_ORIGIN, process.env.APP_BASE_URL, process.env.NEXT_PUBLIC_APP_URL]
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

export function allowedOrigins(): string[] {
  return [
    ...new Set(
      configuredOrigins()
        .map(normalizeOrigin)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowedOrigins().includes(normalized);
}
