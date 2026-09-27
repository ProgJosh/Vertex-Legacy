import { afterEach, describe, expect, it, vi } from "vitest";
import { signInHref, signUpHref } from "./auth-links";

describe("canonical Auth0 links", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the configured Auth0 origin so the transaction and callback share a host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_PROVIDER", "auth0");
    vi.stubEnv("APP_BASE_URL", "https://vertex-legacy.example.workers.dev");

    expect(signInHref()).toBe(
      "https://vertex-legacy.example.workers.dev/auth/login",
    );
    expect(signUpHref()).toBe(
      "https://vertex-legacy.example.workers.dev/auth/login?screen_hint=signup&returnTo=%2Finvestor%2Fonboarding",
    );
  });

  it("keeps local mock authentication links relative", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_PROVIDER", "mock");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");

    expect(signInHref()).toBe("/auth/login");
    expect(signUpHref()).toBe("/auth/login");
  });
});