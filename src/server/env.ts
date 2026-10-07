import "server-only";
import { z } from "zod";

// Server environment. Read lazily so `next build` works without secrets.
// Hard rule 3 (CLAUDE.md): the app connects only as crm_app. Through the Supabase pooler the user name is
// `crm_app.<project-ref>`; locally it is plain `crm_app`. Anything else (postgres, service role) is refused.

export function isCrmAppUser(user: string): boolean {
  return user === "crm_app" || /^crm_app\.[a-z0-9]+$/.test(user);
}

// Messages name what is wrong (and the user found, which is not secret) but never echo the password.
export const databaseUrlSchema = z
  .string({ error: "CRM_DATABASE_URL is not set. Copy .env.example to .env.local and fill it in." })
  .trim()
  .superRefine((v, ctx) => {
    if (!/^postgres(ql)?:\/\//.test(v)) {
      ctx.addIssue({ code: "custom", message: "CRM_DATABASE_URL must start with postgresql://" });
      return;
    }
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "CRM_DATABASE_URL is not a valid connection string (often a symbol such as @ # / ? : in the password: use letters and digits only)",
      });
      return;
    }
    const user = decodeURIComponent(url.username);
    if (!isCrmAppUser(user)) {
      ctx.addIssue({
        code: "custom",
        message: `CRM_DATABASE_URL connects as "${user || "(no user)"}" but must connect as crm_app (through the pooler: crm_app.<project-ref>), never postgres or the service role`,
      });
    }
  });

let cached: { raw: string | undefined; databaseUrl: string } | undefined;

export function serverEnv() {
  // Re-check if the value changed (in dev, .env.local is reloaded after `npm run db:reset` sets a new password).
  const raw = process.env.CRM_DATABASE_URL;
  if (!cached || cached.raw !== raw) cached = { raw, databaseUrl: databaseUrlSchema.parse(raw) };
  return { databaseUrl: cached.databaseUrl };
}
