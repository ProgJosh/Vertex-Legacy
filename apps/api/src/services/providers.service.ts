import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type Checkout = {
  provider: string;
  providerReference: string;
  checkoutUrl: string;
};

@Injectable()
export class ProvidersService {
  assertSandbox(kind: "payment" | "payout" | "kyc") {
    const key =
      kind === "payment" ? "PAYMENT_PROVIDER" : kind === "payout" ? "PAYOUT_PROVIDER" : "KYC_PROVIDER";
    if (process.env[key] !== "mock" || process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException("The requested sandbox provider is not enabled.");
    }
  }

  /**
   * Guards reservation of withdrawal funds. A licensed deployment has no
   * settlement path wired up yet, so accepting a request would move customer
   * money into the reserve account with no way to pay it out or release it.
   */
  assertPayoutAvailable() {
    if (process.env.PAYOUT_PROVIDER !== "mock") {
      throw new ServiceUnavailableException(
        "Payouts are not enabled. A licensed payout adapter must be configured before withdrawals can be requested.",
      );
    }
  }

  createDepositCheckout(depositId: string): Checkout {
    this.assertSandbox("payment");
    return {
      provider: "mock",
      providerReference: "mock_dep_" + randomUUID(),
      checkoutUrl: "/investor/cash-in?depositId=" + encodeURIComponent(depositId),
    };
  }

  sign(payload: string) {
    const secret = process.env.MOCK_PROVIDER_WEBHOOK_SECRET ?? "local-development-only";
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  verify(payload: string, signature: string) {
    const expected = Buffer.from(this.sign(payload), "utf8");
    const received = Buffer.from(signature, "utf8");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new BadRequestException("Invalid provider signature.");
    }
  }
}
