import { formatPhp } from "@vertex/ui";
import { apiGet } from "@/lib/api";

type Summary = {
  users: number;
  plans: number;
  openKyc: number;
  deposits: { _sum: { amountCentavos: string | null } };
  withdrawals: { _sum: { requestedCentavos: string | null; feeCentavos: string | null } };
  generatedAt: string;
};

export default async function AdminOverview() {
  const summary = await apiGet<Summary>("/admin/reports/summary");
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Control center</p>
          <h1>Operational oversight.</h1>
          <p>Permission-scoped review of identity, financial workflows, configuration, and audit evidence.</p>
        </div>
      </header>
      <section className="metrics">
        <div className="metric"><small>Users</small><strong>{summary.users}</strong><em>All account states</em></div>
        <div className="metric"><small>Completed cash-in</small><strong>{formatPhp(summary.deposits._sum.amountCentavos ?? "0")}</strong><em>Sandbox totals</em></div>
        <div className="metric"><small>Completed withdrawals</small><strong>{formatPhp(summary.withdrawals._sum.requestedCentavos ?? "0")}</strong><em>Gross requested</em></div>
        <div className="metric"><small>Open KYC reviews</small><strong>{summary.openKyc}</strong><em>Pending or in review</em></div>
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2 style={{ fontSize: "1.5rem" }}>Administrative controls</h2><p>Sensitive actions require a reason and create immutable audit evidence.</p></div></div>
        <div className="content-grid" style={{ marginTop: 0 }}>
          <div className="content-block"><h3>Least privilege</h3><p className="muted">Finance and compliance reviewers cannot change platform configuration or role policy.</p></div>
          <div className="content-block"><h3>Financial integrity</h3><p className="muted">Posted transactions are append-only; operational corrections create linked reversals.</p></div>
        </div>
      </section>
    </>
  );
}
