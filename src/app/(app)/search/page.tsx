import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Panel, Pill } from "@/components/ui/detail";
import { formatMoney } from "@/lib/format";
import { countryName, STAGES } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { searchAll } from "@/server/crm/search";

export const metadata: Metadata = { title: "Search" };

function Results({ title, count, children, empty }: { title: string; count: number; children: React.ReactNode; empty: string }) {
  return (
    <Panel title={`${title} (${count}${count === 15 ? "+" : ""})`}>
      {count === 0 ? <p className="text-sm text-muted">{empty}</p> : <ul className="grid gap-2">{children}</ul>}
    </Panel>
  );
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  await requireUser();
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const r = await searchAll(q);
  const total = r.companies.length + r.contacts.length + r.deals.length;

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <PageHeader title={q ? `Search: ${q}` : "Search"} />
      {q.length < 2 ? (
        <p className="card p-4 text-sm text-muted">Type at least 2 characters in the search box at the top: a name, email, phone number, web domain or ERP number.</p>
      ) : total === 0 ? (
        <p className="card p-4 text-sm text-muted">Nothing found for &ldquo;{q}&rdquo;. Try part of a name, an email or a phone number.</p>
      ) : (
        <>
          <Results title="Companies" count={r.companies.length} empty="No companies.">
            {r.companies.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`/companies/${c.id}`} className="font-medium text-link hover:underline">
                  {c.name}
                </Link>
                <span className="text-sm text-muted">{[c.domain, countryName(c.country_code), `${c.contacts} contact(s)`].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </Results>
          <Results title="Contacts" count={r.contacts.length} empty="No contacts.">
            {r.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`/contacts/${c.id}`} className="font-medium text-link hover:underline">
                  {c.name}
                </Link>
                <span className="text-sm text-muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
                {c.company_id && (
                  <Link href={`/companies/${c.company_id}`} className="text-sm text-link hover:underline">
                    {c.company}
                  </Link>
                )}
              </li>
            ))}
          </Results>
          <Results title="Deals" count={r.deals.length} empty="No deals.">
            {r.deals.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={`/deals/${d.id}`} className="font-medium text-link hover:underline">
                  {d.title}
                </Link>
                <Pill tone={STAGES[d.stage].tone}>{STAGES[d.stage].label}</Pill>
                <span className="text-sm text-muted">
                  {[d.company, d.erp_so_number, d.est_value ? formatMoney(d.est_value, d.est_currency) : null].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </Results>
        </>
      )}
    </div>
  );
}
