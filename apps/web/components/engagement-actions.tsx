"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatPhp } from "@vertex/ui";
import { Button } from "./ui/button";

async function post(path: string, body: object = {}) {
  const response = await fetch("/api/backend/" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message ?? "The action could not be completed.");
  return result;
}

export function InviteLink({ code, origin }: { code: string; origin: string }) {
  const [copied, setCopied] = useState(false);
  const [currentOrigin, setCurrentOrigin] = useState(origin);
  useEffect(() => setCurrentOrigin(window.location.origin), []);
  const link =
    currentOrigin.replace(/\/$/, "") +
    "/register?ref=" +
    encodeURIComponent(code);
  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="invite-link">
      <div>
        <small>Invitation link</small>
        <strong>{link}</strong>
      </div>
      <Button size="small" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

export function AcceptInvitation({ referralCode }: { referralCode: string }) {
  const router = useRouter();
  const started = useRef(false);
  const mutation = useMutation({
    mutationFn: () => post("me/referrals/claim", { referralCode }),
    onSuccess: () => router.replace("/investor/team"),
  });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutation.mutate();
  }, [mutation]);
  return (
    <section className="callout">
      <p className="eyebrow">Invitation found</p>
      <h2>
        {mutation.isSuccess ? "Invitation linked" : "Linking your invitation…"}
      </h2>
      <p className="muted">
        The invitation is carried by the shared website link. The invited user
        only needs to create an account with email and password; no code entry
        is required.
      </p>
      {mutation.error && (
        <>
          <p className="error-banner">{mutation.error.message}</p>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            Try again
          </Button>
        </>
      )}
    </section>
  );
}

type RewardStatus = {
  checkedInToday: boolean;
  streak: number;
  cycleDay: number;
  nextRewardCentavos: string;
  rewardsCentavos: string[];
  claimedDays: string[];
  disclosure: string;
};

export function DailyReward({
  initial,
  kycVerified,
}: {
  initial: RewardStatus;
  kycVerified: boolean;
}) {
  const [status, setStatus] = useState(initial);
  const mutation = useMutation({
    mutationFn: () => post("me/daily-reward/claim"),
    onSuccess: setStatus,
  });
  return (
    <div className="reward-layout">
      <section className="reward-hero">
        <div>
          <p className="eyebrow">Current streak</p>
          <strong>
            {status.streak}
            <small> / 30 days</small>
          </strong>
          <p>Next promotional reward: {formatPhp(status.nextRewardCentavos)}</p>
        </div>
        <div className="reward-earned">
          <small>Cycle day</small>
          <strong>{status.cycleDay}</strong>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>30-day calendar</h2>
            <p>One claim per Manila calendar day.</p>
          </div>
          <span className="status status-warning">Promotional credit</span>
        </div>
        <div className="reward-calendar">
          {status.rewardsCentavos.map((amount, index) => (
            <div
              className={
                index < status.streak
                  ? "reward-day claimed"
                  : index === status.streak
                    ? "reward-day current"
                    : "reward-day"
              }
              key={index}
            >
              <small>Day {index + 1}</small>
              <strong>{formatPhp(amount)}</strong>
            </div>
          ))}
        </div>
        <p className="disclosure">{status.disclosure}</p>
        {!kycVerified && (
          <div className="callout" style={{ marginBottom: 16 }}>
            <strong>Identity verification is required.</strong>
            <p className="muted">
              Submit your review and wait for administrator approval before
              claiming daily promotional rewards.
            </p>
            <Button asChild variant="secondary">
              <Link href="/investor/kyc">Submit identity review</Link>
            </Button>
          </div>
        )}
        {mutation.error && (
          <p className="error-banner" role="alert">{mutation.error.message}</p>
        )}
        <Button
          style={{ width: "100%" }}
          disabled={!kycVerified || status.checkedInToday || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {!kycVerified
            ? "Complete identity verification first"
            : status.checkedInToday
              ? "Already checked in today"
              : mutation.isPending
                ? "Claiming…"
                : "Check in and claim"}
        </Button>
      </section>
    </div>
  );
}
