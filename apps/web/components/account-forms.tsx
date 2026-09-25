"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/button";

async function submit(path: string, body: object = {}, method: "POST" | "PATCH" = "POST") {
  const response = await fetch("/api/backend/" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Request failed.");
  return result;
}

export function ProfileForm({
  profile,
}: {
  profile: { firstName: string; lastName: string; nationality: string; city: string; region: string };
}) {
  const router = useRouter();
  const [values, setValues] = useState(profile);
  const mutation = useMutation({
    mutationFn: () => submit("me/profile", values, "PATCH"),
    onSuccess: () => router.refresh(),
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="form-grid">
        {([
          ["firstName", "First name"],
          ["lastName", "Last name"],
          ["nationality", "Nationality"],
          ["city", "City"],
          ["region", "Region or province"],
        ] as const).map(([key, label]) => (
          <div className="field" key={key}>
            <label htmlFor={"profile-" + key}>{label}</label>
            <input id={"profile-" + key} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
          </div>
        ))}
      </div>
      {mutation.error && <p className="error-banner">{mutation.error.message}</p>}
      {mutation.isSuccess && <p className="success-banner">Profile saved.</p>}
      <Button disabled={!values.firstName || !values.lastName || mutation.isPending}>{mutation.isPending ? "Saving…" : "Save profile"}</Button>
    </form>
  );
}

export function KycDemoForm() {
  const router = useRouter();
  const [fingerprint, setFingerprint] = useState("");
  const mutation = useMutation({
    mutationFn: () => submit("me/kyc/mock/complete", { individualFingerprint: fingerprint }),
    onSuccess: () => router.refresh(),
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="field">
        <label htmlFor="fingerprint">Sandbox individual fingerprint</label>
        <input
          id="fingerprint"
          value={fingerprint}
          onChange={(event) => setFingerprint(event.target.value)}
          placeholder="Use a unique 12+ character demonstration value"
        />
        <span className="muted">The API stores only an HMAC fingerprint, not the entered value.</span>
      </div>
      {mutation.error && <p className="error-banner">{mutation.error.message}</p>}
      <Button disabled={fingerprint.length < 12 || mutation.isPending}>
        {mutation.isPending ? "Verifying…" : "Complete sandbox KYC"}
      </Button>
    </form>
  );
}

export function EnableMfaButton() {
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: () => submit("me/security/mfa/mock-enable"),
    onSuccess: () => router.refresh(),
  });
  return (
    <>
      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? "Enabling…" : "Enable sandbox MFA"}
      </Button>
      {mutation.error && <p className="error-banner">{mutation.error.message}</p>}
    </>
  );
}

export function PayoutAccountForm() {
  const router = useRouter();
  const [values, setValues] = useState({
    institutionName: "",
    accountHolderName: "",
    accountIdentifier: "",
  });
  const mutation = useMutation({
    mutationFn: () => submit("me/payout-accounts", values),
    onSuccess: () => {
      setValues({ institutionName: "", accountHolderName: "", accountIdentifier: "" });
      router.refresh();
    },
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="institution">Institution</label>
          <input id="institution" value={values.institutionName} onChange={(e) => setValues({ ...values, institutionName: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="holder">Account holder</label>
          <input id="holder" value={values.accountHolderName} onChange={(e) => setValues({ ...values, accountHolderName: e.target.value })} />
        </div>
      </div>
      <div className="field" style={{ marginTop: 16 }}>
        <label htmlFor="identifier">Account number</label>
        <input id="identifier" value={values.accountIdentifier} onChange={(e) => setValues({ ...values, accountIdentifier: e.target.value })} />
        <span className="muted">Local sandbox stores only a token and masked suffix.</span>
      </div>
      {mutation.error && <p className="error-banner">{mutation.error.message}</p>}
      <Button disabled={mutation.isPending || Object.values(values).some((value) => value.length < 2)}>
        {mutation.isPending ? "Adding…" : "Add sandbox payout account"}
      </Button>
    </form>
  );
}

export function SupportCaseForm() {
  const router = useRouter();
  const [values, setValues] = useState({ subject: "", category: "ACCOUNT", message: "" });
  const mutation = useMutation({
    mutationFn: () => submit("support/cases", values),
    onSuccess: () => {
      setValues({ subject: "", category: "ACCOUNT", message: "" });
      router.refresh();
    },
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="form-grid">
        <div className="field"><label htmlFor="subject">Subject</label><input id="subject" value={values.subject} onChange={(e) => setValues({ ...values, subject: e.target.value })} /></div>
        <div className="field"><label htmlFor="category">Category</label><select id="category" value={values.category} onChange={(e) => setValues({ ...values, category: e.target.value })}><option>ACCOUNT</option><option>TRANSACTION</option><option>KYC</option><option>SECURITY</option></select></div>
      </div>
      <div className="field" style={{ marginTop: 16 }}><label htmlFor="message">Message</label><textarea id="message" value={values.message} onChange={(e) => setValues({ ...values, message: e.target.value })} /></div>
      {mutation.error && <p className="error-banner">{mutation.error.message}</p>}
      <Button disabled={mutation.isPending || values.subject.length < 4 || values.message.length < 10}>
        {mutation.isPending ? "Submitting…" : "Open support case"}
      </Button>
    </form>
  );
}
