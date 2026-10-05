"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { isUuid } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { createDeal, findDealByErpNumber, moveDeal, snoozeDeal, updateDeal } from "@/server/crm/deals";
import { dealSchema, fieldErrors, formObject, moveSchema, snoozeSchema } from "@/server/crm/schemas";
import { searchContacts } from "@/server/crm/writes";

// Deal actions: every user can create, edit and move deals (phase 2 decision 2). Writes go through withActor.

export async function saveDeal(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = form.get("id");
  if (id !== null && !isUuid(id)) return { message: "This deal no longer exists." };

  const values = formObject(form) as Record<string, string>; // includes the *_label fields, to refill pickers
  const parsed = dealSchema.safeParse(values);
  if (!parsed.success) return { message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error), values };

  const d = parsed.data;
  if (d.erp_so_number) {
    const other = await findDealByErpNumber(d.entity, d.erp_so_number, id ?? undefined);
    if (other) {
      return {
        message: "Please check the highlighted fields.",
        fieldErrors: { erp_so_number: `${d.erp_so_number} is already on another deal.` },
        duplicates: [{ id: other.id, label: other.title, href: `/deals/${other.id}`, reason: "same ERP number" }],
        values,
      };
    }
  }

  const actor = { type: "user" as const, profileId: user.id };
  const dealId = id ?? (await createDeal(actor, d));
  if (id) await updateDeal(actor, id, d);
  revalidatePath("/deals");
  redirect(`/deals/${dealId}`);
}

/** Move a deal (board drag and drop, "Move to…", or the deal page). */
export async function moveDealStage(dealId: string, stage: string, lostReason = ""): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(dealId)) return { message: "This deal no longer exists." };
  const parsed = moveSchema.safeParse({ stage, lost_reason: lostReason });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), message: "Not moved." };
  await moveDeal({ type: "user", profileId: user.id }, dealId, parsed.data.stage, parsed.data.lost_reason);
  refresh();
  return { ok: true, savedAt: Date.now() };
}

export async function snoozeDealAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = form.get("id");
  if (!isUuid(id)) return { message: "This deal no longer exists." };
  const wake = form.get("wake") === "1";
  const parsed = snoozeSchema.safeParse(formObject(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { snoozed_until, snooze_reason } = parsed.data;
  if (!wake) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
    if (!snoozed_until || snoozed_until <= today) return { fieldErrors: { snoozed_until: "Pick a date after today" } };
    if (!snooze_reason) return { fieldErrors: { snooze_reason: "Say why, so the chase list stays trusted" } };
  }
  await snoozeDeal({ type: "user", profileId: user.id }, id, wake ? null : snoozed_until, wake ? null : snooze_reason);
  refresh();
  return { ok: true, message: wake ? "Snooze removed." : "Snoozed.", savedAt: Date.now() };
}

export async function findContacts(q: string, companyId?: string | null) {
  await requireUser();
  return searchContacts(String(q).slice(0, 100), isUuid(companyId) ? companyId : null);
}
