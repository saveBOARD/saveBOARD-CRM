"use client";

import { useActionState, useState } from "react";
import { ExternalLink, UserPlus } from "lucide-react";
import { addTriageContact, ignoreTriageSender } from "@/app/(app)/triage-actions";
import { initialActionState } from "@/lib/action-state";

export type TriageCardProps = {
  n: number;
  address: string;
  first: string | null;
  last: string | null;
  emails: number;
  latestAt: string;
  latestSubject: string | null;
  latestUrl: string | null;
  mailboxes: string;
  companyId: string | null;
  companyName: string | null;
  newCompanyName: string | null;
  freeDomain: boolean;
  domain: string;
};

export function TriageCard(p: TriageCardProps) {
  const [state, action, pending] = useActionState(addTriageContact, initialActionState);
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState(p.companyId ? "existing" : p.newCompanyName ? "new" : "none");
  const id = (s: string) => `t${p.n}-${s}`;
  const name = [p.first, p.last].filter(Boolean).join(" ");

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="font-medium break-words">{name || p.address}</div>
          {name && <div className="text-sm text-muted break-all">{p.address}</div>}
          <div className="mt-1 text-sm">
            {p.latestUrl ? (
              <a href={p.latestUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-link hover:underline">
                {p.latestSubject ?? "(no subject)"}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : (
              (p.latestSubject ?? "(no subject)")
            )}
          </div>
          <div className="text-xs text-muted">
            {p.latestAt}
            {p.emails > 1 && `, ${p.emails} emails`}
            {p.mailboxes && `, in ${p.mailboxes}`}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <UserPlus className="h-4 w-4" aria-hidden />
            Add as contact
          </button>
          <form action={ignoreTriageSender}>
            <input type="hidden" name="address" value={p.address} />
            <button type="submit" name="scope" value="once" className="btn-secondary">
              Ignore
            </button>
          </form>
          <form action={ignoreTriageSender} className="flex gap-2">
            <input type="hidden" name="address" value={p.address} />
            <button type="submit" name="scope" value="address" className="btn-secondary" title="Skip this address from now on">
              Always ignore sender
            </button>
            {!p.freeDomain && (
              <button type="submit" name="scope" value="domain" className="btn-secondary" title={`Skip everyone at ${p.domain} from now on`}>
                Always ignore {p.domain}
              </button>
            )}
          </form>
        </div>
      </div>

      {open && (
        <form action={action} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
          <input type="hidden" name="address" value={p.address} />
          <div className="grid gap-1">
            <label htmlFor={id("first")} className="text-xs text-muted">
              First name
            </label>
            <input id={id("first")} name="first_name" defaultValue={p.first ?? ""} className="input" />
          </div>
          <div className="grid gap-1">
            <label htmlFor={id("last")} className="text-xs text-muted">
              Last name
            </label>
            <input id={id("last")} name="last_name" defaultValue={p.last ?? ""} className="input" />
          </div>
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="mb-1 text-xs text-muted">Company</legend>
            {p.companyId && (
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="company" value="existing" checked={company === "existing"} onChange={() => setCompany("existing")} />
                {p.companyName} <span className="text-muted">(already in the CRM)</span>
              </label>
            )}
            <input type="hidden" name="company_id" value={p.companyId ?? ""} />
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input type="radio" name="company" value="new" checked={company === "new"} onChange={() => setCompany("new")} />
              New company:
              <input
                name="company_name"
                aria-label="New company name"
                defaultValue={p.newCompanyName ?? ""}
                className="input min-w-0 flex-1"
                onFocus={() => setCompany("new")}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="company" value="none" checked={company === "none"} onChange={() => setCompany("none")} />
              No company
            </label>
          </fieldset>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Adding…" : "Add contact and log their emails"}
            </button>
            {state.message && (
              <span role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>
                {state.message}
              </span>
            )}
          </div>
        </form>
      )}
    </li>
  );
}
