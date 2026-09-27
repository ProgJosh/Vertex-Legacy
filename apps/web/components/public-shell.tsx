import Link from "next/link";
import { Brand } from "./brand";
import { Button } from "./ui/button";

export function PublicHeader() {
  const signupHref =
    process.env.AUTH_PROVIDER === "auth0" || process.env.NODE_ENV === "production"
      ? "/auth/login?screen_hint=signup&returnTo=%2Finvestor%2Fonboarding"
      : "/register";
  return (
    <header className="public-header">
      <div className="container public-header-inner">
        <Brand />
        <nav className="public-nav" aria-label="Primary">
          <a href="/about">About</a>
          <a href="/how-it-works">How it works</a>
          <a href="/plans">Plans</a>
          <a href="/fees-limits">Fees & limits</a>
          <a href="/risk-disclosure">Risk</a>
        </nav>
        <div className="header-actions">
          <Button asChild variant="secondary" size="small">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="small">
            <a href={signupHref}>Open account</a>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <Brand />
          <p>
            GCash and Maya cash-ins are credited only after finance verifies the
            real transfer.
          </p>
        </div>
        <nav aria-label="Legal">
          <Link href="/terms">Terms</Link> ·{" "}
          <Link href="/privacy">Privacy</Link> ·{" "}
          <Link href="/contact">Support</Link>
        </nav>
      </div>
    </footer>
  );
}
