import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import { refreshQuoteSuggestions } from "./quote-links";

// ERP quote suggestions clear themselves (migration 20), against the local made-up ERP documents: SO-2001 is a declined
// AUS quote; SO-1002 an open NZ draft. Own rows: company 'TEST X ...'.

const SYS = { type: "system" as const, reason: "import" as const };
let companyId = "";
const task: Record<string, string> = {};

async function cleanup() {
  await withActor(SYS, async (tx) => {
    const mine = sql`(select id from crm.companies where name = 'TEST X Fencing')`;
    await tx.execute(sql`delete from crm.erp_quote_suggestions where company_id in ${mine}`);
    await tx.execute(sql`delete from crm.tasks where company_id in ${mine} or title like 'TEST X %'`);
    await tx.execute(sql`delete from crm.deals where company_id in ${mine} or title like 'TEST X %'`);
    await tx.execute(sql`delete from crm.companies where name = 'TEST X Fencing'`);
  });
}

beforeAll(async () => {
  await cleanup();
  await withActor(SYS, async (tx) => {
    [{ id: companyId }] = await rows<{ id: string }>(sql`insert into crm.companies (name) values ('TEST X Fencing') returning id`, tx);
    for (const [key, entity, so] of [["declined", "AUS", "SO-2001"], ["linked", "NZ", "SO-1002"]] as const) {
      const [t] = await rows<{ id: string }>(
        sql`insert into crm.tasks (title, due_on, company_id, source, rule) values (${`TEST X ${key}`}, current_date, ${companyId}, 'erp_quote', 'suggest_quote') returning id`,
        tx,
      );
      task[key] = t.id;
      await tx.execute(sql`insert into crm.erp_quote_suggestions (entity, so_number, company_id, task_id) values (${entity}, ${so}, ${companyId}, ${t.id})
                           on conflict (entity, so_number) do update set company_id = excluded.company_id, task_id = excluded.task_id, status = 'pending'`);
    }
    // SO-1002 has since been put on a deal some other way (typed into the deal form).
    await tx.execute(sql`insert into crm.deals (title, entity, est_currency, stage, erp_so_number) values ('TEST X deal', 'NZ', 'NZD', 'contacted', 'SO-1002')`);
  });
});
afterAll(cleanup);

describe("ERP quote suggestions clear themselves", () => {
  it("closes items whose quote is no longer open in the ERP, or is now on a deal", async () => {
    await refreshQuoteSuggestions();
    const t = await rows<{ title: string; status: string; closed_reason: string }>(
      sql`select title, status, closed_reason from crm.tasks where id in (${task.declined}, ${task.linked}) order by title`,
    );
    expect(t).toEqual([
      { title: "TEST X declined", status: "done", closed_reason: "cleared" },
      { title: "TEST X linked", status: "done", closed_reason: "cleared" },
    ]);
    const s = await rows<{ status: string }>(sql`select status from crm.erp_quote_suggestions where company_id = ${companyId}`);
    expect(s.every((x) => x.status === "dismissed")).toBe(true);
  });
});
