"use client";

import { useActionState } from "react";
import { syncOutlookNow, testOutlook } from "@/app/(app)/mail-actions";
import { initialActionState, type ActionState } from "@/lib/action-state";

function ActionButton({ run, label, busy }: { run: () => Promise<ActionState>; label: string; busy: string }) {
  const [state, action, pending] = useActionState(run, initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? busy : label}
      </button>
      {state.message && (
        <span role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>
          {state.message}
        </span>
      )}
    </form>
  );
}

export const TestOutlookButton = () => <ActionButton run={testOutlook} label="Test connection" busy="Testing…" />;
export const SyncOutlookButton = () => <ActionButton run={syncOutlookNow} label="Sync now" busy="Reading your mail…" />;
