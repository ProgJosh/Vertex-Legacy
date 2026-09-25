import { describe, expect, it } from "vitest";
import {
  assertBalanced,
  canIssueSignupBonus,
  ensureMinimum,
  hasAllPermissions,
  sameIdempotentRequest,
  withdrawableBalance,
} from "./index";

describe("sign-up bonus issuance", () => {
  it("issues once to a verified individual", () => {
    expect(
      canIssueSignupBonus({
        alreadyIssuedForUser: false,
        verifiedFingerprintUsedByAnotherUser: false,
        kycVerified: true,
      }),
    ).toBe(true);
  });

  it("prevents duplicate bonuses for the same user or verified fingerprint", () => {
    expect(
      canIssueSignupBonus({
        alreadyIssuedForUser: true,
        verifiedFingerprintUsedByAnotherUser: false,
        kycVerified: true,
      }),
    ).toBe(false);
    expect(
      canIssueSignupBonus({
        alreadyIssuedForUser: false,
        verifiedFingerprintUsedByAnotherUser: true,
        kycVerified: true,
      }),
    ).toBe(false);
  });
});

describe("minimums and balance policy", () => {
  it("enforces the ₱250 deposit minimum", () => {
    expect(() => ensureMinimum(24_999n, 25_000n, "Deposit")).toThrow(/minimum/);
    expect(() => ensureMinimum(25_000n, 25_000n, "Deposit")).not.toThrow();
  });

  it("enforces the ₱150 withdrawal minimum", () => {
    expect(() => ensureMinimum(14_999n, 15_000n, "Withdrawal")).toThrow(/minimum/);
  });

  it("keeps promotional credit out of withdrawable funds by default", () => {
    expect(
      withdrawableBalance({
        deposited: 10_000n,
        commission: 2_000n,
        promotional: 3_000n,
        promotionalWithdrawable: false,
      }),
    ).toBe(12_000n);
  });

  it("detects insufficient withdrawable funds", () => {
    const available = withdrawableBalance({
      deposited: 10_000n,
      commission: 0n,
      promotional: 3_000n,
      promotionalWithdrawable: false,
    });
    expect(15_000n > available).toBe(true);
  });
});

describe("ledger flow balancing", () => {
  it("balances a deposit settlement", () => {
    expect(() =>
      assertBalanced([
        { accountId: "provider-cash", direction: "DEBIT", amountCentavos: 25_000n },
        { accountId: "user-cash", direction: "CREDIT", amountCentavos: 25_000n },
      ]),
    ).not.toThrow();
  });

  it("balances a withdrawal settlement including the fee", () => {
    expect(() =>
      assertBalanced([
        { accountId: "reserve", direction: "DEBIT", amountCentavos: 20_000n },
        { accountId: "provider-cash", direction: "CREDIT", amountCentavos: 19_000n },
        { accountId: "fee-revenue", direction: "CREDIT", amountCentavos: 1_000n },
      ]),
    ).not.toThrow();
  });

  it("balances a failed payout reversal", () => {
    expect(() =>
      assertBalanced([
        { accountId: "reserve", direction: "DEBIT", amountCentavos: 20_000n },
        { accountId: "user-cash", direction: "CREDIT", amountCentavos: 15_000n },
        { accountId: "commission", direction: "CREDIT", amountCentavos: 5_000n },
      ]),
    ).not.toThrow();
  });
});

describe("authorization and idempotency", () => {
  it("denies administrator actions without every required permission", () => {
    expect(hasAllPermissions(["user:read:self"], ["config:manage"])).toBe(false);
  });

  it("allows only an identical idempotent replay", () => {
    expect(
      sameIdempotentRequest(
        { ownerId: "u1", amountCentavos: 25_000n },
        { ownerId: "u1", amountCentavos: 25_000n },
      ),
    ).toBe(true);
    expect(
      sameIdempotentRequest(
        { ownerId: "u1", amountCentavos: 25_000n },
        { ownerId: "u1", amountCentavos: 30_000n },
      ),
    ).toBe(false);
  });
});
