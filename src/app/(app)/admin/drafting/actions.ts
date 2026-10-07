"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { requireAdmin } from "@/server/auth/session";
import { saveVoiceExamples } from "@/server/crm/settings";

export async function saveVoice(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const text = String(form.get("examples") ?? "").trim();
  if (text.length > 20_000) return { ok: false, message: "That's too long: keep it to 3 to 5 emails." };
  await saveVoiceExamples({ type: "user", profileId: user.id }, text);
  refresh();
  return { ok: true, message: "Saved. New drafts will use these.", savedAt: Date.now() };
}
