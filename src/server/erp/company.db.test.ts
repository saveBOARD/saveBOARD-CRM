import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { acceptMatch, linkCompany, pendingMatchCount, rejectMatch, suggestMatches, unlinkCompany } from "@/server/crm/matches";
import { getCompanyErpAccounts, getErpCustomer, listErpDocuments, listMatchCandidates, searchErpCustomers } from ".";

// ERP panel, matching and linking, against the made-up ERP rows in scripts/local/erp_sample_data.sql.
const ERP = {
  fultonNz: "20000000-0000-0000-0000-000000000001",
  acmeNz: "20000000-0000-0000-0000-000000000002",
  deleted: "20000000-0000-0000-0000-000000000004",
  oldMerchant: "20000000-0000-0000-0000-000000000005",
};

let paul = "";
let acmeCo = "";
let otherCo = "";
const user = () => ({ type: "user" as const, profileId: paul });

async function cleanup() {
  await withActor({ type: "system", reason: "import" }, (tx) => tx.execute(sql`delete from crm.companies where name like 'TEST E %'`));
}

beforeAll(async () => {
  await cleanup();
  [{ id: paul }] = await rows<{ id: string }>(sql`select id from crm.profiles where display_name = 'Paul Charteris'`);
  await withActor(user(), async (tx) => {
    [{ id: acmeCo }] = await rows<{ id: string }>(sql`insert into crm.companies (name, domain) values ('TEST E Acme', 'acmebuild.example') returning id`, tx);
    [{ id: otherCo }] = await rows<{ id: string }>(sql`insert into crm.companies (name) values ('TEST E Other') returning id`, tx);
  });
});
afterAll(cleanup);

describe("match review", () => {
  it("suggests a link by web domain, which a person then accepts", async () => {
    await suggestMatches(user());
    const mine = (await listMatchCandidates()).filter((m) => m.company_id === acmeCo);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ method: "domain", erp_entity: "NZ", erp_customer_id: ERP.acmeNz, erp_code: "ACME", erp_active: true });
    expect(await pendingMatchCount()).toBeGreaterThan(0);

    await acceptMatch(user(), mine[0].id);
    expect((await listMatchCandidates()).some((m) => m.company_id === acmeCo)).toBe(false);
    const [link] = await rows<{ confirmed: boolean; confirmed_by: string }>(
      sql`select confirmed, confirmed_by from crm.company_erp_links where company_id = ${acmeCo}`,
    );
    expect(link).toEqual({ confirmed: true, confirmed_by: paul });
  });

  it("does not suggest it again once linked, and a rejected suggestion stays rejected", async () => {
    await suggestMatches(user());
    expect((await listMatchCandidates()).some((m) => m.company_id === acmeCo)).toBe(false);
    // Make and reject a suggestion for the other company.
    await withActor(user(), (tx) =>
      tx.execute(sql`insert into crm.erp_match_candidates (company_id, erp_entity, erp_customer_id, erp_customer_name, method, score)
                     values (${otherCo}, 'NZ', ${ERP.oldMerchant}, 'Old Merchant Ltd', 'name_fuzzy', 0.7)`),
    );
    const [c] = (await listMatchCandidates()).filter((m) => m.company_id === otherCo);
    await rejectMatch(user(), c.id);
    await suggestMatches(user());
    expect((await listMatchCandidates()).some((m) => m.company_id === otherCo)).toBe(false);
  });
});

describe("ERP panel", () => {
  it("shows terms, credit hold and the overdue invoice for the linked customer", async () => {
    const [a] = await getCompanyErpAccounts(acmeCo);
    expect(a).toMatchObject({ erp_entity: "NZ", erp_customer_name: "Acme Builders Limited", payment_terms: "7 days", credit_hold: true, overdue_invoices: 1 });
    expect(Number(a.credit_limit)).toBe(10000);
    expect(Number(a.overdue_amount)).toBe(1150);
  });

  it("lists open quotes and orders and overdue invoices, not closed history", async () => {
    const fulton = (await listErpDocuments([ERP.fultonNz])).map((d) => d.number).sort();
    expect(fulton).toEqual(["SO-1001", "SO-1003"]);
    const acme = await listErpDocuments([ERP.acmeNz]);
    expect(acme.map((d) => [d.number, d.is_overdue])).toEqual([
      ["SO-1004", true],
      ["SO-1002", false],
    ]);
    expect(await listErpDocuments([])).toEqual([]);
  });
});

describe("linking by hand", () => {
  it("finds ERP customers in one entity, showing who they are linked to", async () => {
    const found = await searchErpCustomers("NZ", "acme");
    expect(found.map((c) => [c.name, c.linked_company])).toEqual([["Acme Builders Limited", "TEST E Acme"]]);
    expect(await searchErpCustomers("AUS", "acme")).toEqual([]);
    expect((await searchErpCustomers("NZ", "gone")).length).toBe(0); // deleted customers never show
  });

  it("flags, and refuses to accept, a suggestion whose ERP customer is linked to another company", async () => {
    await withActor(user(), (tx) =>
      tx.execute(sql`insert into crm.erp_match_candidates (company_id, erp_entity, erp_customer_id, erp_customer_name, method, score)
                     values (${otherCo}, 'NZ', ${ERP.acmeNz}, 'Acme Builders Limited', 'name_fuzzy', 0.71)`),
    );
    const [c] = (await listMatchCandidates()).filter((m) => m.company_id === otherCo);
    expect(c.taken_by_company).toBe("TEST E Acme");
    expect(await acceptMatch(user(), c.id)).toBe(false);
    await rejectMatch(user(), c.id);
  });

  it("won't link an ERP customer already linked to another company", async () => {
    expect(await linkCompany(user(), otherCo, "NZ", ERP.acmeNz)).toEqual({ ok: false, reason: "That ERP customer is already linked to another company." });
  });

  it("links and unlinks by hand", async () => {
    expect(await getErpCustomer("NZ", ERP.oldMerchant)).toMatchObject({ name: "Old Merchant Ltd" });
    expect(await getErpCustomer("AUS", ERP.oldMerchant)).toBeNull();
    expect(await getErpCustomer("NZ", ERP.deleted)).toBeNull();
    expect(await linkCompany(user(), otherCo, "NZ", ERP.oldMerchant)).toEqual({ ok: true });
    expect((await getCompanyErpAccounts(otherCo)).map((a) => a.erp_active)).toEqual([false]);
    await unlinkCompany(user(), otherCo, "NZ");
    expect(await getCompanyErpAccounts(otherCo)).toEqual([]);
  });
});
