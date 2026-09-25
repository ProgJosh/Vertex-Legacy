import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { calculateCommission } from "./commission.service";
import { assertBalanced } from "@vertex/types";

describe("commission eligibility math", () => {
  it("calculates a commission from a documented fee event", () => {
    expect(calculateCommission(10_000n, new Prisma.Decimal("0.10"))).toBe(1_000n);
  });

  it("applies the configured cap", () => {
    expect(calculateCommission(100_000n, new Prisma.Decimal("0.10"), 5_000n)).toBe(5_000n);
  });

  it("rejects deposit-like zero-value events", () => {
    expect(() => calculateCommission(0n, new Prisma.Decimal("0.10"))).toThrow();
  });

  it("balances a commission reversal", () => {
    expect(() =>
      assertBalanced([
        { accountId: "user-commission", direction: "DEBIT", amountCentavos: 1_000n },
        { accountId: "commission-expense", direction: "CREDIT", amountCentavos: 1_000n },
      ]),
    ).not.toThrow();
  });
});
