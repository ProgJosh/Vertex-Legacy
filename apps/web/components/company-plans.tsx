import Link from "next/link";
import { formatPhp } from "@vertex/ui";
import { Button } from "./ui/button";

export type CompanyPlan = {
  slug: string;
  name: string;
  description: string;
  category: string;
  minimumCentavos: string;
  maximumCentavos: string | null;
  durationDays: number;
  riskClassification: string;
  performanceLabel: string;
  dailyPayoutCentavos: string;
  totalReturnCentavos: string;
  promotionalBadge: string | null;
};

export type CommissionLevel = {
  id: string;
  name: string;
  rate: string;
  level: number | null;
  active: boolean;
};
const hasSchedule = (plan: CompanyPlan) =>
  BigInt(plan.dailyPayoutCentavos) > 0n || BigInt(plan.totalReturnCentavos) > 0n;

export function formatRate(rate: string): string {
  const percent = Number(rate) * 100;
  if (!Number.isFinite(percent)) return rate;
  return (Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)) + "%";
}

/**
 * Renders the company VIP plan schedule and the three-level commission schedule
 * straight from the API, so the published figures live in one place and cannot
 * drift from what the platform actually offers.
 */
export function CompanyPlans({
  plans,
  levels,
  showLinks = false,
}: {
  plans: CompanyPlan[];
  levels: CommissionLevel[];
  showLinks?: boolean;
}) {
  const scheduled = plans.filter(hasSchedule);
  if (!scheduled.length && !levels.length) return null;

  return (
    <section className="panel company-plans" aria-labelledby="company-plans-title">
      <header className="company-plans-header">
        <div>
          <p className="eyebrow">Company VIP schedule</p>
          <h2 id="company-plans-title">Plan price, daily payout and cycle</h2>
          <p className="muted">
            The tiers below are the company plan schedule held in this system. Prices, daily
            payouts, cycle length and total return come from the plan record, not from a
            static illustration.
          </p>
        </div>
        <span className="status status-warning">Return not guaranteed</span>
      </header>

      {scheduled.length > 0 && (
        <div className="table-scroll company-plans-table">
          <table className="data-table">
            <caption className="company-plans-caption">
              Company VIP plan schedule · {scheduled.length} tiers
            </caption>
            <thead>
              <tr>
                <th scope="col">Plan name</th>
                <th scope="col">Price</th>
                <th scope="col">Daily profit</th>
                <th scope="col">Cycle days</th>
                <th scope="col">Total return</th>
                {showLinks && <th scope="col">Terms</th>}
              </tr>
            </thead>
            <tbody>
              {scheduled.map((plan) => (
                <tr key={plan.slug}>
                  <th scope="row">{plan.name}</th>
                  <td>{formatPhp(plan.minimumCentavos)}</td>
                  <td>{formatPhp(plan.dailyPayoutCentavos)}</td>
                  <td>{plan.durationDays}</td>
                  <td>{formatPhp(plan.totalReturnCentavos)}</td>
                  {showLinks && (
                    <td>
                      <Button asChild variant="secondary" size="small">
                        <Link href={"/plans/" + plan.slug}>View</Link>
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {levels.length > 0 && (
        <div className="company-plans-levels">
          <div>
            <p className="eyebrow">Commission levels</p>
            <h3>Three-level schedule</h3>
            <p className="muted">
              Published for transparency. A commission can only be credited from a confirmed plan
              service fee, never from a deposit.
            </p>
          </div>
          <dl className="company-plans-level-grid">
            {levels.map((item) => (
              <div key={item.id}>
                <dt>
                  Level {item.level ?? "–"}
                  {!item.active && <span className="muted"> · not credited</span>}
                </dt>
                <dd>{formatRate(item.rate)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="disclosure company-plans-notice">
        The daily payout and total return shown are the figures published in the company plan
        schedule. They are a stated schedule and not a guaranteed or assured return, and the
        platform does not underwrite them. You can lose your entire capital. Confirm the current
        schedule with Vertex Legacy before subscribing.
      </p>
    </section>
  );
}
