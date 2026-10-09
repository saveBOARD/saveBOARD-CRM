"use client";

import { useActionState, useState } from "react";
import { findCompanies } from "@/app/(app)/actions";
import { linkCustomerToCompany } from "@/app/(app)/erp-actions";
import { Lookup } from "@/components/forms/lookup";
import { initialActionState } from "@/lib/action-state";

type Candidate = { company_id: string; company_name: string; method: string; score: number };

const WHY: Record<string, string> = {
  name_exact: "same name",
  name_compact: "same name, written differently",
  email: "a contact has the customer's email",
  domain: "same web domain",
  name_fuzzy: "similar name",
};

/** Pick the CRM company this ERP customer is: one of the likely matches, or any other company. */
export function CustomerLinkForm({ entity, erpCustomerId, candidates }: { entity: string; erpCustomerId: string; candidates: Candidate[] }) {
  const [state, action, pending] = useActionState(linkCustomerToCompany, initialActionState);
  const [chosen, setChosen] = useState<string | null>(candidates[0]?.company_id ?? null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="erp_customer_id" value={erpCustomerId} />
      <input type="hidden" name="company_id" value={chosen ?? ""} />
      {candidates.length > 0 ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-xs text-muted">Likely matches in the CRM</legend>
          {candidates.map((c) => (
            <label key={c.company_id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="pick" checked={chosen === c.company_id} onChange={() => setChosen(c.company_id)} />
              <b>{c.company_name}</b>
              <span className="text-xs text-muted">
                ({WHY[c.method] ?? c.method}
                {c.method === "name_fuzzy" ? `, ${Math.round(c.score * 100)}%` : ""})
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-muted">No likely match in the CRM. Search for the company below, or create it from the ERP details.</p>
      )}
      <Lookup
        name="other_company"
        label="Another CRM company"
        search={(q) => findCompanies(q)}
        onChange={(o) => setChosen(o?.id ?? candidates[0]?.company_id ?? null)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending || !chosen}>
          {pending ? "Linking…" : "Link to this company"}
        </button>
        {state.message && (
          <span role="alert" className="text-sm text-bad">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
