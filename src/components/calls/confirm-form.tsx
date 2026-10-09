"use client";

import { useActionState, useEffect, useState } from "react";
import { confirmCall, dealsForContact, discardCall } from "@/app/(app)/log/actions";
import { findContacts } from "@/app/(app)/deal-actions";
import { Lookup } from "@/components/forms/lookup";
import { initialActionState } from "@/lib/action-state";
import { STAGES, type Stage } from "@/lib/labels";

type Candidate = { id: string; name: string; company: string | null; email: string | null; reason: string };
type Deal = { id: string; title: string; stage: string; entity: string | null };

export type ConfirmProps = {
  noteId: string;
  note: string;
  summary: string;
  nextStep: string | null;
  followUpOn: string | null;
  stageHint: string | null;
  newEnquiry: boolean;
  candidates: Candidate[];
  firstDeals: Deal[];
  presetDealId: string | null;
  guess: { first: string | null; last: string | null; company: string | null; phone: string | null; email: string | null };
  defaultEntity: "NZ" | "AUS";
};

/** Check Claude's reading of the call note, pick the contact and deal, then confirm. Nothing is saved before. */
export function ConfirmForm(p: ConfirmProps) {
  const [state, action, pending] = useActionState(confirmCall, initialActionState);
  const [mode, setMode] = useState<"existing" | "new">(p.candidates.length ? "existing" : "new");
  const [contactId, setContactId] = useState<string | null>(p.candidates[0]?.id ?? null);
  const [deals, setDeals] = useState<Deal[]>(p.firstDeals);
  const [dealMode, setDealMode] = useState<"existing" | "new" | "none">(
    p.presetDealId || p.firstDeals.length ? "existing" : p.newEnquiry ? "new" : "none",
  );
  const [dealId, setDealId] = useState<string | null>(p.presetDealId ?? p.firstDeals[0]?.id ?? null);

  // A different contact chosen: load their open deals.
  useEffect(() => {
    if (mode !== "existing" || !contactId || contactId === p.candidates[0]?.id) return;
    let live = true;
    dealsForContact(contactId).then((d) => {
      if (!live) return;
      setDeals(d);
      setDealId(d[0]?.id ?? null);
      setDealMode(d.length ? "existing" : "none");
    });
    return () => {
      live = false;
    };
  }, [contactId, mode, p.candidates]);

  const v = (k: string, fallback: string | null) => (typeof state.values?.[k] === "string" ? (state.values[k] as string) : (fallback ?? ""));

  return (
    <div className="grid gap-4">
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Your note</summary>
        <p className="mt-2 whitespace-pre-line">{p.note}</p>
      </details>

      <form action={action} className="grid gap-4">
        <input type="hidden" name="note_id" value={p.noteId} />

        <div className="grid gap-1">
          <label htmlFor="summary" className="text-xs text-muted">
            Summary (goes on the timeline)
          </label>
          <textarea id="summary" name="summary" rows={3} defaultValue={v("summary", p.summary)} className="input" />
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-xs text-muted">Who was the call with?</legend>
          <input type="hidden" name="contact_mode" value={mode} />
          {p.candidates.map((c) => (
            <label key={c.id} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="contact_pick"
                checked={mode === "existing" && contactId === c.id}
                onChange={() => {
                  setMode("existing");
                  setContactId(c.id);
                  if (c.id === p.candidates[0]?.id) {
                    setDeals(p.firstDeals);
                    setDealId(p.presetDealId ?? p.firstDeals[0]?.id ?? null);
                  }
                }}
                className="mt-1"
              />
              <span>
                <b>{c.name}</b>
                {c.company && `, ${c.company}`} <span className="text-xs text-muted">({c.reason})</span>
              </span>
            </label>
          ))}
          <div className="grid gap-1">
            <Lookup
              name="lookup_contact"
              label="Someone else in the CRM"
              search={(q) => findContacts(q)}
              onChange={(o) => {
                if (o) {
                  setMode("existing");
                  setContactId(o.id);
                }
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="contact_pick" checked={mode === "new"} onChange={() => setMode("new")} />
            Someone new: add them as a contact
          </label>
          {mode === "existing" && <input type="hidden" name="contact_id" value={contactId ?? ""} />}
          {mode === "new" && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["new_first_name", "First name", p.guess.first],
                  ["new_last_name", "Last name", p.guess.last],
                  ["new_company", "Company", p.guess.company],
                  ["new_phone", "Phone", p.guess.phone],
                  ["new_email", "Email", p.guess.email],
                ] as const
              ).map(([name, label, value]) => (
                <div key={name} className="grid gap-1">
                  <label htmlFor={name} className="text-xs text-muted">
                    {label}
                  </label>
                  <input id={name} name={name} defaultValue={v(name, value)} className="input" />
                </div>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-xs text-muted">Deal</legend>
          <input type="hidden" name="deal_mode" value={dealMode} />
          {mode === "existing" &&
            deals.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="deal_pick"
                  checked={dealMode === "existing" && dealId === d.id}
                  onChange={() => {
                    setDealMode("existing");
                    setDealId(d.id);
                  }}
                />
                {d.title} <span className="text-xs text-muted">({[d.entity, STAGES[d.stage as Stage]?.label].filter(Boolean).join(", ")})</span>
              </label>
            ))}
          {dealMode === "existing" && <input type="hidden" name="deal_id" value={dealId ?? ""} />}
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="deal_pick" checked={dealMode === "new"} onChange={() => setDealMode("new")} />
            A new deal{p.newEnquiry && <span className="text-xs text-muted">(Claude thinks this is a new enquiry)</span>}
          </label>
          {dealMode === "new" && (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input name="new_deal_title" aria-label="New deal name" placeholder="Deal name, e.g. Riverside job" defaultValue={v("new_deal_title", p.guess.company)} className="input" />
              <select name="new_deal_entity" aria-label="Country" defaultValue={v("new_deal_entity", p.defaultEntity)} className="input">
                <option value="NZ">NZ</option>
                <option value="AUS">AUS</option>
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="deal_pick" checked={dealMode === "none"} onChange={() => setDealMode("none")} />
            No deal
          </label>
          {p.stageHint && dealMode === "existing" && (
            <label className="flex items-center gap-2 rounded bg-pending px-3 py-2 text-sm">
              <input type="checkbox" name="apply_stage" />
              <input type="hidden" name="stage" value={p.stageHint} />
              Move the deal to <b>{STAGES[p.stageHint as Stage]?.label ?? p.stageHint}</b> (Claude&apos;s suggestion from your note)
            </label>
          )}
        </fieldset>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-1">
            <label htmlFor="next_step" className="text-xs text-muted">
              Next step
            </label>
            <input id="next_step" name="next_step" defaultValue={v("next_step", p.nextStep)} className="input" />
          </div>
          <div className="grid gap-1">
            <label htmlFor="follow_up_on" className="text-xs text-muted">
              Follow up on (makes a task)
            </label>
            <input id="follow_up_on" name="follow_up_on" type="date" defaultValue={v("follow_up_on", p.followUpOn)} className="input" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary px-6 py-2 text-base" disabled={pending}>
            {pending ? "Saving…" : "Confirm"}
          </button>
          {state.message && (
            <span role="alert" className="text-sm text-bad">
              {state.message}
            </span>
          )}
        </div>
      </form>
      <form action={discardCall}>
        <input type="hidden" name="note_id" value={p.noteId} />
        <button type="submit" className="text-sm text-muted underline hover:text-bad">
          Discard this note
        </button>
      </form>
    </div>
  );
}
