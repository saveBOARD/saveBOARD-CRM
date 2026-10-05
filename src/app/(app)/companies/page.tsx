import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { toLocalDate } from "@/lib/format";
import { countryName, SEGMENTS } from "@/lib/labels";
import { listCompanies } from "@/server/crm/companies";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Companies" };

const COLUMNS: TableColumn[] = [
  { key: "name", header: "Company", link: { base: "/companies", idKey: "id" } },
  { key: "segment", header: "Segment" },
  { key: "country", header: "Country" },
  { key: "erp", header: "ERP customer" },
  { key: "contacts", header: "Contacts", kind: "number", total: true },
  { key: "open_deals", header: "Open deals", kind: "number", total: true },
  { key: "owner", header: "Owner" },
  { key: "last_activity_at", header: "Last activity", kind: "date" },
  { key: "domain", header: "Domain", hidden: true },
];

export default async function CompaniesPage() {
  await requireUser();
  const companies = await listCompanies();
  const tableRows = companies.map((c) => ({
    id: c.id,
    name: c.name,
    segment: SEGMENTS[c.segment],
    country: countryName(c.country_code),
    erp: c.erp,
    contacts: c.contacts,
    open_deals: c.open_deals,
    owner: c.owner,
    last_activity_at: toLocalDate(c.last_activity_at),
    domain: c.domain,
  }));

  return (
    <>
      <PageHeader title="Companies" />
      <DataTable
        id="companies"
        noun="companies"
        columns={COLUMNS}
        rows={tableRows}
        empty="No companies yet. They appear here once the HubSpot data is loaded."
      />
    </>
  );
}
