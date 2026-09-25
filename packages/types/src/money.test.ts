import { describe, expect, it } from "vitest";
import {
  assertBalanced,
  calculateWithdrawal,
  getWithdrawalWindowStatus,
  parseCentavos,
} from "./index";

describe("money", () => {
  it("parses PHP without floating point", () => {
    expect(parseCentavos("1,234.56")).toBe(123456n);
  });

  it("calculates a 5% withdrawal fee and net amount", () => {
    expect(calculateWithdrawal(10_000n, 500n)).toEqual({
      requested: 10_000n,
      fee: 500n,
      net: 9_500n,
    });
  });

  it("rejects an unbalanced ledger transaction", () => {
    expect(() =>
      assertBalanced([
        { accountId: "a", direction: "DEBIT", amountCentavos: 100n },
        { accountId: "b", direction: "CREDIT", amountCentavos: 99n },
      ]),
    ).toThrow(/not balanced/);
  });
});

describe("withdrawal window in Asia/Manila", () => {
  const config = {
    timezone: "Asia/Manila",
    opensAt: "09:00",
    closesAt: "18:30",
    outsideWindowMode: "BLOCK" as const,
  };

  it("opens at 09:00 Manila time", () => {
    expect(getWithdrawalWindowStatus(new Date("2026-09-25T01:00:00Z"), config).isOpen).toBe(true);
  });

  it("blocks outside configured hours and reports reopening", () => {
    const result = getWithdrawalWindowStatus(new Date("2026-09-25T12:00:00Z"), config);
    expect(result.isOpen).toBe(false);
    expect(result.nextOpenAt).toBe("2026-09-26T01:00:00.000Z");
  });
});
