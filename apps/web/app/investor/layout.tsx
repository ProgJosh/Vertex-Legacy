import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { apiGet, optionalApiGet } from "@/lib/api";

type Me = {
  email: string;
  profile: { firstName: string; lastName: string } | null;
};

export default async function InvestorLayout({ children }: { children: React.ReactNode }) {
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
  return (
    <AppShell
      mode="investor"
      environmentLabel={manualPaymentsEnabled ? "GCash / Maya deposits · finance verified" : undefined}
      logoutHref={
        process.env.AUTH_PROVIDER === "auth0" || process.env.NODE_ENV === "production"
          ? "/auth/logout"
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
