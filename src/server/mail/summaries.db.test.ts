import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import type { EmailForSummary, Summariser } from "@/server/claude/summarise";
import { saveMailAccount } from "./accounts";
import { forgetGraphToken } from "./graph";
import { runSummaries, summaryStatus } from "./summaries";

// Claude summaries as crm_app, with a fake Outlook and a fake Claude. Own rows: *.sumtest.test, '<sumtest-...>'.

const SYS = { type: "system" as const, reason: "import" as const };
let ownerId = "";
let dealOwnerId = "";
let janeId = "";
let bobId = "";
let dealId = "";

async function cleanup() {
  await withActor(SYS, async (tx) => {
    await tx.execute(sql`delete from crm.tasks where title like 'TEST S %' or contact_id in (select id from crm.contacts where email like '%sumtest.test')`);
    await tx.execute(sql`delete from crm.activities where external_id like '<sumtest-%'`);
    await tx.execute(sql`delete from crm.deals where title like 'TEST S %'`);
    await tx.execute(sql`delete from crm.contacts where email like '%sumtest.test'`);
    await tx.execute(sql`delete from crm.profiles where display_name in ('TEST Sum Owner', 'TEST Sum Deal Owner')`);
  });
}

beforeAll(async () => {
  vi.stubEnv("MAIL_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("AUTH_SECRET", "s");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ID", "client-id");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_SECRET", "client-secret");
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ISSUER", "https://login.microsoftonline.com/6a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d/v2.0");
  await cleanup();
  await withActor(SYS, async (tx) => {
    [{ id: ownerId }] = await rows<{ id: string }>(sql`insert into crm.profiles (display_name, email) values ('TEST Sum Owner', 'sum.owner@saveboard.nz') returning id`, tx);
    [{ id: dealOwnerId }] = await rows<{ id: string }>(sql`insert into crm.profiles (display_name, email) values ('TEST Sum Deal Owner', 'sum.deal@saveboard.nz') returning id`, tx);
    [{ id: janeId }] = await rows<{ id: string }>(sql`insert into crm.contacts (first_name, email) values ('Jane', 'jane@a.sumtest.test') returning id`, tx);
    [{ id: bobId }] = await rows<{ id: string }>(sql`insert into crm.contacts (first_name, email) values ('Bob', 'bob@a.sumtest.test') returning id`, tx);
    [{ id: dealId }] = await rows<{ id: string }>(
      sql`insert into crm.deals (title, primary_contact_id, entity, owner_id) values ('TEST S Job', ${janeId}, 'NZ', ${dealOwnerId}) returning id`,
      tx,
    );
  });
  await saveMailAccount({ type: "user", profileId: ownerId }, ownerId, "sum.owner@saveboard.nz", "refresh-1", "Mail.ReadWrite");
  forgetGraphToken(ownerId);
});
afterAll(async () => {
  await cleanup();
  vi.unstubAllEnvs();
});

async function logEmail(n: number, opts: { contacts: string[]; deal?: string | null; messageId?: string | null; direction?: "inbound" | "outbound" }) {
  await withActor(SYS, async (tx) => {
    for (const c of opts.contacts) {
      await tx.execute(sql`
        insert into crm.activities (type, direction, subject, occurred_at, contact_id, deal_id, owner_id, origin, external_id, metadata)
        values ('email', ${opts.direction ?? "inbound"}, ${`Subject ${n}`}, '2026-10-07T21:00:00Z', ${c}, ${opts.deal ?? null}, ${ownerId}, 'graph',
                ${`<sumtest-${n}@x>|${c}`},
                ${JSON.stringify({ mailbox: "sum.owner@saveboard.nz", folder: "inbox", message_id: opts.messageId === undefined ? `msg${n}` : opts.messageId })}::jsonb)`);
    }
  });
}

const SOON = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const BODY = "Hi Paul, could you send the revised quote for 40 panels? Call me Thursday. SECRET-BODY-TEXT";
const QUOTED = "Hi Paul, could you send the revised quote for 40 panels? Call me Thursday.\n\n> earlier thread QUOTED-HISTORY";

