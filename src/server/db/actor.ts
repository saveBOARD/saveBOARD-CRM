import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "./client";

// Who is acting. The crm.audit_row and deal-stage triggers read these settings, so every write must
// go through withActor. Claude's writes are always recorded as actor_type 'claude' (CLAUDE.md).
export type Actor =
  | { type: "user"; profileId: string }
  | { type: "claude"; profileId?: string | null } // profileId: the user Claude is working for, if any
  | { type: "system"; reason: "import" | "erp_sync" | "mail_sync" };

export type ChangeReason = "manual" | "claude" | "import" | "erp_sync" | "mail_sync";

const uuid = z.uuid();

export function actorSettings(actor: Actor): { type: string; id: string; reason: ChangeReason } {
  switch (actor.type) {
    case "user":
      return { type: "user", id: uuid.parse(actor.profileId), reason: "manual" };
    case "claude":
      return { type: "claude", id: actor.profileId ? uuid.parse(actor.profileId) : "", reason: "claude" };
    case "system":
      return { type: "system", id: "", reason: actor.reason };
  }
}

/**
 * Run writes in one transaction with the actor set, so the audit log and stage history say who did it.
 * The settings are transaction-local (`set_config(..., true)`), so they never leak to another request
 * through the connection pool.
 */
export async function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const s = actorSettings(actor);
  return db().transaction(async (tx) => {
    await tx.execute(sql`
      select set_config('crm.actor_type', ${s.type}, true),
             set_config('crm.actor_id', ${s.id}, true),
             set_config('crm.change_reason', ${s.reason}, true)`);
    return fn(tx);
  });
}
