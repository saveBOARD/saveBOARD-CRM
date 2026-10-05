import type { Metadata } from "next";
import { ContactForm } from "@/components/forms/contact-form";
import { BackLink } from "@/components/ui/detail";
import { isUuid } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { getCompany } from "@/server/crm/companies";
import { listUsers } from "@/server/crm/writes";

export const metadata: Metadata = { title: "New contact" };

export default async function NewContactPage({ searchParams }: PageProps<"/contacts/new">) {
  const user = await requireUser();
  const companyId = (await searchParams).company;
  const [users, company] = await Promise.all([listUsers(), isUuid(companyId) ? getCompany(companyId) : null]);
  return (
    <div className="mx-auto max-w-4xl">
      <BackLink href={company ? `/companies/${company.id}` : "/contacts"}>{company ? company.name : "Contacts"}</BackLink>
      <h1 className="mb-4 text-xl font-medium">New contact</h1>
      <ContactForm users={users} defaultOwnerId={user.id} company={company ? { id: company.id, name: company.name } : null} />
    </div>
  );
}
