import { notFound } from "next/navigation";
import { formatPhp } from "@vertex/ui";
import { optionalApiGet } from "@/lib/api";

type Plan = {
  slug: string;
  name: string;
  description: string;
  category: string;
  minimumCentavos: string;
  maximumCentavos: string | null;
  durationDays: number;
  riskClassification: string;
  managementFeeRate: string;
  performanceLabel: string;
  targetPerformanceLow: string | null;
  targetPerformanceHigh: string | null;
  terms: string;
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const plan = await optionalApiGet<Plan | null>("/public/plans/" + slug, null);
  return plan
    ? { title: plan.name, description: plan.description, openGraph: { images: [] }, twitter: { images: [] } }
    : { title: "Plan not found" };
}

export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const plan = await optionalApiGet<Plan | null>("/public/plans/" + slug, null);
  if (!plan) notFound();
  return (
    <div className="container public-page">
      <p className="eyebrow">{plan.category} mandate</p>
      <div className="public-page-intro">
        <div>
          <h1>{plan.name}</h1>
          <p className="muted">{plan.description}</p>
        </div>
        <p className="disclosure">
          {plan.performanceLabel}. Returns may differ materially and are not guaranteed.
        </p>
      </div>
      <div className="content-grid">
        <section className="content-block">
          <h2>Plan parameters</h2>
          <dl className="detail-list">
            <div><dt>Minimum</dt><dd>{formatPhp(plan.minimumCentavos)}</dd></div>
            <div><dt>Maximum</dt><dd>{plan.maximumCentavos ? formatPhp(plan.maximumCentavos) : "No published maximum"}</dd></div>
            <div><dt>Duration</dt><dd>{plan.durationDays} days</dd></div>
            <div><dt>Risk classification</dt><dd>{plan.riskClassification}</dd></div>
          </dl>
        </section>
        <section className="content-block">
          <h2>Terms and risk</h2>
          <p>{plan.terms}</p>
          <p className="muted">
            Subscription remains subject to identity verification, suitability, plan capacity, and
            provider availability.
          </p>
        </section>
      </div>
    </div>
  );
}
