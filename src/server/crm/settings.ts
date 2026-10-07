import "server-only";
import { sql } from "drizzle-orm";
import { rows } from "@/server/db/client";

// Follow-up thresholds live in crm.settings (CLAUDE.md: change them there, never hard-code them).
export type IntSetting =
  | "stale_days"
  | "quote_expiry_warning_days"
  | "first_response_hours"
  | "first_response_business_days"
  | "customer_checkin_days"
  | "customer_checkin_recent_order_days"
  | "specifier_followup_days";

export async function settingInt(key: IntSetting) {
  const [r] = await rows<{ v: number | null }>(sql`select crm.setting_int(${key}) as v`);
  return r?.v ?? null;
}

/** The chase thresholds, for wording on the Today page and in the digest. */
export async function chaseSettings() {
  const [r] = await rows<{ stale: number; qexp: number; frd: number; cci: number }>(sql`
    select crm.setting_int('stale_days') as stale, crm.setting_int('quote_expiry_warning_days') as qexp,
           coalesce(crm.setting_int('first_response_business_days'), 1) as frd, crm.setting_int('customer_checkin_days') as cci`);
  return r;
}
