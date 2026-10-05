"use server";

import { refresh } from "next/cache";
import { ZodError } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { importHubspotContacts, type ImportResult } from "@/server/crm/imports";
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
