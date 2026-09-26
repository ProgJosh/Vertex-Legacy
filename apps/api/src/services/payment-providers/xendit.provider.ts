import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentProvider, CheckoutSession, PayoutInstruction, WebhookEvent } from "./payment-provider.interface";
import { PaymentProviderRegistry } from "./payment-provider.interface";

interface XenditInvoice {
  id: string;
  external_id: string;
  amount: number;
  currency: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "FAILED";
  invoice_url: string;
  expiration_date: string;
  payment_method?: string;
}

interface XenditEWalletCharge {
  id: string;
  external_id: string;
  amount: number;
  currency: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  checkout_url: string;
  channel_properties: { success_return_url: string; failure_return_url: string };
}

interface XenditDisbursement {
  id: string;
  external_id: string;
  amount: number;
  currency: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  channel_code: string;
  bank_code?: string;
  account_number?: string;
  ewallet_type?: string;
  ewallet_id?: string;
  failure_code?: string;
  failure_message?: string;
}

@Injectable()
export class XenditProvider implements PaymentProvider {
  readonly name = "xendit";

  private readonly baseUrl = "https://api.xendit.co";

  private getSecretKey(): string {
    const key = process.env.XENDIT_SECRET_KEY ?? "";
    if (!key) throw new Error("XENDIT_SECRET_KEY is required");
    return key;
  }

  private getWebhookToken(): string {
    const token = process.env.XENDIT_WEBHOOK_TOKEN ?? "";
    if (!token) throw new Error("XENDIT_WEBHOOK_TOKEN is required");
    return token;
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
      external_id: params.depositId,
      amount: Math.round(amount),
      currency: params.currency.toUpperCase(),
      description: `Deposit ${params.depositId}`,
      customer: {
        given_names: params.customerEmail.split("@")[0],
        email: params.customerEmail,
        mobile_number: params.customerPhone,
      },
      success_redirect_url: params.returnUrl ?? `${process.env.WEB_ORIGIN}/investor/wallet?deposit=success`,
      failure_redirect_url: params.returnUrl ?? `${process.env.WEB_ORIGIN}/investor/wallet?deposit=failed`,
      payment_methods: ["GCASH", "GRABPAY", "SHOPEEPAY", "BANK_TRANSFER", "OVER_THE_COUNTER"],
      items: [
        {
          name: "Wallet Cash-in",
          quantity: 1,
          price: Math.round(amount),
          currency: params.currency.toUpperCase(),
        },
      ],
      metadata: {
        deposit_id: params.depositId,
        customer_email: params.customerEmail,
      },
    };

    const response = await fetch(`${this.baseUrl}/v2/invoices`, {
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
        `Xendit invoice creation failed: ${JSON.stringify(error)}`,
      );
    }

    const invoice = (await response.json()) as XenditInvoice;

    return {
      provider: this.name,
      providerReference: invoice.id,
      checkoutUrl: invoice.invoice_url,
      expiresAt: new Date(invoice.expiration_date),
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
      external_id: params.withdrawalId,
      amount: Math.round(amount),
      currency: params.currency.toUpperCase(),
      channel_code: isEwallet
        ? params.destination.accountDetails.ewalletType ?? "GCASH"
        : params.destination.accountDetails.bankCode ?? "PH_BPI",
      channel_properties: isEwallet
        ? { ewallet_id: params.destination.accountDetails.ewalletId }
        : {
            account_number: params.destination.accountDetails.accountNumber,
            account_holder_name: params.destination.accountHolderName,
          },
      description: `Withdrawal ${params.withdrawalId}`,
      metadata: {
        withdrawal_id: params.withdrawalId,
      },
    };

    const response = await fetch(`${this.baseUrl}/disbursements`, {
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
        `Xendit disbursement creation failed: ${JSON.stringify(error)}`,
      );
    }

    const disbursement = (await response.json()) as XenditDisbursement;

    return {
      provider: this.name,
      providerReference: disbursement.id,
      status: this.mapDisbursementStatus(disbursement.status),
      failureReason: disbursement.failure_message,
    };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    try {
      const expected = createHmac("sha256", this.getWebhookToken())
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
      event: string;
      data: XenditInvoice | XenditDisbursement;
    };

    if (payload.event.startsWith("invoice.") || payload.event.startsWith("ewallet_charge.")) {
      const invoice = payload.data as XenditInvoice;
      const isCompleted = invoice.status === "PAID";
      const isFailed = invoice.status === "FAILED" || invoice.status === "EXPIRED";

      return {
        eventType: isCompleted ? "deposit.completed" : isFailed ? "deposit.failed" : "deposit.pending",
        providerReference: invoice.id,
        amountCentavos: BigInt(Math.round(invoice.amount * 100)),
        currency: invoice.currency,
        metadata: { payment_method: invoice.payment_method, status: invoice.status },
        rawPayload,
      };
    }

    if (payload.event.startsWith("disbursement.")) {
      const disbursement = payload.data as XenditDisbursement;
      const isCompleted = disbursement.status === "COMPLETED";
      const isFailed = disbursement.status === "FAILED";

      return {
        eventType: isCompleted ? "payout.completed" : isFailed ? "payout.failed" : "payout.pending",
        providerReference: disbursement.id,
        amountCentavos: BigInt(Math.round(disbursement.amount * 100)),
        currency: disbursement.currency,
        metadata: {
          channel_code: disbursement.channel_code,
          failure_code: disbursement.failure_code,
          failure_message: disbursement.failure_message,
        },
        rawPayload,
      };
    }

    return null;
  }

  private mapDisbursementStatus(status: string): PayoutInstruction["status"] {
    switch (status) {
      case "PENDING":
        return "pending";
      case "COMPLETED":
        return "completed";
      case "FAILED":
        return "failed";
      default:
        return "pending";
    }
  }
}