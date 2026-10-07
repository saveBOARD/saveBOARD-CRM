"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { toLocalDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { acceptSuggestion, completeChase, dismissChase, snoozeChase } from "@/server/crm/chase";

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
  if (taskId.success) await acceptSuggestion({ type: "user", profileId: user.id }, taskId.data);
  refresh();
}

export async function dismissChaseItem(form: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = id.safeParse(form.get("task_id"));
  if (taskId.success) await dismissChase({ type: "user", profileId: user.id }, taskId.data);
  refresh();
}
