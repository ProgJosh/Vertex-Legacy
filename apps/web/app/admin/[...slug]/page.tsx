import { notFound } from "next/navigation";
import { formatPhp } from "@vertex/ui";
import { apiGet, optionalApiGet } from "@/lib/api";
import {
  AnnouncementForm,
  CommissionRuleForm,
  ConfigForm,
  ManualPayoutAction,
  PlanForm,
  ReasonedAction,
  ReconciliationForm,
  UserManagementActions,
} from "@/components/admin-forms";

function Heading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div></header>;
}

function Status({ value }: { value: string }) {
  const kind = ["COMPLETED", "ACTIVE", "VERIFIED", "MATCHED"].includes(value) ? "status-success" : ["FAILED", "REJECTED", "REVERSED", "SUSPENDED"].includes(value) ? "status-danger" : "status-warning";
  return <span className={"status " + kind}>{value.replaceAll("_", " ")}</span>;
}

export default async function AdminSection({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const section = slug[0];

  if (section === "users") {
    const users = await optionalApiGet<Array<{ id: string; email: string; status: string; createdAt: string; profile: { firstName: string; lastName: string } | null; roles: Array<{ role: { name: string } }>; kycCases: Array<{ status: string }> }>>("/admin/users", []);
    return <><Heading eyebrow="User management" title="Accounts and access." description="Review account state, role assignment, and verification without exposing unnecessary personal data." /><section className="panel">{users.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>User</th><th>Roles</th><th>KYC</th><th>Status</th><th>Created</th><th>Controlled actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.profile ? user.profile.firstName + " " + user.profile.lastName : "Profile pending"}<div className="muted">{user.email}</div></td><td>{user.roles.map((item) => item.role.name).join(", ")}</td><td><Status value={user.kycCases[0]?.status ?? "NOT_STARTED"} /></td><td><Status value={user.status} /></td><td>{new Date(user.createdAt).toLocaleDateString("en-PH")}</td><td><UserManagementActions userId={user.id} status={user.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state">No users are available or your role cannot view them.</div>}</section></>;
  }

  if (section === "kyc") {
    const cases = await optionalApiGet<Array<{ id: string; status: string; createdAt: string; riskRating: string | null; user: { email: string; profile: { firstName: string; lastName: string } | null }; documents: unknown[] }>>("/admin/kyc", []);
    return <><Heading eyebrow="KYC review queue" title="Identity cases requiring judgment." description="Reviewers receive only the permissions and data needed for identity and compliance decisions." /><section className="panel">{cases.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Applicant</th><th>Submitted</th><th>Documents</th><th>Status</th><th>Decision</th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}><td>{item.user.profile ? item.user.profile.firstName + " " + item.user.profile.lastName : item.user.email}</td><td>{new Date(item.createdAt).toLocaleString("en-PH")}</td><td>{item.documents.length}</td><td><Status value={item.status} /></td><td><div style={{ display: "grid", gap: 8 }}><ReasonedAction path={"admin/kyc/" + item.id + "/decision"} label="Verify" extra={{ status: "VERIFIED" }} /><ReasonedAction path={"admin/kyc/" + item.id + "/decision"} label="Reject" variant="danger" extra={{ status: "REJECTED" }} /></div></td></tr>)}</tbody></table></div> : <div className="empty-state">The KYC review queue is clear.</div>}</section></>;
  }

  if (section === "deposits") {
    const deposits = await optionalApiGet<Array<{
      id: string;
      amountCentavos: string;
      provider: string;
      providerReference: string | null;
      paymentChannel: string | null;
      senderName: string | null;
      senderMobileLast4: string | null;
      submittedAt: string | null;
      status: string;
      createdAt: string;
      user: { email: string; profile: { firstName: string; lastName: string } | null };
    }>>("/admin/deposits", []);
    return (
      <>
        <Heading
          eyebrow="Deposit review"
          title="Match wallet transfers before crediting funds."
          description="Compare the exact amount, channel, reference, sender details and transaction time against the official GCash or Maya business-wallet record. Screenshots alone are not proof."
        />
        <section className="panel">
          {deposits.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>User</th><th>Transfer details</th><th>Amount</th><th>Status</th><th>Created / submitted</th><th>Controlled actions</th></tr></thead>
                <tbody>
                  {deposits.map((item) => (
                    <tr key={item.id}>
                      <td>{item.user.profile ? item.user.profile.firstName + " " + item.user.profile.lastName : item.user.email}<div className="muted">{item.user.email}</div></td>
                      <td>{item.paymentChannel ?? item.provider}<div className="muted">Reference: {item.providerReference?.replace(/^MANUAL:[^:]+:/, "") ?? "Not submitted"}</div>{item.senderName && <div className="muted">Sender: {item.senderName} · ••• {item.senderMobileLast4}</div>}</td>
                      <td>{formatPhp(item.amountCentavos)}</td>
                      <td><Status value={item.status} /></td>
                      <td>{new Date(item.createdAt).toLocaleString("en-PH")}<div className="muted">{item.submittedAt ? "Submitted " + new Date(item.submittedAt).toLocaleString("en-PH") : "Awaiting transfer"}</div></td>
                      <td>{item.status === "AWAITING_REVIEW" ? <div style={{ display: "grid", gap: 10 }}><ReasonedAction path={"admin/deposits/" + item.id + "/approve"} label="Confirm wallet match" /><ReasonedAction path={"admin/deposits/" + item.id + "/reject"} label="Reject unmatched transfer" variant="danger" /></div> : <span className="muted">No action available</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-state">No deposit activity is available.</div>}
        </section>
      </>
    );
  }

  if (section === "withdrawals") {
    const withdrawals = await optionalApiGet<Array<{
      id: string; requestedCentavos: string; feeCentavos: string; netCentavos: string;
      status: string; provider: string; providerReference: string | null;
      payoutSubmittedAt: string | null; payoutSubmittedBy: string | null;
      createdAt: string;
      user: { email: string; profile: { firstName: string; lastName: string } | null };
      payoutAccount: { institutionName: string; accountHolderName: string; maskedIdentifier: string };
    }>>("/admin/withdrawals", []);
    return <><Heading eyebrow="Withdrawal review" title="Payout controls and exceptions." description="Finance reveals the approved destination, sends the exact net amount, and records the wallet reference. A different authorized reviewer must then confirm settlement or safely restore the reserved funds if the transfer failed. Every action is audited." /><section className="panel">{withdrawals.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>User</th><th>Gross / fee / net</th><th>Destination</th><th>Status</th><th>Controlled actions</th></tr></thead><tbody>{withdrawals.map((item) => {
      const manual = item.provider === "manual";
      const reference = item.providerReference?.replace(/^MANUAL-PAYOUT:/, "");
      return <tr key={item.id}><td>{item.user.profile ? item.user.profile.firstName + " " + item.user.profile.lastName : item.user.email}<div className="muted">{new Date(item.createdAt).toLocaleString("en-PH")}</div></td><td>{formatPhp(item.requestedCentavos)}<div className="muted">Fee {formatPhp(item.feeCentavos)} · Net {formatPhp(item.netCentavos)}</div></td><td>{item.payoutAccount.institutionName} · {item.payoutAccount.maskedIdentifier}<div className="muted">{item.payoutAccount.accountHolderName}</div></td><td><Status value={item.status} />{reference && <div className="muted">Reference: {reference}</div>}{item.payoutSubmittedAt && <div className="muted">Sent {new Date(item.payoutSubmittedAt).toLocaleString("en-PH")}</div>}</td><td><div style={{ display: "grid", gap: 10 }}>
        {item.status === "AWAITING_REVIEW" && <ReasonedAction path={"admin/withdrawals/" + item.id + "/approve"} label="Approve for payout" />}
        {manual && item.status === "PROCESSING" && <ManualPayoutAction withdrawalId={item.id} />}
        {!manual && item.status === "PROCESSING" && <ReasonedAction path={"admin/withdrawals/" + item.id + "/mock-settle"} label="Settle sandbox payout" />}
        {manual && item.status === "AWAITING_PROVIDER" && <><ReasonedAction path={"admin/withdrawals/" + item.id + "/manual-settle"} label="Confirm transfer settled" /><ReasonedAction path={"admin/withdrawals/" + item.id + "/manual-fail"} label="Confirm failed and restore funds" variant="danger" /></>}
        {manual && item.status === "PROCESSING" && <ReasonedAction path={"admin/withdrawals/" + item.id + "/reverse"} label="Cancel before transfer" variant="danger" />}
      </div></td></tr>;
    })}</tbody></table></div> : <div className="empty-state">No withdrawal requests are available.</div>}</section></>;
  }

  if (section === "plans") {
    const plans = await optionalApiGet<Array<{ id: string; name: string; category: string; minimumCentavos: string; dailyPayoutCentavos: string; totalReturnCentavos: string; durationDays: number; riskClassification: string; status: string; subscribedCentavos: string }>>("/admin/plans", []);
    return <><Heading eyebrow="Plan management" title="Terms, capacity, and availability." description="Create reviewed plan definitions. Performance wording remains illustrative, never guaranteed." /><div className="dashboard-grid"><section className="panel"><h2 style={{ fontSize: "1.5rem" }}>Existing plans</h2>{plans.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Plan</th><th>Price</th><th>Daily payout</th><th>Total return</th><th>Subscribed</th><th>Risk</th><th>Status</th></tr></thead><tbody>{plans.map((item) => <tr key={item.id}><td>{item.name}<div className="muted">{item.category} · {item.durationDays} days</div></td><td>{formatPhp(item.minimumCentavos)}</td><td>{formatPhp(item.dailyPayoutCentavos)}</td><td>{formatPhp(item.totalReturnCentavos)}</td><td>{formatPhp(item.subscribedCentavos)}</td><td>{item.riskClassification}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state">No plans configured.</div>}</section><aside className="panel"><h2 style={{ fontSize: "1.5rem" }}>Create plan</h2><PlanForm /></aside></div></>;
  }

  if (section === "commissions") {
    const rules = await optionalApiGet<Array<{ id: string; name: string; qualifyingEvent: string; rate: string; capCentavos: string | null; active: boolean; effectiveFrom: string }>>("/admin/commission-rules", []);
    return <><Heading eyebrow="Commission configuration" title="Qualified events only." description="Rates, caps, eligibility, and effective dates are explicit. Deposits never trigger commission." /><div className="dashboard-grid"><section className="panel">{rules.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Rule</th><th>Qualifying event</th><th>Rate</th><th>Cap</th><th>State</th></tr></thead><tbody>{rules.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.qualifyingEvent}</td><td>{item.rate}</td><td>{item.capCentavos ? formatPhp(item.capCentavos) : "No cap"}</td><td><Status value={item.active ? "ACTIVE" : "PAUSED"} /></td></tr>)}</tbody></table></div> : <div className="empty-state">No commission rules configured.</div>}</section><aside className="panel"><h2 style={{ fontSize: "1.5rem" }}>New rule</h2><CommissionRuleForm /></aside></div></>;
  }

  if (section === "referrals") {
    const referrals = await optionalApiGet<Array<{ id: string; status: string; eligibilityReason: string | null; createdAt: string; referrer: { email: string }; referred: { email: string } }>>("/admin/referrals", []);
    return <><Heading eyebrow="Referral monitoring" title="Eligibility and abuse review." description="Self-referrals, duplicate identities, and deposit-only activity are ineligible." /><section className="panel">{referrals.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Referrer</th><th>Referred account</th><th>Status</th><th>Reason</th><th>Created</th></tr></thead><tbody>{referrals.map((item) => <tr key={item.id}><td>{item.referrer.email}</td><td>{item.referred.email}</td><td><Status value={item.status} /></td><td>{item.eligibilityReason ?? "Pending evaluation"}</td><td>{new Date(item.createdAt).toLocaleDateString("en-PH")}</td></tr>)}</tbody></table></div> : <div className="empty-state">No referral links are recorded.</div>}</section></>;
  }

  if (section === "ledger") {
    const transactions = await optionalApiGet<Array<{ id: string; reference: string; kind: string; description: string; status: string; effectiveAt: string; entries: Array<{ id: string; direction: string; amountCentavos: string; account: { code: string; name: string } }> }>>("/admin/ledger", []);
    return <><Heading eyebrow="Ledger explorer" title="Append-only financial evidence." description="Every posted transaction must contain equal debit and credit totals. Corrections use linked reversals." /><section className="panel">{transactions.length ? transactions.map((transaction) => <article key={transaction.id} style={{ padding: "18px 0", borderBottom: "1px solid var(--line)" }}><div className="panel-header"><div><strong>{transaction.reference} · {transaction.kind}</strong><p>{transaction.description}</p></div><Status value={transaction.status} /></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Account</th><th>Direction</th><th>Amount</th></tr></thead><tbody>{transaction.entries.map((entry) => <tr key={entry.id}><td>{entry.account.code}<div className="muted">{entry.account.name}</div></td><td>{entry.direction}</td><td>{formatPhp(entry.amountCentavos)}</td></tr>)}</tbody></table></div></article>) : <div className="empty-state">No ledger transactions are available.</div>}</section></>;
  }

  if (section === "reconciliation") {
    const runs = await optionalApiGet<Array<{ id: string; provider: string; businessDate: string; status: string; internalTotal: string; providerTotal: string; discrepancyCount: number }>>("/admin/reconciliation", []);
    return <><Heading eyebrow="Reconciliation" title="Internal ledger versus provider records." description="Daily runs identify amount, status, and reference mismatches for finance review." /><div className="dashboard-grid"><section className="panel">{runs.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Provider</th><th>Internal</th><th>Provider total</th><th>Differences</th><th>Status</th></tr></thead><tbody>{runs.map((item) => <tr key={item.id}><td>{new Date(item.businessDate).toLocaleDateString("en-PH")}</td><td>{item.provider}</td><td>{formatPhp(item.internalTotal)}</td><td>{formatPhp(item.providerTotal)}</td><td>{item.discrepancyCount}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state">No reconciliation runs recorded.</div>}</section><aside className="panel"><h2 style={{ fontSize: "1.5rem" }}>Start run</h2><ReconciliationForm /></aside></div></>;
  }

  if (section === "configuration") {
    const configs = await optionalApiGet<Array<{ id: string; version: number; minimumDepositCentavos: string; minimumWithdrawalCentavos: string; withdrawalFeeRate: string; withdrawalOpensAt: string; withdrawalClosesAt: string; withdrawalOutsideWindowMode: string; active: boolean; changeReason: string; createdAt: string }>>("/admin/config", []);
    const active = configs.find((item) => item.active);
    return <><Heading eyebrow="Platform configuration" title="Versioned financial policy." description="Amounts, fee, hours, and outside-window behavior are read from the active configuration record." />{active ? <div className="dashboard-grid"><section className="panel"><h2 style={{ fontSize: "1.5rem" }}>Active version {active.version}</h2><ConfigForm config={active} /></section><aside className="panel"><h2 style={{ fontSize: "1.5rem" }}>Version history</h2>{configs.map((item) => <article key={item.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}><strong>Version {item.version}</strong> · <Status value={item.active ? "ACTIVE" : "ARCHIVED"} /><p className="muted">{item.changeReason}</p></article>)}</aside></div> : <div className="error-state">Configuration is unavailable or access is restricted.</div>}</>;
  }

  if (section === "announcements") {
    const announcements = await optionalApiGet<Array<{ id: string; title: string; body: string; audience: string; publishedAt: string | null }>>("/admin/announcements", []);
    return <><Heading eyebrow="Announcements" title="Publish operational notices." description="Keep content factual, audience-specific, and free from deceptive urgency." /><div className="dashboard-grid"><section className="panel">{announcements.length ? announcements.map((item) => <article key={item.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}><h3>{item.title}</h3><p className="muted">{item.body}</p><small>{item.audience} · {item.publishedAt ? new Date(item.publishedAt).toLocaleString("en-PH") : "Draft"}</small></article>) : <div className="empty-state">No announcements published.</div>}</section><aside className="panel"><h2 style={{ fontSize: "1.5rem" }}>New announcement</h2><AnnouncementForm /></aside></div></>;
  }

  if (section === "reports") {
    const summary = await apiGet<{ users: number; plans: number; openKyc: number; deposits: { _sum: { amountCentavos: string | null } }; withdrawals: { _sum: { requestedCentavos: string | null; feeCentavos: string | null } }; generatedAt: string }>("/admin/reports/summary");
    return <><Heading eyebrow="Reports" title="Operational summary." description={"Generated " + new Date(summary.generatedAt).toLocaleString("en-PH")} /><section className="metrics"><div className="metric"><small>Users</small><strong>{summary.users}</strong></div><div className="metric"><small>Active plans</small><strong>{summary.plans}</strong></div><div className="metric"><small>Completed cash-in</small><strong>{formatPhp(summary.deposits._sum.amountCentavos ?? "0")}</strong></div><div className="metric"><small>Withdrawal fees</small><strong>{formatPhp(summary.withdrawals._sum.feeCentavos ?? "0")}</strong></div></section><p className="disclosure">Sandbox data only. Production reports require retention, access, and regulatory approval.</p></>;
  }

  if (section === "audit-logs") {
    const logs = await optionalApiGet<Array<{ id: string; action: string; resourceType: string; resourceId: string | null; reason: string | null; outcome: string; correlationId: string; createdAt: string; actor: { email: string } | null }>>("/admin/audit-logs", []);
    return <><Heading eyebrow="Audit logs" title="Sensitive action evidence." description="Append-only records preserve actor, reason, resource, outcome, correlation, and timestamp." /><section className="panel">{logs.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Reason</th><th>Outcome</th></tr></thead><tbody>{logs.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString("en-PH")}</td><td>{item.actor?.email ?? "System"}</td><td>{item.action}</td><td>{item.resourceType} · {item.resourceId ?? "—"}</td><td>{item.reason ?? "Automated"}</td><td><Status value={item.outcome} /></td></tr>)}</tbody></table></div> : <div className="empty-state">No audit records are available.</div>}</section></>;
  }

  if (section === "roles") {
    const roles = await optionalApiGet<Array<{ id: string; name: string; description: string; permissions: Array<{ permission: { key: string; description: string } }> }>>("/admin/roles", []);
    return <><Heading eyebrow="Roles and permissions" title="Least-privilege policy." description="Role membership and permission changes require controlled, audited administration." /><section className="content-grid" style={{ marginTop: 0 }}>{roles.map((role) => <article className="content-block" key={role.id}><h2 style={{ fontSize: "1.5rem" }}>{role.name}</h2><p className="muted">{role.description}</p><ul>{role.permissions.map((item) => <li key={item.permission.key}>{item.permission.key}</li>)}</ul></article>)}</section></>;
  }

  notFound();
}
