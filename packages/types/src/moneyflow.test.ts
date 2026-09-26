import { describe, expect, it } from "vitest";
import {
  allocateWithdrawal,
  assertApprovableWithdrawal,
  assertReversibleWithdrawal,
  assertSettleableWithdrawal,
  holdsReservation,
  isTerminalStatus,
  TransitionError,
} from "./moneyflow";

describe("withdrawal state transitions", () => {
  it("allows only finance-review withdrawals to be approved", () => {
    expect(() => assertApprovableWithdrawal("AWAITING_REVIEW")).not.toThrow();

    for (const status of ["SCHEDULED", "PROCESSING", "COMPLETED", "REVERSED"]) {
      expect(() => assertApprovableWithdrawal(status)).toThrowError(
        expect.objectContaining<Partial<TransitionError>>({ code: "APPROVAL_NOT_PERMITTED" }),
      );
    }
  });

  it("allows settlement only after a request enters processing", () => {
    const now = new Date("2026-09-26T08:00:00.000Z");
    expect(() => assertSettleableWithdrawal("PROCESSING", null, now)).not.toThrow();

    expect(() =>
      assertSettleableWithdrawal("AWAITING_REVIEW", null, now),
    ).toThrowError(expect.objectContaining<Partial<TransitionError>>({
      code: "SETTLEMENT_NOT_PERMITTED",
    }));
    expect(() =>
      assertSettleableWithdrawal("SCHEDULED", new Date("2026-09-26T07:00:00.000Z"), now),
    ).toThrowError(expect.objectContaining<Partial<TransitionError>>({
      code: "SETTLEMENT_NOT_PERMITTED",
    }));
  });

  it("releases funds only while a reservation still exists", () => {
    for (const status of ["PENDING", "AWAITING_REVIEW", "SCHEDULED", "PROCESSING"]) {
      expect(holdsReservation(status)).toBe(true);
      expect(() => assertReversibleWithdrawal(status)).not.toThrow();
    }
    for (const status of ["COMPLETED", "REJECTED", "FAILED", "REVERSED", "CANCELLED"]) {
      expect(isTerminalStatus(status)).toBe(true);
      expect(() => assertReversibleWithdrawal(status)).toThrowError(
        expect.objectContaining<Partial<TransitionError>>({ code: "REVERSAL_NOT_PERMITTED" }),
      );
    }
  });
});

describe("withdrawal balance allocation", () => {
  it("uses deposited, commission, then promotional funds without over-allocation", () => {
    expect(
      allocateWithdrawal(1_250n, {
        deposited: 800n,
        commission: 300n,
        promotional: 500n,
      }),
    ).toEqual({
      fromDeposit: 800n,
      fromCommission: 300n,
      fromPromotional: 150n,
      shortfall: 0n,
    });
  });

  it("returns an exact shortfall when available balances are insufficient", () => {
    expect(
      allocateWithdrawal(1_500n, {
        deposited: 800n,
        commission: 300n,
        promotional: 200n,
      }),
    ).toEqual({
      fromDeposit: 800n,
      fromCommission: 300n,
      fromPromotional: 200n,
      shortfall: 200n,
    });
  });
});
