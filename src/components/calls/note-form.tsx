"use client";

import { useActionState } from "react";
import { Mic } from "lucide-react";
import { submitCallNote } from "@/app/(app)/log/actions";
import { initialActionState } from "@/lib/action-state";

/** The note box. On a phone, the keyboard's microphone button turns speech into text here: nothing is recorded. */
export function NoteForm({ contactId, dealId, about }: { contactId: string | null; dealId: string | null; about: string | null }) {
  const [state, action, pending] = useActionState(submitCallNote, initialActionState);
  return (
    <form action={action} className="grid gap-3">
      {contactId && <input type="hidden" name="contact_id" value={contactId} />}
      {dealId && <input type="hidden" name="deal_id" value={dealId} />}
      {about && <p className="text-sm">About: <b>{about}</b></p>}
      <label htmlFor="note" className="flex items-center gap-2 text-sm text-muted">
        <Mic className="h-4 w-4" aria-hidden />
        Tap the microphone on your keyboard and say who you spoke to, what you agreed and what happens next.
      </label>
      <textarea
        id="note"
        name="note"
        rows={7}
        required
        autoFocus
        defaultValue={typeof state.values?.note === "string" ? state.values.note : ""}
        placeholder="e.g. Spoke to Sarah Jones at Smith Builders about the Riverside job. She wants betterBRACE samples, I'll send them today and call her back next Thursday."
        className="input text-base"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary px-6 py-2 text-base" disabled={pending}>
          {pending ? "Claude is reading it…" : "Next"}
        </button>
        {state.message && (
          <span role="alert" className="text-sm text-bad">
            {state.message}
          </span>
        )}
      </div>
      <p className="text-xs text-muted">Nothing is saved to a contact or deal until you check it on the next screen.</p>
    </form>
  );
}
