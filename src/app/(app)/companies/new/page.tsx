import type { Metadata } from "next";
import { CompanyForm } from "@/components/forms/company-form";
import { BackLink } from "@/components/ui/detail";
import { requireUser } from "@/server/auth/session";
import { listUsers } from "@/server/crm/writes";

export const metadata: Metadata = { title: "New company" };

export default async function NewCompanyPage() {
  const user = await requireUser();
  const users = await listUsers();
  return (
    <div className="mx-auto max-w-4xl">
      <BackLink href="/companies">Companies</BackLink>
      <h1 className="mb-4 text-xl font-medium">New company</h1>
      <CompanyForm users={users} defaultOwnerId={user.id} />
    </div>
  );
}
