import { z } from "zod";

export const centavoStringSchema = z
  .string()
  .regex(/^\d+$/, "Expected integer centavos.");
export const moneyInputSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/);

export const manualPaymentChannelSchema = z.enum(["GCASH", "MAYA"]);

export const createDepositSchema = z.object({
  amount: moneyInputSchema,
  idempotencyKey: z.string().uuid(),
  paymentChannel: manualPaymentChannelSchema.optional(),
});

export const submitManualDepositSchema = z.object({
  paymentReference: z
    .string()
    .trim()
    .min(6, "Enter the transaction reference from the wallet receipt.")
    .max(100)
    .regex(/^[A-Za-z0-9-]+$/, "Use only letters, numbers, and hyphens."),
  senderName: z.string().trim().min(2).max(120),
  senderMobileLast4: z
    .string()
    .regex(/^\d{4}$/, "Enter the sender mobile number's last 4 digits."),
});

export const manualPayoutChannelSchema = z.enum(["GCASH", "MAYA"]);

export const createPayoutAccountSchema = z.object({
  channel: manualPayoutChannelSchema,
  accountHolderName: z.string().trim().min(2).max(160),
  accountIdentifier: z
    .string()
    .regex(/^09\d{9}$/, "Enter an 11-digit Philippine mobile number."),
});

export const submitManualPayoutSchema = z.object({
  transactionReference: z
    .string()
    .trim()
    .min(6)
    .max(100)
    .regex(/^[A-Za-z0-9-]+$/, "Use only letters, numbers, and hyphens."),
  note: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(8).max(500),
});

export const createWithdrawalSchema = z.object({
  amount: moneyInputSchema,
  payoutAccountId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  mfaCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const withdrawalQuoteSchema = z.object({
  amount: moneyInputSchema,
  payoutAccountId: z.string().uuid(),
});

export type CreateDepositInput = z.infer<typeof createDepositSchema>;
export type SubmitManualDepositInput = z.infer<
  typeof submitManualDepositSchema
>;
export type CreatePayoutAccountInput = z.infer<
  typeof createPayoutAccountSchema
>;
export type SubmitManualPayoutInput = z.infer<typeof submitManualPayoutSchema>;
export type CreateWithdrawalInput = z.infer<typeof createWithdrawalSchema>;
export type WithdrawalQuoteInput = z.infer<typeof withdrawalQuoteSchema>;
