"use client";

import { useActionState, useEffect, useState } from "react";
import clsx from "clsx";
import { Link2 } from "lucide-react";
import { findErpCustomers, linkErpCustomer } from "@/app/(app)/erp-actions";
import { initialActionState } from "@/lib/action-state";
import type { ErpCustomerOption } from "@/server/erp/company";

const ENTITY_NAME = { NZ: "New Zealand", AUS: "Australia" } as const;

// Admins: link this company to an ERP customer by hand (search the chosen entity's customers).
export function ErpLinkForm({ companyId, entities }: { companyId: string; entities: ("NZ" | "AUS")[] }) {
  const [open, setOpen] = useState(false);
  const [entity, setEntity] = useState<"NZ" | "AUS">(entities[0]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ErpCustomerOption[]>([]);
  const [chosen, setChosen] = useState<ErpCustomerOption | null>(null);
  const [state, action, pending] = useActionState(linkErpCustomer, initialActionState);

  useEffect(() => {
    const term = q.trim();
    let live = true;
    const t = setTimeout(async () => {
      const r = term.length >= 2 ? await findErpCustomers(entity, term) : [];
      if (live) setFound(r);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, entity]);

  // After a successful link, close and clear the form (adjusting state during render, not in an effect).
  const [handledSave, setHandledSave] = useState<number | undefined>();
  if (state.savedAt && state.savedAt !== handledSave) {
    setHandledSave(state.savedAt);
    setOpen(false);
    setQ("");
    setChosen(null);
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        <Link2 className="h-4 w-4" aria-hidden />
        Link to ERP customer
      </button>
    );
  }

  return (
    <form action={action} className="grid gap-3 rounded border border-line p-4">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="erp_customer_id" value={chosen?.id ?? ""} />
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-xs text-muted">
          ERP company
          <select className="input" value={entity} onChange={(e) => (setEntity(e.target.value as "NZ" | "AUS"), setChosen(null))}>
            {entities.map((en) => (
              <option key={en} value={en}>
                {ENTITY_NAME[en]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid flex-1 gap-1 text-xs text-muted">
          Find ERP customer (name, code or email)
          <input className="input" value={q} onChange={(e) => (setQ(e.target.value), setChosen(null))} autoComplete="off" />
        </label>
      </div>
      {found.length > 0 && !chosen && (
        <ul className="max-h-60 overflow-auto rounded border border-line text-sm" role="listbox" aria-label="ERP customers">
          {found.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={!!c.linked_company_id}
                onClick={() => setChosen(c)}
                className={clsx("flex w-full flex-wrap gap-x-2 px-3 py-1.5 text-left", c.linked_company_id ? "text-muted" : "hover:bg-page")}
              >
                <span className="font-medium">{c.name}</span>
                {c.code && <span className="font-mono text-xs text-muted">[{c.code}]</span>}
                {c.billing_city && <span className="text-muted">{c.billing_city}</span>}
                {!c.active && <span className="text-warn">inactive</span>}
                {c.linked_company && <span className="text-muted">already linked to {c.linked_company}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen && (
        <p className="rounded bg-[#eef3f8] px-3 py-2 text-sm">
          Link to <b>{chosen.name}</b> {chosen.code && <span className="font-mono text-xs">[{chosen.code}]</span>} in {ENTITY_NAME[entity]}?
        </p>
      )}
      {(state.message || state.fieldErrors) && (
        <p role="alert" className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>
          {state.fieldErrors?.erp_customer_id ?? state.message}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={!chosen || pending}>
          {pending ? "Linking…" : "Link customer"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
