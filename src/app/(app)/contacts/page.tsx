import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { PageHeader } from "@/components/shell/page-header";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { toLocalDate } from "@/lib/format";
import { CONSENT, countryName, SEGMENTS } from "@/lib/labels";
import { listContacts } from "@/server/crm/contacts";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Contacts" };

const COLUMNS: TableColumn[] = [
  { key: "name", header: "Name", link: { base: "/contacts", idKey: "id" } },
  { key: "email", header: "Email" },
  { key: "company", header: "Company", link: { base: "/companies", idKey: "company_id" } },
  { key: "phone", header: "Phone" },
  { key: "country", header: "Country" },
  { key: "segment", header: "Segment" },
  { key: "samples_sent", header: "Samples sent", kind: "boolean" },
  { key: "owner", header: "Owner" },
  {
    key: "consent",
    header: "Email consent",
    kind: "status",
    tones: Object.fromEntries(Object.values(CONSENT).map((c) => [c.label, c.tone])),
    hidden: true,
  },
  { key: "last_activity_at", header: "Last activity", kind: "date" },
];

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx("rounded border px-3 py-1 text-sm", active ? "border-primary bg-primary text-white" : "border-line bg-surface hover:bg-page")}
    >
      {children}
    </Link>
  );
}

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const user = await requireUser();
  const mine = (await searchParams).mine === "1";
  const contacts = await listContacts(mine ? { ownerId: user.id } : {});

  const tableRows = contacts.map((c) => ({
    id: c.id,
    // Contacts with no name (about 1 in 6 from HubSpot) show their email so the row can still be opened.
    name: c.name ?? c.email ?? "(no name)",
    email: c.kind === "generic_mailbox" && c.email ? `${c.email} (shared mailbox)` : c.email,
    company_id: c.company_id,
    company: c.company,
    phone: c.phone,
    country: countryName(c.country_code),
    segment: SEGMENTS[c.segment],
    samples_sent: c.samples_sent,
    owner: c.owner,
    consent: CONSENT[c.consent_status].label,
    last_activity_at: toLocalDate(c.last_activity_at),
  }));

  return (
    <>
      <PageHeader title="Contacts" />
      <div className="mb-3 flex gap-2">
        <Tab href="/contacts" active={!mine}>
          All contacts
        </Tab>
        <Tab href="/contacts?mine=1" active={mine}>
          My contacts
        </Tab>
      </div>
      <DataTable
        id="contacts"
        noun="contacts"
        columns={COLUMNS}
        rows={tableRows}
        empty={mine ? "You don't own any contacts yet." : "No contacts yet. They appear here once the HubSpot data is loaded."}
      />
    </>
  );
}
