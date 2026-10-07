import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rows } from "@/server/db/client";
import { deleteMailAccount, getMailAccount, loadRefreshToken, saveMailAccount } from "./accounts";
import { forgetGraphToken, graphGet, graphToken, MAIL_SCOPES, MailNotConnected, testMailConnection } from "./graph";

// Outlook connections as crm_app, with a fake Microsoft token endpoint. Uses a throwaway profile.

let profileId = "";
const user = () => ({ type: "user" as const, profileId });

beforeAll(async () => {
  vi.stubEnv("MAIL_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("AUTH_SECRET", "s");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ID", "client-id");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_SECRET", "client-secret");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ISSUER", "https://login.microsoftonline.com/6a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d/v2.0");
  await rows(sql`delete from crm.profiles where display_name = 'TEST Mail User'`);
  [{ id: profileId }] = await rows<{ id: string }>(
    sql`insert into crm.profiles (display_name, email, role) values ('TEST Mail User', 'test.mail@saveboard.example', 'user') returning id`,
  );
});
afterAll(async () => {
  await rows(sql`delete from crm.profiles where display_name = 'TEST Mail User'`);
  vi.unstubAllEnvs();
});

function fakeMicrosoft(response: object, status = 200) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    void init;
    return new Response(JSON.stringify(response), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("Outlook connection", () => {
  it("stores the refresh token encrypted, and gives pages status only", async () => {
    await saveMailAccount(user(), profileId, "test.mail@saveboard.example", "refresh-ONE", "openid Mail.ReadWrite offline_access");
    const [raw] = await rows<{ refresh_token_enc: string }>(sql`select refresh_token_enc from crm.mail_accounts where profile_id = ${profileId}`);
    expect(raw.refresh_token_enc.startsWith("v1:")).toBe(true);
    expect(raw.refresh_token_enc).not.toContain("refresh-ONE");
    expect(await loadRefreshToken(profileId)).toBe("refresh-ONE");
    const status = await getMailAccount(profileId);
    expect(status).toMatchObject({ status: "connected", mailbox: "test.mail@saveboard.example" });
    expect(status).not.toHaveProperty("refresh_token_enc");
    expect(JSON.stringify(status)).not.toContain("refresh-ONE");
  });

  it("refreshes access with the stored token, keeps Microsoft's new one, and caches the access token", async () => {
    forgetGraphToken(profileId);
    const fake = fakeMicrosoft({ access_token: "access-1", refresh_token: "refresh-TWO", expires_in: 3600 });
    expect(await graphToken(profileId, fake)).toBe("access-1");
    expect(await graphToken(profileId, fake)).toBe("access-1"); // cached: no second call
    expect(fake).toHaveBeenCalledTimes(1);

    const [url, init] = fake.mock.calls[0];
    expect(String(url)).toBe("https://login.microsoftonline.com/6a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d/oauth2/v2.0/token");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-ONE");
    expect(body.get("scope")).toBe(MAIL_SCOPES);
    expect(body.get("scope")).not.toMatch(/send/i);

    expect(await loadRefreshToken(profileId)).toBe("refresh-TWO");
    expect((await getMailAccount(profileId))?.last_refresh_at).not.toBeNull();
  });

  it("marks the connection for reconnecting when Microsoft revokes it", async () => {
    forgetGraphToken(profileId);
    const fake = fakeMicrosoft({ error: "invalid_grant", error_description: "AADSTS700082: The refresh token has expired.\r\nTrace ID: x" }, 400);
    await expect(graphToken(profileId, fake)).rejects.toBeInstanceOf(MailNotConnected);
    expect(await getMailAccount(profileId)).toMatchObject({ status: "needs_reconnect", last_error: "invalid_grant: AADSTS700082: The refresh token has expired." });
    // Until reconnected, nothing is tried.
    await expect(graphToken(profileId, fakeMicrosoft({}))).rejects.toThrow(/not connected/);
  });

  it("the connection test reads Inbox counts and says which shared mailboxes can be opened", async () => {
    await saveMailAccount(user(), profileId, "test.mail@saveboard.example", "refresh-S", "Mail.ReadWrite Mail.Read.Shared");
    forgetGraphToken(profileId);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    const fake = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("login.microsoftonline.com")) return json({ access_token: "a", expires_in: 3600 });
      if (url.includes("sales%40saveboard.com.au")) return json({ error: { code: "ErrorAccessDenied" } }, 403);
      return json({ displayName: "Inbox", totalItemCount: 12, unreadItemCount: 1 });
    }) as unknown as typeof fetch;
    const r = await testMailConnection(profileId, fake);
    expect(r.totalItemCount).toBe(12);
    expect(r.shared).toEqual([
      { entity: "NZ", address: "enquiries@saveboard.nz", ok: true, total: 12 },
      { entity: "AUS", address: "sales@saveboard.com.au", ok: false, problem: "ErrorAccessDenied" },
    ]);
    expect(MAIL_SCOPES.split(" ")).toContain("Mail.Read.Shared");
  });

  it("waits and retries once when Microsoft throttles (ApplicationThrottled)", async () => {
    let graphCalls = 0;
    const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...headers } });
    const fake = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("login.microsoftonline.com")) return json({ access_token: "a", expires_in: 3600 });
      graphCalls++;
      return graphCalls === 1
        ? json({ error: { code: "ApplicationThrottled" } }, 429, { "Retry-After": "0" })
        : json({ displayName: "Inbox", totalItemCount: 3, unreadItemCount: 0 });
    }) as unknown as typeof fetch;
    const r = await graphGet<{ totalItemCount: number }>(profileId, "/me/mailFolders/inbox", fake);
    expect(r.totalItemCount).toBe(3);
    expect(graphCalls).toBe(2);
  });

  it("reconnecting clears the problem; disconnecting removes the token", async () => {
    await saveMailAccount(user(), profileId, "test.mail@saveboard.example", "refresh-THREE", "Mail.ReadWrite");
    expect(await getMailAccount(profileId)).toMatchObject({ status: "connected", last_error: null });
    await deleteMailAccount(user(), profileId);
    expect(await getMailAccount(profileId)).toBeNull();
    expect(await loadRefreshToken(profileId)).toBeNull();
  });
});
