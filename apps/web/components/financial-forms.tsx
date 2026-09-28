"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { formatPhp } from "@vertex/ui";
import { Button } from "./ui/button";

async function jsonRequest(path: string, init: RequestInit) {
  const response = await fetch("/api/backend/" + path, init);
  const body = await response.json();
  if (!response.ok) {
    const message = Array.isArray(body.message)
      ? body.message.join(" ")
      : body.message;
    throw new Error(message ?? "The request could not be completed.");
  }
  return body;
}

const amountSchema = z.object({
  amount: z
    .string()
    .regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/, "Enter a valid peso amount."),
});

type ManualPaymentChannel = {
  code: "GCASH" | "MAYA";
  name: string;
  destinationNumber: string;
  qrAssetPath: string | null;
};

type DepositResult = {
  id: string;
  amountCentavos: string;
  provider: string;
  paymentChannel: "GCASH" | "MAYA" | null;
  status: string;
};

export function CashInForm({
  minimumCentavos,
  manualPaymentsEnabled = false,
  paymentChannels = [],
}: {
  minimumCentavos: string;
  manualPaymentsEnabled?: boolean;
  paymentChannels?: ManualPaymentChannel[];
}) {
  const router = useRouter();
  const [deposit, setDeposit] = useState<DepositResult | null>(null);
  const [paymentChannel, setPaymentChannel] = useState<"GCASH" | "MAYA">(
    paymentChannels[0]?.code ?? "GCASH",
  );
  const [paymentReference, setPaymentReference] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderMobileLast4, setSenderMobileLast4] = useState("");
  const depositIdempotencyKey = useRef(crypto.randomUUID());
  const form = useForm<z.infer<typeof amountSchema>>({
    resolver: zodResolver(amountSchema),
    defaultValues: { amount: "" },
  });
  const create = useMutation({
    mutationFn: (values: z.infer<typeof amountSchema>) =>
      jsonRequest("deposits", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": depositIdempotencyKey.current,
        },
        body: JSON.stringify({
          ...values,
          ...(manualPaymentsEnabled ? { paymentChannel } : {}),
        }),
      }),
    onSuccess: setDeposit,
  });
  const complete = useMutation({
    mutationFn: () =>
      jsonRequest("providers/mock/deposits/" + deposit!.id + "/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    onSuccess: () => {
      router.push("/investor/transactions");
      router.refresh();
    },
  });

  const submitManual = useMutation({
    mutationFn: () =>
      jsonRequest("deposits/" + deposit!.id + "/manual-submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentReference,
          senderName,
          senderMobileLast4,
        }),
      }),
    onSuccess: (result: DepositResult) => {
      setDeposit(result);
      router.refresh();
    },
  });

  const selectedChannel = paymentChannels.find(
    (item) => item.code === paymentChannel,
  );

  if (
    deposit?.provider.startsWith("manual-") &&
    deposit.status === "AWAITING_REVIEW"
  ) {
    return (
      <div className="success-banner" role="status">
        <h3>Transfer submitted for verification</h3>
        <p>
          Your wallet has not been credited yet. Finance will match the
          destination account, exact amount and transaction reference before
          posting {formatPhp(deposit.amountCentavos)}.
        </p>
        <Button
          variant="secondary"
          onClick={() => router.push("/investor/transactions")}
        >
          View transactions
        </Button>
      </div>
    );
  }

  if (deposit?.provider.startsWith("manual-")) {
    const channel = paymentChannels.find(
      (item) => item.code === deposit.paymentChannel,
    );
    return (
      <div className="manual-payment-step">
        <div className="manual-payment-heading">
          <div>
            <p className="eyebrow">Step 2 of 2</p>
            <h3>
              Send the exact amount with{" "}
              {channel?.name ?? deposit.paymentChannel}
            </h3>
          </div>
          <span className="status status-warning">Awaiting transfer</span>
        </div>
        <div className="manual-payment-destination">
          <div>
            <small>Amount to send</small>
            <strong>{formatPhp(deposit.amountCentavos)}</strong>
          </div>
          <div>
            <small>{channel?.name ?? deposit.paymentChannel} destination</small>
            <strong>{channel?.destinationNumber}</strong>
          </div>
        </div>
        <div className="callout" role="status">
          <strong>Payment is not submitted yet.</strong>
          <p className="muted" style={{ marginBottom: 0 }}>
            After sending the exact amount, continue below the QR and enter the
            wallet transaction reference. Your balance changes only after
            finance approves the submitted transfer.
          </p>
        </div>
        {deposit.paymentChannel === "GCASH" && channel?.qrAssetPath && (
          <figure className="gcash-qr">
            <Image
              src={channel.qrAssetPath}
              alt="GCash payment QR supplied by Vertex Legacy"
              width={671}
              height={650}
              priority
            />
            <figcaption>
              Scan only with GCash, then verify the displayed recipient before
              sending.
            </figcaption>
          </figure>
        )}
        <div className="disclosure">
          Do not continue if the wallet shows a different destination. Keep the
          wallet receipt. Submission does not prove payment and cannot credit
          your balance automatically.
        </div>
        <div className="field">
          <label htmlFor="manual-reference">Transaction reference</label>
          <input
            id="manual-reference"
            value={paymentReference}
            onChange={(event) => setPaymentReference(event.target.value)}
            maxLength={100}
            autoComplete="off"
          />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="manual-sender-name">Sender account name</label>
            <input
              id="manual-sender-name"
              value={senderName}
              onChange={(event) => setSenderName(event.target.value)}
              maxLength={120}
              autoComplete="name"
            />
          </div>
          <div className="field">
            <label htmlFor="manual-sender-last4">
              Sender mobile last 4 digits
            </label>
            <input
              id="manual-sender-last4"
              value={senderMobileLast4}
              onChange={(event) =>
                setSenderMobileLast4(
                  event.target.value.replace(/\D/g, "").slice(0, 4),
                )
              }
              inputMode="numeric"
              maxLength={4}
            />
          </div>
        </div>
        {submitManual.error && (
          <p className="error-banner" role="alert">
            {submitManual.error.message}
          </p>
        )}
        <Button
          onClick={() => submitManual.mutate()}
          disabled={
            submitManual.isPending ||
            paymentReference.trim().length < 6 ||
            senderName.trim().length < 2 ||
            senderMobileLast4.length !== 4
          }
        >
          {submitManual.isPending
            ? "Submitting…"
            : "I sent the payment — submit for review"}
        </Button>
      </div>
    );
  }

  if (deposit) {
    return (
      <div className="success-banner">
        <h3>Sandbox checkout created</h3>
        <p>
          The wallet has not changed. Complete the simulated provider webhook to
          settle {formatPhp(deposit.amountCentavos)}.
        </p>
        <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
          {complete.isPending
            ? "Verifying webhook…"
            : "Complete sandbox payment"}
        </Button>
        {complete.error && (
          <p className="error-banner">{complete.error.message}</p>
        )}
      </div>
    );
  }

  if (
    !manualPaymentsEnabled &&
    paymentChannels.length === 0 &&
    process.env.NODE_ENV === "production"
  ) {
    return (
      <div className="empty-state">
        GCash and Maya cash-in are temporarily unavailable while the approved
        business wallets are being activated. Do not send money outside this
        verified workflow.
      </div>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit((values) => create.mutate(values))}
      noValidate
    >
      {manualPaymentsEnabled && (
        <fieldset className="payment-channel-picker">
          <legend>Choose payment channel</legend>
          <div className="payment-channel-grid">
            {paymentChannels.map((channel) => (
              <label
                className={
                  paymentChannel === channel.code
                    ? "payment-channel active"
                    : "payment-channel"
                }
                key={channel.code}
              >
                <input
                  type="radio"
                  name="payment-channel"
                  value={channel.code}
                  checked={paymentChannel === channel.code}
                  onChange={() => setPaymentChannel(channel.code)}
                />
                <span>{channel.name}</span>
                <small>
                  {channel.code === "GCASH"
                    ? "QR or mobile transfer"
                    : "Mobile transfer"}
                </small>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="field">
        <label htmlFor="cash-in-amount">Cash-in amount (PHP)</label>
        <input
          id="cash-in-amount"
          inputMode="decimal"
          placeholder="0.00"
          aria-describedby="cash-in-help"
          {...form.register("amount")}
        />
        <span id="cash-in-help" className="muted">
          Minimum {formatPhp(minimumCentavos)}. Final credit requires finance to
          match the real wallet transaction.
        </span>
        {form.formState.errors.amount && (
          <span className="field-error">
            {form.formState.errors.amount.message}
          </span>
        )}
      </div>
      {create.error && (
        <p className="error-banner" role="alert">
          {create.error.message}
        </p>
      )}
      <Button type="submit" disabled={create.isPending}>
        {create.isPending
          ? "Creating request…"
          : manualPaymentsEnabled
            ? `Continue with ${selectedChannel?.name ?? paymentChannel}`
            : "Continue to sandbox provider"}
      </Button>
    </form>
  );
}

type Payout = { id: string; institutionName: string; maskedIdentifier: string };
type Quote = {
  requestedCentavos: string;
  feeCentavos: string;
  netCentavos: string;
  destination: Payout;
  estimatedProcessingTime: string;
  window: {
    isOpen: boolean;
    mode: "BLOCK" | "SCHEDULE";
    nextOpenAt: string | null;
  };
};

const withdrawalSchema = z.object({
  amount: z
    .string()
    .regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/, "Enter a valid peso amount."),
  payoutAccountId: z.string().uuid("Select a payout account."),
});

export function WithdrawalForm({
  payoutAccounts,
  minimumCentavos,
  requiresLocalMfaCode = false,
}: {
  payoutAccounts: Payout[];
  minimumCentavos: string;
  requiresLocalMfaCode?: boolean;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const withdrawalIdempotencyKey = useRef(crypto.randomUUID());
  const form = useForm<z.infer<typeof withdrawalSchema>>({
    resolver: zodResolver(withdrawalSchema),
    defaultValues: { amount: "", payoutAccountId: payoutAccounts[0]?.id ?? "" },
  });
  const quoteMutation = useMutation({
    mutationFn: (values: z.infer<typeof withdrawalSchema>) =>
      jsonRequest("withdrawals/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      }),
    onSuccess: setQuote,
  });
  const submitMutation = useMutation({
    mutationFn: () =>
      jsonRequest("withdrawals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": withdrawalIdempotencyKey.current,
        },
        body: JSON.stringify({ ...form.getValues(), mfaCode }),
      }),
    onSuccess: (result) => {
      router.push("/investor/withdraw/confirmation?id=" + result.id);
      router.refresh();
    },
  });

  if (!payoutAccounts.length) {
    return (
      <div className="empty-state">
        Add and verify a payout account before requesting a withdrawal.
      </div>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        setQuote(null);
        quoteMutation.mutate(values);
      })}
      noValidate
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor="withdrawal-amount">Requested amount (PHP)</label>
          <input
            id="withdrawal-amount"
            inputMode="decimal"
            placeholder="0.00"
            {...form.register("amount")}
          />
          <span className="muted">Minimum {formatPhp(minimumCentavos)}</span>
          {form.formState.errors.amount && (
            <span className="field-error">
              {form.formState.errors.amount.message}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="payout-account">Destination account</label>
          <select id="payout-account" {...form.register("payoutAccountId")}>
            {payoutAccounts.map((account) => (
              <option value={account.id} key={account.id}>
                {account.institutionName} · {account.maskedIdentifier}
              </option>
            ))}
          </select>
        </div>
      </div>
      {quoteMutation.error && (
        <p className="error-banner" role="alert">
          {quoteMutation.error.message}
        </p>
      )}
      {!quote && (
        <Button
          type="submit"
          disabled={quoteMutation.isPending}
          style={{ marginTop: 20 }}
        >
          {quoteMutation.isPending ? "Calculating…" : "Review withdrawal"}
        </Button>
      )}
      {quote && (
        <section
          className="callout"
          style={{ marginTop: 22 }}
          aria-label="Withdrawal confirmation"
        >
          <p className="eyebrow">Final confirmation</p>
          <div className="calculation">
            <div>
              <span>Requested amount</span>
              <strong>{formatPhp(quote.requestedCentavos)}</strong>
            </div>
            <div>
              <span>Withdrawal fee</span>
              <strong>{formatPhp(quote.feeCentavos)}</strong>
            </div>
            <div>
              <span>Net amount you will receive</span>
              <strong>{formatPhp(quote.netCentavos)}</strong>
            </div>
            <div>
              <span>Destination account</span>
              <strong>
                {quote.destination.institutionName} ·{" "}
                {quote.destination.maskedIdentifier}
              </strong>
            </div>
            <div>
              <span>Estimated processing</span>
              <strong>{quote.estimatedProcessingTime}</strong>
            </div>
            <div>
              <span>Withdrawal window</span>
              <strong>
                {quote.window.isOpen
                  ? "Open now"
                  : quote.window.mode === "SCHEDULE"
                    ? "Closed · request will be scheduled"
                    : "Closed · reopens " +
                      new Date(quote.window.nextOpenAt!).toLocaleString(
                        "en-PH",
                      )}
              </strong>
            </div>
          </div>
          {requiresLocalMfaCode && (
            <div className="field">
              <label htmlFor="mfa-code">MFA authorization code</label>
              <input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={mfaCode}
                onChange={(event) =>
                  setMfaCode(event.target.value.replace(/\D/g, ""))
                }
              />
              <span className="muted">Local demonstration code: 123456</span>
            </div>
          )}
          {submitMutation.error && (
            <p className="error-banner" role="alert">
              {submitMutation.error.message}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={
                submitMutation.isPending ||
                (requiresLocalMfaCode && mfaCode.length !== 6) ||
                (!quote.window.isOpen && quote.window.mode === "BLOCK")
              }
            >
              {submitMutation.isPending
                ? "Authorizing…"
                : "Authorize withdrawal"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setQuote(null)}
            >
              Change details
            </Button>
          </div>
        </section>
      )}
    </form>
  );
}

export function PlanSubscribeForm({
  slug,
  minimumCentavos,
  maximumCentavos,
  availableCentavos,
  kycVerified,
}: {
  slug: string;
  minimumCentavos: string;
  maximumCentavos: string | null;
  availableCentavos: string;
  kycVerified: boolean;
}) {
  const router = useRouter();
  const [complete, setComplete] = useState(false);
  const purchaseIdempotencyKey = useRef(crypto.randomUUID());
  const form = useForm<z.infer<typeof amountSchema>>({
    resolver: zodResolver(amountSchema),
    defaultValues: { amount: (Number(minimumCentavos) / 100).toFixed(2) },
  });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof amountSchema>) =>
      jsonRequest("plans/" + slug + "/subscribe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": purchaseIdempotencyKey.current,
        },
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      setComplete(true);
      router.refresh();
    },
  });
  if (complete) {
    return (
      <div className="success-banner">
        Your product purchase was posted and added to your portfolio.
      </div>
    );
  }
  if (!kycVerified) {
    return (
      <div className="empty-state">
        <p>
          Identity verification is required before deposited cash can buy a
          product. Submit your identity review, then wait for an administrator
          to approve it.
        </p>
        <Button asChild>
          <Link href="/investor/kyc">Submit identity review</Link>
        </Button>
      </div>
    );
  }
  if (BigInt(availableCentavos) < BigInt(minimumCentavos)) {
    return (
      <div className="empty-state">
        Your deposited balance is {formatPhp(availableCentavos)}. A
        finance-approved cash-in of at least {formatPhp(minimumCentavos)} is
        required to buy this product.
      </div>
    );
  }
  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      noValidate
    >
      <div className="field">
        <label htmlFor="subscription-amount">Subscription amount (PHP)</label>
        <input
          id="subscription-amount"
          inputMode="decimal"
          {...form.register("amount")}
        />
        <span className="muted">
          {formatPhp(minimumCentavos)} minimum
          {maximumCentavos
            ? " · " + formatPhp(maximumCentavos) + " maximum"
            : ""}
        </span>
        {form.formState.errors.amount && (
          <span className="field-error">
            {form.formState.errors.amount.message}
          </span>
        )}
      </div>
      {mutation.error && (
        <p className="error-banner" role="alert">
          {mutation.error.message}
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Buying product…" : "Buy product"}
      </Button>
    </form>
  );
}
