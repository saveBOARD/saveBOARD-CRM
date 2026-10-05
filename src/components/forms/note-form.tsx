"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveNote } from "@/app/(app)/actions";
import { initialActionState } from "@/lib/action-state";

type Target = { companyId?: string; contactId?: string; dealId?: string };

// "Add a note" on a company, contact or deal page. A note is an activity, so it resets the 7-day clock.
export function NoteForm({ target }: { target: Target }) {
  const [state, action, pending] = useActionState(saveNote, initialActionState);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.savedAt) form.current?.reset();
  }, [state.savedAt]);

  return (
    <form ref={form} action={action} className="mb-5 grid gap-2 border-b border-line pb-5">
      {target.companyId && <input type="hidden" name="company_id" value={target.companyId} />}
      {target.contactId && <input type="hidden" name="contact_id" value={target.contactId} />}
      {target.dealId && <input type="hidden" name="deal_id" value={target.dealId} />}
      <label htmlFor="note-summary" className="text-xs text-muted">
        Add a note
      </label>
      <textarea
        id="note-summary"
        name="summary"
        rows={3}
        className="input"
        placeholder="What happened, what was agreed, what's next"
        defaultValue={state.values ? String(state.values.summary ?? "") : ""}
        aria-invalid={!!state.fieldErrors?.summary}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          Date
          <input
            type="date"
            name="occurred_on"
            className="input py-1"
            aria-label="Date of the note (leave blank for now)"
            defaultValue={state.values ? String(state.values.occurred_on ?? "") : ""}
          />
        </label>
        <span
          role={state.fieldErrors || (state.message && !state.ok) ? "alert" : "status"}
          className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}
        >
          {state.fieldErrors?.summary ?? state.fieldErrors?.occurred_on ?? state.message}
        </span>
        <button type="submit" className="btn-primary ml-auto" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </button>
      </div>
    </form>
  );
}
