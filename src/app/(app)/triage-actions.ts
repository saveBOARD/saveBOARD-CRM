"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { requireUser } from "@/server/auth/session";
import { addSenderAsContact, ignoreSender, removeIgnoreRule, type IgnoreScope } from "@/server/mail/triage";

// Inbox triage: a person decides what happens to email from unknown senders. Nothing is created without a click.

const addSchema = z.object({
  address: z.email().max(320),
  first_name: z.string().trim().max(100).transform((s) => s || null),
  last_name: z.string().trim().max(100).transform((s) => s || null),
  company: z.enum(["existing", "new", "none"]),
  company_id: z.string().optional(),
  company_name: z.string().trim().max(200).optional(),
});

export async function addTriageContact(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = addSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Please check the name and company." };
  const d = parsed.data;
  let company: { existingId: string } | { newName: string } | null = null;
  if (d.company === "existing") {
    if (!z.uuid().safeParse(d.company_id).success) return { ok: false, message: "That company no longer exists." };
    company = { existingId: d.company_id! };
  }
  if (d.company === "new") {
    if (!d.company_name) return { ok: false, message: "Enter the new company's name, or choose no company." };
    company = { newName: d.company_name };
  }
  await addSenderAsContact({ type: "user", profileId: user.id }, { address: d.address, first_name: d.first_name, last_name: d.last_name, company });
  revalidatePath("/contacts");
  refresh();
  return { ok: true, message: "Added as a contact.", savedAt: Date.now() };
}

const ignoreSchema = z.object({ address: z.email().max(320), scope: z.enum(["once", "address", "domain"]) });

export async function ignoreTriageSender(form: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = ignoreSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return;
  await ignoreSender({ type: "user", profileId: user.id }, parsed.data.address, parsed.data.scope as IgnoreScope);
  refresh();
}

export async function removeIgnore(form: FormData): Promise<void> {
  const user = await requireUser();
  const pattern = String(form.get("pattern") ?? "");
  if (!pattern) return;
  await removeIgnoreRule({ type: "user", profileId: user.id }, pattern);
  refresh();
}
