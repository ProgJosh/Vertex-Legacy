export const MONEY_REQUEST_STATUSES = [
  "PENDING",
  "AWAITING_PROVIDER",
  "AWAITING_REVIEW",
  "SCHEDULED",
  "PROCESSING",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "REVERSED",
  "CANCELLED",
] as const;

export type MoneyRequestStatusName = (typeof MONEY_REQUEST_STATUSES)[number];

/** Statuses that still hold reserved funds and have not been settled or released. */
const RESERVABLE: readonly MoneyRequestStatusName[] = [
  "PENDING",
  "AWAITING_REVIEW",
  "SCHEDULED",
  "PROCESSING",
];

/** Statuses from which no further transition is permitted. */
const TERMINAL: readonly MoneyRequestStatusName[] = [
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "REVERSED",
  "CANCELLED",
];

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL as readonly string[]).includes(status);
}

/** True while a withdrawal still holds a reservation that must be settled or released. */
export function holdsReservation(status: string): boolean {
  return (RESERVABLE as readonly string[]).includes(status);
}

export type TransitionCode =
  | "APPROVAL_NOT_PERMITTED"
  | "SETTLEMENT_NOT_PERMITTED"
  | "REVERSAL_NOT_PERMITTED";

/** Raised when a money request is asked to make a transition its status forbids. */
export class TransitionError extends Error {
  constructor(
    readonly code: TransitionCode,
    readonly status: string,
    message: string,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

/**
 * Approving is only meaningful for a request that is still waiting on a human.
 * Scheduled requests are released by the operating-window job once they are due;
 * allowing a manual approval would bypass that time control. Without this guard,
 * an already-settled withdrawal can be pushed back into PROCESSING and settled
 * a second time, which double-debits
 * the wallet's reserved balance because the ledger post is idempotent but the
 * wallet projection increment is not.
 */
export function assertApprovableWithdrawal(status: string): void {
  if (status !== "AWAITING_REVIEW") {
    throw new TransitionError(
      "APPROVAL_NOT_PERMITTED",
      status,
      `A withdrawal in state ${status} is not awaiting a decision and cannot be approved.`,
    );
  }
}

/**
 * Only a request that has completed review and entered PROCESSING may settle.
 * Scheduled requests must first be promoted by the operating-window release job;
 * reviewed requests must first be explicitly approved. Keeping those stages
 * separate prevents either control from being bypassed by the settlement route.
 */
export function assertSettleableWithdrawal(
  status: string,
  _scheduledFor: Date | null,
  _now: Date,
): void {
  if (status === "PROCESSING") return;
  throw new TransitionError(
    "SETTLEMENT_NOT_PERMITTED",
    status,
    `A withdrawal in state ${status} cannot be settled.`,
  );
}

/**
 * Releasing a reservation is only valid while the request still holds one. A
 * settled or already-reversed withdrawal has no reserve left to return, and
 * reversing it would post a second, unbalanced pair of entries against the
 * reserve account.
 */
export function assertReversibleWithdrawal(status: string): void {
  if (!holdsReservation(status)) {
    throw new TransitionError(
      "REVERSAL_NOT_PERMITTED",
      status,
      `A withdrawal in state ${status} holds no reserved funds to release.`,
    );
  }
}

/**
 * Splits a requested withdrawal across the balances that may fund it, in a fixed
 * order, and returns the remainder that cannot be covered. The quote and the
 * reservation must use the same policy, otherwise a quote can promise an amount
 * that the reservation then rejects.
 */
export function allocateWithdrawal(
  requested: bigint,
  balances: { deposited: bigint; commission: bigint; promotional: bigint },
): { fromDeposit: bigint; fromCommission: bigint; fromPromotional: bigint; shortfall: bigint } {
  let remaining = requested;
  const fromDeposit = remaining < balances.deposited ? remaining : balances.deposited;
  remaining -= fromDeposit;
  const fromCommission = remaining < balances.commission ? remaining : balances.commission;
  remaining -= fromCommission;
  const fromPromotional = remaining < balances.promotional ? remaining : balances.promotional;
  remaining -= fromPromotional;
  return { fromDeposit, fromCommission, fromPromotional, shortfall: remaining };
}
