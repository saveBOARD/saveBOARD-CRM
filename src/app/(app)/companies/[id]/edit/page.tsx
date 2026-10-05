import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyForm } from "@/components/forms/company-form";
import { BackLink } from "@/components/ui/detail";
import { isUuid } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { getCompany } from "@/server/crm/companies";
import { listUsers } from "@/server/crm/writes";

export const metadata: Metadata = { title: "Edit company" };

export default async function EditCompanyPage({ params }: PageProps<"/companies/[id]/edit">) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [company, users] = await Promise.all([getCompany(id), listUsers()]);
  if (!company) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <BackLink href={`/companies/${id}`}>{company.name}</BackLink>
      <h1 className="mb-4 text-xl font-medium">Edit company</h1>
      <CompanyForm company={company} users={users} defaultOwnerId={user.id} />
    </div>
  );
}
