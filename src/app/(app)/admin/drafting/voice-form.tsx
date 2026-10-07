"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { saveVoice } from "./actions";

export function VoiceForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState(saveVoice, initialActionState);
  return (
    <form action={action} className="grid gap-3">
      <label htmlFor="examples" className="text-sm">
        Paste 3 to 5 follow-up emails you have sent and liked, one after another. Take out anything private you don&apos;t want
        Claude to see; names and details in them are only used for style, never copied into drafts.
      </label>
      <textarea id="examples" name="examples" rows={18} defaultValue={current} className="input font-mono text-xs" />
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        {state.message && (
          <span role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
