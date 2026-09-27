"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPhp } from "@vertex/ui";
import { Button } from "./ui/button";

async function post(path: string, body: object = {}) {
  const response = await fetch("/api/backend/" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "The action could not be completed.");
  return result;
}

export function InviteLink({ code, origin }: { code: string; origin: string }) {
  const [copied, setCopied] = useState(false);
  const link = origin.replace(/\/$/, "") + "/register?ref=" + encodeURIComponent(code);
  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return <div className="invite-link"><div><small>Invitation link</small><strong>{link}</strong></div><Button size="small" onClick={copy}>{copied ? "Copied" : "Copy link"}</Button></div>;
}

export function AcceptInvitation({ referralCode }: { referralCode: string }) {
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: () => post("me/referrals/claim", { referralCode }),
    onSuccess: () => router.replace("/investor/team"),
  });
  return <section className="callout"><p className="eyebrow">Invitation found</p><h2>Join this Vertex team</h2><p className="muted">Code {referralCode}. Linking records who invited you; deposits never generate commission.</p><Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>{mutation.isPending ? "Linking…" : "Accept invitation"}</Button>{mutation.error && <p className="error-banner">{mutation.error.message}</p>}</section>;
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

export function DailyReward({ initial }: { initial: RewardStatus }) {
  const [status, setStatus] = useState(initial);
  const mutation = useMutation({
    mutationFn: () => post("me/daily-reward/claim"),
    onSuccess: setStatus,
  });
  return <div className="reward-layout"><section className="reward-hero"><div><p className="eyebrow">Current streak</p><strong>{status.streak}<small> / 30 days</small></strong><p>Next promotional reward: {formatPhp(status.nextRewardCentavos)}</p></div><div className="reward-earned"><small>Cycle day</small><strong>{status.cycleDay}</strong></div></section><section className="panel"><div className="panel-header"><div><h2>30-day calendar</h2><p>One claim per Manila calendar day.</p></div><span className="status status-warning">Promotional credit</span></div><div className="reward-calendar">{status.rewardsCentavos.map((amount, index) => <div className={index < status.streak ? "reward-day claimed" : index === status.streak ? "reward-day current" : "reward-day"} key={index}><small>Day {index + 1}</small><strong>{formatPhp(amount)}</strong></div>)}</div><p className="disclosure">{status.disclosure}</p><Button style={{ width: "100%" }} disabled={status.checkedInToday || mutation.isPending} onClick={() => mutation.mutate()}>{status.checkedInToday ? "Already checked in today" : mutation.isPending ? "Claiming…" : "Check in and claim"}</Button>{mutation.error && <p className="error-banner">{mutation.error.message}</p>}</section></div>;
}
