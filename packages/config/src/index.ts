import { z } from "zod";

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    AUTH_PROVIDER: z.enum(["mock", "auth0", "cognito"]).default("mock"),
    PAYMENT_PROVIDER: z.enum(["mock", "manual", "licensed", "paymongo", "xendit"]).default("mock"),
    PAYOUT_PROVIDER: z.enum(["mock", "manual", "licensed", "paymongo", "xendit"]).default("mock"),
    KYC_PROVIDER: z.enum(["mock", "licensed"]).default("mock"),
    WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
    API_PORT: z.coerce.number().int().positive().default(4000),
    MANUAL_PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false"),
    MANUAL_PAYOUTS_ENABLED: z.enum(["true", "false"]).default("false"),
    GCASH_DESTINATION_NUMBER: z.string().regex(/^09\d{9}$/).optional(),
    MAYA_DESTINATION_NUMBER: z.string().regex(/^09\d{9}$/).optional(),
    PAYOUT_ACCOUNT_ENCRYPTION_KEY: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),
  })
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === "production" &&
      [env.AUTH_PROVIDER, env.PAYMENT_PROVIDER, env.PAYOUT_PROVIDER, env.KYC_PROVIDER].includes("mock")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Mock identity and financial providers are forbidden in production.",
      });
    }
    if (env.PAYMENT_PROVIDER === "manual" && env.MANUAL_PAYMENTS_ENABLED === "true") {
      if (!env.GCASH_DESTINATION_NUMBER) {
        ctx.addIssue({ code: "custom", path: ["GCASH_DESTINATION_NUMBER"], message: "Required when manual payments are enabled." });
      }
      if (!env.MAYA_DESTINATION_NUMBER) {
        ctx.addIssue({ code: "custom", path: ["MAYA_DESTINATION_NUMBER"], message: "Required when manual payments are enabled." });
      }
    }
    if (env.PAYOUT_PROVIDER === "manual" && env.MANUAL_PAYOUTS_ENABLED === "true") {
      if (!env.PAYOUT_ACCOUNT_ENCRYPTION_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["PAYOUT_ACCOUNT_ENCRYPTION_KEY"],
          message: "A 32-byte hexadecimal key is required when manual payouts are enabled.",
        });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

/**
 * Reduces a configured URL to its bare origin. Browsers send an `Origin` header
 * that never carries a trailing slash or an explicit default port, so comparing
 * it against a raw configured value rejects every legitimate request.
 */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

/**
 * Parses the process environment once at boot. Misconfiguration must stop the
 * process with an actionable message instead of surfacing later as a stream of
 * 503 responses from individual endpoints.
 */
export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);
  if (result.success) return result.data;
  const details = result.error.issues
    .map((issue) => "  - " + issue.path.join(".") + ": " + issue.message)
    .join("\n");
  throw new Error("Invalid environment configuration:\n" + details);
}

export const platformSeed = {
  signupBonusCentavos: 3_000n,
  minimumDepositCentavos: 25_000n,
  minimumWithdrawalCentavos: 15_000n,
  withdrawalFeeBasisPoints: 500n,
  withdrawalOpensAt: "09:00",
  withdrawalClosesAt: "18:30",
  withdrawalTimezone: "Asia/Manila",
  withdrawalOutsideWindowMode: "BLOCK",
  currency: "PHP",
  promotionalCreditsWithdrawable: false,
} as const;

export function manualPaymentChannels(source: NodeJS.ProcessEnv = process.env) {
  if (source.PAYMENT_PROVIDER !== "manual" || source.MANUAL_PAYMENTS_ENABLED !== "true") {
    return [];
  }
  return [
    {
      code: "GCASH" as const,
      name: "GCash",
      destinationNumber: source.GCASH_DESTINATION_NUMBER ?? "",
      qrAssetPath: "/payments/gcash-qr.jpg",
    },
    {
      code: "MAYA" as const,
      name: "Maya",
      destinationNumber: source.MAYA_DESTINATION_NUMBER ?? "",
      qrAssetPath: null,
    },
  ];
}

/**
 * Company VIP plan schedule, transcribed from the client-supplied plan sheet in
 * docs/reference. Amounts are centavos. `cycleDays` x `dailyPayoutCentavos`
 * equals `totalReturnCentavos` for every tier, which the seed asserts so a typo
 * cannot ship a schedule whose arithmetic contradicts itself.
 */
export const companyVipPlans = [
  { name: "VIP 1", priceCentavos: 25_000n, dailyPayoutCentavos: 4_000n, cycleDays: 60, totalReturnCentavos: 240_000n },
  { name: "VIP 2", priceCentavos: 30_000n, dailyPayoutCentavos: 5_200n, cycleDays: 60, totalReturnCentavos: 312_000n },
  { name: "VIP 3", priceCentavos: 50_000n, dailyPayoutCentavos: 9_000n, cycleDays: 60, totalReturnCentavos: 540_000n },
  { name: "VIP 4", priceCentavos: 100_000n, dailyPayoutCentavos: 16_500n, cycleDays: 60, totalReturnCentavos: 990_000n },
  { name: "VIP 5", priceCentavos: 200_000n, dailyPayoutCentavos: 31_000n, cycleDays: 60, totalReturnCentavos: 1_860_000n },
  { name: "VIP 6", priceCentavos: 500_000n, dailyPayoutCentavos: 72_000n, cycleDays: 60, totalReturnCentavos: 4_320_000n },
  { name: "VIP 7", priceCentavos: 1_000_000n, dailyPayoutCentavos: 130_000n, cycleDays: 60, totalReturnCentavos: 7_800_000n },
  { name: "VIP 8", priceCentavos: 1_300_000n, dailyPayoutCentavos: 165_000n, cycleDays: 60, totalReturnCentavos: 9_900_000n },
  { name: "VIP 9", priceCentavos: 1_450_000n, dailyPayoutCentavos: 178_000n, cycleDays: 60, totalReturnCentavos: 10_680_000n },
  { name: "VIP 10", priceCentavos: 1_500_000n, dailyPayoutCentavos: 185_000n, cycleDays: 60, totalReturnCentavos: 11_100_000n },
] as const;

/**
 * Three-level commission schedule from the client-supplied level sheet. Rates are
 * basis points. The engine applies these only to a confirmed, documented plan
 * service-fee event; deposits by themselves never qualify.
 */
export const companyCommissionLevels = [
  { level: 1, rateBasisPoints: 2_700, name: "Level 1 direct referral" },
  { level: 2, rateBasisPoints: 200, name: "Level 2 referral" },
  { level: 3, rateBasisPoints: 100, name: "Level 3 referral" },
] as const;

for (const plan of companyVipPlans) {
  if (plan.dailyPayoutCentavos * BigInt(plan.cycleDays) !== plan.totalReturnCentavos) {
    throw new Error(
      "Company VIP schedule is inconsistent for " +
        plan.name +
        ": daily payout x cycle days does not equal the stated total return.",
    );
  }
}
