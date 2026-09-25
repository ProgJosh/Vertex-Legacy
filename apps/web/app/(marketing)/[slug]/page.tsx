import { notFound } from "next/navigation";

type PublicPage = {
  eyebrow: string;
  title: string;
  intro: string;
  blocks: Array<{ title: string; body: string }>;
};

const pages: Record<string, PublicPage> = {
  about: {
    eyebrow: "About Vertex",
    title: "Operational discipline for long-horizon decisions.",
    intro:
      "Vertex Legacy is designed as the accountable operating layer between verified users, documented company plans, and licensed financial providers.",
    blocks: [
      {
        title: "What we build",
        body:
          "A traceable account experience for identity verification, provider-led funding, plan subscriptions, commissions, withdrawals, statements, and support.",
      },
      {
        title: "What we do not claim",
        body:
          "Vertex does not promise returns, present promotions as cash, hide fees, or treat member deposits as a source of referral compensation.",
      },
      {
        title: "Governance",
        body:
          "Sensitive actions require permissions, reasons, and immutable audit records. Money events require balanced postings and idempotent provider processing.",
      },
      {
        title: "Current status",
        body:
          "This repository runs in sandbox mode. Live payment, custody, brokerage, and payout activity remains disabled until licensed partners and approvals are supplied.",
      },
    ],
  },
  "how-it-works": {
    eyebrow: "Process",
    title: "From identity to a fully traceable position.",
    intro:
      "The experience is intentionally sequential: verify, secure, fund through a provider, assess a plan, authorize, and monitor.",
    blocks: [
      { title: "1. Verify", body: "Create your identity-provider account, verify contact details, complete KYC, and enable MFA." },
      { title: "2. Fund", body: "Create a cash-in request above the configured minimum. Only a signed provider webhook can complete it." },
      { title: "3. Assess", body: "Review plan objectives, risk, fees, duration, capacity, eligibility, documents, and illustrative targets." },
      { title: "4. Authorize", body: "Submit an idempotent subscription or withdrawal request. The API validates funds, policy, time, and identity state." },
      { title: "5. Monitor", body: "Review wallet composition, holdings, ledger-derived transactions, commissions, notifications, and downloadable statements." },
      { title: "6. Correct", body: "Posted records are never edited. Errors and failed payouts are corrected by linked reversal entries." },
    ],
  },
  "risk-disclosure": {
    eyebrow: "Risk disclosure",
    title: "Investment outcomes are uncertain.",
    intro:
      "Plan targets, historical observations, and illustrations are not guarantees. Capital, liquidity, provider, operational, market, credit, and regulatory risks can affect results.",
    blocks: [
      { title: "Capital risk", body: "You may receive less than you invest. A lower risk classification does not mean no risk." },
      { title: "Liquidity risk", body: "Plan terms, market conditions, review controls, settlement cutoffs, and provider availability may delay access to funds." },
      { title: "Target performance", body: "Target ranges communicate an objective or illustration. They do not create a guaranteed obligation." },
      { title: "Suitability", body: "Eligibility and KYC do not replace personal assessment of objectives, time horizon, capacity for loss, and independent advice." },
    ],
  },
  "fees-limits": {
    eyebrow: "Fees and limits",
    title: "Visible before authorization.",
    intro:
      "Current values are administered centrally and displayed in the product before requests are finalized.",
    blocks: [
      { title: "Cash-in minimum", body: "The active configuration applies before a provider checkout is created. Provider charges, if any, must be disclosed separately." },
      { title: "Withdrawal minimum", body: "The active minimum applies to withdrawable funds. Promotional balances remain separate by default." },
      { title: "Withdrawal fee", body: "The configured charge is labelled Withdrawal fee. The gross request, fee, and net payout are shown before MFA." },
      { title: "Operating window", body: "Requests outside Asia/Manila operating hours are blocked or clearly scheduled according to the active administrative policy." },
    ],
  },
  faq: {
    eyebrow: "Frequently asked questions",
    title: "Straight answers about the operating model.",
    intro: "These answers describe the current sandbox implementation and the controls required for production.",
    blocks: [
      { title: "Is the promotional credit cash?", body: "No. It is separately ledgered and non-withdrawable by default." },
      { title: "Are plan returns guaranteed?", body: "No. Targets and illustrations may not be achieved, and capital can be lost." },
      { title: "When does a referral earn commission?", body: "Only when an enabled rule matches a documented qualifying service-fee event. A deposit alone never qualifies." },
      { title: "Can the browser change my balance?", body: "No. The API posts balanced ledger entries after policy and provider verification, then refreshes the wallet projection." },
      { title: "Is live money enabled?", body: "No. Local payment, payout, and KYC actions are explicit simulations." },
      { title: "How are errors corrected?", body: "Posted ledger records stay immutable. Corrections use linked reversal transactions." },
    ],
  },
  contact: {
    eyebrow: "Contact and support",
    title: "A clear route to accountable support.",
    intro:
      "Signed-in users can open and track a support case from the application. Security incidents should be escalated without including passwords, OTPs, tokens, or full account numbers.",
    blocks: [
      { title: "Account support", body: "Use Help and support in the investor application so the case is linked to your verified account." },
      { title: "Transaction review", body: "Include the Vertex reference, status, date, and amount. Never send credentials or unmasked payout details." },
      { title: "Security report", body: "Revoke affected sessions, change credentials through the identity provider, and open an urgent support case." },
      { title: "Service expectation", body: "Response and processing estimates are displayed with the relevant workflow and may vary during compliance review." },
    ],
  },
  terms: {
    eyebrow: "Terms of service",
    title: "Demonstration terms pending legal approval.",
    intro:
      "These repository terms describe intended platform behavior and are not a substitute for company-specific terms reviewed by qualified counsel.",
    blocks: [
      { title: "Sandbox limitation", body: "Local balances, provider callbacks, KYC decisions, plans, and transactions are demonstration data and have no cash value." },
      { title: "Account duties", body: "Users must provide accurate information, protect identity-provider access, enable MFA, and report suspicious activity." },
      { title: "Financial risk", body: "No target or illustration is guaranteed. Plan-specific documents govern once lawfully approved and published." },
      { title: "Prohibited conduct", body: "Fraud, duplicate-account abuse, self-referral, evasion of controls, and unauthorized access are prohibited." },
    ],
  },
  privacy: {
    eyebrow: "Privacy notice",
    title: "Collect less. Protect what matters.",
    intro:
      "The production operator must publish a jurisdiction-specific privacy notice, retention schedule, lawful bases, and data-subject request process.",
    blocks: [
      { title: "Identity data", body: "Contact, profile, identity-provider, KYC, security-event, and session data support verification and account protection." },
      { title: "Financial data", body: "Ledger, transaction, payout token, plan, commission, reconciliation, and audit records support the requested service and compliance." },
      { title: "Sensitive handling", body: "Full payout identifiers belong in encrypted provider vaults. Logs redact tokens, OTPs, passwords, and customer financial identifiers." },
      { title: "Retention and rights", body: "Production retention, deletion exceptions, access, correction, and complaint routes must be approved for the operating jurisdiction." },
    ],
  },
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return pages[slug] ? { title: pages[slug].title } : { title: "Not found" };
}

export default async function PublicContentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = pages[slug];
  if (!page) notFound();
  return (
    <div className="container public-page">
      <div className="public-page-intro">
        <div>
          <p className="eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
        </div>
        <p className="muted">{page.intro}</p>
      </div>
      <div className="content-grid">
        {page.blocks.map((block) => (
          <section className="content-block" key={block.title}>
            <h2 style={{ fontSize: "1.5rem" }}>{block.title}</h2>
            <p className="muted">{block.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
