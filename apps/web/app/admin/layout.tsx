import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { apiGet } from "@/lib/api";

type Me = {
  email: string;
  profile: { firstName: string; lastName: string } | null;
  roles: Array<{ role: { name: string } }>;
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let me: Me;
  try {
    me = await apiGet<Me>("/me");
  } catch {
    redirect("/login");
  }
  const roles = me.roles.map((item) => item.role.name);
  if (!roles.includes("ADMIN") && !roles.includes("FINANCE_COMPLIANCE")) redirect("/investor");
  return (
    <AppShell
      mode="admin"
      user={{
        name: me.profile ? me.profile.firstName + " " + me.profile.lastName : me.email,
        email: me.email,
      }}
    >
      {children}
    </AppShell>
  );
}
