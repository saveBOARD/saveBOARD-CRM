"use client";

import { useActionState, useState } from "react";
import { Moon } from "lucide-react";
import { snoozeDealAction } from "@/app/(app)/deal-actions";
import { initialActionState } from "@/lib/action-state";
import { formatDate } from "@/lib/format";

// Snooze with a reason pauses the deal's chase-list rules until the date (brief: "The clock").
export function SnoozeForm({ dealId, snoozedUntil, reason }: { dealId: string; snoozedUntil: string | null; reason: string | null }) {
  const [state, action, pending] = useActionState(snoozeDealAction, initialActionState);
  const [open, setOpen] = useState(false);
  const e = state.fieldErrors ?? {};

  if (snoozedUntil) {
    return (
      <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="id" value={dealId} />
        <input type="hidden" name="wake" value="1" />
        <input type="hidden" name="snoozed_until" value="" />
        <input type="hidden" name="snooze_reason" value="" />
        <span className="inline-flex items-center gap-1 rounded bg-pending px-2 py-1">
          <Moon className="h-4 w-4" aria-hidden />
          Snoozed until {formatDate(snoozedUntil)}
          {reason && `: ${reason}`}
        </span>
        <button type="submit" className="btn-secondary" disabled={pending}>
          Wake now
        </button>
      </form>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        <Moon className="h-4 w-4" aria-hidden />
        Snooze
      </button>
    );
  }

  return (
    <form action={action} className="flex w-full flex-wrap items-end gap-2 rounded border border-line p-3">
      <input type="hidden" name="id" value={dealId} />
      <label className="grid gap-1 text-xs text-muted">
        Until
        <input type="date" name="snoozed_until" className={e.snoozed_until ? "input border-bad" : "input"} defaultValue={state.values ? String(state.values.snoozed_until ?? "") : ""} />
      </label>
      <label className="grid flex-1 gap-1 text-xs text-muted">
        Reason
        <input name="snooze_reason" className={e.snooze_reason ? "input border-bad" : "input"} placeholder="e.g. Project on hold until February" />
      </label>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Snooze"}
      </button>
      <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {(e.snoozed_until || e.snooze_reason || (state.message && !state.ok)) && (
        <span role="alert" className="w-full text-sm text-bad">
          {e.snoozed_until ?? e.snooze_reason ?? state.message}
        </span>
      )}
    </form>
  );
}
