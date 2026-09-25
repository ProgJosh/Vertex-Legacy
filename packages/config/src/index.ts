import { z } from "zod";

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    AUTH_PROVIDER: z.enum(["mock", "auth0", "cognito"]).default("mock"),
    PAYMENT_PROVIDER: z.enum(["mock", "licensed"]).default("mock"),
    PAYOUT_PROVIDER: z.enum(["mock", "licensed"]).default("mock"),
    KYC_PROVIDER: z.enum(["mock", "licensed"]).default("mock"),
    WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
    API_PORT: z.coerce.number().int().positive().default(4000),
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
  });

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
