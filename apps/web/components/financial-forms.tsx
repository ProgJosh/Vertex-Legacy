"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { formatPhp } from "@vertex/ui";
import { Button } from "./ui/button";

async function jsonRequest(path: string, init: RequestInit) {
  const response = await fetch("/api/backend/" + path, init);
  const body = await response.json();
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(" ") : body.message;
    throw new Error(message ?? "The request could not be completed.");
  }
  return body;
}

const amountSchema = z.object({
  amount: z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/, "Enter a valid peso amount."),
});

export function CashInForm({ minimumCentavos }: { minimumCentavos: string }) {
  const router = useRouter();
  const [deposit, setDeposit] = useState<{ id: string; amountCentavos: string } | null>(null);
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
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(values),
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

  if (deposit) {
    return (
      <div className="success-banner">
        <h3>Sandbox checkout created</h3>
        <p>
          The wallet has not changed. Complete the simulated provider webhook to settle{" "}
          {formatPhp(deposit.amountCentavos)}.
        </p>
        <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
          {complete.isPending ? "Verifying webhook…" : "Complete sandbox payment"}
        </Button>
        {complete.error && <p className="error-banner">{complete.error.message}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit((values) => create.mutate(values))} noValidate>
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
          Minimum {formatPhp(minimumCentavos)}. Final credit requires a signed provider webhook.
        </span>
        {form.formState.errors.amount && (
          <span className="field-error">{form.formState.errors.amount.message}</span>
        )}
      </div>
      {create.error && <p className="error-banner" role="alert">{create.error.message}</p>}
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? "Creating checkout…" : "Continue to sandbox provider"}
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
  window: { isOpen: boolean; mode: "BLOCK" | "SCHEDULE"; nextOpenAt: string | null };
};

const withdrawalSchema = z.object({
  amount: z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/, "Enter a valid peso amount."),
  payoutAccountId: z.string().uuid("Select a payout account."),
});

export function WithdrawalForm({
  payoutAccounts,
  minimumCentavos,
}: {
  payoutAccounts: Payout[];
  minimumCentavos: string;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [mfaCode, setMfaCode] = useState("");
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
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ ...form.getValues(), mfaCode }),
      }),
    onSuccess: (result) => {
      router.push("/investor/withdraw/confirmation?id=" + result.id);
      router.refresh();
    },
  });

  if (!payoutAccounts.length) {
    return <div className="empty-state">Add and verify a payout account before requesting a withdrawal.</div>;
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
          <input id="withdrawal-amount" inputMode="decimal" placeholder="0.00" {...form.register("amount")} />
          <span className="muted">Minimum {formatPhp(minimumCentavos)}</span>
          {form.formState.errors.amount && <span className="field-error">{form.formState.errors.amount.message}</span>}
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
      {quoteMutation.error && <p className="error-banner" role="alert">{quoteMutation.error.message}</p>}
      {!quote && (
        <Button type="submit" disabled={quoteMutation.isPending} style={{ marginTop: 20 }}>
          {quoteMutation.isPending ? "Calculating…" : "Review withdrawal"}
        </Button>
      )}
      {quote && (
        <section className="callout" style={{ marginTop: 22 }} aria-label="Withdrawal confirmation">
          <p className="eyebrow">Final confirmation</p>
          <div className="calculation">
            <div><span>Requested amount</span><strong>{formatPhp(quote.requestedCentavos)}</strong></div>
            <div><span>Withdrawal fee</span><strong>{formatPhp(quote.feeCentavos)}</strong></div>
            <div><span>Net amount you will receive</span><strong>{formatPhp(quote.netCentavos)}</strong></div>
            <div><span>Destination account</span><strong>{quote.destination.institutionName} · {quote.destination.maskedIdentifier}</strong></div>
            <div><span>Estimated processing</span><strong>{quote.estimatedProcessingTime}</strong></div>
            <div>
              <span>Withdrawal window</span>
              <strong>
                {quote.window.isOpen
                  ? "Open now"
                  : quote.window.mode === "SCHEDULE"
                    ? "Closed · request will be scheduled"
                    : "Closed · reopens " + new Date(quote.window.nextOpenAt!).toLocaleString("en-PH")}
              </strong>
            </div>
          </div>
          <div className="field">
            <label htmlFor="mfa-code">MFA authorization code</label>
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))}
            />
            <span className="muted">Local demonstration code: 123456</span>
          </div>
          {submitMutation.error && <p className="error-banner" role="alert">{submitMutation.error.message}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={
                submitMutation.isPending ||
                mfaCode.length !== 6 ||
                (!quote.window.isOpen && quote.window.mode === "BLOCK")
              }
            >
              {submitMutation.isPending ? "Authorizing…" : "Authorize withdrawal"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setQuote(null)}>
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
}: {
  slug: string;
  minimumCentavos: string;
  maximumCentavos: string | null;
}) {
  const router = useRouter();
  const [complete, setComplete] = useState(false);
  const form = useForm<z.infer<typeof amountSchema>>({
    resolver: zodResolver(amountSchema),
    defaultValues: { amount: "" },
  });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof amountSchema>) =>
      jsonRequest("plans/" + slug + "/subscribe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      setComplete(true);
      router.refresh();
    },
  });
  if (complete) {
    return <div className="success-banner">The sandbox subscription was posted and added to your portfolio.</div>;
  }
  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
      <div className="field">
        <label htmlFor="subscription-amount">Subscription amount (PHP)</label>
        <input id="subscription-amount" inputMode="decimal" {...form.register("amount")} />
        <span className="muted">
          {formatPhp(minimumCentavos)} minimum
          {maximumCentavos ? " · " + formatPhp(maximumCentavos) + " maximum" : ""}
        </span>
        {form.formState.errors.amount && <span className="field-error">{form.formState.errors.amount.message}</span>}
      </div>
      {mutation.error && <p className="error-banner" role="alert">{mutation.error.message}</p>}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Submitting…" : "Authorize sandbox subscription"}
      </Button>
    </form>
  );
}
