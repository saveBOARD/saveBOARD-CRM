import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";

// Follow-up thresholds live in crm.settings (CLAUDE.md: change them there, never hard-code them).
export async function settingInt(key: "stale_days" | "quote_expiry_warning_days" | "first_response_hours" | "customer_checkin_days" | "specifier_followup_days") {
  const [r] = await rows<{ v: number | null }>(sql`select crm.setting_int(${key}) as v`);
  return r?.v ?? null;
}
