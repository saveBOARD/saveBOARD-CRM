"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { isUuid } from "@/lib/ids";
import { requireAdmin } from "@/server/auth/session";
import { acceptMatch, linkCompany, rejectMatch, suggestMatches, unlinkCompany } from "@/server/crm/matches";
import { getErpCustomer, searchErpCustomers, type Entity } from "@/server/erp";

// ERP linking (admins only, decision 2 of the phase 2 plan). Links are CRM records; the ERP is never changed.

const isEntity = (v: unknown): v is Entity => v === "NZ" || v === "AUS";

export async function runSuggestMatches(): Promise<ActionState> {
  const admin = await requireAdmin();
  const n = await suggestMatches({ type: "user", profileId: admin.id });
  refresh();
  return { ok: true, message: n === 0 ? "No new suggestions." : `${n} suggestion(s) added or updated.`, savedAt: Date.now() };
}

export async function reviewMatch(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = form.get("candidate_id");
  const decision = form.get("decision");
  if (!isUuid(id)) return;
  if (decision === "accept") await acceptMatch({ type: "user", profileId: admin.id }, id);
  if (decision === "reject") await rejectMatch({ type: "user", profileId: admin.id }, id);
  refresh();
}

export async function linkErpCustomer(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const companyId = form.get("company_id");
  const entity = form.get("entity");
  const customerId = form.get("erp_customer_id");
  if (!isUuid(companyId) || !isEntity(entity)) return { message: "Something went wrong: reload the page and try again." };
  if (!isUuid(customerId)) return { fieldErrors: { erp_customer_id: "Pick an ERP customer from the list." } };
  if (!(await getErpCustomer(entity, customerId))) return { message: `That customer isn't in the ${entity} ERP (or was deleted).` };

  const r = await linkCompany({ type: "user", profileId: admin.id }, companyId, entity, customerId);
  if (!r.ok) return { message: r.reason };
  refresh();
  return { ok: true, message: "Linked.", savedAt: Date.now() };
}

export async function unlinkErpCustomer(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const companyId = form.get("company_id");
  const entity = form.get("entity");
  if (!isUuid(companyId) || !isEntity(entity)) return;
  await unlinkCompany({ type: "user", profileId: admin.id }, companyId, entity);
  refresh();
}

export async function findErpCustomers(entity: string, q: string) {
  await requireAdmin();
  if (!isEntity(entity)) return [];
  return searchErpCustomers(entity, String(q).slice(0, 100));
}
