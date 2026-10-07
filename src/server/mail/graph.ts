import "server-only";
import { authStatus } from "@/server/auth/config";
import { loadRefreshToken, markNeedsReconnect, storeRotatedToken } from "./accounts";

// Microsoft Graph on behalf of a connected user (delegated permissions only). The CRM can read mail and create
// drafts; it never has permission to send (CLAUDE.md hard rule 4).

/** Scopes requested when a user clicks "Connect Outlook". Never add the send-mail permission. */
export const MAIL_SCOPES = "openid profile email offline_access User.Read Mail.ReadWrite";

export class MailNotConnected extends Error {
  constructor(message = "Outlook is not connected for this user") {
    super(message);
    this.name = "MailNotConnected";
  }
}

const cache = new Map<string, { token: string; expiresAt: number }>();

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

/** A short-lived access token for this user, refreshed from the stored (encrypted) refresh token when needed. */
export async function graphToken(profileId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const hit = cache.get(profileId);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const status = authStatus();
  if (!status.configured) throw new MailNotConnected("Sign-in settings are incomplete");
  const refresh = await loadRefreshToken(profileId);
  if (!refresh) throw new MailNotConnected();

  const res = await fetchImpl(`https://login.microsoftonline.com/${status.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? "",
      client_secret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refresh,
      scope: MAIL_SCOPES,
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as TokenResponse;
  if (!res.ok || !body.access_token) {
    const reason = `${body.error ?? res.status}: ${(body.error_description ?? "").split("\r\n")[0]}`;
    // invalid_grant = revoked, expired or password changed: the user must connect again.
    if (body.error === "invalid_grant" || body.error === "interaction_required") await markNeedsReconnect(profileId, reason);
    throw new MailNotConnected(`Microsoft refused to refresh access (${reason})`);
  }
  if (body.refresh_token) await storeRotatedToken(profileId, body.refresh_token);
  cache.set(profileId, { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

export function forgetGraphToken(profileId: string) {
  cache.delete(profileId);
}

/** GET a Graph path (e.g. "/me/mailFolders/inbox") as this user. */
export async function graphGet<T>(profileId: string, path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const token = await graphToken(profileId, fetchImpl);
  const res = await fetchImpl(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Microsoft Graph ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

/** A harmless read to prove the connection works: the Inbox folder's counts. */
export async function testMailConnection(profileId: string) {
  return graphGet<{ displayName: string; totalItemCount: number; unreadItemCount: number }>(
    profileId,
    "/me/mailFolders/inbox?$select=displayName,totalItemCount,unreadItemCount",
  );
}
