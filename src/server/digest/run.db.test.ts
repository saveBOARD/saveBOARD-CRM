import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { runDigest } from "./run";

// The morning digest as crm_app, with a fake email service. Own rows: 'TEST G ...'. Seeded CRM users may also get a
// (fake) digest: nothing leaves the test.

const SYS = { type: "system" as const, reason: "import" as const };
let meId = "";
let outsiderId = "";

async function cleanup() {
  await withActor(SYS, async (tx) => {
    await tx.execute(sql`delete from crm.tasks where title like 'TEST G %'`);
    await tx.execute(sql`delete from crm.profiles where display_name in ('TEST G Digest', 'TEST G Outsider')`);
    await tx.execute(sql`delete from crm.settings where key = 'digest_last_sent_on'`);
  });
}

beforeAll(async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("DIGEST_FROM", "saveBOARD CRM <crm@saveboard.nz>");
  vi.stubEnv("APP_URL", "https://crm.example");
  await cleanup();
  await withActor(SYS, async (tx) => {
    [{ id: meId }] = await rows<{ id: string }>(sql`insert into crm.profiles (display_name, email) values ('TEST G Digest', 'digest.test@saveboard.nz') returning id`, tx);
    // A profile with an outside address must never be emailed, even with work on their list.
    [{ id: outsiderId }] = await rows<{ id: string }>(sql`insert into crm.profiles (display_name, email) values ('TEST G Outsider', 'someone@gmail.com') returning id`, tx);
    for (const who of [meId, outsiderId]) {
      await tx.execute(sql`insert into crm.tasks (title, detail, priority, due_on, assigned_to, source, rule)
                           values ('TEST G chase', 'No activity', 4, current_date - 1, ${who}, 'follow_up_engine', 'gone_quiet')`);
    }
  });
});
afterAll(async () => {
  await cleanup();
  vi.unstubAllEnvs();
});

function fakeResend() {
  const sent: { to: string[]; subject: string; text: string }[] = [];
  const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, sent };
}

// 9 Oct 2026 is a Friday. NZDT (UTC+13): 7:30 am NZ = 18:30 UTC the day before.
const FRI_0730 = new Date("2026-10-08T18:30:00Z");
const FRI_0830 = new Date("2026-10-08T19:30:00Z");
const SAT_0730 = new Date("2026-10-09T18:30:00Z");

describe("morning digest", () => {
  it("sends only at 7 am NZ on weekdays", async () => {
    const f = fakeResend();
    expect(await runDigest({ now: SAT_0730, fetchImpl: f.impl })).toMatchObject({ skipped: "weekend" });
    expect(await runDigest({ now: FRI_0830, fetchImpl: f.impl })).toMatchObject({ skipped: expect.stringMatching(/not 7 am/) });
    expect(f.sent).toEqual([]);
  });

  it("sends each saveBOARD user their own list, never an outside address, and only once a day", async () => {
    const f = fakeResend();
    const r = await runDigest({ now: FRI_0730, fetchImpl: f.impl });
    expect(r.sent).toContain("TEST G Digest");
    expect(r.sent).not.toContain("TEST G Outsider");
    expect(f.sent.every((m) => m.to.every((a) => /@saveboard\.(nz|com\.au)$/.test(a)))).toBe(true);
    const mine = f.sent.find((m) => m.to[0] === "digest.test@saveboard.nz")!;
    expect(mine.subject).toMatch(/^CRM today: \d+ to chase/);
    expect(mine.text).toContain("Morning TEST,");
    expect(mine.text).toContain("Gone quiet (1):");
    expect(mine.text).toContain("Open today's list: https://crm.example/");

    const again = fakeResend();
    expect(await runDigest({ now: FRI_0730, fetchImpl: again.impl })).toMatchObject({ skipped: "already sent today" });
    expect(again.sent).toEqual([]);
  });

  it("'send me a test' goes to that one person, any time", async () => {
    const f = fakeResend();
    const r = await runDigest({ now: SAT_0730, onlyProfileId: meId, fetchImpl: f.impl });
    expect(r.sent).toEqual(["TEST G Digest"]);
    expect(f.sent.map((m) => m.to[0])).toEqual(["digest.test@saveboard.nz"]);
  });
});
