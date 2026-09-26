import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPhp } from "@vertex/ui";
import { apiGet, optionalApiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  CashInForm,
  PlanSubscribeForm,
  WithdrawalForm,
} from "@/components/financial-forms";
import {
  EnableMfaButton,
  KycDemoForm,
  PayoutAccountForm,
  ProfileForm,
  SupportCaseForm,
} from "@/components/account-forms";
import { PortfolioChart } from "@/components/portfolio-chart";
import {
  CompanyPlans,
  type CommissionLevel,
  type CompanyPlan,
} from "@/components/company-plans";

type Wallet = {
  depositedAvailableCentavos: string;
  promotionalAvailableCentavos: string;
  commissionAvailableCentavos: string;
  reservedCentavos: string;
  projectionVersion: string;
};

type Payout = {
  id: string;
  institutionName: string;
  accountHolderName: string;
  maskedIdentifier: string;
  verifiedAt: string | null;
};

type Me = {
  email: string;
  mobile: string | null;
  emailVerifiedAt: string | null;
  mobileVerifiedAt: string | null;
  mfaEnabledAt: string | null;
  profile: {
    firstName: string;
    lastName: string;
    nationality: string | null;
    city: string | null;
    region: string | null;
  } | null;
  wallet: Wallet;
  kycCases: Array<{ id: string; status: string; reviewedAt: string | null }>;
  payoutAccounts: Payout[];
  sessions: Array<{ id: string; deviceLabel: string | null; lastSeenAt: string; revokedAt: string | null }>;
};

type Config = {
  minimumDepositCentavos: string;
  minimumWithdrawalCentavos: string;
  withdrawalFeeRate: string;
  withdrawalOpensAt: string;
  withdrawalClosesAt: string;
  withdrawalTimezone: string;
  promotionalCreditsWithdrawable: boolean;
};

type Plan = {
  id: string;
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
  dailyPayoutCentavos: string;
  totalReturnCentavos: string;
  terms: string;
  promotionalBadge: string | null;
};

type Transaction = {
  id: string;
  kind: string;
  reference: string | null;
  amountCentavos: string;
  status: string;
  createdAt: string;
};

function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

function Status({ value }: { value: string }) {
  const style =
    ["COMPLETED", "ACTIVE", "VERIFIED", "PAID", "APPROVED"].includes(value)
      ? "status-success"
      : ["FAILED", "REJECTED", "REVERSED"].includes(value)
        ? "status-danger"
        : "status-warning";
  return <span className={"status " + style}>{value.replaceAll("_", " ")}</span>;
}

