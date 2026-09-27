import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptPayoutIdentifier, encryptPayoutIdentifier } from "./payout-account-crypto";

describe("payout account encryption", () => {
  beforeEach(() => vi.stubEnv("PAYOUT_ACCOUNT_ENCRYPTION_KEY", "11".repeat(32)));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips a wallet identifier without storing it as plaintext", () => {
    const encrypted = encryptPayoutIdentifier("09171234567");

    expect(encrypted).not.toContain("09171234567");
    expect(decryptPayoutIdentifier(encrypted)).toBe("09171234567");
  });

  it("rejects a modified ciphertext", () => {
    const encrypted = encryptPayoutIdentifier("09171234567");
    const tampered = encrypted.slice(0, -1) + (encrypted.endsWith("A") ? "B" : "A");

    expect(() => decryptPayoutIdentifier(tampered)).toThrow();
  });
});
