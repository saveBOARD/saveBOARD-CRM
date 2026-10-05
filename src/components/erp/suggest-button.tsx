"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { runSuggestMatches } from "@/app/(app)/erp-actions";
import { initialActionState } from "@/lib/action-state";

export function SuggestMatchesButton() {
  const [state, action, pending] = useActionState(runSuggestMatches, initialActionState);
  return (
    <form action={action} className="flex items-center gap-3">
      {state.message && (
        <span role="status" className="text-sm text-ok">
          {state.message}
        </span>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        <RefreshCw className="h-4 w-4" aria-hidden />
        {pending ? "Looking for matches…" : "Suggest matches"}
      </button>
    </form>
  );
}
