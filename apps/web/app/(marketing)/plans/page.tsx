import Link from "next/link";
import { formatPhp } from "@vertex/ui";
import { optionalApiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";

type Plan = {
  slug: string;
  name: string;
  description: string;
  category: string;
  minimumCentavos: string;
  maximumCentavos: string | null;
  durationDays: number;
  riskClassification: string;
  performanceLabel: string;
  promotionalBadge: string | null;
};

export default async function PlansPage() {
  const plans = await optionalApiGet<Plan[]>("/public/plans", []);
  return (
    <div className="container public-page">
      <div className="public-page-intro">
        <div>
          <p className="eyebrow">Company plans</p>
          <h1>Compare the mandate, not the marketing.</h1>
        </div>
        <p className="muted">
          Review duration, configured limits, risk classification, fees, capacity, eligibility,
          and full terms before making a subscription request.
        </p>
      </div>
      {plans.length ? (
        <div className="plan-grid" style={{ marginTop: 34 }}>
          {plans.map((plan) => (
            <article className="plan-card" key={plan.slug}>
              <p className="eyebrow">{plan.category}</p>
              <h3>{plan.name}</h3>
              <p className="muted">{plan.description}</p>
              <div className="plan-meta">
                <span>
                  <small>Minimum</small>
                  {formatPhp(plan.minimumCentavos)}
                </span>
                <span>
                  <small>Duration</small>
                  {plan.durationDays} days
                </span>
                <span>
                  <small>Risk</small>
                  {plan.riskClassification}
                </span>
                <span>
                  <small>Performance</small>
                  {plan.performanceLabel}
                </span>
              </div>
              <Button asChild variant="secondary">
                <Link href={"/plans/" + plan.slug}>Open plan terms</Link>
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 34 }}>
          No plans are currently available.
        </div>
      )}
      <p className="disclosure" style={{ marginTop: 24 }}>
        Plan targets are illustrative and returns are not guaranteed. You can lose capital.
      </p>
    </div>
  );
}
