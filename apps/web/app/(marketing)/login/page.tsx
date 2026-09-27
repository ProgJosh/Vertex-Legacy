import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth-forms";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  const useAuth0 = process.env.AUTH_PROVIDER === "auth0" || process.env.NODE_ENV === "production";
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
          <div className="access-choice">
            <a className="access-card" href="/auth/login?returnTo=/investor"><strong>Client access</strong><span>Wallet, products, rewards, invitations and account activity.</span></a>
            <a className="access-card" href="/auth/login?returnTo=/admin"><strong>Admin access</strong><span>For pre-authorized operations staff only. Role checks are enforced after sign-in.</span></a>
          </div>
        ) : (
          <Suspense fallback={<div className="loading-state">Preparing secure sign-in…</div>}>
            <LoginForm />
          </Suspense>
        )}
        <p>
          New to Vertex? <Link href="/register">Open an account</Link>
        </p>
      </section>
    </div>
  );
}
