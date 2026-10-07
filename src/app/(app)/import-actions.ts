"use server";

import { refresh } from "next/cache";
import { ZodError } from "zod";
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
