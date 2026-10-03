// Sign-in settings. When any are missing (e.g. a fresh Vercel project) the app stays locked: every page
// redirects to /signin, which says sign-in is not set up. Nothing is reachable without a signed-in user.

const ISSUER = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0\/?$/i;

export const AUTH_ENV = [
  "AUTH_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_ISSUER",
] as const;

export type AuthStatus = { configured: true; tenantId: string } | { configured: false; problems: string[] };

export function authStatus(env: Record<string, string | undefined> = process.env): AuthStatus {
  const problems: string[] = AUTH_ENV.filter((k) => !env[k]).map((k) => `${k} is not set`);
  const issuer = env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  const tenantId = issuer ? ISSUER.exec(issuer)?.[1] : undefined;
  // Single tenant only: the "common" and "organizations" endpoints would let any Microsoft account try to sign in.
  if (issuer && !tenantId) {
    problems.push("AUTH_MICROSOFT_ENTRA_ID_ISSUER must be https://login.microsoftonline.com/<tenant id>/v2.0");
  }
  return problems.length || !tenantId ? { configured: false, problems } : { configured: true, tenantId: tenantId.toLowerCase() };
}
