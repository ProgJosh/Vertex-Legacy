const DECIMAL_MONEY = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export type Centavos = bigint;

export function parseCentavos(value: string): Centavos {
  const normalized = value.trim().replaceAll(",", "");
  const match = DECIMAL_MONEY.exec(normalized);
  if (!match) {
    throw new Error("Amount must be a positive decimal with at most two decimal places.");
  }
  const pesos = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return pesos * 100n + BigInt(fraction || "0");
}

export function formatCentavos(value: Centavos): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const pesos = absolute / 100n;
  const centavos = (absolute % 100n).toString().padStart(2, "0");
  return sign + pesos.toLocaleString("en-PH") + "." + centavos;
}

export function calculateBasisPointAmount(amount: Centavos, basisPoints: bigint): Centavos {
  if (amount < 0n || basisPoints < 0n) {
    throw new Error("Amount and rate must be non-negative.");
  }
  return (amount * basisPoints + 5_000n) / 10_000n;
}

export function calculateWithdrawal(amount: Centavos, feeBasisPoints: bigint) {
  const fee = calculateBasisPointAmount(amount, feeBasisPoints);
  if (fee >= amount) {
    throw new Error("Withdrawal fee must be lower than the requested amount.");
  }
  return { requested: amount, fee, net: amount - fee };
}

export type LedgerLine = {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amountCentavos: Centavos;
};

export function assertBalanced(lines: readonly LedgerLine[]): void {
  if (lines.length < 2) {
    throw new Error("A ledger transaction needs at least two entries.");
  }
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    if (line.amountCentavos <= 0n) {
      throw new Error("Ledger entry amounts must be positive.");
    }
    if (line.direction === "DEBIT") debits += line.amountCentavos;
    else credits += line.amountCentavos;
  }
  if (debits !== credits) {
    throw new Error("Ledger transaction is not balanced.");
  }
}
