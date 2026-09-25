import { fromZonedTime, toZonedTime } from "date-fns-tz";

export type WithdrawalWindow = {
  timezone: string;
  opensAt: string;
  closesAt: string;
  outsideWindowMode: "BLOCK" | "SCHEDULE";
};

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("Time must use HH:mm format.");
  }
  return hour! * 60 + minute!;
}

export function getWithdrawalWindowStatus(now: Date, config: WithdrawalWindow) {
  const local = toZonedTime(now, config.timezone);
  const current = local.getHours() * 60 + local.getMinutes();
  const open = minutes(config.opensAt);
  const close = minutes(config.closesAt);
  const isOpen = current >= open && current <= close;

  const next = new Date(local);
  next.setSeconds(0, 0);
  next.setHours(Math.floor(open / 60), open % 60, 0, 0);
  if (current > close) next.setDate(next.getDate() + 1);
  if (isOpen) next.setTime(local.getTime());

  return {
    isOpen,
    mode: config.outsideWindowMode,
    nextOpenAt: isOpen ? null : fromZonedTime(next, config.timezone).toISOString(),
  };
}

export const Roles = {
  INVESTOR: "INVESTOR",
  FINANCE_COMPLIANCE: "FINANCE_COMPLIANCE",
  ADMIN: "ADMIN",
} as const;

export type RoleName = (typeof Roles)[keyof typeof Roles];

export const Permissions = {
  USER_READ_SELF: "user:read:self",
  WALLET_READ_SELF: "wallet:read:self",
  DEPOSIT_CREATE_SELF: "deposit:create:self",
  WITHDRAWAL_CREATE_SELF: "withdrawal:create:self",
  PLAN_SUBSCRIBE_SELF: "plan:subscribe:self",
  KYC_REVIEW: "kyc:review",
  WITHDRAWAL_REVIEW: "withdrawal:review",
  RECONCILIATION_REVIEW: "reconciliation:review",
  USER_MANAGE: "user:manage",
  PLAN_MANAGE: "plan:manage",
  CONFIG_MANAGE: "config:manage",
  AUDIT_READ: "audit:read",
  ROLE_MANAGE: "role:manage",
} as const;
