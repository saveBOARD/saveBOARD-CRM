import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { createDeal, findDealByErpNumber, getDeal, listBoardDeals, listStageHistory, moveDeal, snoozeDeal, updateDeal } from "./deals";
import { dealSchema } from "./schemas";
import { searchContacts } from "./writes";

// Deals as crm_app. Own "TEST D ..." rows, removed before and after.

let paul = "";
let iris = "";
let companyId = "";
let contactId = "";
let dealId = "";
const user = () => ({ type: "user" as const, profileId: paul });

const input = (o: Record<string, unknown> = {}) =>
  dealSchema.parse({
    title: "TEST D Hamilton depot",
    company_id: companyId,
    primary_contact_id: contactId,
    entity: "NZ",
    est_value: "12,500",
    source: "phone",
    owner_id: paul,
    next_action: "Send samples",
    next_action_on: "",
    erp_so_number: "",
    ...o,
  });

async function cleanup() {
  await withActor({ type: "system", reason: "import" }, async (tx) => {
    await tx.execute(sql`delete from crm.deals where title like 'TEST D %'`);
    await tx.execute(sql`delete from crm.contacts where email like 'test.d.%@example.test'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST D %'`);
  });
}

beforeAll(async () => {
  await cleanup();
  [{ id: paul }] = await rows<{ id: string }>(sql`select id from crm.profiles where display_name = 'Paul Charteris'`);
  [{ id: iris }] = await rows<{ id: string }>(sql`select id from crm.profiles where display_name = 'Iris Lim'`);
  await withActor(user(), async (tx) => {
    [{ id: companyId }] = await rows<{ id: string }>(sql`insert into crm.companies (name) values ('TEST D Depot Builders') returning id`, tx);
    [{ id: contactId }] = await rows<{ id: string }>(
      sql`insert into crm.contacts (company_id, first_name, last_name, email) values (${companyId}, 'Testa', 'Deal', 'test.d.testa@example.test') returning id`,
      tx,
    );
  });
});
afterAll(cleanup);

describe("create and edit", () => {
  it("creates a New enquiry with the entity's currency, recorded as made by the user", async () => {
    dealId = await createDeal(user(), input());
    const d = await getDeal(dealId);
    expect(d).toMatchObject({ stage: "new_enquiry", entity: "NZ", est_currency: "NZD", company: "TEST D Depot Builders", contact: "Testa Deal" });
    expect(Number(d!.est_value)).toBe(12500);
    const [h] = await listStageHistory(dealId);
    expect(h).toMatchObject({ from_stage: null, to_stage: "new_enquiry", reason: "manual", changed_by: "Paul Charteris" });
  });

  it("switching to Australia switches the currency to AUD", async () => {
    await updateDeal(user(), dealId, input({ entity: "AUS", erp_so_number: "so-77" }));
    expect(await getDeal(dealId)).toMatchObject({ entity: "AUS", est_currency: "AUD", erp_so_number: "SO-77" });
  });

  it("finds another deal with the same ERP number in the same entity, ignoring case", async () => {
    expect((await findDealByErpNumber("AUS", "so-77"))?.id).toBe(dealId);
    expect(await findDealByErpNumber("NZ", "SO-77")).toBeNull();
    expect(await findDealByErpNumber("AUS", "SO-77", dealId)).toBeNull();
  });
});

describe("moving stages", () => {
  it("records each move once, with who and how", async () => {
    await moveDeal(user(), dealId, "contacted", null);
    await moveDeal(user(), dealId, "contacted", null); // no change, no history
    const history = await listStageHistory(dealId);
    expect(history.map((h) => h.to_stage)).toEqual(["contacted", "new_enquiry"]);
    expect(history[0]).toMatchObject({ from_stage: "new_enquiry", reason: "manual", changed_by: "Paul Charteris" });
  });

  it("Lost keeps its reason and closes the deal; reopening clears both", async () => {
    await moveDeal(user(), dealId, "lost", "Went with a competitor");
    let d = await getDeal(dealId);
    expect(d).toMatchObject({ stage: "lost", lost_reason: "Went with a competitor" });
    expect(d!.closed_at).not.toBeNull();

    await moveDeal(user(), dealId, "qualified", null);
    d = await getDeal(dealId);
    expect(d).toMatchObject({ stage: "qualified", lost_reason: null, closed_at: null });
  });

  it("Won can be set by hand (until ERP sync in phase 5)", async () => {
    const id = await createDeal(user(), input({ title: "TEST D won deal" }));
    await moveDeal(user(), id, "won", null);
    expect((await getDeal(id))?.stage).toBe("won");
  });
});

describe("snooze and board", () => {
  it("snoozes with a reason and wakes", async () => {
    await snoozeDeal(user(), dealId, "2099-01-31", "Project on hold");
    expect(await getDeal(dealId)).toMatchObject({ snoozed_until: "2099-01-31", snooze_reason: "Project on hold" });
    await snoozeDeal(user(), dealId, null, "ignored");
    expect(await getDeal(dealId)).toMatchObject({ snoozed_until: null, snooze_reason: null });
  });

  it("filters the board by owner and entity, and hides deals closed over 90 days ago", async () => {
    const irisDeal = await createDeal(user(), input({ title: "TEST D Iris deal", owner_id: iris, entity: "NZ" }));
    const old = await createDeal(user(), input({ title: "TEST D old loss" }));
    await moveDeal(user(), old, "lost", "Old");
    await withActor(user(), (tx) => tx.execute(sql`update crm.deals set closed_at = now() - interval '100 days' where id = ${old}`));

    const mine = (await listBoardDeals({ ownerId: iris })).map((d) => d.id);
    expect(mine).toEqual([irisDeal]);
    const aus = (await listBoardDeals({ entity: "AUS" })).map((d) => d.title);
    expect(aus).toContain("TEST D Hamilton depot");
    expect(aus).not.toContain("TEST D Iris deal");
    expect((await listBoardDeals()).some((d) => d.id === old)).toBe(false);
  });
});

describe("contact look-up", () => {
  it("finds contacts by name or email", async () => {
    const found = await searchContacts("testa", companyId);
    expect(found[0]).toMatchObject({ id: contactId, name: "Testa Deal", company_id: companyId });
    expect(found[0].detail).toContain("TEST D Depot Builders");
    // Wildcards in the search text are treated as plain characters.
    expect(await searchContacts("%%")).toEqual([]);
    expect(await searchContacts("test_d")).toEqual([]);
  });
});
