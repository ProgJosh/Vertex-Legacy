import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth-forms";
import { Button } from "@/components/ui/button";
import { auth0Enabled, signInHref, signUpHref } from "@/lib/auth-links";

export const metadata = { title: "Sign in" };

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

const authErrorMessage = (error?: string) => {
  if (error === "provisioning") {
    return "Your identity was verified, but Vertex could not finish creating your account. Please contact support.";
  }
  if (error === "authentication") {
    return "Sign-in could not be completed. Please try again. If this continues, contact support.";
  }
  return null;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const useAuth0 = auth0Enabled();
  const { error } = await searchParams;
  const errorMessage = authErrorMessage(error);
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
        {errorMessage ? (
          <p className="error-banner" role="alert">
            {errorMessage}
          </p>
        ) : null}
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