export default async function InvestorSection({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const section = slug[0];

  if (section === "onboarding") {
    const me = await apiGet<Me>("/me");
    const steps = [
      { label: "Email verification", complete: Boolean(me.emailVerifiedAt), href: "/investor/verify" },
      { label: "Identity verification", complete: me.kycCases[0]?.status === "VERIFIED", href: "/investor/kyc" },
      { label: "Multi-factor authentication", complete: Boolean(me.mfaEnabledAt), href: "/investor/security" },
      { label: "Verified payout account", complete: me.payoutAccounts.some((item) => item.verifiedAt), href: "/investor/payout-accounts" },
    ];
    return (
      <>
        <Heading eyebrow="Account setup" title="Complete your operating controls." description="Financial actions unlock only after the relevant verification and security requirements are satisfied." />
        <section className="panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Requirement</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{steps.map((step) => <tr key={step.label}><td>{step.label}</td><td><Status value={step.complete ? "COMPLETED" : "PENDING"} /></td><td><Button asChild variant="secondary" size="small"><Link href={step.href}>{step.complete ? "Review" : "Continue"}</Link></Button></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </>
    );
  }

  if (section === "verify") {
    const me = await apiGet<Me>("/me");
    return (
      <>
        <Heading eyebrow="Contact verification" title="Email and mobile." description="Production verification is delegated to the configured identity provider." />
        <section className="panel">
          <dl className="detail-list">
            <div><dt>Email</dt><dd>{me.email} · <Status value={me.emailVerifiedAt ? "VERIFIED" : "PENDING"} /></dd></div>
            <div><dt>Mobile</dt><dd>{me.mobile ?? "Not supplied"} · <Status value={me.mobileVerifiedAt ? "VERIFIED" : "PENDING"} /></dd></div>
          </dl>
        </section>
      </>
    );
  }

  if (section === "kyc") {
    const me = await apiGet<Me>("/me");
    const status = me.kycCases[0]?.status ?? "NOT_STARTED";
    return (
      <>
        <Heading eyebrow="Identity verification" title="Know your customer review." description="Identity, document, sanctions, and risk checks belong behind a licensed KYC provider adapter." />
        <section className="panel">
          <div className="panel-header"><div><h2 style={{ fontSize: "1.5rem" }}>Current review</h2><p>Mock KYC is available only in local development.</p></div><Status value={status} /></div>
          {status === "VERIFIED" ? <div className="success-banner">Identity verification is complete.</div> : <KycDemoForm />}
        </section>
      </>
    );
  }

  if (section === "wallet") {
    const [wallet, config] = await Promise.all([
      apiGet<Wallet>("/me/wallet"),
      apiGet<Config>("/public/config"),
    ]);
    const withdrawable = BigInt(wallet.depositedAvailableCentavos) + BigInt(wallet.commissionAvailableCentavos);
    return (
      <>
        <Heading eyebrow="Wallet" title="Separated balances, one ledger." description="The wallet is a read projection. Promotional, deposited, commission, and reserved funds remain distinct." action={<div style={{ display: "flex", gap: 8 }}><Button asChild variant="secondary"><Link href="/investor/withdraw">Withdraw</Link></Button><Button asChild><Link href="/investor/cash-in">Cash in</Link></Button></div>} />
        <section className="metrics">
          <div className="metric"><small>Withdrawable</small><strong>{formatPhp(withdrawable)}</strong><em>Excludes promotional credit</em></div>
          <div className="metric"><small>Deposited cash</small><strong>{formatPhp(wallet.depositedAvailableCentavos)}</strong><em>Available for eligible plans</em></div>
          <div className="metric"><small>Commissions</small><strong>{formatPhp(wallet.commissionAvailableCentavos)}</strong><em>Paid qualified events</em></div>
          <div className="metric"><small>Reserved</small><strong>{formatPhp(wallet.reservedCentavos)}</strong><em>Pending payout requests</em></div>
        </section>
        <section className="panel">
          <h2 style={{ fontSize: "1.5rem" }}>Promotional credit policy</h2>
          <p className="muted">
            Current promotional balance: {formatPhp(wallet.promotionalAvailableCentavos)}.{" "}
            {config.promotionalCreditsWithdrawable
              ? "The active policy permits withdrawal when other requirements are met."
              : "The active policy does not permit withdrawal."}
          </p>
        </section>
      </>
    );
  }

  if (section === "cash-in") {
    const config = await apiGet<Config>("/public/config");
    return (
      <>
        <Heading eyebrow="Cash in" title="Create a provider-backed funding request." description="The browser creates a pending intent. Only the sandbox provider webhook can post funds to the ledger." />
        <div className="dashboard-grid">
          <section className="panel"><CashInForm minimumCentavos={config.minimumDepositCentavos} /></section>
          <aside className="panel"><h2 style={{ fontSize: "1.5rem" }}>Control path</h2><ol className="muted"><li>Amount and minimum validated.</li><li>Idempotent deposit intent created.</li><li>Sandbox checkout initialized.</li><li>Signed webhook verified and deduplicated.</li><li>Balanced entries posted and wallet refreshed.</li></ol></aside>
        </div>
      </>
    );
  }

  if (section === "withdraw" && slug[1] === "confirmation") {
    const id = typeof query.id === "string" ? query.id : null;
    return (
      <>
        <Heading eyebrow="Withdrawal status" title="Request received." description="The requested amount is reserved while the configured workflow continues." />
        <section className="success-banner">
          <h2 style={{ fontSize: "1.5rem" }}>Authorization recorded</h2>
          <p>Reference: {id ?? "Unavailable"}</p>
          <p>The request is pending, scheduled, or under review according to its server status. No live payout is enabled in this sandbox.</p>
          <Button asChild variant="secondary"><Link href="/investor/transactions">View transaction history</Link></Button>
        </section>
      </>
    );
  }

  if (section === "withdraw") {
    const [me, config] = await Promise.all([apiGet<Me>("/me"), apiGet<Config>("/public/config")]);
    return (
      <>
        <Heading eyebrow="Withdraw" title="Authorize a controlled payout request." description="KYC, MFA, balance, minimum, operating hours, fee, and destination are checked on the server." />
        <section className="panel">
          <WithdrawalForm payoutAccounts={me.payoutAccounts} minimumCentavos={config.minimumWithdrawalCentavos} />
        </section>
      </>
    );
  }

  if (section === "plans" && slug[1]) {
    const plan = await optionalApiGet<Plan | null>("/public/plans/" + slug[1], null);
    if (!plan) notFound();
    return (
      <>
        <Heading eyebrow={plan.category} title={plan.name} description={plan.description} action={<Status value={plan.riskClassification.toUpperCase().replace("–", "_")} />} />
        <div className="dashboard-grid">
          <section className="panel">
            <h2 style={{ fontSize: "1.5rem" }}>Mandate and terms</h2>
            <p>{plan.terms}</p>
            <dl className="detail-list">
              <div><dt>Price</dt><dd>{formatPhp(plan.minimumCentavos)}</dd></div>
              <div><dt>Daily payout</dt><dd>{BigInt(plan.dailyPayoutCentavos) > 0n ? formatPhp(plan.dailyPayoutCentavos) : "Not scheduled"}</dd></div>
              <div><dt>Cycle</dt><dd>{plan.durationDays} days</dd></div>
              <div><dt>Stated total return</dt><dd>{BigInt(plan.totalReturnCentavos) > 0n ? formatPhp(plan.totalReturnCentavos) : "Not scheduled"}</dd></div>
              <div><dt>Maximum</dt><dd>{plan.maximumCentavos ? formatPhp(plan.maximumCentavos) : "No published maximum"}</dd></div>
              <div><dt>Risk</dt><dd>{plan.riskClassification}</dd></div>
              <div><dt>Performance wording</dt><dd>{plan.performanceLabel}</dd></div>
            </dl>
            <p className="disclosure">Returns are not guaranteed. Capital is at risk.</p>
          </section>
          <aside className="panel">
            <div className="panel-header"><div><h2 style={{ fontSize: "1.5rem" }}>Subscribe</h2><p>Uses deposited cash only.</p></div></div>
            <PlanSubscribeForm slug={plan.slug} minimumCentavos={plan.minimumCentavos} maximumCentavos={plan.maximumCentavos} />
          </aside>
        </div>
      </>
    );
  }

  if (section === "plans") {
    const [plans, levels] = await Promise.all([
      optionalApiGet<Plan[]>("/public/plans", []),
      optionalApiGet<CommissionLevel[]>("/public/commission-levels", []),
    ]);
    return (
      <>
        <Heading eyebrow="Company plans" title="Assess before you subscribe." description="Compare price, daily payout, cycle, stated total return, risk, limits, eligibility, and approved supporting documents." />
        {plans.length ? <div className="plan-grid">{plans.map((plan) => <article className="plan-card" key={plan.id}><p className="eyebrow">{plan.category}</p><h3>{plan.name}</h3><p className="muted">{plan.description}</p><div className="plan-meta"><span><small>Price</small>{formatPhp(plan.minimumCentavos)}</span><span><small>Daily payout</small>{BigInt(plan.dailyPayoutCentavos) > 0n ? formatPhp(plan.dailyPayoutCentavos) : "Not scheduled"}</span><span><small>Cycle</small>{plan.durationDays} days</span><span><small>Stated total return</small>{BigInt(plan.totalReturnCentavos) > 0n ? formatPhp(plan.totalReturnCentavos) : "Not scheduled"}</span><span><small>Risk</small>{plan.riskClassification}</span></div><Button asChild variant="secondary"><Link href={"/investor/plans/" + plan.slug}>Review and subscribe</Link></Button></article>)}</div> : <div className="empty-state">No plans are open.</div>}
        <CompanyPlans plans={plans} levels={levels} />
      </>
    );
  }

  if (section === "portfolio") {
    const holdings = await optionalApiGet<Array<{ id: string; costBasisCentavos: string; units: string; plan: Plan }>>("/me/portfolio", []);
    return (
      <>
        <Heading eyebrow="Portfolio" title="Your active positions." description="Positions below come from completed plan orders and stored valuations." />
        <section className="panel">
          <div className="panel-header"><div><h2 style={{ fontSize: "1.5rem" }}>Cost basis by plan</h2><p>No fabricated market performance is shown.</p></div></div>
          <PortfolioChart labels={holdings.map((item) => item.plan.name)} values={holdings.map((item) => (BigInt(item.costBasisCentavos) / 100n).toString())} />
        </section>
        <section className="panel" style={{ marginTop: 18 }}>
          {holdings.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Plan</th><th>Units</th><th>Cost basis</th><th>Risk</th></tr></thead><tbody>{holdings.map((item) => <tr key={item.id}><td>{item.plan.name}</td><td>{item.units}</td><td>{formatPhp(item.costBasisCentavos)}</td><td>{item.plan.riskClassification}</td></tr>)}</tbody></table></div> : <div className="empty-state">You do not have active holdings.</div>}
        </section>
      </>
    );
  }

  if (section === "transactions") {
    const transactions = await optionalApiGet<Transaction[]>("/me/transactions", []);
    return (
      <>
        <Heading eyebrow="Transaction history" title="Every recorded movement." description="Deposits, withdrawals, plan orders, and qualified commissions share one traceable history." />
        <section className="panel">{transactions.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Activity</th><th>Date</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td>{item.kind}</td><td>{new Date(item.createdAt).toLocaleString("en-PH")}</td><td>{item.reference ?? "—"}</td><td>{formatPhp(item.amountCentavos)}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state">No transactions have been recorded.</div>}</section>
      </>
    );
  }

  if (section === "commissions") {
    const commissions = await optionalApiGet<Array<{ id: string; reason: string; amountCentavos: string; status: string; sourceEventType: string; sourceOrderId: string; createdAt: string }>>("/me/commissions", []);
    return (
      <>
        <Heading eyebrow="Commission history" title="Qualified, explained, reversible." description="Every commission identifies its documented source and reason. Deposits alone never qualify." />
        <section className="panel">{commissions.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Reason</th><th>Source order</th><th>Amount</th><th>Status</th></tr></thead><tbody>{commissions.map((item) => <tr key={item.id}><td>{item.reason}<div className="muted">{item.sourceEventType}</div></td><td>{item.sourceOrderId}</td><td>{formatPhp(item.amountCentavos)}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state">No commission events have been recorded.</div>}</section>
      </>
    );
  }

  if (section === "team") {
    const [data, levels] = await Promise.all([
      apiGet<{ referralCode: string; programStatement: string; referrals: Array<{ id: string; status: string; createdAt: string; referred: { email: string; profile: { firstName: string; lastName: string } | null } }> }>("/me/referrals"),
      optionalApiGet<CommissionLevel[]>("/public/commission-levels", []),
    ]);
    return (
      <>
        <Heading eyebrow="Team and referrals" title="Transparent network activity." description={data.programStatement} />
        <section className="callout"><p className="eyebrow">Your referral code</p><h2 style={{ fontSize: "1.8rem" }}>{data.referralCode}</h2><p className="muted">Self-referrals and duplicate-account abuse are ineligible.</p></section>
        {levels.length > 0 && (
          <section className="panel" style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: "1.5rem" }}>Commission levels</h2>
            <dl className="company-plans-level-grid" style={{ marginTop: 14 }}>
              {levels.map((item) => (
                <div key={item.id}>
                  <dt>Level {item.level ?? "–"}{!item.active && <span className="muted"> · not credited</span>}</dt>
                  <dd>{(Number(item.rate) * 100).toFixed(0)}%</dd>
                </div>
              ))}
            </dl>
            <p className="muted" style={{ marginTop: 14 }}>A commission is credited only from a confirmed plan service fee. A deposit never qualifies.</p>
          </section>
        )}
        <section className="panel" style={{ marginTop: 18 }}>{data.referrals.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Member</th><th>Joined</th><th>Status</th></tr></thead><tbody>{data.referrals.map((item) => <tr key={item.id}><td>{item.referred.profile ? item.referred.profile.firstName + " " + item.referred.profile.lastName : item.referred.email}</td><td>{new Date(item.createdAt).toLocaleDateString("en-PH")}</td><td><Status value={item.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state">No referred accounts are linked to your profile.</div>}</section>
      </>
    );
  }

  if (section === "statements") {
    const statement = await apiGet<{ statementPeriod: string; generatedAt: string; fileName: string; disclosure: string; entries: Array<{ id: string; amountCentavos: string; direction: string; createdAt: string; transaction: { reference: string; description: string }; account: { name: string } }> }>("/me/statements");
    return (
      <>
        <Heading eyebrow="Statements" title={"Statement · " + statement.statementPeriod} description={statement.disclosure} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}><Button asChild variant="secondary"><a href="/api/backend/me/statements" download={statement.fileName}>Download statement JSON</a></Button></div>
        <section className="panel">{statement.entries.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Reference</th><th>Account</th><th>Direction</th><th>Amount</th></tr></thead><tbody>{statement.entries.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleDateString("en-PH")}</td><td>{item.transaction.reference}<div className="muted">{item.transaction.description}</div></td><td>{item.account.name}</td><td>{item.direction}</td><td>{formatPhp(item.amountCentavos)}</td></tr>)}</tbody></table></div> : <div className="empty-state">No posted entries exist for this statement period.</div>}</section>
      </>
    );
  }

  if (section === "notifications") {
    const notifications = await optionalApiGet<Array<{ id: string; title: string; body: string; readAt: string | null; createdAt: string }>>("/me/notifications", []);
    return (
      <>
        <Heading eyebrow="Notifications" title="Important account events." description="Funding, payout, security, compliance, and plan events are delivered here." />
        <section className="panel">{notifications.length ? notifications.map((item) => <article key={item.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}><h3>{item.title}</h3><p className="muted">{item.body}</p><small>{new Date(item.createdAt).toLocaleString("en-PH")}</small></article>) : <div className="empty-state">You have no notifications.</div>}</section>
      </>
    );
  }

  if (section === "profile") {
    const me = await apiGet<Me>("/me");
    return (
      <>
        <Heading eyebrow="Profile" title="Personal information." description="Identity-sensitive changes are validated and audited through the configured provider and API." />
        <div className="dashboard-grid"><section className="panel"><h2 style={{ fontSize: "1.5rem" }}>Account record</h2><dl className="detail-list"><div><dt>Email</dt><dd>{me.email}</dd></div><div><dt>Mobile</dt><dd>{me.mobile ?? "Not provided"}</dd></div><div><dt>Identity details</dt><dd>Verified identity fields may require provider review before changing.</dd></div></dl></section><section className="panel"><h2 style={{ fontSize: "1.5rem" }}>Editable details</h2><ProfileForm profile={{ firstName: me.profile?.firstName ?? "", lastName: me.profile?.lastName ?? "", nationality: me.profile?.nationality ?? "", city: me.profile?.city ?? "", region: me.profile?.region ?? "" }} /></section></div>
      </>
    );
  }

  if (section === "security") {
    const me = await apiGet<Me>("/me");
    return (
      <>
        <Heading eyebrow="Security settings" title="Protect sensitive actions." description="Production MFA, recovery, breach detection, and sessions are controlled by Auth0 or Cognito." />
        <div className="dashboard-grid">
          <section className="panel"><div className="panel-header"><div><h2 style={{ fontSize: "1.5rem" }}>Multi-factor authentication</h2><p>Required for withdrawals and sensitive changes.</p></div><Status value={me.mfaEnabledAt ? "ACTIVE" : "PENDING"} /></div>{me.mfaEnabledAt ? <div className="success-banner">MFA is enabled.</div> : <EnableMfaButton />}</section>
          <aside className="panel"><h2 style={{ fontSize: "1.5rem" }}>Active sessions</h2>{me.sessions.length ? me.sessions.map((session) => <div key={session.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>{session.deviceLabel ?? "Unlabelled device"}<div className="muted">{new Date(session.lastSeenAt).toLocaleString("en-PH")}</div></div>) : <div className="empty-state">No provider sessions are recorded locally.</div>}</aside>
        </div>
      </>
    );
  }

  if (section === "payout-accounts") {
    const me = await apiGet<Me>("/me");
    return (
      <>
        <Heading eyebrow="Payout accounts" title="Verified destinations only." description="Full account identifiers are not displayed or written to logs." />
        <div className="dashboard-grid"><section className="panel"><h2 style={{ fontSize: "1.5rem" }}>Linked accounts</h2>{me.payoutAccounts.length ? me.payoutAccounts.map((account) => <article key={account.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}><strong>{account.institutionName}</strong><p className="muted">{account.accountHolderName} · {account.maskedIdentifier}</p><Status value={account.verifiedAt ? "VERIFIED" : "PENDING"} /></article>) : <div className="empty-state">No payout accounts linked.</div>}</section><aside className="panel"><h2 style={{ fontSize: "1.5rem" }}>Add sandbox account</h2><PayoutAccountForm /></aside></div>
      </>
    );
  }

  if (section === "support") {
    const cases = await optionalApiGet<Array<{ id: string; subject: string; category: string; status: string; createdAt: string }>>("/support/cases", []);
    return (
      <>
        <Heading eyebrow="Help and support" title="Open a traceable support case." description="Do not include passwords, OTPs, access tokens, or full payout account numbers." />
        <div className="dashboard-grid"><section className="panel"><h2 style={{ fontSize: "1.5rem" }}>Your cases</h2>{cases.length ? cases.map((item) => <article key={item.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}><strong>{item.subject}</strong><p className="muted">{item.category} · {new Date(item.createdAt).toLocaleDateString("en-PH")}</p><Status value={item.status} /></article>) : <div className="empty-state">No support cases are open.</div>}</section><aside className="panel"><h2 style={{ fontSize: "1.5rem" }}>New case</h2><SupportCaseForm /></aside></div>
      </>
    );
  }

  notFound();
}