/** Fake Outlook: message by id (404 for 'moved'), or by internetMessageId filter. */
function fakeOutlook() {
  const calls: string[] = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const msg = { uniqueBody: { content: BODY }, body: { content: QUOTED }, from: { emailAddress: { address: "Jane@a.sumtest.test" } }, toRecipients: [{ emailAddress: { address: "sum.owner@saveboard.nz" } }] };
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${url} ${JSON.stringify(init?.headers ?? {})}`);
    if (url.includes("login.microsoftonline.com")) return json({ access_token: "acc", expires_in: 3600 });
    if (url.includes("/messages/moved")) return json({ error: { code: "ErrorItemNotFound" } }, 404);
    if (url.includes("/messages?")) return json({ value: [msg] });
    return json(msg);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("Claude email summaries", () => {
  it("summarises each email once, stores only the summary, and turns a follow-up date into a task for the deal owner", async () => {
    await logEmail(1, { contacts: [janeId, bobId], deal: dealId });
    const seen: EmailForSummary[] = [];
    const summarise: Summariser = async (e) => {
      seen.push(e);
      return { summary: "Jane wants a revised quote for 40 panels.", next_step: "Send revised quote", follow_up_date: SOON };
    };
    const g = fakeOutlook();
    const r = await runSummaries({ summarise, fetchImpl: g.impl });
    expect(r).toMatchObject({ attempted: 1, summarised: 1, tasks: 1, failed: 0 });

    // Claude was given the new text only (not the quoted thread), with today's NZ date to resolve "Thursday".
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ direction: "inbound", from: "jane@a.sumtest.test", subject: "Subject 1" });
    expect(seen[0].text).toContain("SECRET-BODY-TEXT");
    expect(seen[0].today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(g.calls.some((c) => c.includes("/users/sum.owner%40saveboard.nz/messages/msg1") && c.includes('outlook.body-content-type=\\"text\\"'))).toBe(true);

    const acts = await rows<Record<string, unknown>>(sql`select * from crm.activities where external_id like '<sumtest-1@x>|%'`);
    expect(acts).toHaveLength(2);
    for (const a of acts) {
      expect(a.summary).toBe("Jane wants a revised quote for 40 panels.");
      expect(a.metadata).toMatchObject({ summary_status: "done", next_step: "Send revised quote", follow_up_on: SOON });
    }
    // The email's text is never stored.
    expect(JSON.stringify(acts)).not.toContain("SECRET-BODY-TEXT");

    const tasks = await rows<{ title: string; due_on: string; assigned_to: string; created_by_claude: boolean; source: string }>(
      sql`select title, due_on, assigned_to, created_by_claude, source from crm.tasks where deal_id = ${dealId}`,
    );
    expect(tasks).toEqual([{ title: "Send revised quote", due_on: SOON, assigned_to: dealOwnerId, created_by_claude: true, source: "claude" }]);
    const [audit] = await rows<{ actor_type: string; actor_id: string }>(
      sql`select actor_type, actor_id from crm.audit_log where table_name = 'tasks' and changes -> 'new' ->> 'deal_id' = ${dealId} order by id desc limit 1`,
    );
    expect(audit).toEqual({ actor_type: "claude", actor_id: ownerId });

    // Nothing left to do: a second run calls neither Outlook nor Claude for it.
    const again = await runSummaries({ summarise, fetchImpl: g.impl });
    expect(again.attempted).toBe(0);
  });

  it("finds a moved message by its internet message id, and makes no task for past dates", async () => {
    await logEmail(2, { contacts: [janeId], messageId: "moved" });
    const g = fakeOutlook();
    const r = await runSummaries({
      summarise: async () => ({ summary: "Old news.", next_step: null, follow_up_date: "2001-01-01" }),
      fetchImpl: g.impl,
    });
    expect(r).toMatchObject({ summarised: 1, tasks: 0 });
    expect(g.calls.some((c) => decodeURIComponent(c).includes("internetMessageId eq '<sumtest-2@x>'"))).toBe(true);
  });

  it("records a decline, and retries a failure at most three times", async () => {
    await logEmail(3, { contacts: [janeId] });
    await logEmail(4, { contacts: [bobId] });
    const summarise: Summariser = async (e) => {
      if (e.subject === "Subject 3") return { refused: true };
      throw new Error("overloaded");
    };
    for (let i = 0; i < 4; i++) await runSummaries({ summarise, fetchImpl: fakeOutlook().impl });
    const [refused] = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from crm.activities where external_id like '<sumtest-3@x>|%'`);
    expect(refused.metadata.summary_status).toBe("refused");
    const [failed] = await rows<{ metadata: Record<string, unknown>; summary: string | null }>(
      sql`select metadata, summary from crm.activities where external_id like '<sumtest-4@x>|%'`,
    );
    expect(failed.summary).toBeNull();
    expect(failed.metadata).toMatchObject({ summary_attempts: 3, summary_error: "overloaded" });
    const status = await summaryStatus();
    expect(status.failed).toBeGreaterThanOrEqual(1);
    expect(status.refused).toBeGreaterThanOrEqual(1);
  });

  it("does the newest emails first", async () => {
    await withActor(SYS, async (tx) => {
      await tx.execute(sql`delete from crm.activities where external_id like '<sumtest-%'`);
      for (const [key, at] of [["<sumtest-a-old@x>", "2026-07-01T00:00:00Z"], ["<sumtest-z-new@x>", "2026-10-07T00:00:00Z"], ["<sumtest-m-mid@x>", "2026-09-01T00:00:00Z"]]) {
        await tx.execute(sql`insert into crm.activities (type, direction, subject, occurred_at, contact_id, owner_id, origin, external_id, metadata)
                             values ('email', 'inbound', ${key}, ${at}, ${janeId}, ${ownerId}, 'graph', ${`${key}|${janeId}`},
                                     ${JSON.stringify({ mailbox: "sum.owner@saveboard.nz", message_id: "m" })}::jsonb)`);
      }
    });
    const order: string[] = [];
    await runSummaries({ summarise: async (e) => (order.push(e.subject!), { summary: "s", next_step: null, follow_up_date: null }), fetchImpl: fakeOutlook().impl, limit: 2 });
    expect(order.sort()).toEqual(["<sumtest-m-mid@x>", "<sumtest-z-new@x>"]);
  });

  it("does nothing without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await runSummaries()).toMatchObject({ attempted: 0, skipped: "ANTHROPIC_API_KEY is not set" });
  });
});
