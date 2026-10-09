import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { getQuote, listCompanyQuotes } from "@/server/erp";
import { acceptQuoteSuggestion, dismissQuoteSuggestion, linkQuote, refreshQuoteSuggestions, unlinkQuote } from "./quote-links";

// Linking deals to ERP quotes as crm_app, against the local made-up ERP data: "Acme Builders Limited" (NZ) and its
// draft quote SO-1002. Own rows: company 'TEST Q Acme'.

const SYS = { type: "system" as const, reason: "import" as const };
let paulId = "";
let acmeErpId = "";
let companyId = "";
const user = () => ({ type: "user" as const, profileId: paulId });

async function cleanup() {
  await withActor(SYS, async (tx) => {
    const mine = sql`(select id from crm.companies where name = 'TEST Q Acme')`;
    await tx.execute(sql`delete from crm.tasks where company_id in ${mine} or deal_id in (select id from crm.deals where company_id in ${mine})`);
    await tx.execute(sql`delete from crm.erp_quote_suggestions where company_id in ${mine}`);
    await tx.execute(sql`delete from crm.deals where company_id in ${mine}`);
    if (acmeErpId) await tx.execute(sql`delete from crm.company_erp_links where erp_customer_id = ${acmeErpId}`);
    await tx.execute(sql`delete from crm.companies where name = 'TEST Q Acme'`);
  });
}

beforeAll(async () => {
  [{ id: paulId }] = await rows<{ id: string }>(sql`select id from crm.profiles where lower(email) = 'paul@saveboard.nz'`);
  [{ id: acmeErpId }] = await rows<{ id: string }>(sql`select id from erp_read.customers where name = 'Acme Builders Limited' and entity_id = 'NZ'`);
  await cleanup();
  await withActor(SYS, async (tx) => {
    [{ id: companyId }] = await rows<{ id: string }>(sql`insert into crm.companies (name, owner_id) values ('TEST Q Acme', ${paulId}) returning id`, tx);
    await tx.execute(sql`insert into crm.company_erp_links (company_id, erp_entity, erp_customer_id, confirmed) values (${companyId}, 'NZ', ${acmeErpId}, true)`);
  });
});
afterAll(cleanup);

describe("ERP quote links", () => {
  it("lists the company's quotes, and shows a quote with its lines (never cost)", async () => {
    const options = await listCompanyQuotes(companyId, "NZ");
    expect(options.find((o) => o.number === "SO-1002")).toMatchObject({ status: "quote", quote_status: "draft", linked_deal_id: null });
    expect(await listCompanyQuotes(companyId, "AUS")).toEqual([]);
    const q = await getQuote("NZ", "SO-1002");
    expect(q?.quote).toMatchObject({ number: "SO-1002", customer_name: "Acme Builders Limited" });
    expect(Object.keys(q!.lines[0] ?? {}).some((k) => /cost|margin/i.test(k))).toBe(false);
  });

  it("suggests opening a deal for an ERP quote that isn't on one, once; accepting opens and links it", async () => {
    expect(await refreshQuoteSuggestions()).toBeGreaterThanOrEqual(1);
    const [t] = await rows<{ id: string; title: string; assigned_to: string; source: string }>(
      sql`select id, title, assigned_to, source from crm.tasks where company_id = ${companyId} and rule = 'suggest_quote' and status = 'open'`,
    );
    expect(t).toMatchObject({ title: "Open a deal for ERP quote SO-1002?", assigned_to: paulId, source: "erp_quote" });
    expect(await refreshQuoteSuggestions()).toBe(0); // never twice

    const r = await acceptQuoteSuggestion(user(), t.id);
    expect(r.ok).toBe(true);
    const dealId = (r as { dealId: string }).dealId;
    const [d] = await rows<{ erp_so_number: string; erp_quote_status: string; stage: string; entity: string; company_id: string }>(
      sql`select erp_so_number, erp_quote_status, stage::text as stage, entity, company_id from crm.deals where id = ${dealId}`,
    );
    expect(d).toEqual({ erp_so_number: "SO-1002", erp_quote_status: "draft", stage: "qualified", entity: "NZ", company_id: companyId });
    const [task] = await rows<{ status: string; closed_reason: string }>(sql`select status, closed_reason from crm.tasks where id = ${t.id}`);
    expect(task).toEqual({ status: "done", closed_reason: "accepted" });
    expect((await listCompanyQuotes(companyId, "NZ")).find((o) => o.number === "SO-1002")?.linked_deal_id).toBe(dealId);
  });

  it("only links the company's own quotes, and each quote to one deal", async () => {
    const [deal] = await rows<{ id: string }>(sql`select id from crm.deals where company_id = ${companyId}`);
    const [other] = await withActor(SYS, (tx) =>
      rows<{ id: string }>(sql`insert into crm.deals (title, company_id, entity, stage) values ('TEST Q second', ${companyId}, 'NZ', 'contacted') returning id`, tx),
    );
    expect(await linkQuote(user(), other.id, "SO-1001")).toMatchObject({ ok: false, message: expect.stringMatching(/isn't a NZ quote or order for this company/) });
    expect(await linkQuote(user(), other.id, "so-1002")).toMatchObject({ ok: false, message: expect.stringMatching(/already linked/) });

    // Unlinked again, the quote is suggested for the company's one open deal without a number; dismissing settles it.
    await unlinkQuote(user(), deal.id);
    await withActor(SYS, async (tx) => {
      await tx.execute(sql`update crm.deals set stage = 'lost' where id = ${deal.id}`);
      await tx.execute(sql`delete from crm.erp_quote_suggestions where company_id = ${companyId}`);
    });
    await refreshQuoteSuggestions();
    const [t] = await rows<{ id: string; title: string; deal_id: string }>(
      sql`select id, title, deal_id from crm.tasks where rule = 'suggest_quote' and status = 'open' and deal_id = ${other.id}`,
    );
    expect(t).toMatchObject({ title: "Link ERP quote SO-1002 to TEST Q second?", deal_id: other.id });
    await dismissQuoteSuggestion(user(), t.id);
    const [s] = await rows<{ status: string }>(sql`select status from crm.erp_quote_suggestions where task_id = ${t.id}`);
    expect(s.status).toBe("dismissed");
    expect(await refreshQuoteSuggestions()).toBe(0);
  });
});
