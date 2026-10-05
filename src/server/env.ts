import "server-only";
import { z } from "zod";

// Server environment. Read lazily so `next build` works without secrets.
// Hard rule 3 (CLAUDE.md): the app connects only as crm_app. Through the Supabase pooler the user name is
// `crm_app.<project-ref>`; locally it is plain `crm_app`. Anything else (postgres, service role) is refused.

export function isCrmAppUser(user: string): boolean {
  return user === "crm_app" || /^crm_app\.[a-z0-9]+$/.test(user);
}

export const databaseUrlSchema = z
  .string({ error: "CRM_DATABASE_URL is not set. Copy .env.example to .env.local and fill it in." })
  .refine((v) => /^postgres(ql)?:\/\//.test(v), "CRM_DATABASE_URL must be a postgres:// connection string")
  .refine((v) => {
    try {
      return isCrmAppUser(decodeURIComponent(new URL(v).username));
    } catch {
      return false;
    }
  }, "CRM_DATABASE_URL must connect as crm_app (never postgres or the service role)");

let cached: { raw: string | undefined; databaseUrl: string } | undefined;

export function serverEnv() {
  // Re-check if the value changed (in dev, .env.local is reloaded after `npm run db:reset` sets a new password).
  const raw = process.env.CRM_DATABASE_URL;
  if (!cached || cached.raw !== raw) cached = { raw, databaseUrl: databaseUrlSchema.parse(raw) };
  return { databaseUrl: cached.databaseUrl };
}
