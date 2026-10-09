"use client";

import { useActionState } from "react";
import { linkQuoteAction } from "@/app/(app)/deal-actions";
import { initialActionState } from "@/lib/action-state";

/** One click to link a listed quote, or type an ERP number. */
export function QuoteLinkButton({ dealId, number }: { dealId: string; number: string }) {
  const [state, action, pending] = useActionState(linkQuoteAction, initialActionState);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="deal_id" value={dealId} />
      <input type="hidden" name="number" value={number} />
      <button type="submit" className="btn-secondary px-2 py-0.5 text-xs" disabled={pending}>
        {pending ? "Linking…" : "Link"}
      </button>
      {state.message && !state.ok && <span className="text-xs text-bad">{state.message}</span>}
    </form>
  );
}

export function QuoteNumberForm({ dealId }: { dealId: string }) {
  const [state, action, pending] = useActionState(linkQuoteAction, initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="deal_id" value={dealId} />
      <label htmlFor={`q-${dealId}`} className="text-sm text-muted">
        Or the ERP number
      </label>
      <input id={`q-${dealId}`} name="number" placeholder="SO-1602" className="input w-32 font-mono text-sm" />
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "Linking…" : "Link"}
      </button>
      {state.message && <span className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>{state.message}</span>}
    </form>
  );
}
