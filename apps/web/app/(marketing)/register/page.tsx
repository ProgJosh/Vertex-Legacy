import Link from "next/link";
import { RegisterForm } from "@/components/auth-forms";

export const metadata = { title: "Registration" };

export default function RegisterPage() {
  return (
    <div className="container">
      <section className="form-shell">
        <p className="eyebrow">Verified access</p>
        <h1 style={{ fontSize: "2.4rem" }}>Create an account.</h1>
        <p className="muted">
          Registration begins identity verification. Promotional credit is issued once per
          verified individual and is non-withdrawable unless policy changes.
        </p>
        <RegisterForm />
        <p>
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </div>
  );
}
