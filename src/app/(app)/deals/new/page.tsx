import type { Metadata } from "next";
import { DealForm } from "@/components/forms/deal-form";
import { BackLink } from "@/components/ui/detail";
import { isUuid } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { getCompany } from "@/server/crm/companies";
import { getContact } from "@/server/crm/contacts";
import { DEAL_SOURCES } from "@/server/crm/schemas";
import { listUsers } from "@/server/crm/writes";

export const metadata: Metadata = { title: "New deal" };

const sources = Object.entries(DEAL_SOURCES).map(([value, label]) => ({ value, label }));

export default async function NewDealPage({ searchParams }: PageProps<"/deals/new">) {
  const user = await requireUser();
  const sp = await searchParams;
  const [users, contact] = await Promise.all([listUsers(), isUuid(sp.contact) ? getContact(sp.contact) : null]);
  const companyId = isUuid(sp.company) ? sp.company : contact?.company_id;
  const company = companyId ? await getCompany(companyId) : null;
  const entity = company?.country_code === "AU" || contact?.country_code === "AU" ? "AUS" : company?.country_code === "NZ" || contact?.country_code === "NZ" ? "NZ" : null;
  const back = contact ? `/contacts/${contact.id}` : company ? `/companies/${company.id}` : "/deals";

  return (
    <div className="mx-auto max-w-4xl">
      <BackLink href={back}>{contact?.name ?? company?.name ?? "Deals"}</BackLink>
      <h1 className="mb-4 text-xl font-medium">New deal</h1>
      <DealForm
        users={users}
        defaultOwnerId={user.id}
        sources={sources}
        company={company ? { id: company.id, name: company.name } : null}
        contact={contact ? { id: contact.id, name: contact.name ?? contact.email ?? "" } : null}
        defaultEntity={entity}
        defaultSource={typeof sp.source === "string" && sp.source in DEAL_SOURCES ? sp.source : null}
      />
    </div>
  );
}
