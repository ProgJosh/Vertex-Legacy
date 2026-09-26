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
          <Button asChild style={{ width: "100%" }}>
            <a href="/auth/login?returnTo=/investor">Continue securely</a>
          </Button>
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
