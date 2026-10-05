import type { Metadata } from "next";
import { ContactsImport } from "@/components/imports/contacts-import";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/detail";
import { SimpleTable } from "@/components/ui/simple-table";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { listImportBatches, type ImportBatch } from "@/server/crm/imports";

export const metadata: Metadata = { title: "Imports" };

const KIND: Record<string, string> = {
  hubspot_contacts: "HubSpot contacts",
  hubspot_companies: "HubSpot companies",
  hubspot_deals: "HubSpot deals",
  consultant_visits: "Consultant visits",
};

// Still to come: each needs its HubSpot export file first (phase 2 plan, step 2.7).
const WAITING = [
  ["Companies", "brings real names for the 508 companies that came through as numbers, and companies with no contacts"],
  ["Deals (42)", "go to a review screen, where each one is given a stage, NZ or AUS and an owner"],
  ["Notes (976), calls (66) and emails (2)", "become activities on the right contacts and companies"],
  ["Tasks (132)", "open ones stay open, completed ones become history"],
  ["Unsubscribes and bounces", "set each contact's email consent. Needed before any email campaign"],
] as const;

/** "5,830 contacts, 400 companies" when the loader recorded the split; otherwise the total. */
function split(b: ImportBatch, what: "created" | "updated") {
  const d = b.details;
  const contacts = d?.[`contacts_${what}`];
  const companies = d?.[`companies_${what}`];
  if (contacts === undefined && companies === undefined) return (what === "created" ? b.rows_created : b.rows_updated).toLocaleString("en-NZ");
  return `${(contacts ?? 0).toLocaleString("en-NZ")} contacts, ${(companies ?? 0).toLocaleString("en-NZ")} companies`;
}

export default async function ImportsPage() {
  const user = await requireUser();
  const batches = await listImportBatches();
  const lastContacts = batches.find((b) => b.kind === "hubspot_contacts" && b.finished_at);

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <PageHeader title="Imports" />

      {user.role === "admin" ? (
        <Panel title="HubSpot contacts">
          <ContactsImport lastImportAt={lastContacts?.finished_at ?? null} />
        </Panel>
      ) : (
        <p className="card p-4 text-sm text-muted">Imports are run by an admin.</p>
      )}

      <Panel title="Other HubSpot files">
        <ul className="grid gap-2 text-sm">
          {WAITING.map(([what, why]) => (
            <li key={what}>
              <b>{what}</b>: {why}. <span className="text-muted">Loader added once the export file is available.</span>
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
