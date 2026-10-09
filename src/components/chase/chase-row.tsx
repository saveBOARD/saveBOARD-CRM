"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, Clock, Mail } from "lucide-react";
import { acceptChaseSuggestion, dismissChaseItem, markChaseDone, snoozeChaseItem } from "@/app/(app)/chase-actions";
import { initialActionState } from "@/lib/action-state";
import { DraftPanel, type ExistingDraft } from "./draft-panel";

export type ChaseRowProps = {
  id: string;
  rule: string;
  title: string;
  href: string | null;
  detail: string | null;
  who: string | null; // contact / company line
  meta: string; // e.g. "NZ · Contacted · quiet 9 days · Paul Charteris"
  suggestion: boolean;
  acceptLabel?: string;
  dismissable: boolean;
  byClaude: boolean;
  draft: ExistingDraft | null;
};

export function ChaseRow(p: ChaseRowProps) {
  const [open, setOpen] = useState<"done" | "snooze" | "draft" | null>(p.draft ? "draft" : null);
  const [days, setDays] = useState("7");
  const [doneState, doneAction, donePending] = useActionState(markChaseDone, initialActionState);
  const [snoozeState, snoozeAction, snoozePending] = useActionState(snoozeChaseItem, initialActionState);
  const message = open === "done" ? doneState : open === "snooze" ? snoozeState : null;
  const fid = (s: string) => `c-${p.id}-${s}`;

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium break-words">
            {p.href ? (
              <Link href={p.href} className="text-link hover:underline">
                {p.title}
              </Link>
            ) : (
              p.title
            )}
            {p.byClaude && <span className="ml-2 text-xs font-normal text-muted">(from Claude&apos;s email summary)</span>}
          </div>
          {p.detail && <div className="text-sm">{p.detail}</div>}
          {p.who && <div className="text-sm text-muted">{p.who}</div>}
          <div className="text-xs text-muted">{p.meta}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.suggestion ? (
            <>
              <form action={acceptChaseSuggestion}>
                <input type="hidden" name="task_id" value={p.id} />
                <button type="submit" className="btn-primary">
                  {p.acceptLabel ?? "Move to Negotiation"}
                </button>
              </form>
              <form action={dismissChaseItem}>
                <input type="hidden" name="task_id" value={p.id} />
                <button type="submit" className="btn-secondary">
                  Dismiss
                </button>
              </form>
            </>
          ) : (
            <>
              <button type="button" className="btn-primary" aria-expanded={open === "done"} onClick={() => setOpen(open === "done" ? null : "done")}>
                <Check className="h-4 w-4" aria-hidden />
                Done
              </button>
              <button type="button" className="btn-secondary" aria-expanded={open === "draft"} onClick={() => setOpen(open === "draft" ? null : "draft")}>
                <Mail className="h-4 w-4" aria-hidden />
                Draft
              </button>
              <button type="button" className="btn-secondary" aria-expanded={open === "snooze"} onClick={() => setOpen(open === "snooze" ? null : "snooze")}>
                <Clock className="h-4 w-4" aria-hidden />
                Snooze
              </button>
              {p.dismissable && (
                <form action={dismissChaseItem}>
                  <input type="hidden" name="task_id" value={p.id} />
                  <button type="submit" className="btn-secondary">
                    Dismiss
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      {open === "done" && (
        <form action={doneAction} className="mt-3 grid gap-2 border-t border-line pt-3">
          <input type="hidden" name="task_id" value={p.id} />
          <label htmlFor={fid("note")} className="text-xs text-muted">
            What happened? (goes on the timeline; optional)
          </label>
          <textarea id={fid("note")} name="note" rows={2} className="input" placeholder="e.g. Rang Sarah, she'll confirm quantities on Friday" />
          <div>
            <button type="submit" className="btn-primary" disabled={donePending}>
              {donePending ? "Saving…" : p.rule === "slow_first_response" ? "Save (marks the deal Contacted)" : "Save"}
            </button>
          </div>
        </form>
      )}

      {open === "draft" && <DraftPanel taskId={p.id} existing={p.draft} />}

      {open === "snooze" && (
        <form action={snoozeAction} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
          <input type="hidden" name="task_id" value={p.id} />
          <div className="grid gap-1">
            <label htmlFor={fid("days")} className="text-xs text-muted">
              For
            </label>
            <select id={fid("days")} name="days" className="input" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="3">3 days</option>
              <option value="7">1 week</option>
              <option value="14">2 weeks</option>
              <option value="30">1 month</option>
              <option value="custom">Until…</option>
            </select>
          </div>
          {days === "custom" && (
            <div className="grid gap-1">
              <label htmlFor={fid("until")} className="text-xs text-muted">
                Date
              </label>
              <input id={fid("until")} name="until" type="date" className="input" />
            </div>
          )}
          <div className="grid gap-1">
            <label htmlFor={fid("reason")} className="text-xs text-muted">
              Why
            </label>
            <input id={fid("reason")} name="reason" required maxLength={300} className="input" placeholder="e.g. Customer away until the 20th" />
          </div>
          <div>
            <button type="submit" className="btn-primary" disabled={snoozePending}>
              {snoozePending ? "Saving…" : "Snooze"}
            </button>
          </div>
        </form>
      )}

      {message?.message && !message.ok && (
        <p role="alert" className="mt-2 text-sm text-bad">
          {message.message}
        </p>
      )}
    </li>
  );
}
