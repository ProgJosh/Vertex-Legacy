import Link from "next/link";
import { formatPhp } from "@vertex/ui";
import { apiGet, optionalApiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";

type Me = {
  profile: { firstName: string } | null;
  wallet: {
    depositedAvailableCentavos: string;
    promotionalAvailableCentavos: string;
    commissionAvailableCentavos: string;
    reservedCentavos: string;
  };
  kycCases: Array<{ status: string }>;
  mfaEnabledAt: string | null;
};

type Transaction = {
  id: string;
  kind: string;
  amountCentavos: string;
  status: string;
  createdAt: string;
};

export default async function InvestorOverview() {
  const [me, transactions] = await Promise.all([
    apiGet<Me>("/me"),
    optionalApiGet<Transaction[]>("/me/transactions", []),
  ]);
  const withdrawable =
    BigInt(me.wallet.depositedAvailableCentavos) + BigInt(me.wallet.commissionAvailableCentavos);
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Account overview</p>
          <h1>Good day{me.profile ? ", " + me.profile.firstName : ""}.</h1>
          <p>Your balances below are server projections from posted ledger entries.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button asChild variant="secondary"><Link href="/investor/withdraw">Withdraw</Link></Button>
          <Button asChild><Link href="/investor/cash-in">Cash in</Link></Button>
        </div>
      </header>
      <section className="metrics" aria-label="Wallet summary">
        <div className="metric">
          <small>Withdrawable</small>
          <strong>{formatPhp(withdrawable)}</strong>
          <em>Deposited cash and paid commissions</em>
        </div>
        <div className="metric">
          <small>Deposited cash</small>
          <strong>{formatPhp(me.wallet.depositedAvailableCentavos)}</strong>
          <em>Provider-confirmed funds</em>
        </div>
        <div className="metric">
          <small>Promotional credit</small>
          <strong>{formatPhp(me.wallet.promotionalAvailableCentavos)}</strong>
          <em>Separated and non-withdrawable by default</em>
        </div>
        <div className="metric">
          <small>Reserved</small>
          <strong>{formatPhp(me.wallet.reservedCentavos)}</strong>
          <em>Pending withdrawal authorization</em>
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div><h2 style={{ fontSize: "1.5rem" }}>Recent activity</h2><p>Latest recorded account events.</p></div>
            <Button asChild variant="quiet" size="small"><Link href="/investor/transactions">All activity</Link></Button>
          </div>
          {transactions.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Activity</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {transactions.slice(0, 6).map((item) => (
                    <tr key={item.id}>
                      <td>{item.kind}</td>
                      <td>{new Date(item.createdAt).toLocaleDateString("en-PH")}</td>
                      <td>{formatPhp(item.amountCentavos)}</td>
                      <td><span className="status">{item.status.replaceAll("_", " ")}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">No account activity has been recorded.</div>
          )}
        </section>
        <aside className="panel">
          <div className="panel-header"><div><h2 style={{ fontSize: "1.5rem" }}>Account readiness</h2><p>Controls required for financial actions.</p></div></div>
          <dl className="detail-list">
            <div><dt>Identity review</dt><dd><span className={"status " + (me.kycCases[0]?.status === "VERIFIED" ? "status-success" : "status-warning")}>{me.kycCases[0]?.status ?? "NOT STARTED"}</span></dd></div>
            <div><dt>MFA</dt><dd><span className={"status " + (me.mfaEnabledAt ? "status-success" : "status-warning")}>{me.mfaEnabledAt ? "Enabled" : "Required"}</span></dd></div>
            <div><dt>Provider mode</dt><dd>Sandbox</dd></div>
          </dl>
          <Button asChild variant="secondary" style={{ width: "100%", marginTop: 18 }}>
            <Link href="/investor/security">Review security</Link>
          </Button>
        </aside>
      </div>
    </>
  );
}
