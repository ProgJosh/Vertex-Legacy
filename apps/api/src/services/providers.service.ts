import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { PaymentProviderRegistry, PaymentProvider, WebhookEvent, CheckoutSession, PayoutInstruction } from "./payment-providers";

export type Checkout = {
  provider: string;
  providerReference: string;
  checkoutUrl: string;
};

@Injectable()
export class ProvidersService {
  private readonly activePaymentProvider: string;
  private readonly activePayoutProvider: string;
  private readonly activeKycProvider: string;

  constructor(private readonly registry: PaymentProviderRegistry) {
    this.activePaymentProvider = process.env.PAYMENT_PROVIDER ?? "mock";
    this.activePayoutProvider = process.env.PAYOUT_PROVIDER ?? "mock";
    this.activeKycProvider = process.env.KYC_PROVIDER ?? "mock";
  }

  private getPaymentProvider(): PaymentProvider {
    const provider = this.registry.get(this.activePaymentProvider);
    if (!provider && this.activePaymentProvider !== "mock") {
      throw new ServiceUnavailableException(
        `Payment provider "${this.activePaymentProvider}" not registered`,
      );
    }
    return provider!;
  }

  private getPayoutProvider(): PaymentProvider {
    const provider = this.registry.get(this.activePayoutProvider);
    if (!provider && this.activePayoutProvider !== "mock") {
      throw new ServiceUnavailableException(
        `Payout provider "${this.activePayoutProvider}" not registered`,
      );
    }
    return provider!;
  }

  assertSandbox(kind: "payment" | "payout" | "kyc"): void {
    const key =
      kind === "payment" ? "PAYMENT_PROVIDER" : kind === "payout" ? "PAYOUT_PROVIDER" : "KYC_PROVIDER";
    if (process.env[key] === "mock" && process.env.NODE_ENV !== "production") {
      return;
    }
    if (process.env[key] !== "mock") {
      return;
    }
    throw new ServiceUnavailableException("The requested sandbox provider is not enabled.");
  }

  assertPayoutAvailable(): void {
    if (this.activePayoutProvider === "mock") {
      throw new ServiceUnavailableException(
        "Payouts are not enabled. A licensed payout adapter must be configured before withdrawals can be requested.",
      );
    }
  }

  async createDepositCheckout(params: {
    depositId: string;
    amountCentavos: bigint;
    currency: string;
    customerEmail: string;
    customerPhone: string | undefined;
    returnUrl: string | undefined;
    webhookUrl: string;
  }): Promise<Checkout> {
    if (this.activePaymentProvider === "mock") {
      return this.createMockDepositCheckout(params.depositId);
    }

    const provider = this.getPaymentProvider();
    const session = await provider.createDepositCheckout(params);
    return {
      provider: session.provider,
      providerReference: session.providerReference,
      checkoutUrl: session.checkoutUrl,
    };
  }

  private createMockDepositCheckout(depositId: string): Checkout {
    return {
      provider: "mock",
      providerReference: "mock_dep_" + randomUUID(),
      checkoutUrl: "/investor/cash-in?depositId=" + encodeURIComponent(depositId),
    };
  }

  async createPayout(params: {
    withdrawalId: string;
    amountCentavos: bigint;
    currency: string;
    destination: {
      type: "ewallet" | "bank_account";
      accountHolderName: string;
      accountDetails: Record<string, string | undefined>;
    };
    webhookUrl: string;
  }): Promise<{
    provider: string;
    providerReference: string;
    status: "pending" | "processing" | "completed" | "failed";
  }> {
    if (this.activePayoutProvider === "mock") {
      return {
        provider: "mock",
        providerReference: "mock_payout_" + randomUUID(),
        status: "pending",
      };
    }

    const provider = this.getPayoutProvider();
    const instruction = await provider.createPayout(params);
    return {
      provider: instruction.provider,
      providerReference: instruction.providerReference,
      status: instruction.status,
    };
  }

  sign(payload: string): string {
    const secret = process.env.MOCK_PROVIDER_WEBHOOK_SECRET ?? "local-development-only";
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  verify(payload: string, signature: string): boolean {
    if (this.activePaymentProvider === "mock" && this.activePayoutProvider === "mock") {
      const expected = Buffer.from(this.sign(payload), "utf8");
      const received = Buffer.from(signature, "utf8");
      return expected.length === received.length && timingSafeEqual(expected, received);
    }

    const paymentProvider = this.registry.get(this.activePaymentProvider);
    if (paymentProvider?.verifyWebhookSignature(payload, signature)) {
      return true;
    }

    const payoutProvider = this.registry.get(this.activePayoutProvider);
    if (payoutProvider?.verifyWebhookSignature(payload, signature)) {
      return true;
    }

    return false;
  }

  parseWebhookEvent(rawPayload: unknown, signature: string): WebhookEvent | null {
    if (this.activePaymentProvider === "mock" && this.activePayoutProvider === "mock") {
      return null;
    }

    const paymentProvider = this.registry.get(this.activePaymentProvider);
    if (paymentProvider) {
      const event = paymentProvider.parseWebhookEvent(rawPayload, signature);
      if (event) return event;
    }

    const payoutProvider = this.registry.get(this.activePayoutProvider);
    if (payoutProvider) {
      const event = payoutProvider.parseWebhookEvent(rawPayload, signature);
      if (event) return event;
    }

    return null;
  }
}