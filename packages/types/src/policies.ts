export function ensureMinimum(amount: bigint, minimum: bigint, label: string) {
  if (amount < minimum) throw new Error(label + " minimum not met.");
}

export function withdrawableBalance(input: {
  deposited: bigint;
  commission: bigint;
  promotional: bigint;
  promotionalWithdrawable: boolean;
}) {
  return (
    input.deposited +
    input.commission +
    (input.promotionalWithdrawable ? input.promotional : 0n)
  );
}

export function canIssueSignupBonus(input: {
  alreadyIssuedForUser: boolean;
  verifiedFingerprintUsedByAnotherUser: boolean;
  kycVerified: boolean;
}) {
  return (
    input.kycVerified &&
    !input.alreadyIssuedForUser &&
    !input.verifiedFingerprintUsedByAnotherUser
  );
}

export function sameIdempotentRequest(
  existing: { ownerId: string; amountCentavos: bigint },
  incoming: { ownerId: string; amountCentavos: bigint },
) {
  return (
    existing.ownerId === incoming.ownerId &&
    existing.amountCentavos === incoming.amountCentavos
  );
}

export function hasAllPermissions(granted: readonly string[], required: readonly string[]) {
  return required.every((permission) => granted.includes(permission));
}
