import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { linkCompany, suggestMatches } from "./matches";
import { companyCandidates, createCompanyFromErp, refreshQuoteSuggestions, settleCustomerLink } from "./quote-links";

// Matching ERP customers that have open quotes (migration 16), against the local made-up ERP data: "Acme Builders
// Limited" (draft quote SO-1002) and "Fulton Hogan Ltd" (sent quote SO-1001), both NZ. Own rows: 'AcmeBuilders' and
// companies created from the ERP.

const SYS = { type: "system" as const, reason: "import" as const };
let paulId = "";
let acmeErp = "";
let fultonErp = "";
let crmAcme = "";
const user = () => ({ type: "user" as const, profileId: paulId });

async function cleanup() {
  await withActor(SYS, async (tx) => {
    const erp = sql`(${acmeErp || null}::uuid, ${fultonErp || null}::uuid)`;
    const mine = sql`(select company_id from crm.company_erp_links where erp_customer_id in ${erp} union select id from crm.companies where name = 'AcmeBuilders')`;
    await tx.execute(sql`delete from crm.tasks where rule in ('suggest_customer_link', 'suggest_quote') and (company_id in ${mine} or link like '/erp-customers/%' or deal_id in (select id from crm.deals where company_id in ${mine}))`);
    await tx.execute(sql`delete from crm.erp_quote_suggestions where erp_customer_id in ${erp} or company_id in ${mine}`);
    await tx.execute(sql`delete from crm.erp_match_candidates where company_id in ${mine}`);
    await tx.execute(sql`delete from crm.contacts where company_id in ${mine} and source = 'erp'`);
    await tx.execute(sql`delete from crm.deals where company_id in ${mine}`);
    const ids = await rows<{ company_id: string }>(mine, tx);
    await tx.execute(sql`delete from crm.company_erp_links where erp_customer_id in ${erp}`);
    for (const { company_id } of ids) await tx.execute(sql`delete from crm.companies where id = ${company_id} and (source = 'erp' or name = 'AcmeBuilders')`);
  });
}

beforeAll(async () => {
  [{ id: paulId }] = await rows<{ id: string }>(sql`select id from crm.profiles where lower(email) = 'paul@saveboard.nz'`);
  [{ id: acmeErp }] = await rows<{ id: string }>(sql`select id from erp_read.customers where name = 'Acme Builders Limited' and entity_id = 'NZ'`);
  [{ id: fultonErp }] = await rows<{ id: string }>(sql`select id from erp_read.customers where name = 'Fulton Hogan Ltd' and entity_id = 'NZ'`);
  await cleanup();
  [{ id: crmAcme }] = await withActor(SYS, (tx) => rows<{ id: string }>(sql`insert into crm.companies (name, owner_id) values ('AcmeBuilders', ${paulId}) returning id`, tx));
});
afterAll(cleanup);

describe("matching ERP customers with open quotes", () => {
  it("finds the CRM company when the name is written differently", async () => {
    const c = await companyCandidates("NZ", acmeErp);
    expect(c[0]).toMatchObject({ company_id: crmAcme, company_name: "AcmeBuilders", method: "name_compact" });
    await suggestMatches(user());
    const [m] = await rows<{ method: string }>(sql`select method from crm.erp_match_candidates where company_id = ${crmAcme} and erp_customer_id = ${acmeErp}`);
    expect(m?.method).toBe("name_compact");
  });

  it("puts each unlinked customer with an open quote on Today once, naming the likely match", async () => {
    await refreshQuoteSuggestions();
    const tasks = await rows<{ title: string; detail: string; link: string; rule: string }>(sql`
      select title, detail, link, rule from crm.tasks where status = 'open' and rule = 'suggest_customer_link'
        and link in (${`/erp-customers/NZ/${acmeErp}`}, ${`/erp-customers/NZ/${fultonErp}`}) order by title`);
    expect(tasks).toEqual([
      {
        title: "Link ERP customer Acme Builders Limited?",
        detail: "NZ, 1 open quote. Looks like AcmeBuilders (same name, written differently) in the CRM",
        link: `/erp-customers/NZ/${acmeErp}`,
        rule: "suggest_customer_link",
      },
      expect.objectContaining({ title: "Link ERP customer Fulton Hogan Ltd?", link: `/erp-customers/NZ/${fultonErp}` }),
    ]);
    await refreshQuoteSuggestions();
    const [n] = await rows<{ n: number }>(sql`select count(*)::int as n from crm.tasks where status = 'open' and link = ${`/erp-customers/NZ/${acmeErp}`}`);
    expect(n.n).toBe(1);
  });

  it("linking settles the item, and the customer's quote is then suggested for a deal", async () => {
    expect(await linkCompany(user(), crmAcme, "NZ", acmeErp)).toEqual({ ok: true });
    await settleCustomerLink(user(), "NZ", acmeErp);
    const [old] = await rows<{ status: string }>(sql`select status from crm.tasks where link = ${`/erp-customers/NZ/${acmeErp}`}`);
    expect(old.status).toBe("done");
    const [q] = await rows<{ title: string }>(sql`select title from crm.tasks where status = 'open' and rule = 'suggest_quote' and company_id = ${crmAcme}`);
    expect(q.title).toBe("Open a deal for ERP quote SO-1002?");
  });

  it("creates the CRM company (and main contact) from the ERP customer, linked", async () => {
    const r = await createCompanyFromErp(user(), "NZ", fultonErp);
    expect(r.ok).toBe(true);
    const companyId = (r as { companyId: string }).companyId;
    const [co] = await rows<{ name: string; country_code: string; source: string; linked: boolean }>(sql`
      select name, country_code, source,
             exists (select 1 from crm.company_erp_links where company_id = ${companyId} and erp_customer_id = ${fultonErp} and confirmed) as linked
      from crm.companies where id = ${companyId}`);
    expect(co).toEqual({ name: "Fulton Hogan Ltd", country_code: "NZ", source: "erp", linked: true });
    expect((await createCompanyFromErp(user(), "NZ", fultonErp)) as { companyId: string }).toMatchObject({ companyId }); // twice: same company
  });
});
