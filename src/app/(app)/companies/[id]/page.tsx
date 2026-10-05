import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, UserPlus } from "lucide-react";
import { ErpPanel } from "@/components/erp/erp-panel";
import { DeleteButton } from "@/components/forms/delete-button";
import { NoteForm } from "@/components/forms/note-form";
import { BackLink, Field, HeaderCard, Panel, Pill } from "@/components/ui/detail";
import { SimpleTable } from "@/components/ui/simple-table";
import { Timeline } from "@/components/ui/timeline";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { countryName, SEGMENTS, sourceLabel, STAGES } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { listActivities } from "@/server/crm/activities";
import { getCompany } from "@/server/crm/companies";
import { listContacts, type ContactListRow } from "@/server/crm/contacts";
import { listDealsFor, type DealListRow } from "@/server/crm/deals";
import { getCompanyErpAccounts, listErpDocuments } from "@/server/erp";

export async function generateMetadata({ params }: PageProps<"/companies/[id]">): Promise<Metadata> {
  const { id } = await params;
  const company = isUuid(id) ? await getCompany(id) : null;
  return { title: company?.name ?? "Company" };
}

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const company = await getCompany(id);
  if (!company) notFound();

  const [contacts, deals, activities, erpAccounts] = await Promise.all([
    listContacts({ companyId: id }),
    listDealsFor({ companyId: id }),
    listActivities({ companyId: id }),
    getCompanyErpAccounts(id),
  ]);
  const erpDocuments = await listErpDocuments(erpAccounts.map((a) => a.erp_customer_id));

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div>
        <BackLink href="/companies">Companies</BackLink>
        <HeaderCard
          eyebrow="Company"
          title={company.name}
          subtitle={company.name !== company.raw_name ? "No name in HubSpot: showing the web domain" : undefined}
          actions={
            <>
              <Link href={`/companies/${company.id}/edit`} className="btn-secondary">
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Link>
              <Link href={`/contacts/new?company=${company.id}`} className="btn-secondary">
                <UserPlus className="h-4 w-4" aria-hidden />
                Add contact
              </Link>
              {user.role === "admin" && (
                <DeleteButton
                  table="companies"
                  id={company.id}
                  name={company.name}
                  consequence={`Its ${contacts.length} contact(s) stay in the CRM without a company.`}
                />
              )}
            </>
          }
        >
          <Field label="Segment">{SEGMENTS[company.segment]}</Field>
          <Field label="Country">{countryName(company.country_code)}</Field>
          <Field label="Owner">{company.owner}</Field>
          <Field label="Last activity">{formatDateTime(company.last_activity_at)}</Field>
          <Field label="Web domain">
            {company.domain && (
              <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" className="text-link hover:underline">
                {company.domain}
              </a>
            )}
          </Field>
          <Field label="City">{company.city}</Field>
          <Field label="Source">{sourceLabel(company.source)}</Field>
          <Field label="Snoozed">
            {company.snoozed_until && `Until ${formatDate(company.snoozed_until)}${company.snooze_reason ? `: ${company.snooze_reason}` : ""}`}
          </Field>
          {company.notes && (
            <Field label="Notes" wide>
              <span className="whitespace-pre-line">{company.notes}</span>
            </Field>
          )}
        </HeaderCard>
      </div>

      <ErpPanel companyId={company.id} accounts={erpAccounts} documents={erpDocuments} isAdmin={user.role === "admin"} />

      <Panel title={`Contacts (${contacts.length})`}>
        <SimpleTable<ContactListRow>
          rows={contacts}
          empty="No contacts at this company yet."
          columns={[
            {
              header: "Name",
              cell: (c) => (
                <Link href={`/contacts/${c.id}`} className="text-link hover:underline">
                  {c.name ?? c.email ?? "(no name)"}
                </Link>
              ),
            },
            { header: "Email", cell: (c) => (c.kind === "generic_mailbox" ? `${c.email} (shared mailbox)` : c.email) },
            { header: "Phone", cell: (c) => c.phone },
            { header: "Last activity", cell: (c) => formatDateTime(c.last_activity_at) },
          ]}
        />
      </Panel>

      <Panel title={`Deals (${deals.length})`}>
        <SimpleTable<DealListRow>
          rows={deals}
          empty="No deals with this company yet."
          columns={[
            {
              header: "Deal",
              cell: (d) => (
                <Link href={`/deals/${d.id}`} className="text-link hover:underline">
                  {d.title}
                </Link>
              ),
            },
            { header: "Stage", cell: (d) => <Pill tone={STAGES[d.stage].tone}>{STAGES[d.stage].label}</Pill> },
            { header: "Entity", cell: (d) => d.entity },
            { header: "Estimated value", numeric: true, cell: (d) => formatMoney(d.est_value, d.est_currency) },
            { header: "Next action", cell: (d) => formatDate(d.next_action_on) },
          ]}
        />
      </Panel>

      <Panel title="Activity">
        <NoteForm target={{ companyId: company.id }} />
        <Timeline items={activities} empty="No activity yet. Emails, calls and notes will appear here." />
      </Panel>
    </div>
  );
}
