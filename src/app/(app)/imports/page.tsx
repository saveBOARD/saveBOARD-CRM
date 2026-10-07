import type { Metadata } from "next";
import { ContactsImport } from "@/components/imports/contacts-import";
import { EmailEventsImport, NotesImport } from "@/components/imports/hubspot-imports";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/detail";
import { SimpleTable } from "@/components/ui/simple-table";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { listImportBatches, listUnlinkedHubspotNotes, type ImportBatch, type UnlinkedNote } from "@/server/crm/imports";

export const metadata: Metadata = { title: "Imports" };

const KIND: Record<string, string> = {
  hubspot_contacts: "HubSpot contacts",
  hubspot_companies: "HubSpot companies",
  hubspot_deals: "HubSpot deals",
  hubspot_notes: "HubSpot notes",
  hubspot_email_events: "HubSpot campaign results (consent)",
  consultant_visits: "Consultant visits",
};

// HubSpot data not exported (7 Oct 2026). Add a loader if any of these turns up later.
const NOT_EXPORTED = [
  ["Deals (42)", "recreate any live ones by hand on the Deals board"],
  ["Tasks (132), calls (66) and emails (2)", "not exported"],
  ["Companies", "not needed: the contacts file brought the companies in. 508 have no name in HubSpot and show their web domain"],
] as const;

/** "5,830 contacts, 400 companies" when the loader recorded the split; otherwise the total. */
function split(b: ImportBatch, what: "created" | "updated") {
  const d = b.details;
  const contacts = d?.[`contacts_${what}`];
  const companies = d?.[`companies_${what}`];
  if (b.kind === "hubspot_notes" && d) return `${((what === "created" ? d.notes_created : d.notes_updated) ?? 0).toLocaleString("en-NZ")} notes`;
  if (b.kind === "hubspot_email_events" && d)
    return what === "created"
      ? `${(d.suppression_list ?? 0).toLocaleString("en-NZ")} on do-not-email list`
      : `${(d.contacts_unsubscribed ?? 0).toLocaleString("en-NZ")} unsubscribed, ${(d.contacts_bounced ?? 0).toLocaleString("en-NZ")} bounced`;
  if (contacts === undefined && companies === undefined) return (what === "created" ? b.rows_created : b.rows_updated).toLocaleString("en-NZ");
  return `${(contacts ?? 0).toLocaleString("en-NZ")} contacts, ${(companies ?? 0).toLocaleString("en-NZ")} companies`;
}

export default async function ImportsPage() {
  const user = await requireUser();
  const [batches, unlinked] = await Promise.all([listImportBatches(), listUnlinkedHubspotNotes()]);
  const lastContacts = batches.find((b) => b.kind === "hubspot_contacts" && b.finished_at);

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <PageHeader title="Imports" />

      {user.role === "admin" ? (
        <>
          <Panel title="1. HubSpot contacts">
            <ContactsImport lastImportAt={lastContacts?.finished_at ?? null} />
          </Panel>
          <Panel title="2. HubSpot notes">
            <NotesImport />
          </Panel>
          <Panel title="3. Email consent: HubSpot campaign results">
            <p className="mb-3 text-sm text-muted">
              Marks people who unsubscribed, reported spam, were blocked or bounced permanently, and keeps them on a do-not-email list so anyone
              added later is marked too. Receiving or opening a campaign does not count as consent.
            </p>
            <EmailEventsImport />
          </Panel>
        </>
      ) : (
        <p className="card p-4 text-sm text-muted">Imports are run by an admin.</p>
      )}

      {unlinked.length > 0 && (
        <Panel title={`HubSpot notes not linked to anyone (${unlinked.length})`}>
          <p className="mb-3 text-sm text-muted">These matched no contact or company, most likely because they were on HubSpot deals, which weren&apos;t exported.</p>
          <SimpleTable<UnlinkedNote>
            rows={unlinked}
            empty=""
            columns={[
              { header: "Date", cell: (u) => formatDateTime(u.occurred_at) },
              { header: "Note", cell: (u) => <span className="whitespace-pre-line">{u.summary}</span> },
              { header: "HubSpot contact / company", cell: (u) => [u.hubspot_contact, u.hubspot_company].filter(Boolean).join(" · ") },
            ]}
          />
        </Panel>
      )}

      <Panel title="Not exported from HubSpot">
        <ul className="grid gap-2 text-sm">
          {NOT_EXPORTED.map(([what, why]) => (
            <li key={what}>
              <b>{what}</b>: {why}.
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="History">
        <SimpleTable<ImportBatch>
          rows={batches}
          empty="Nothing has been imported yet."
          columns={[
            { header: "When", cell: (b) => formatDateTime(b.started_at) },
            { header: "What", cell: (b) => KIND[b.kind] ?? b.kind },
            { header: "File", cell: (b) => b.file_name },
            { header: "Rows", numeric: true, cell: (b) => b.rows_read.toLocaleString("en-NZ") },
            { header: "Added", cell: (b) => split(b, "created") },
            { header: "Updated", cell: (b) => split(b, "updated") },
            { header: "Skipped", numeric: true, cell: (b) => b.rows_skipped.toLocaleString("en-NZ") },
            { header: "By", cell: (b) => b.created_by ?? (b.finished_at ? "Set-up script" : "") },
          ]}
        />
      </Panel>
    </div>
  );
}
