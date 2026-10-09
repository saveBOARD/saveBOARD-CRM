"use server";

import { refresh } from "next/cache";
import { z, ZodError } from "zod";
import { requireAdmin } from "@/server/auth/session";
import {
  importEmailEvents,
  importHubspotContacts,
  importNotes,
  type EmailEventsResult,
  type ImportResult,
  type NotesResult,
} from "@/server/crm/imports";
import { suggestMatches } from "@/server/crm/matches";
import { importVisitFile, previewVisitFile, type VisitFileMeta, type VisitImportResult, type VisitPreview } from "@/server/visits/import";
import { REGIONS } from "@/server/visits/parse";

export type ImportOutcome = { ok: true; result: ImportResult; suggestions: number } | { ok: false; message: string };

/** Load the HubSpot contacts export (already parsed and mapped in the browser). Admins only. */
export async function importContacts(fileName: string, rows: unknown): Promise<ImportOutcome> {
  const admin = await requireAdmin();
  try {
    const result = await importHubspotContacts(admin.id, String(fileName), rows);
    const suggestions = await suggestMatches({ type: "user", profileId: admin.id });
    refresh();
    return { ok: true, result, suggestions };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, message: e.issues[0]?.message ?? "The file doesn't look right." };
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : "Unknown error";
    return { ok: false, message: `Nothing was loaded: ${cause}` };
  }
}

export type NotesOutcome = { ok: true; result: NotesResult } | { ok: false; message: string };
export type EmailEventsOutcome = { ok: true; result: EmailEventsResult } | { ok: false; message: string };

function failure(e: unknown): { ok: false; message: string } {
  if (e instanceof ZodError) return { ok: false, message: e.issues[0]?.message ?? "The file doesn't look right." };
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : "Unknown error";
  return { ok: false, message: `Nothing was loaded: ${cause}` };
}

/** Load the HubSpot notes export (parsed and mapped in the browser). Admins only. */
export async function importNotesAction(fileName: string, rows: unknown): Promise<NotesOutcome> {
  const admin = await requireAdmin();
  try {
    const result = await importNotes(admin.id, String(fileName), rows);
    refresh();
    return { ok: true, result };
  } catch (e) {
    return failure(e);
  }
}

/** Load HubSpot email campaign results as unsubscribes and bounces (classified in the browser). Admins only. */
export async function importEmailEventsAction(fileNames: string, suppressions: unknown, stats: unknown): Promise<EmailEventsOutcome> {
  const admin = await requireAdmin();
  try {
    const result = await importEmailEvents(admin.id, String(fileNames), suppressions, stats);
    refresh();
    return { ok: true, result };
  } catch (e) {
    return failure(e);
  }
}

export type VisitCheck = { ok: true; preview: VisitPreview } | { ok: false; message: string };
export type VisitOutcome = { ok: true; result: VisitImportResult } | { ok: false; message: string };

const visitMeta = z.object({
  region: z.enum(REGIONS),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the report's month."),
  follow_ups: z.enum(["on", "off"]),
});

/** One consultant visit report from the form: the file and its region, month and follow-up choice. */
async function readVisitForm(form: FormData, regionNeeded = true): Promise<{ data: ArrayBuffer; meta: VisitFileMeta } | { message: string }> {
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) return { message: "Choose an Excel (.xlsx) report." };
  if (file.size > 3_000_000) return { message: `${file.name} is too big for a visit report.` };
  // A check can run before the region is chosen (the layout it finds pre-fills the region); an import can't.
  const region = form.get("region") || (regionNeeded ? null : "Northern");
  const m = visitMeta.safeParse({ region, month: form.get("month"), follow_ups: form.get("follow_ups") });
  if (!m.success) return { message: `${file.name}: ${m.error.issues[0]?.message ?? "pick the region and month."}` };
  return {
    data: await file.arrayBuffer(),
    meta: { fileName: file.name.slice(0, 200), region: m.data.region, month: `${m.data.month}-01`, followUps: m.data.follow_ups === "on" },
  };
}

/** What uploading this report would do. Nothing is saved. Admins only. */
export async function checkVisitReport(form: FormData): Promise<VisitCheck> {
  await requireAdmin();
  const f = await readVisitForm(form, false);
  if ("message" in f) return { ok: false, message: f.message };
  try {
    return { ok: true, preview: await previewVisitFile(f.data, f.meta) };
  } catch (e) {
    return { ok: false, message: `${f.meta.fileName}: ${e instanceof Error ? e.message : "couldn't be read."}` };
  }
}

/** Upload one consultant visit report. Admins only. */
export async function importVisitReport(form: FormData): Promise<VisitOutcome> {
  const user = await requireAdmin();
  const f = await readVisitForm(form);
  if ("message" in f) return { ok: false, message: f.message };
  try {
    const result = await importVisitFile({ type: "user", profileId: user.id }, f.data, f.meta);
    refresh();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: `${f.meta.fileName}: ${e instanceof Error ? e.message : "the upload failed."}` };
  }
}
