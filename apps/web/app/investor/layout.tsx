import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { apiGet } from "@/lib/api";

type Me = {
  email: string;
  profile: { firstName: string; lastName: string } | null;
};

export default async function InvestorLayout({ children }: { children: React.ReactNode }) {
  let me: Me;
  try {
    me = await apiGet<Me>("/me");
  } catch {
    redirect("/login");
  }
  return (
    <AppShell
      mode="investor"
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
