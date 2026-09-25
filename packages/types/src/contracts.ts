import { z } from "zod";

export const centavoStringSchema = z.string().regex(/^\d+$/, "Expected integer centavos.");
export const moneyInputSchema = z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/);

export const createDepositSchema = z.object({
  amount: moneyInputSchema,
  idempotencyKey: z.string().uuid(),
});

export const createWithdrawalSchema = z.object({
  amount: moneyInputSchema,
  payoutAccountId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  mfaCode: z.string().regex(/^\d{6}$/),
});

export const withdrawalQuoteSchema = z.object({
  amount: moneyInputSchema,
  payoutAccountId: z.string().uuid(),
});

export type CreateDepositInput = z.infer<typeof createDepositSchema>;
export type CreateWithdrawalInput = z.infer<typeof createWithdrawalSchema>;
export type WithdrawalQuoteInput = z.infer<typeof withdrawalQuoteSchema>;
