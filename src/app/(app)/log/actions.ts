"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { isUuid } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { confirmCallNote, createCallNote, discardCallNote, openDealsFor, type ConfirmInput, type OpenDeal } from "@/server/crm/calls";

// Log a call (phase 4.1-4.2): save the note (Claude reads it), then the person confirms on /log/[id].

export async function submitCallNote(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const note = String(form.get("note") ?? "").trim();
  if (note.length < 5) return { ok: false, message: "Say or type a few words about the call first.", values: { note } };
  const contactId = form.get("contact_id");
  const dealId = form.get("deal_id");
  const id = await createCallNote(
    { id: user.id, displayName: user.displayName },
    { note, contactId: isUuid(contactId) ? contactId : null, dealId: isUuid(dealId) ? dealId : null },
  );
  redirect(`/log/${id}`);
}

/** Open deals for a contact chosen on the confirm screen. */
export async function dealsForContact(contactId: string): Promise<OpenDeal[]> {
  await requireUser();
  return isUuid(contactId) ? openDealsFor(contactId) : [];
}

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => s || null);

const confirmSchema = z.object({
  note_id: z.uuid(),
  summary: z.string().trim().min(1, "The summary can't be empty.").max(2000),
  contact_mode: z.enum(["existing", "new"]),
  contact_id: z.string().optional(),
  new_first_name: opt(100),
  new_last_name: opt(100),
  new_company: opt(200),
  new_phone: opt(50),
  new_email: z
    .union([z.email(), z.literal("")])
    .optional()
    .transform((s) => s || null),
  deal_mode: z.enum(["existing", "new", "none"]),
  deal_id: z.string().optional(),
  new_deal_title: opt(200),
  new_deal_entity: z.enum(["NZ", "AUS"]).optional(),
  next_step: opt(300),
  follow_up_on: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
    .optional()
    .transform((s) => s || null),
  apply_stage: z.string().optional(),
  stage: z.string().optional(),
});

export async function confirmCall(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const values = Object.fromEntries(form) as Record<string, string>;
  const parsed = confirmSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the form.", values };
  const d = parsed.data;

  let contact: ConfirmInput["contact"];
  if (d.contact_mode === "existing") {
    if (!isUuid(d.contact_id)) return { ok: false, message: "Choose who the call was with.", values };
    contact = { id: d.contact_id };
  } else {
    if (!d.new_first_name && !d.new_last_name) return { ok: false, message: "Give the new contact a name.", values };
    contact = { new: { first_name: d.new_first_name, last_name: d.new_last_name, company: d.new_company, phone: d.new_phone, email: d.new_email } };
  }
  let deal: ConfirmInput["deal"] = null;
  if (d.deal_mode === "existing") {
    if (!isUuid(d.deal_id)) return { ok: false, message: "Choose the deal, or pick no deal.", values };
    deal = { id: d.deal_id };
  }
  if (d.deal_mode === "new") {
    if (!d.new_deal_title || !d.new_deal_entity) return { ok: false, message: "Give the new deal a name and NZ or AUS.", values };
    deal = { new: { title: d.new_deal_title, entity: d.new_deal_entity } };
  }

  let result: { contactId: string; dealId: string | null };
  try {
    result = await confirmCallNote({ type: "user", profileId: user.id }, d.note_id, {
      summary: d.summary,
      contact,
      deal,
      nextStep: d.next_step,
      followUpOn: d.follow_up_on,
      stage: d.apply_stage === "on" && d.stage ? d.stage : null,
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The call couldn't be saved.", values };
  }
  revalidatePath("/");
  redirect(result.dealId ? `/deals/${result.dealId}` : `/contacts/${result.contactId}`);
}

export async function discardCall(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = form.get("note_id");
  if (isUuid(id)) await discardCallNote({ type: "user", profileId: user.id }, id);
  redirect("/log");
}
