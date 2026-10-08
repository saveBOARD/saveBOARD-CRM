"use client";

import { useActionState } from "react";
import { sendMyDigest } from "@/app/(app)/mail-actions";
import { initialActionState } from "@/lib/action-state";

export function DigestTestButton() {
  const [state, action, pending] = useActionState(sendMyDigest, initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "Sending…" : "Send me today's digest now"}
      </button>
      {state.message && (
        <span role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>
          {state.message}
        </span>
      )}
    </form>
  );
}
