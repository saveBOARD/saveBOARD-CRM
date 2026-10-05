import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { DeleteButton } from "@/components/forms/delete-button";
import { NoteForm } from "@/components/forms/note-form";
import { BackLink, Field, HeaderCard, Panel, Pill } from "@/components/ui/detail";
import { SimpleTable } from "@/components/ui/simple-table";
import { Timeline } from "@/components/ui/timeline";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { CONSENT, countryName, SEGMENTS, sourceLabel, STAGES } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { listActivities } from "@/server/crm/activities";
import { getContact } from "@/server/crm/contacts";
import { listDealsFor, type DealListRow } from "@/server/crm/deals";

export async function generateMetadata({ params }: PageProps<"/contacts/[id]">): Promise<Metadata> {
  const { id } = await params;
  const contact = isUuid(id) ? await getContact(id) : null;
  return { title: contact?.name ?? contact?.email ?? "Contact" };
}

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const contact = await getContact(id);
  if (!contact) notFound();

  const [deals, activities] = await Promise.all([listDealsFor({ contactId: id }), listActivities({ contactId: id })]);
  const consent = CONSENT[contact.consent_status];

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div>
        <BackLink href="/contacts">Contacts</BackLink>
        <HeaderCard
          eyebrow={contact.kind === "generic_mailbox" ? "Shared mailbox" : "Contact"}
          title={contact.name ?? contact.email ?? "(no name)"}
          subtitle={
            contact.company_id ? (
              <Link href={`/companies/${contact.company_id}`} className="text-link hover:underline">
                {contact.company}
              </Link>
            ) : (
              "No company"
            )
          }
          actions={
            <>
              <Link href={`/contacts/${contact.id}/edit`} className="btn-secondary">
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Link>
              <Link href={`/deals/new?contact=${contact.id}`} className="btn-secondary">
                <Plus className="h-4 w-4" aria-hidden />
                New deal
              </Link>
              {user.role === "admin" && (
                <DeleteButton
                  table="contacts"
                  id={contact.id}
                  name={contact.name ?? contact.email ?? ""}
                  consequence="Their notes and activity stay on the company timeline."
                />
              )}
            </>
          }
          pills={
            <>
              <Pill tone={consent.tone}>Email consent: {consent.label}</Pill>
              {contact.track_followup && <Pill tone="progress">Follow-up tracked</Pill>}
            </>
          }
        >
          <Field label="Email">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="text-link hover:underline">
                {contact.email}
              </a>
            )}
          </Field>
          <Field label="Phone">
            {contact.phone_e164 ? (
              <a href={`tel:${contact.phone_e164}`} className="text-link hover:underline">
                {contact.phone_e164}
              </a>
            ) : (
              contact.phone_raw
            )}
          </Field>
          <Field label="Role">{contact.role_title}</Field>
          <Field label="Owner">{contact.owner}</Field>
          <Field label="Segment">{SEGMENTS[contact.segment]}</Field>
          <Field label="Country">{countryName(contact.country_code)}</Field>
          <Field label="City">{contact.city}</Field>
          <Field label="Samples sent">{contact.samples_sent ? "Yes" : "No"}</Field>
          <Field label="Last activity">{formatDateTime(contact.last_activity_at)}</Field>
          <Field label="Source">{sourceLabel(contact.source)}</Field>
          <Field label="Consent source">
            {contact.consent_source}
            {contact.consent_at && ` (${formatDateTime(contact.consent_at)})`}
          </Field>
          {contact.notes && (
            <Field label="Notes" wide>
              <span className="whitespace-pre-line">{contact.notes}</span>
            </Field>
          )}
        </HeaderCard>
      </div>

      <Panel title={`Deals (${deals.length})`}>
        <SimpleTable<DealListRow>
          rows={deals}
          empty="This contact is not the main contact on any deal."
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
            { header: "Estimated value", numeric: true, cell: (d) => formatMoney(d.est_value, d.est_currency) },
            { header: "Next action", cell: (d) => formatDate(d.next_action_on) },
          ]}
        />
      </Panel>

      <Panel title="Activity">
        <NoteForm target={{ contactId: contact.id, ...(contact.company_id ? { companyId: contact.company_id } : {}) }} />
        <Timeline items={activities} empty="No activity yet. Emails, calls and notes will appear here." />
      </Panel>
    </div>
  );
}
