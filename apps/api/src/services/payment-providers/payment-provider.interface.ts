import { Injectable, Optional, Inject, forwardRef, OnModuleInit } from "@nestjs/common";
import { PayMongoProvider } from "./paymongo.provider";
import { XenditProvider } from "./xendit.provider";

export type CheckoutSession = {
  provider: string;
  providerReference: string;
  checkoutUrl: string;
  expiresAt?: Date | undefined;
};

export type PayoutInstruction = {
  provider: string;
  providerReference: string;
  status: "pending" | "processing" | "completed" | "failed";
  estimatedArrival?: Date | undefined;
  failureReason?: string | undefined;
};

export type WebhookEvent = {
  eventType:
    | "deposit.completed"
    | "deposit.failed"
    | "deposit.pending"
    | "payout.completed"
    | "payout.failed"
    | "payout.pending";
  providerReference: string;
  amountCentavos: bigint;
  currency: string;
  metadata?: Record<string, unknown> | undefined;
  rawPayload: unknown;
};

export interface PaymentProvider {
  readonly name: string;

  createDepositCheckout(params: {
    depositId: string;
    amountCentavos: bigint;
    currency: string;
    customerEmail: string;
    customerPhone: string | undefined;
    returnUrl: string | undefined;
    webhookUrl: string;
  }): Promise<CheckoutSession>;

  createPayout(params: {
    withdrawalId: string;
    amountCentavos: bigint;
    currency: string;
    destination: {
      type: "ewallet" | "bank_account";
      accountHolderName: string;
      accountDetails: Record<string, string | undefined>;
    };
    webhookUrl: string;
  }): Promise<PayoutInstruction>;

  verifyWebhookSignature(payload: string, signature: string): boolean;

  parseWebhookEvent(rawPayload: unknown, signature: string): WebhookEvent | null;
}

@Injectable()
export class PaymentProviderRegistry implements OnModuleInit {
  private providers = new Map<string, PaymentProvider>();

  constructor(
    @Optional() @Inject(forwardRef(() => PayMongoProvider)) private readonly paymongo?: PayMongoProvider,
    @Optional() @Inject(forwardRef(() => XenditProvider)) private readonly xendit?: XenditProvider,
  ) {}

  onModuleInit(): void {
    if (this.paymongo) this.register(this.paymongo);
    if (this.xendit) this.register(this.xendit);
  }

  register(provider: PaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): PaymentProvider | undefined {
    return this.providers.get(name);
  }

  getActive(): PaymentProvider[] {
    return Array.from(this.providers.values());
  }
}