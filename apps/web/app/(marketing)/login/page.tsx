import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth-forms";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="container">
      <section className="form-shell">
        <p className="eyebrow">Account access</p>
        <h1 style={{ fontSize: "2.4rem" }}>Sign in to Vertex.</h1>
        <p className="muted">
          Local development uses isolated demonstration identities. Production delegates
          authentication and MFA to Auth0 or Amazon Cognito.
        </p>
        <Suspense fallback={<div className="loading-state">Preparing secure sign-in…</div>}>
          <LoginForm />
        </Suspense>
        <p>
          New to Vertex? <Link href="/register">Open an account</Link>
        </p>
      </section>
    </div>
  );
}
