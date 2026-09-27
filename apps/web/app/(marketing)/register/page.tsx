import Link from "next/link";
import { RegisterForm } from "@/components/auth-forms";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Registration" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const useAuth0 = process.env.AUTH_PROVIDER === "auth0" || process.env.NODE_ENV === "production";
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
            <a href={"/auth/login?screen_hint=signup&returnTo=" + encodeURIComponent(returnTo)}>
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
