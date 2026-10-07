"use client";

import { useActionState } from "react";
import { testOutlook } from "@/app/(app)/mail-actions";
import { initialActionState } from "@/lib/action-state";

export function TestOutlookButton() {
  const [state, action, pending] = useActionState(testOutlook, initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "Testing…" : "Test connection"}
      </button>
      {state.message && (
        <span role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>
          {state.message}
        </span>
      )}
    </form>
  );
}
