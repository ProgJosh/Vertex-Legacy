"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "./ui/button";

const loginSchema = z.object({ email: z.string().email("Enter a valid email address.") });
type LoginInput = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "investor.demo@vertex.local" },
  });
  const mutation = useMutation({
    mutationFn: async (values: LoginInput) => {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Sign-in failed.");
      return body as { roles: string[] };
    },
    onSuccess: (session) => {
      const requested = search.get("returnTo");
      const destination =
        requested && requested.startsWith("/")
          ? requested
          : session.roles.includes("ADMIN") || session.roles.includes("FINANCE_COMPLIANCE")
            ? "/admin"
            : "/investor";
      router.push(destination);
      router.refresh();
    },
  });

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
      <div className="field">
        <label htmlFor="email">Email address</label>
        <input id="email" type="email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email && (
          <span className="field-error">{form.formState.errors.email.message}</span>
        )}
      </div>
      {mutation.error && (
        <p className="error-banner" role="alert">
          {mutation.error.message}
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending} style={{ width: "100%" }}>
        {mutation.isPending ? "Signing in…" : "Continue securely"}
      </Button>
      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        Local demo accounts: investor.demo@vertex.local, finance.demo@vertex.local, and
        admin.demo@vertex.local. No passwords or live funds are used.
      </p>
    </form>
  );
}

const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().min(1, "Last name is required."),
  email: z.string().email("Enter a valid email address."),
  mobile: z.string().min(8, "Enter a valid mobile number."),
  accepted: z.literal(true, { error: "Accept the terms and privacy notice to continue." }),
});
type RegisterInput = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", email: "", mobile: "", accepted: false as true },
  });
  const mutation = useMutation({
    mutationFn: async (values: RegisterInput) => {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Registration failed.");
      const session = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: values.email }),
      });
      if (!session.ok) throw new Error("Account created, but sign-in could not be started.");
      return body;
    },
    onSuccess: () => {
      router.push("/investor/onboarding");
      router.refresh();
    },
  });
  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="firstName">First name</label>
          <input id="firstName" autoComplete="given-name" {...form.register("firstName")} />
          {form.formState.errors.firstName && (
            <span className="field-error">{form.formState.errors.firstName.message}</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="lastName">Last name</label>
          <input id="lastName" autoComplete="family-name" {...form.register("lastName")} />
          {form.formState.errors.lastName && (
            <span className="field-error">{form.formState.errors.lastName.message}</span>
          )}
        </div>
      </div>
      <div className="field" style={{ marginTop: 18 }}>
        <label htmlFor="register-email">Email address</label>
        <input id="register-email" type="email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email && (
          <span className="field-error">{form.formState.errors.email.message}</span>
        )}
      </div>
      <div className="field">
        <label htmlFor="mobile">Mobile number</label>
        <input id="mobile" autoComplete="tel" {...form.register("mobile")} />
        {form.formState.errors.mobile && (
          <span className="field-error">{form.formState.errors.mobile.message}</span>
        )}
      </div>
      <label style={{ display: "flex", gap: 10, alignItems: "start", marginBottom: 18 }}>
        <input type="checkbox" {...form.register("accepted")} />
        <span>
          I agree to the <Link href="/terms">terms</Link> and{" "}
          <Link href="/privacy">privacy notice</Link>.
        </span>
      </label>
      {form.formState.errors.accepted && (
        <p className="field-error">{form.formState.errors.accepted.message}</p>
      )}
      {mutation.error && (
        <p className="error-banner" role="alert">
          {mutation.error.message}
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending} style={{ width: "100%" }}>
        {mutation.isPending ? "Creating account…" : "Create demonstration account"}
      </Button>
    </form>
  );
}
