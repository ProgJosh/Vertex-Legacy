import Link from "next/link";
import { ArrowRight, Landmark, LockKeyhole, Scale, ShieldCheck } from "lucide-react";
import { formatPhp } from "@vertex/ui";
import { optionalApiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";

type Config = {
  signupBonusCentavos: string;
  minimumDepositCentavos: string;
  minimumWithdrawalCentavos: string;
  withdrawalFeeRate: string;
  withdrawalOpensAt: string;
  withdrawalClosesAt: string;
  withdrawalTimezone: string;
};

type Plan = {
  slug: string;
  name: string;
  description: string;
  category: string;
  minimumCentavos: string;
  durationDays: number;
  riskClassification: string;
  promotionalBadge: string | null;
};

export default async function LandingPage() {
  const [config, plans] = await Promise.all([
    optionalApiGet<Config | null>("/public/config", null),
    optionalApiGet<Plan[]>("/public/plans", []),
  ]);

  return (
    <>
      <section className="landing-intro">
        <div className="container landing-grid">
          <div className="landing-copy">
            <p className="eyebrow">Disciplined investment operations</p>
            <h1>Clarity before capital. Records before promises.</h1>
            <p>
              Vertex Legacy gives verified investors one accountable place to review plan terms,
              fund a sandbox wallet, authorize withdrawals, and trace every financial movement.
            </p>
            <div className="landing-actions">
              <Button asChild>
                <Link href="/register">
                  Begin verification <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/how-it-works">Review the process</Link>
              </Button>
            </div>
          </div>
          <aside className="trust-panel" aria-label="Platform operating principles">
            <div className="trust-row">
              <span>Environment</span>
              <strong>Sandbox-first</strong>
            </div>
            <div className="trust-row">
              <span>Accounting</span>
              <strong>Double-entry ledger</strong>
            </div>
            <div className="trust-row">
              <span>Access</span>
              <strong>KYC and MFA gated</strong>
            </div>
            <div className="trust-row">
              <span>Returns</span>
              <strong>Illustrative, never guaranteed</strong>
            </div>
          </aside>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-header">
            <div>
              <p className="eyebrow">Operating standard</p>
              <h2>A financial record you can interrogate.</h2>
            </div>
            <p>
              Balances are projections from immutable entries. Corrections use traceable reversals,
              and provider callbacks are verified before money states change.
            </p>
          </div>
          <div className="principles">
            <article className="principle">
              <Landmark size={20} aria-hidden="true" />
              <p className="principle-index">01 · Custody boundary</p>
              <h3>Providers stay accountable</h3>
              <p className="muted">
                Cash-in and payout actions move through adapter contracts built for licensed
                providers. The local experience remains visibly simulated.
              </p>
            </article>
            <article className="principle">
              <Scale size={20} aria-hidden="true" />
              <p className="principle-index">02 · Balanced records</p>
              <h3>Every posting balances</h3>
              <p className="muted">
                Deposits, investments, fees, reserves, payouts, promotions, and commissions keep
                separate ledger accounts.
              </p>
            </article>
            <article className="principle">
              <ShieldCheck size={20} aria-hidden="true" />
              <p className="principle-index">03 · Qualified access</p>
              <h3>Verification governs action</h3>
              <p className="muted">
                KYC, MFA, role permissions, configured limits, and operating windows are enforced
                on the server.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-header">
            <div>
              <p className="eyebrow">Current parameters</p>
              <h2>Published fees and limits.</h2>
            </div>
            <Button asChild variant="secondary" size="small">
              <Link href="/fees-limits">Read the full schedule</Link>
            </Button>
          </div>
          {config ? (
            <div className="metrics">
              <div className="metric">
                <small>Minimum cash-in</small>
                <strong>{formatPhp(config.minimumDepositCentavos)}</strong>
                <em>Validated before provider checkout</em>
              </div>
              <div className="metric">
                <small>Minimum withdrawal</small>
                <strong>{formatPhp(config.minimumWithdrawalCentavos)}</strong>
                <em>Withdrawable funds only</em>
              </div>
              <div className="metric">
                <small>Withdrawal fee</small>
                <strong>{new PrismaDecimalDisplay(config.withdrawalFeeRate).percent()}</strong>
                <em>Shown before final authorization</em>
              </div>
              <div className="metric">
                <small>Request window</small>
                <strong>
                  {config.withdrawalOpensAt}–{config.withdrawalClosesAt}
                </strong>
                <em>{config.withdrawalTimezone}</em>
              </div>
            </div>
          ) : (
            <div className="error-state">Current operating parameters are temporarily unavailable.</div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-header">
            <div>
              <p className="eyebrow">Company plans</p>
              <h2>Terms first. Suitability always.</h2>
            </div>
            <p>
              Targets describe an intended range, not a promise. Eligibility, capacity, and risk
              classification are assessed before subscription.
            </p>
          </div>
          {plans.length ? (
            <div className="plan-grid">
              {plans.slice(0, 3).map((plan) => (
                <article
                  className={"plan-card " + (plan.promotionalBadge ? "plan-card-featured" : "")}
                  key={plan.slug}
                >
                  <p className="eyebrow">{plan.category}</p>
                  <h3>{plan.name}</h3>
                  <p className="muted">{plan.description}</p>
                  <div className="plan-meta">
                    <span>
                      <small>Minimum</small>
                      {formatPhp(plan.minimumCentavos)}
                    </span>
                    <span>
                      <small>Risk</small>
                      {plan.riskClassification}
                    </span>
                  </div>
                  <Button asChild variant="secondary">
                    <Link href={"/plans/" + plan.slug}>Review terms</Link>
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">No company plans are currently open for subscription.</div>
          )}
          <p className="disclosure" style={{ marginTop: 22 }}>
            Capital is at risk. Illustrative performance may not be achieved. Vertex Legacy does
            not activate live money movement without approved providers, credentials, and required
            regulatory authorization.
          </p>
        </div>
      </section>
    </>
  );
}

class PrismaDecimalDisplay {
  constructor(private readonly value: string) {}
  percent() {
    const [whole = "0", fraction = ""] = this.value.split(".");
    const basis = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0").slice(0, 4));
    const percentWhole = basis / 100n;
    const percentFraction = (basis % 100n).toString().padStart(2, "0");
    return percentWhole.toString() + "." + percentFraction + "%";
  }
}
