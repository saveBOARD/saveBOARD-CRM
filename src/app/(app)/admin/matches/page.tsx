import type { Metadata } from "next";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { reviewMatch } from "@/app/(app)/erp-actions";
import { SuggestMatchesButton } from "@/components/erp/suggest-button";
import { PageHeader } from "@/components/shell/page-header";
import { SimpleTable } from "@/components/ui/simple-table";
import { countryName } from "@/lib/labels";
import { requireAdmin } from "@/server/auth/session";
import { listMatchCandidates, type MatchCandidate } from "@/server/erp";

export const metadata: Metadata = { title: "ERP matches" };

const METHOD: Record<string, string> = {
  name_exact: "Same name",
  email: "Contact email is the ERP customer's email",
  domain: "Same web domain as the ERP customer's email",
  name_fuzzy: "Similar name",
};

function Decision({ m }: { m: MatchCandidate }) {
  return (
    <form action={reviewMatch} className="flex flex-wrap items-center justify-end gap-1">
      <input type="hidden" name="candidate_id" value={m.id} />
      {m.taken_by_company_id ? (
        <span className="text-xs text-warn">
          Already linked to{" "}
          <Link href={`/companies/${m.taken_by_company_id}`} className="text-link hover:underline">
            {m.taken_by_company}
          </Link>
        </span>
      ) : (
        <button type="submit" name="decision" value="accept" className="btn-secondary py-1 text-ok">
          <Check className="h-4 w-4" aria-hidden />
          Accept
        </button>
      )}
      <button type="submit" name="decision" value="reject" className="btn-secondary py-1 text-bad">
        <X className="h-4 w-4" aria-hidden />
        Reject
      </button>
    </form>
  );
}

// Suggested links between CRM companies and ERP customers. Nothing is linked until an admin accepts it.
export default async function MatchesPage() {
  await requireAdmin();
  const candidates = await listMatchCandidates();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="ERP matches" actions={<SuggestMatchesButton />} />
      <p className="mb-4 text-sm text-muted">
        Suggested links between CRM companies and ERP customers, best first. Accepting links them (one ERP customer per company per
        country); rejecting hides the suggestion. The ERP itself is never changed.
      </p>
      <div className="card px-4 py-2">
        <SimpleTable<MatchCandidate>
          rows={candidates}
          empty="Nothing to review. Run Suggest matches after loading or adding companies."
          columns={[
            {
              header: "CRM company",
              cell: (m) => (
                <div>
                  <Link href={`/companies/${m.company_id}`} className="text-link hover:underline">
                    {m.company}
                  </Link>
                  <div className="text-xs text-muted">
                    {[m.company_domain, countryName(m.company_country), `${m.company_contacts} contact(s)`].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ),
            },
            {
              header: "ERP customer",
              cell: (m) => (
                <div>
                  {m.erp_name} {m.erp_code && <span className="font-mono text-xs text-muted">[{m.erp_code}]</span>}
                  <div className="text-xs text-muted">
                    {[m.erp_entity === "NZ" ? "New Zealand" : "Australia", m.erp_city, m.erp_email, m.erp_active === false ? "inactive" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ),
            },
            { header: "Why", cell: (m) => <span className="text-sm">{METHOD[m.method] ?? m.method}</span> },
            { header: "Score", numeric: true, cell: (m) => `${Math.round(Number(m.score) * 100)}%` },
            { header: "", cell: (m) => <Decision m={m} /> },
          ]}
        />
      </div>
    </div>
  );
}
