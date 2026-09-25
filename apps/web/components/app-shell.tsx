"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  BadgeDollarSign,
  Bell,
  BookOpenCheck,
  BriefcaseBusiness,
  CircleHelp,
  CircleUserRound,
  ClipboardCheck,
  FileClock,
  FileText,
  Landmark,
  LayoutDashboard,
  Menu,
  Network,
  ReceiptText,
  Scale,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { Brand } from "./brand";
import { Button } from "./ui/button";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }> };

const investorNav: NavItem[] = [
  { href: "/investor", label: "Overview", icon: LayoutDashboard },
  { href: "/investor/wallet", label: "Wallet", icon: WalletCards },
  { href: "/investor/cash-in", label: "Cash in", icon: Landmark },
  { href: "/investor/withdraw", label: "Withdraw", icon: BadgeDollarSign },
  { href: "/investor/plans", label: "Company plans", icon: BriefcaseBusiness },
  { href: "/investor/portfolio", label: "Portfolio", icon: Activity },
  { href: "/investor/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/investor/commissions", label: "Commissions", icon: Scale },
  { href: "/investor/team", label: "Team & referrals", icon: Network },
  { href: "/investor/statements", label: "Statements", icon: FileText },
  { href: "/investor/notifications", label: "Notifications", icon: Bell },
  { href: "/investor/profile", label: "Profile", icon: CircleUserRound },
  { href: "/investor/security", label: "Security", icon: ShieldCheck },
  { href: "/investor/payout-accounts", label: "Payout accounts", icon: Landmark },
  { href: "/investor/support", label: "Help & support", icon: CircleHelp },
];

const adminNav: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/kyc", label: "KYC review", icon: ClipboardCheck },
  { href: "/admin/deposits", label: "Deposits", icon: Landmark },
  { href: "/admin/withdrawals", label: "Withdrawals", icon: BadgeDollarSign },
  { href: "/admin/plans", label: "Plans", icon: BriefcaseBusiness },
  { href: "/admin/commissions", label: "Commission rules", icon: Scale },
  { href: "/admin/referrals", label: "Referrals", icon: Network },
  { href: "/admin/ledger", label: "Ledger explorer", icon: ReceiptText },
  { href: "/admin/reconciliation", label: "Reconciliation", icon: BookOpenCheck },
  { href: "/admin/configuration", label: "Configuration", icon: SlidersHorizontal },
  { href: "/admin/announcements", label: "Announcements", icon: Bell },
  { href: "/admin/reports", label: "Reports", icon: FileText },
  { href: "/admin/audit-logs", label: "Audit logs", icon: FileClock },
  { href: "/admin/roles", label: "Roles & permissions", icon: Settings },
];

export function AppShell({
  mode,
  user,
  children,
}: {
  mode: "investor" | "admin";
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const nav = mode === "investor" ? investorNav : adminNav;

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="app-frame">
      <aside className={"sidebar " + (open ? "open" : "")}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand href={mode === "investor" ? "/investor" : "/admin"} />
          <button
            className="button button-quiet mobile-menu"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="sidebar-nav" aria-label={mode === "investor" ? "Investor" : "Administration"}>
          <span className="sidebar-label">
            {mode === "investor" ? "Investor workspace" : "Administration"}
          </span>
          {nav.map((item) => {
            const active =
              path === item.href || (item.href !== "/" + mode && path.startsWith(item.href + "/"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
                onClick={() => setOpen(false)}
              >
                <Icon size={16} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-account">
          <strong>{user.name}</strong>
          <div className="muted">{user.email}</div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <button
            className="button button-secondary mobile-menu"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu size={18} />
          </button>
          <span className="environment-label">Sandbox environment · no live money movement</span>
          <Button variant="secondary" size="small" onClick={signOut}>
            Sign out
          </Button>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
