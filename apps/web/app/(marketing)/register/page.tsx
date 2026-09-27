import Link from "next/link";
import { RegisterForm } from "@/components/auth-forms";
import { Button } from "@/components/ui/button";
import { auth0Enabled, signUpHref } from "@/lib/auth-links";

export const metadata = { title: "Registration" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const useAuth0 = auth0Enabled();
  const { ref } = await searchParams;
  const referralCode = /^VTX-[A-Fa-f0-9]{8}$/.test(ref ?? "") ? ref!.toUpperCase() : null;
  const returnTo = referralCode ? "/investor/invitations?ref=" + encodeURIComponent(referralCode) : "/investor/onboarding";
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
            <a href={signUpHref(returnTo)}>
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
