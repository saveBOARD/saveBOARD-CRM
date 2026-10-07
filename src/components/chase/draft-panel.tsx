"use client";

import { useActionState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { draftChaseEmail, saveDraftToOutlook, type DraftState } from "@/app/(app)/chase-actions";

export type ExistingDraft = { subject: string; body: string; to: string; link: string | null };

/**
 * Claude's draft for one chase item: ask for a draft, edit it, then save it to your own Outlook Drafts. The CRM never
 * sends it; you send it from Outlook.
 */
export function DraftPanel({ taskId, existing }: { taskId: string; existing: ExistingDraft | null }) {
  const [drafted, draftAction, drafting] = useActionState<DraftState, FormData>(draftChaseEmail, {});
  const [saved, saveAction, saving] = useActionState<DraftState, FormData>(saveDraftToOutlook, {});
  // What the boxes show: the newest of Claude's latest draft, the last save (with your edits), or the stored draft.
  // React resets a form after its action runs, so the boxes are re-created (by key) from that newest version.
  const latest =
    (saved.savedAt ?? 0) >= (drafted.savedAt ?? 0) && saved.subject
      ? { subject: saved.subject, body: saved.body ?? "", at: saved.savedAt ?? 0 }
      : drafted.ok
        ? { subject: drafted.subject ?? "", body: drafted.body ?? "", at: drafted.savedAt ?? 0 }
        : existing
          ? { subject: existing.subject, body: existing.body, at: 0 }
          : null;
  const to = drafted.to ?? existing?.to ?? null;
  const link = saved.link ?? existing?.link ?? null;
  const fid = (s: string) => `d-${taskId}-${s}`;

  return (
    <div className="mt-3 grid gap-3 border-t border-line pt-3">
      <form action={draftAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="task_id" value={taskId} />
        <button type="submit" className="btn-secondary" disabled={drafting}>
          <Sparkles className="h-4 w-4" aria-hidden />
          {drafting ? "Claude is writing…" : latest ? "Draft again" : "Draft email with Claude"}
        </button>
        {drafted.message && !drafted.ok && (
          <span role="alert" className="text-sm text-bad">
            {drafted.message}
          </span>
        )}
      </form>

      {drafted.warning && (
        <p role="status" className="rounded bg-pending px-3 py-2 text-sm">
          {drafted.warning}
        </p>
      )}

      {latest && (
        <form key={latest.at} action={saveAction} className="grid gap-2">
          <input type="hidden" name="task_id" value={taskId} />
          {to && <div className="text-xs text-muted">To: {to}</div>}
          <div className="grid gap-1">
            <label htmlFor={fid("subject")} className="text-xs text-muted">
              Subject
            </label>
            <input id={fid("subject")} name="subject" defaultValue={latest.subject} maxLength={200} className="input" />
          </div>
          <div className="grid gap-1">
            <label htmlFor={fid("body")} className="text-xs text-muted">
              Email (check it, change anything you like)
            </label>
            <textarea id={fid("body")} name="body" rows={8} defaultValue={latest.body} maxLength={5000} className="input" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save to my Outlook Drafts"}
            </button>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-link hover:underline">
                Open the draft in Outlook <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
            {saved.message && (
              <span role={saved.ok ? "status" : "alert"} className={saved.ok ? "text-sm text-ok" : "text-sm text-bad"}>
                {saved.message}
              </span>
            )}
          </div>
          <p className="text-xs text-muted">Nothing is sent from the CRM. You send it from Outlook when you&apos;re happy with it.</p>
        </form>
      )}
    </div>
  );
}
