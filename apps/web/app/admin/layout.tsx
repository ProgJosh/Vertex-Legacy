import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { apiGet, optionalApiGet } from "@/lib/api";

type Me = {
  email: string;
  profile: { firstName: string; lastName: string } | null;
  roles: Array<{ role: { name: string } }>;
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let me: Me;
  let manualPaymentsEnabled = false;
  try {
    [me, manualPaymentsEnabled] = await Promise.all([
      apiGet<Me>("/me"),
      optionalApiGet<{ manualPaymentsEnabled: boolean }>("/public/config", { manualPaymentsEnabled: false }).then((config) => config.manualPaymentsEnabled),
    ]);
  } catch {
    redirect("/login");
  }
  const roles = me.roles.map((item) => item.role.name);
  if (!roles.includes("ADMIN") && !roles.includes("FINANCE_COMPLIANCE")) redirect("/investor");
  return (
    <AppShell
      mode="admin"
      environmentLabel={manualPaymentsEnabled ? "Manual wallet settlement · dual-control review" : undefined}
      logoutHref={
        process.env.AUTH_PROVIDER === "auth0" || process.env.NODE_ENV === "production"
          ? "/auth/logout?returnTo=/"
          : undefined
      }
      user={{
        name: me.profile ? me.profile.firstName + " " + me.profile.lastName : me.email,
        email: me.email,
      }}
    >
      {children}
    </AppShell>
  );
}
