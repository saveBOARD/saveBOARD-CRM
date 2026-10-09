"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { toLocalDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { acceptSuggestion, completeChase, dismissChase, snoozeChase, taskRule } from "@/server/crm/chase";
import { draftChase, saveChaseDraft } from "@/server/crm/drafts";
import { acceptQuoteSuggestion, dismissQuoteSuggestion } from "@/server/crm/quote-links";

// Chase list actions (Today page). Each one: check the user, validate, write via withActor (in server/crm/chase.ts).

const id = z.uuid();

export async function markChaseDone(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const taskId = id.safeParse(form.get("task_id"));
  if (!taskId.success) return { ok: false, message: "This item no longer exists." };
  const note = String(form.get("note") ?? "").trim().slice(0, 2000) || null;
  const ok = await completeChase({ type: "user", profileId: user.id }, taskId.data, note);
  refresh();
  return ok ? { ok: true, message: "Done.", savedAt: Date.now() } : { ok: false, message: "Someone else has already dealt with this one." };
}

const snoozeSchema = z.object({
  task_id: z.uuid(),
  days: z.enum(["3", "7", "14", "30", "custom"]),
  until: z.string().optional(),
  reason: z.string().trim().min(1, "Say why, so the next person knows.").max(300),
});

export async function snoozeChaseItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = snoozeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the snooze." };
  const d = parsed.data;
  const today = toLocalDate(new Date())!;
  let until: string;
  if (d.days === "custom") {
    if (!d.until || !/^\d{4}-\d{2}-\d{2}$/.test(d.until) || d.until <= today) return { ok: false, message: "Pick a date after today." };
    until = d.until;
  } else {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + Number(d.days));
    until = t.toISOString().slice(0, 10);
  }
  const ok = await snoozeChase({ type: "user", profileId: user.id }, d.task_id, until, d.reason);
  refresh();
  return ok ? { ok: true, message: "Snoozed.", savedAt: Date.now() } : { ok: false, message: "Someone else has already dealt with this one." };
}

export async function acceptChaseSuggestion(form: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = id.safeParse(form.get("task_id"));
  if (!taskId.success) return;
  const actor = { type: "user" as const, profileId: user.id };
  const [t] = await taskRule(taskId.data);
  if (t?.rule === "suggest_quote") {
    const r = await acceptQuoteSuggestion(actor, taskId.data);
    refresh();
    if (r.ok) redirect(`/deals/${r.dealId}`);
    return;
  }
  await acceptSuggestion(actor, taskId.data);
  refresh();
}

export async function dismissChaseItem(form: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = id.safeParse(form.get("task_id"));
  if (!taskId.success) return;
  const actor = { type: "user" as const, profileId: user.id };
  const [t] = await taskRule(taskId.data);
  if (t?.rule === "suggest_quote") await dismissQuoteSuggestion(actor, taskId.data);
  else await dismissChase(actor, taskId.data);
  refresh();
}

export type DraftState = {
  ok?: boolean;
  message?: string;
  warning?: string | null;
  subject?: string;
  body?: string;
  to?: string;
  link?: string;
  savedAt?: number;
};

/** Claude drafts (or re-drafts) the follow-up for a chase item. Takes a few seconds; nothing leaves the CRM. */
export async function draftChaseEmail(_prev: DraftState, form: FormData): Promise<DraftState> {
  const user = await requireUser();
  const taskId = id.safeParse(form.get("task_id"));
  if (!taskId.success) return { ok: false, message: "This item no longer exists." };
  try {
    const r = await draftChase({ id: user.id, displayName: user.displayName, email: user.email }, taskId.data);
    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, subject: r.draft.subject, body: r.draft.body, to: r.draft.to, warning: r.warning, savedAt: Date.now() };
  } catch {
    return { ok: false, message: "Claude couldn't draft this just now. Please try again in a minute." };
  }
}

const saveSchema = z.object({ task_id: z.uuid(), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) });

/** Save the reviewed draft to the user's own Outlook Drafts folder. The CRM never sends it. */
export async function saveDraftToOutlook(_prev: DraftState, form: FormData): Promise<DraftState> {
  const user = await requireUser();
  const parsed = saveSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "The draft needs a subject and some text." };
  const { task_id, subject, body } = parsed.data;
  try {
    const r = await saveChaseDraft({ type: "user", profileId: user.id }, task_id, { subject, body });
    if (!r.ok) return { ok: false, message: r.message, subject, body };
    refresh();
    return { ok: true, message: "Saved to your Outlook Drafts.", link: r.link, subject, body, savedAt: Date.now() };
  } catch (e) {
    const notConnected = e instanceof Error && /not connected|refresh access/i.test(e.message);
    return {
      ok: false,
      subject,
      body,
      message: notConnected ? "Your Outlook isn't connected: connect it under Outlook connection, then try again." : "Outlook didn't save the draft. Please try again.",
    };
  }
}
