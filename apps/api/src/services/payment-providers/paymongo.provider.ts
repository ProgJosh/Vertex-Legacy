import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentProvider, CheckoutSession, PayoutInstruction, WebhookEvent } from "./payment-provider.interface";
import { PaymentProviderRegistry } from "./payment-provider.interface";

interface PayMongoSource {
  id: string;
  type: "gcash" | "grab_pay" | "card" | "dob" | "bpi" | "unionbank" | "paymaya";
  status: "pending" | "chargeable" | "paid" | "failed" | "cancelled";
  amount: number;
  currency: string;
  redirect: { checkout_url: string };
  metadata?: Record<string, unknown>;
}

interface PayMongoPayment {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  source: PayMongoSource;
  description: string;
  metadata?: Record<string, unknown>;
}

interface PayMongoPayout {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "processing" | "completed" | "failed";
  destination: {
    type: "gcash" | "bank_account";
    name: string;
    account_number: string;
  };
  failure_code?: string;
  failure_message?: string;
}

@Injectable()
export class PayMongoProvider implements PaymentProvider {
  readonly name = "paymongo";

  private readonly baseUrl = "https://api.paymongo.com/v1";

  private getSecretKey(): string {
    const key = process.env.PAYMONGO_SECRET_KEY ?? "";
    if (!key) throw new Error("PAYMONGO_SECRET_KEY is required");
    return key;
  }

  private getWebhookSecret(): string {
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET ?? "";
    if (!secret) throw new Error("PAYMONGO_WEBHOOK_SECRET is required");
    return secret;
  }

  private authHeader(): string {
    return "Basic " + Buffer.from(this.getSecretKey() + ":").toString("base64");
  }

  async createDepositCheckout(params: {
    depositId: string;
    amountCentavos: bigint;
    currency: string;
    customerEmail: string;
    customerPhone: string | undefined;
    returnUrl: string | undefined;
    webhookUrl: string;
  }): Promise<CheckoutSession> {
    const amount = Number(params.amountCentavos) / 100;
    const body = {
      data: {
        attributes: {
          amount: Math.round(amount * 100),
          currency: params.currency.toUpperCase(),
          type: "gcash",
          redirect: {
            success: params.returnUrl ?? `${process.env.WEB_ORIGIN}/investor/wallet?deposit=success`,
            failed: params.returnUrl ?? `${process.env.WEB_ORIGIN}/investor/wallet?deposit=failed`,
          },
          metadata: {
            deposit_id: params.depositId,
            customer_email: params.customerEmail,
            customer_phone: params.customerPhone,
          },
        },
      },
    };

    const response = await fetch(`${this.baseUrl}/sources`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ServiceUnavailableException(
        `PayMongo source creation failed: ${JSON.stringify(error)}`,
      );
    }

    const result = (await response.json()) as { data: PayMongoSource };
    const source = result.data;

    if (!source.redirect?.checkout_url) {
      throw new ServiceUnavailableException("PayMongo did not return a checkout URL");
    }

    return {
      provider: this.name,
      providerReference: source.id,
      checkoutUrl: source.redirect.checkout_url,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  async createPayout(params: {
    withdrawalId: string;
    amountCentavos: bigint;
    currency: string;
    destination: {
      type: "ewallet" | "bank_account";
      accountHolderName: string;
      accountDetails: Record<string, string>;
    };
    webhookUrl: string;
  }): Promise<PayoutInstruction> {
    const amount = Number(params.amountCentavos) / 100;
    const isEwallet = params.destination.type === "ewallet";

    const body = {
      data: {
        attributes: {
          amount: Math.round(amount * 100),
          currency: params.currency.toUpperCase(),
          method: isEwallet ? "gcash" : "bank_transfer",
          destination: isEwallet
            ? {
                type: "gcash",
                name: params.destination.accountHolderName,
                account_number: params.destination.accountDetails.mobileNumber,
              }
            : {
                type: "bank_account",
                name: params.destination.accountHolderName,
                account_number: params.destination.accountDetails.accountNumber,
                bank_code: params.destination.accountDetails.bankCode,
              },
          description: `Withdrawal ${params.withdrawalId}`,
          metadata: {
            withdrawal_id: params.withdrawalId,
          },
        },
      },
    };

    const response = await fetch(`${this.baseUrl}/payouts`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ServiceUnavailableException(
        `PayMongo payout creation failed: ${JSON.stringify(error)}`,
      );
    }

    const result = (await response.json()) as { data: PayMongoPayout };
    const payout = result.data;

    return {
      provider: this.name,
      providerReference: payout.id,
      status: this.mapPayoutStatus(payout.status),
      estimatedArrival: this.estimateArrival(payout.status),
      failureReason: payout.failure_message,
    };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    try {
      const expected = createHmac("sha256", this.getWebhookSecret())
        .update(payload)
        .digest("hex");
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  parseWebhookEvent(rawPayload: unknown, signature: string): WebhookEvent | null {
    if (!this.verifyWebhookSignature(JSON.stringify(rawPayload), signature)) {
      return null;
    }

    const payload = rawPayload as {
      data: {
        attributes: {
          type: string;
          data: {
            id: string;
            attributes: PayMongoPayment | PayMongoPayout;
          };
        };
      };
    };

    const eventType = payload.data.attributes.type;
    const data = payload.data.attributes.data.attributes;

    if (eventType.startsWith("source.") || eventType.startsWith("payment.")) {
      const payment = data as PayMongoPayment;
      const isCompleted = payment.status === "succeeded" || payment.source?.status === "paid";
      const isFailed = payment.status === "failed" || payment.source?.status === "failed";

      return {
        eventType: isCompleted ? "deposit.completed" : isFailed ? "deposit.failed" : "deposit.pending",
        providerReference: payment.source?.id ?? payment.id,
        amountCentavos: BigInt(Math.round(payment.amount)),
        currency: payment.currency,
        metadata: payment.metadata,
        rawPayload,
      };
    }

    if (eventType.startsWith("payout.")) {
      const payout = data as PayMongoPayout;
      const isCompleted = payout.status === "completed";
      const isFailed = payout.status === "failed";

      return {
        eventType: isCompleted ? "payout.completed" : isFailed ? "payout.failed" : "payout.pending",
        providerReference: payout.id,
        amountCentavos: BigInt(Math.round(payout.amount)),
        currency: payout.currency,
        metadata: { failure_code: payout.failure_code, failure_message: payout.failure_message },
        rawPayload,
      };
    }

    return null;
  }

  private mapPayoutStatus(status: string): PayoutInstruction["status"] {
    switch (status) {
      case "pending":
        return "pending";
      case "processing":
        return "processing";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      default:
        return "pending";
    }
  }

  private estimateArrival(status: string): Date | undefined {
    if (status === "completed") return new Date();
    if (status === "processing") return new Date(Date.now() + 2 * 60 * 60 * 1000);
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
}