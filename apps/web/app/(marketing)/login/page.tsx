import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth-forms";
import { Button } from "@/components/ui/button";
import { auth0Enabled, signInHref, signUpHref } from "@/lib/auth-links";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  const useAuth0 = auth0Enabled();
  return (
    <div className="container">
      <section className="form-shell">
        <p className="eyebrow">Account access</p>
        <h1 style={{ fontSize: "2.4rem" }}>Sign in to Vertex.</h1>
        <p className="muted">
          {useAuth0
            ? "Continue through Auth0 Universal Login for secure account access."
            : "Local development uses isolated demonstration identities."}
        </p>
        {useAuth0 ? (
          <div style={{ display: "grid", gap: 12 }}>
            <Button asChild style={{ width: "100%" }}>
              <a href={signInHref()}>Sign in to existing account</a>
            </Button>
            <Button asChild variant="secondary" style={{ width: "100%" }}>
              <a href={signUpHref()}>Create new account</a>
            </Button>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="loading-state">Preparing secure sign-in…</div>
            }
          >
            <LoginForm />
          </Suspense>
        )}
        {!useAuth0 && (
          <p>
            New to Vertex? <a href="/register">Create new account</a>
          </p>
        )}
      </section>
    </div>
  );
}
