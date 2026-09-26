import Link from "next/link";
import { formatPhp } from "@vertex/ui";
import { optionalApiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  CompanyPlans,
  type CommissionLevel,
  type CompanyPlan,
} from "@/components/company-plans";

export default async function PlansPage() {
  const [plans, levels] = await Promise.all([
    optionalApiGet<CompanyPlan[]>("/public/plans", []),
    optionalApiGet<CommissionLevel[]>("/public/commission-levels", []),
  ]);

  return (
    <div className="container public-page">
      <div className="public-page-intro">
        <div>
          <p className="eyebrow">Company plans</p>
          <h1>Compare the schedule, not the marketing.</h1>
        </div>
        <p className="muted">
          Review price, daily payout, cycle length, stated total return, risk classification,
          eligibility and full terms before making a subscription request.
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
                  <small>Price</small>
                  {formatPhp(plan.minimumCentavos)}
                </span>
                <span>
                  <small>Daily payout</small>
                  {BigInt(plan.dailyPayoutCentavos) > 0n
                    ? formatPhp(plan.dailyPayoutCentavos)
                    : "Not scheduled"}
                </span>
                <span>
                  <small>Cycle</small>
                  {plan.durationDays} days
                </span>
                <span>
                  <small>Stated total return</small>
                  {BigInt(plan.totalReturnCentavos) > 0n
                    ? formatPhp(plan.totalReturnCentavos)
                    : "Not scheduled"}
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

      <CompanyPlans plans={plans} levels={levels} />
    </div>
  );
}
