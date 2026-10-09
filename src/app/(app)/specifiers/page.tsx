import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { PageHeader } from "@/components/shell/page-header";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { toLocalDate } from "@/lib/format";
import { SPECIFIER_ORDER, SPECIFIER_STAGES, type SpecifierStage } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { listSpecifiers, specifierCounts } from "@/server/crm/specifiers";

export const metadata: Metadata = { title: "Specifiers" };

const COLUMNS: TableColumn[] = [
  { key: "name", header: "Name", link: { base: "/contacts", idKey: "id" } },
  { key: "company", header: "Practice", link: { base: "/companies", idKey: "company_id" } },
  { key: "role_title", header: "Type" },
  { key: "city", header: "City" },
  {
    key: "stage",
    header: "Stage",
    kind: "status",
    tones: Object.fromEntries(Object.values(SPECIFIER_STAGES).map((s) => [s.label, s.tone])),
  },
  { key: "last_region", header: "Region" },
  { key: "visits", header: "Visits", kind: "number" },
  { key: "last_visit", header: "Last visit", kind: "date" },
  { key: "follow_up_due", header: "Follow-up due", kind: "date" },
  { key: "owner", header: "Owner" },
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

export default async function SpecifiersPage({ searchParams }: PageProps<"/specifiers">) {
  await requireUser();
  const sp = await searchParams;
  const stage = typeof sp.stage === "string" && sp.stage in SPECIFIER_STAGES ? (sp.stage as SpecifierStage) : undefined;
  const [list, counts] = await Promise.all([listSpecifiers({ stage }), specifierCounts()]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const tableRows = list.map((s) => ({
    id: s.id,
    name: s.name ?? s.email ?? "(no name)",
    company_id: s.company_id,
    company: s.company,
    role_title: s.role_title,
    city: s.city,
    stage: s.stage ? SPECIFIER_STAGES[s.stage].label : "",
    last_region: s.last_region,
    visits: s.visits,
    last_visit: s.last_visit,
    follow_up_due: s.follow_up_due,
    owner: s.owner,
    last_activity_at: toLocalDate(s.last_activity_at),
  }));

  return (
    <>
      <PageHeader title="Specifiers" />
      <p className="mb-3 text-sm text-muted">
        Architects, designers and engineers the consultants visit. They move Visited → Follow-up → Specified → Enquiry on their contact page; a deal is
        opened only when a real enquiry arrives.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Tab href="/contacts" active={false}>
          All contacts
        </Tab>
        <Tab href="/specifiers" active={!stage}>
          All specifiers ({total.toLocaleString("en-NZ")})
        </Tab>
        {SPECIFIER_ORDER.map((s) => (
          <Tab key={s} href={`/specifiers?stage=${s}`} active={stage === s}>
            {SPECIFIER_STAGES[s].label} ({(counts[s] ?? 0).toLocaleString("en-NZ")})
          </Tab>
        ))}
      </div>
      <DataTable
        id="specifiers"
        noun="specifiers"
        columns={COLUMNS}
        rows={tableRows}
        empty="No specifiers yet. Upload the consultants' visit reports on the Imports tab."
      />
    </>
  );
}
