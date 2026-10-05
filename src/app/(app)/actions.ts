"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { isUuid } from "@/lib/ids";
import { requireAdmin, requireUser } from "@/server/auth/session";
import { companySchema, contactSchema, fieldErrors, formObject, noteSchema } from "@/server/crm/schemas";
import {
  addNote,
  createCompany,
  createContact,
  findCompanyDuplicates,
  findContactByEmail,
  searchCompanies,
  softDelete,
  updateCompany,
  updateContact,
} from "@/server/crm/writes";

// Server actions for companies, contacts and notes. Each one: check the user, validate, write via withActor.

const CHECK_FAILED: ActionState = { message: "Please check the highlighted fields." };

export async function saveCompany(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = form.get("id");
  if (id !== null && !isUuid(id)) return { message: "This company no longer exists." };

  const values = formObject(form) as Record<string, string>;
  const parsed = companySchema.safeParse(values);
  if (!parsed.success) return { ...CHECK_FAILED, fieldErrors: fieldErrors(parsed.error), values };

  if (form.get("confirm_duplicate") !== "yes") {
    const duplicates = await findCompanyDuplicates(parsed.data, id ?? undefined);
    if (duplicates.length > 0) {
      return { duplicates, message: "This looks like a company that is already in the CRM.", values };
    }
  }

  const companyId = id ?? (await createCompany({ type: "user", profileId: user.id }, parsed.data));
  if (id) await updateCompany({ type: "user", profileId: user.id }, id, parsed.data);
  revalidatePath("/companies");
  redirect(`/companies/${companyId}`);
}

export async function saveContact(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = form.get("id");
  if (id !== null && !isUuid(id)) return { message: "This contact no longer exists." };

  const values = formObject(form, ["samples_sent", "track_followup"]) as Record<string, string | boolean>;
  values.company_name = String(form.get("company_name") ?? "");
  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) return { ...CHECK_FAILED, fieldErrors: fieldErrors(parsed.error), values };

  // Emails are unique: point to the existing contact instead of failing.
  if (parsed.data.email) {
    const existing = await findContactByEmail(parsed.data.email, id ?? undefined);
    if (existing) {
      return { fieldErrors: { email: "Another contact already uses this email." }, duplicates: [existing], message: CHECK_FAILED.message, values };
    }
  }

  const contactId = id ?? (await createContact({ type: "user", profileId: user.id }, parsed.data));
  if (id) await updateContact({ type: "user", profileId: user.id }, id, parsed.data);
  revalidatePath("/contacts");
  redirect(`/contacts/${contactId}`);
}

export async function saveNote(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const target = {
    companyId: form.get("company_id"),
    contactId: form.get("contact_id"),
    dealId: form.get("deal_id"),
  };
  const ids = Object.fromEntries(Object.entries(target).filter(([, v]) => v !== null && v !== ""));
  if (Object.keys(ids).length === 0 || !Object.values(ids).every(isUuid)) return { message: "Can't tell what this note is about." };

  const values = formObject(form) as Record<string, string>;
  const parsed = noteSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  await addNote({ type: "user", profileId: user.id }, ids as { companyId?: string; contactId?: string; dealId?: string }, parsed.data);
  refresh();
  return { ok: true, message: "Note added.", savedAt: Date.now() };
}

export async function deleteRecord(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const table = form.get("table");
  const id = form.get("id");
  if ((table !== "companies" && table !== "contacts") || !isUuid(id)) return;
  await softDelete({ type: "user", profileId: admin.id }, table, id);
  revalidatePath(`/${table}`);
  redirect(`/${table}`);
}

/** Company look-up for the contact form. */
export async function findCompanies(q: string) {
  await requireUser();
  return searchCompanies(String(q).slice(0, 100));
}
