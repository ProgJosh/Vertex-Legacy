import Link from "next/link";
import { RegisterForm } from "@/components/auth-forms";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Registration" };

export default function RegisterPage() {
  const useAuth0 = process.env.AUTH_PROVIDER === "auth0" || process.env.NODE_ENV === "production";
  return (
    <div className="container">
      <section className="form-shell">
        <p className="eyebrow">Verified access</p>
        <h1 style={{ fontSize: "2.4rem" }}>Create an account.</h1>
        <p className="muted">
          Registration begins identity verification. Promotional credit is issued once per
          verified individual and is non-withdrawable unless policy changes.
        </p>
        {useAuth0 ? (
          <Button asChild style={{ width: "100%" }}>
            <a href="/auth/login?screen_hint=signup&returnTo=/investor/onboarding">
              Create account securely
            </a>
          </Button>
        ) : (
          <RegisterForm />
        )}
        <p>
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </div>
  );
}
