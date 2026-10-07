"use server";

import { refresh } from "next/cache";
import { signIn } from "@/auth";
import type { ActionState } from "@/lib/action-state";
import { requireUser } from "@/server/auth/session";
import { deleteMailAccount } from "@/server/mail/accounts";
import { mailKeyStatus } from "@/server/mail/crypto";
import { forgetGraphToken, MAIL_SCOPES, testMailConnection } from "@/server/mail/graph";
import { runSummaries } from "@/server/mail/summaries";
import { syncMail } from "@/server/mail/sync";

// Connecting Outlook: sign in again with Microsoft, asking for mail access (read + drafts, never send).

export async function connectOutlook(): Promise<void> {
  await requireUser();
  if (!mailKeyStatus().ok) throw new Error("Outlook connections are not set up on this server yet (MAIL_TOKEN_KEY).");
  await signIn("microsoft-entra-id", { redirectTo: "/settings/outlook?connected=1" }, { scope: MAIL_SCOPES });
}

export async function disconnectOutlook(): Promise<void> {
  const user = await requireUser();
  await deleteMailAccount({ type: "user", profileId: user.id }, user.id);
  forgetGraphToken(user.id);
  refresh();
}

export async function testOutlook(): Promise<ActionState> {
  const user = await requireUser();
  try {
    const inbox = await testMailConnection(user.id);
    const n = (x: number) => x.toLocaleString("en-NZ");
    const shared = inbox.shared
      .map((m) => (m.ok ? `${m.address}: can read (${n(m.total)} emails)` : `${m.address}: can't open (${m.problem})`))
      .join("; ");
    return {
      ok: inbox.shared.every((m) => m.ok),
      message: `Connected: your Inbox has ${n(inbox.totalItemCount)} emails (${n(inbox.unreadItemCount)} unread). Shared mailboxes: ${shared}.`,
      savedAt: Date.now(),
    };
  } catch (e) {
    refresh();
    return { ok: false, message: e instanceof Error ? e.message : "The test failed." };
  }
}

/** Read new mail now instead of waiting for the 10-minute job. Same code path, this user's mailbox only. */
export async function syncOutlookNow(): Promise<ActionState> {
  const user = await requireUser();
  const [r] = await syncMail({ profileId: user.id, budgetMs: 35_000 });
  // Then a few summaries for this user's newest emails; the 10-minute job does the rest.
  const s = r && !r.error ? await runSummaries({ ownerId: user.id, budgetMs: 15_000, limit: 12 }) : null;
  refresh();
  if (!r) return { ok: false, message: "Outlook isn't connected." };
  const error = r.error ?? r.folders.find((f) => f.error)?.error;
  if (error) return { ok: false, message: `Sync stopped: ${error}` };
  const seen = r.folders.reduce((n, f) => n + f.seen, 0);
  const logged = r.folders.reduce((n, f) => n + f.logged, 0);
  const triaged = r.folders.reduce((n, f) => n + f.triaged, 0);
  const more = r.folders.length < 2 || r.folders.some((f) => !f.finished) ? " Still catching up: it carries on automatically." : "";
  return {
    ok: true,
    message: `Checked ${seen.toLocaleString("en-NZ")} emails: ${logged} logged on contacts, ${triaged} new for triage.${more}${
      s && s.summarised ? ` Claude summarised ${s.summarised}.` : ""
    }`,
    savedAt: Date.now(),
  };
}
