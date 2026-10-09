import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { createDeal } from "./deals";
import { listSpecifiers, listVisits, setSpecifierStage, specifierCounts } from "./specifiers";

// The specifier track as crm_app. Own rows: *.spectest.test; speed rows 'TEST SPEC ...'.

const SYS = { type: "system" as const, reason: "import" as const };
let paulId = "";
let annaId = "";
const user = () => ({ type: "user" as const, profileId: paulId });

async function cleanup() {
  await withActor(SYS, async (tx) => {
    await tx.execute(sql`select set_config('crm.skip_audit', 'on', true)`);
    const mine = sql`(select id from crm.contacts where email like '%spectest.test')`;
    await tx.execute(sql`delete from crm.deals where primary_contact_id in ${mine}`);
    await tx.execute(sql`delete from crm.visits where contact_id in ${mine}`);
    await tx.execute(sql`delete from crm.contacts where email like '%spectest.test'`);
  });
}

beforeAll(async () => {
  await cleanup();
  [{ id: paulId }] = await rows<{ id: string }>(sql`select id from crm.profiles where lower(email) = 'paul@saveboard.nz'`);
  await withActor(SYS, async (tx) => {
    [{ id: annaId }] = await rows<{ id: string }>(
      sql`insert into crm.contacts (first_name, last_name, email, is_specifier, specifier_stage, owner_id)
          values ('Anna', 'Arch', 'anna@studio.spectest.test', true, 'visited', ${paulId}) returning id`,
      tx,
    );
    for (const [m, region] of [["2026-08-01", "Northern"], ["2026-09-01", "Northern"]] as const) {
      await tx.execute(sql`insert into crm.visits (visited_on, contact_id, notes, row_hash, region, report_month, report_group, provided, action)
                           values (${m}::date + 29, ${annaId}, 'Talked about betterBRACE', ${`spectest-${m}`}, ${region}, ${m}, 'Priority Feedback',
                                   'saveBOARD sample provided', ${m.startsWith("2026-09") ? "Send pricing" : null})`);
    }
  });
}, 120_000);
afterAll(cleanup, 120_000);

describe("specifier track", () => {
  it("lists visits newest first, and specifiers with their last visit and region", async () => {
    const v = await listVisits(annaId);
    expect(v.map((x) => [x.report_month, x.action])).toEqual([
      ["2026-09-01", "Send pricing"],
      ["2026-08-01", null],
    ]);
    const [a] = (await listSpecifiers()).filter((s) => s.id === annaId);
    expect(a).toMatchObject({ name: "Anna Arch", stage: "visited", visits: 2, last_visit: "2026-09-30", last_region: "Northern", owner: "Paul Charteris" });
  });

  it("moves along the track, filters by stage, and can come off it", async () => {
    await setSpecifierStage(user(), annaId, "specified");
    expect((await listSpecifiers({ stage: "specified" })).map((s) => s.id)).toContain(annaId);
    expect((await listSpecifiers({ stage: "visited" })).map((s) => s.id)).not.toContain(annaId);
    expect((await specifierCounts()).specified).toBeGreaterThanOrEqual(1);
    await setSpecifierStage(user(), annaId, null);
    expect((await listSpecifiers()).map((s) => s.id)).not.toContain(annaId);
    await setSpecifierStage(user(), annaId, "visited");
  });

  it("a deal from a specifier moves them to Enquiry", async () => {
    await createDeal(user(), {
      title: "Anna's school project",
      company_id: null,
      primary_contact_id: annaId,
      entity: "NZ",
      est_value: null,
      source: "specifier",
      owner_id: paulId,
      next_action: null,
      next_action_on: null,
      erp_so_number: null,
    });
    const [c] = await rows<{ stage: string }>(sql`select specifier_stage::text as stage from crm.contacts where id = ${annaId}`);
    expect(c.stage).toBe("enquiry");
  });

  it("stays fast at live volumes (5,800 contacts, 1,500 visits)", async () => {
    await withActor(SYS, async (tx) => {
      await tx.execute(sql`select set_config('crm.skip_audit', 'on', true)`);
      await tx.execute(sql`insert into crm.contacts (first_name, last_name, email, is_specifier, specifier_stage)
                           select 'TEST SPEC', 'P' || g, 'p' || g || '@speed.spectest.test', g % 4 = 0, case when g % 4 = 0 then 'visited'::crm.specifier_stage end
                           from generate_series(1, 5800) g`);
      await tx.execute(sql`insert into crm.visits (visited_on, contact_id, row_hash, region, report_month)
                           select date '2026-05-31' + (g % 120), c.id, 'spectest-speed-' || g, 'Central', date '2026-05-01'
                           from generate_series(1, 1500) g
                           join lateral (select id from crm.contacts where email = 'p' || (g % 1450 + 1) * 4 % 5800 || '@speed.spectest.test' limit 1) c on true`);
      await tx.execute(sql`analyze crm.contacts`);
      await tx.execute(sql`analyze crm.visits`);
    });
    await listSpecifiers(); // warm
    const t = Date.now();
    const list = await listSpecifiers();
    expect(Date.now() - t).toBeLessThan(1500);
    expect(list.filter((s) => s.email?.endsWith("speed.spectest.test")).length).toBeGreaterThan(1000);
  }, 120_000);
});
