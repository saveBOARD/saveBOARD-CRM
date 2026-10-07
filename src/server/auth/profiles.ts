import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withActor } from "@/server/db/actor";

// Who may sign in: an active crm.profiles row whose email matches the Microsoft account.
// On first sign-in the account's Entra object id (oid) is saved; after that the oid must match, so a reused
// or renamed mailbox cannot take over someone else's profile.

export type Role = "admin" | "user";
export type Profile = { id: string; displayName: string; email: string; role: Role };

type Row = { id: string; display_name: string; email: string; role: Role; microsoft_oid: string | null };

const toProfile = (r: Row): Profile => ({ id: r.id, displayName: r.display_name, email: r.email, role: r.role });

/** Match a Microsoft sign-in to a CRM user, claiming the profile on first sign-in. Null means "not allowed". */
export async function claimProfile(emails: string[], oid: string): Promise<Profile | null> {
  const candidates = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (candidates.length === 0 || !oid) return null;

  const rows = (await db().execute(sql`
    select id, display_name, email, role, microsoft_oid from crm.profiles
    where active and email is not null and lower(email) in ${candidates}`)) as unknown as Row[];
  if (rows.length !== 1) return null;

  const row = rows[0];
  if (row.microsoft_oid && row.microsoft_oid !== oid) return null;
  if (!row.microsoft_oid) {
    await withActor({ type: "user", profileId: row.id }, (tx) =>
      tx.execute(sql`update crm.profiles set microsoft_oid = ${oid} where id = ${row.id} and microsoft_oid is null`),
    );
  }
  return toProfile(row);
}

/** The active profile already claimed by this Microsoft account (after claimProfile succeeded at sign-in). */
export async function profileByOid(oid: string): Promise<Profile | null> {
  if (!oid) return null;
  const rows = (await db().execute(sql`
    select id, display_name, email, role, microsoft_oid from crm.profiles
    where microsoft_oid = ${oid} and active`)) as unknown as Row[];
  return rows[0] ? toProfile(rows[0]) : null;
}

/** The signed-in user's profile if it is still active (checked on every request, so deactivation is immediate). */
export async function activeProfile(id: string): Promise<Profile | null> {
  const rows = (await db().execute(sql`
    select id, display_name, email, role, microsoft_oid from crm.profiles
    where id = ${id} and active`)) as unknown as Row[];
  return rows[0] ? toProfile(rows[0]) : null;
}
