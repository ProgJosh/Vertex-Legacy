"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/button";

async function request(path: string, method: "POST" | "PATCH", body: object) {
  const response = await fetch("/api/backend/" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Administrative action failed.");
  return result;
}

export function ReasonedAction({
  path,
  label,
  variant = "secondary",
  extra = {},
  method = "POST",
}: {
  path: string;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  extra?: object;
  method?: "POST" | "PATCH";
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => request(path, method, { ...extra, reason }),
    onSuccess: () => {
      setReason("");
      router.refresh();
    },
  });
  return (
    <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
      <input
        aria-label={"Reason for " + label}
        placeholder="Required reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <Button
        size="small"
        variant={variant}
        disabled={reason.length < 8 || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Applying…" : label}
      </Button>
      {mutation.error && <span className="field-error">{mutation.error.message}</span>}
    </div>
  );
}

export function UserManagementActions({ userId, status }: { userId: string; status: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [nextStatus, setNextStatus] = useState(status === "ACTIVE" ? "SUSPENDED" : "ACTIVE");
  const [roleName, setRoleName] = useState("INVESTOR");
  const mutation = useMutation({
    mutationFn: (action: "status" | "role") =>
      action === "status"
        ? request("admin/users/" + userId + "/status", "PATCH", { status: nextStatus, reason })
        : request("admin/users/" + userId + "/roles", "POST", { roleName, reason }),
    onSuccess: () => {
      setReason("");
      router.refresh();
    },
  });
  return (
    <div style={{ display: "grid", gap: 8, minWidth: 230 }}>
      <label className="sr-only" htmlFor={"user-reason-" + userId}>Administrative reason</label>
      <input id={"user-reason-" + userId} placeholder="Required reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <select aria-label="New account status" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
          <option value="ACTIVE">Activate</option>
          <option value="SUSPENDED">Suspend</option>
          <option value="CLOSED">Close</option>
        </select>
        <Button size="small" variant={nextStatus === "ACTIVE" ? "secondary" : "danger"} disabled={reason.length < 8 || mutation.isPending} onClick={() => mutation.mutate("status")}>Apply</Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <select aria-label="Role to assign" value={roleName} onChange={(event) => setRoleName(event.target.value)}>
          <option value="INVESTOR">Investor</option>
          <option value="FINANCE_COMPLIANCE">Finance / compliance</option>
          <option value="ADMIN">Administrator</option>
        </select>
        <Button size="small" variant="secondary" disabled={reason.length < 8 || mutation.isPending} onClick={() => mutation.mutate("role")}>Assign</Button>
      </div>
      {mutation.error && <span className="field-error">{mutation.error.message}</span>}
    </div>
  );
}

export function ConfigForm({
  config,
}: {
  config: {
    minimumDepositCentavos: string;
    minimumWithdrawalCentavos: string;
    withdrawalFeeRate: string;
    withdrawalOpensAt: string;
    withdrawalClosesAt: string;
    withdrawalOutsideWindowMode: string;
  };
}) {
  const router = useRouter();
  const [values, setValues] = useState({ ...config, reason: "" });
  const mutation = useMutation({
    mutationFn: () => request("admin/config", "POST", values),
    onSuccess: () => router.refresh(),
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="form-grid">
        <div className="field"><label>Minimum cash-in (centavos)</label><input value={values.minimumDepositCentavos} onChange={(e) => setValues({ ...values, minimumDepositCentavos: e.target.value })} /></div>
        <div className="field"><label>Minimum withdrawal (centavos)</label><input value={values.minimumWithdrawalCentavos} onChange={(e) => setValues({ ...values, minimumWithdrawalCentavos: e.target.value })} /></div>
        <div className="field"><label>Withdrawal fee rate</label><input value={values.withdrawalFeeRate} onChange={(e) => setValues({ ...values, withdrawalFeeRate: e.target.value })} /></div>
        <div className="field"><label>Outside-window policy</label><select value={values.withdrawalOutsideWindowMode} onChange={(e) => setValues({ ...values, withdrawalOutsideWindowMode: e.target.value })}><option value="BLOCK">Block</option><option value="SCHEDULE">Schedule</option></select></div>
        <div className="field"><label>Opens at</label><input type="time" value={values.withdrawalOpensAt} onChange={(e) => setValues({ ...values, withdrawalOpensAt: e.target.value })} /></div>
        <div className="field"><label>Closes at</label><input type="time" value={values.withdrawalClosesAt} onChange={(e) => setValues({ ...values, withdrawalClosesAt: e.target.value })} /></div>
      </div>
      <div className="field" style={{ marginTop: 16 }}><label>Change reason</label><textarea value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} /></div>
      {mutation.error && <p className="error-banner">{mutation.error.message}</p>}
      <Button disabled={values.reason.length < 8 || mutation.isPending}>{mutation.isPending ? "Publishing…" : "Publish new configuration version"}</Button>
    </form>
  );
}

export function PlanForm() {
  const router = useRouter();
  const [values, setValues] = useState({
    slug: "",
    name: "",
    description: "",
    category: "Balanced",
    minimumCentavos: "500000",
    maximumCentavos: "10000000",
    durationDays: "365",
    riskClassification: "Moderate",
    managementFeeRate: "0.015000",
    targetPerformanceLow: "0.040000",
    targetPerformanceHigh: "0.080000",
    terms: "",
    status: "DRAFT",
    reason: "",
  });
  const update = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const mutation = useMutation({
    mutationFn: () =>
      request("admin/plans", "POST", {
        ...values,
        durationDays: Number(values.durationDays),
        maximumCentavos: values.maximumCentavos || null,
        targetPerformanceLow: values.targetPerformanceLow || null,
        targetPerformanceHigh: values.targetPerformanceHigh || null,
      }),
    onSuccess: () => router.refresh(),
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="form-grid">
        {([
          ["slug", "Slug"],
          ["name", "Plan name"],
          ["category", "Category"],
          ["minimumCentavos", "Minimum (centavos)"],
          ["maximumCentavos", "Maximum (centavos)"],
          ["durationDays", "Duration days"],
          ["riskClassification", "Risk classification"],
          ["managementFeeRate", "Management fee rate"],
          ["targetPerformanceLow", "Illustrative target low"],
          ["targetPerformanceHigh", "Illustrative target high"],
        ] as const).map(([key, label]) => (
          <div className="field" key={key}>
            <label htmlFor={"plan-" + key}>{label}</label>
            <input id={"plan-" + key} value={values[key as keyof typeof values]} onChange={(e) => update(key, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="field" style={{ marginTop: 16 }}><label>Description</label><textarea value={values.description} onChange={(e) => update("description", e.target.value)} /></div>
      <div className="field"><label>Terms</label><textarea value={values.terms} onChange={(e) => update("terms", e.target.value)} /></div>
      <div className="field"><label>Status</label><select value={values.status} onChange={(e) => update("status", e.target.value)}><option>DRAFT</option><option>ACTIVE</option><option>PAUSED</option><option>CLOSED</option></select></div>
      <div className="field"><label>Administrative reason</label><textarea value={values.reason} onChange={(e) => update("reason", e.target.value)} /></div>
      {mutation.error && <p className="error-banner">{mutation.error.message}</p>}
      <Button disabled={values.reason.length < 8 || values.terms.length < 20 || mutation.isPending}>{mutation.isPending ? "Creating…" : "Create plan"}</Button>
    </form>
  );
}

export function CommissionRuleForm() {
  const router = useRouter();
  const [values, setValues] = useState({
    name: "",
    rate: "0.100000",
    capCentavos: "",
    minimumSourceCentavos: "",
    effectiveFrom: new Date().toISOString(),
    reason: "",
  });
  const mutation = useMutation({
    mutationFn: () => request("admin/commission-rules", "POST", {
      ...values,
      capCentavos: values.capCentavos || null,
      minimumSourceCentavos: values.minimumSourceCentavos || null,
    }),
    onSuccess: () => router.refresh(),
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="field"><label>Rule name</label><input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} /></div>
      <div className="form-grid">
        <div className="field"><label>Rate</label><input value={values.rate} onChange={(e) => setValues({ ...values, rate: e.target.value })} /></div>
        <div className="field"><label>Cap (centavos)</label><input value={values.capCentavos} onChange={(e) => setValues({ ...values, capCentavos: e.target.value })} /></div>
      </div>
      <div className="field" style={{ marginTop: 16 }}><label>Minimum qualifying fee (centavos)</label><input value={values.minimumSourceCentavos} onChange={(e) => setValues({ ...values, minimumSourceCentavos: e.target.value })} /></div>
      <div className="field"><label>Reason</label><textarea value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} /></div>
      <p className="muted">Qualifying event is fixed to PLAN_SERVICE_FEE_CONFIRMED. Deposits never qualify.</p>
      {mutation.error && <p className="error-banner">{mutation.error.message}</p>}
      <Button disabled={values.name.length < 3 || values.reason.length < 8 || mutation.isPending}>{mutation.isPending ? "Creating…" : "Create commission rule"}</Button>
    </form>
  );
}

export function AnnouncementForm() {
  const router = useRouter();
  const [values, setValues] = useState({ title: "", body: "", audience: "ALL", reason: "" });
  const mutation = useMutation({
    mutationFn: () => request("admin/announcements", "POST", values),
    onSuccess: () => router.refresh(),
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="field"><label>Title</label><input value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} /></div>
      <div className="field"><label>Message</label><textarea value={values.body} onChange={(e) => setValues({ ...values, body: e.target.value })} /></div>
      <div className="field"><label>Audience</label><select value={values.audience} onChange={(e) => setValues({ ...values, audience: e.target.value })}><option>ALL</option><option>INVESTOR</option><option>ADMIN</option></select></div>
      <div className="field"><label>Reason</label><textarea value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} /></div>
      {mutation.error && <p className="error-banner">{mutation.error.message}</p>}
      <Button disabled={values.title.length < 3 || values.body.length < 10 || values.reason.length < 8 || mutation.isPending}>Publish announcement</Button>
    </form>
  );
}

export function ReconciliationForm() {
  const router = useRouter();
  const [values, setValues] = useState({ provider: "mock", businessDate: new Date().toISOString().slice(0, 10), reason: "" });
  const mutation = useMutation({
    mutationFn: () => request("admin/reconciliation", "POST", values),
    onSuccess: () => router.refresh(),
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="form-grid">
        <div className="field"><label>Provider</label><input value={values.provider} onChange={(e) => setValues({ ...values, provider: e.target.value })} /></div>
        <div className="field"><label>Business date</label><input type="date" value={values.businessDate} onChange={(e) => setValues({ ...values, businessDate: e.target.value })} /></div>
      </div>
      <div className="field" style={{ marginTop: 16 }}><label>Reason</label><textarea value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} /></div>
      {mutation.error && <p className="error-banner">{mutation.error.message}</p>}
      <Button disabled={values.reason.length < 8 || mutation.isPending}>Start reconciliation</Button>
    </form>
  );
}
