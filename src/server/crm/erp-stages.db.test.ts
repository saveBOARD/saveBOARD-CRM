import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";

// Deals follow the ERP (migration 19), against the local made-up ERP documents: SO-1001 quote sent, SO-1002 quote
// draft, SO-1003 open order, SO-1004 invoiced order (NZ), SO-2001 quote declined (AUS). Own rows: 'TEST S2 ...'.

const SYS = { type: "system" as const, reason: "import" as const };
const ids: Record<string, string> = {};

async function cleanup() {
  await withActor(SYS, (tx) => tx.execute(sql`delete from crm.deals where title like 'TEST S2 %' or erp_so_number in ('SO-1001','SO-1002','SO-1003','SO-1004','SO-2001')`));
}
const sync = (all = false) => withActor({ type: "system", reason: "follow_up" }, async (tx) => (await rows<{ n: number }>(sql`select crm.sync_deal_stages(${all}) as n`, tx))[0].n);
const stage = async (k: string) => (await rows<{ stage: string; lost_reason: string | null }>(sql`select stage::text as stage, lost_reason from crm.deals where id = ${ids[k]}`))[0];

beforeAll(async () => {
  await cleanup();
  await withActor(SYS, async (tx) => {
    for (const [k, entity, stg, so] of [
      ["order", "NZ", "qualified", "SO-1003"],
      ["invoiced", "NZ", "won", "SO-1004"],
      ["declined", "AUS", "quote_sent", "SO-2001"],
      ["sent", "NZ", "contacted", "SO-1001"],
      ["draft", "NZ", "contacted", "SO-1002"],
    ] as const) {
      const [d] = await rows<{ id: string }>(
        sql`insert into crm.deals (title, entity, est_currency, stage, erp_so_number) values (${`TEST S2 ${k}`}, ${entity}, ${entity === "NZ" ? "NZD" : "AUD"}, ${stg}::crm.deal_stage, ${so}) returning id`,
        tx,
      );
      ids[k] = d.id;
    }
  });
});
afterAll(cleanup);

describe("deal stages follow the ERP", () => {
  it("order -> Won, declined -> Lost, sent -> Quote sent; draft moves nothing; Won is never touched", async () => {
    expect(await sync()).toBe(3);
    expect(await stage("order")).toMatchObject({ stage: "won" });
    expect(await stage("declined")).toEqual({ stage: "lost", lost_reason: "ERP: quote declined" });
    expect(await stage("sent")).toMatchObject({ stage: "quote_sent" });
    expect(await stage("draft")).toMatchObject({ stage: "contacted" });
    expect(await stage("invoiced")).toMatchObject({ stage: "won" });
    const [h] = await rows<{ reason: string }>(sql`select reason from crm.deal_stage_history where deal_id = ${ids.order} order by changed_at desc limit 1`);
    expect(h.reason).toBe("erp_sync");
  });

  it("a stage set by hand sticks until the ERP status changes", async () => {
    await withActor({ type: "user", profileId: (await rows<{ id: string }>(sql`select id from crm.profiles where lower(email) = 'paul@saveboard.nz'`))[0].id }, (tx) =>
      tx.execute(sql`update crm.deals set stage = 'negotiation' where id = ${ids.sent}`),
    );
    expect(await sync()).toBe(0);
    expect(await stage("sent")).toMatchObject({ stage: "negotiation" });
    // Even a catch-up run doesn't pull a Negotiation deal back to Quote sent.
    await sync(true);
    expect(await stage("sent")).toMatchObject({ stage: "negotiation" });
  });
});
