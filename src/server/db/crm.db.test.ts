import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./client";
import { withActor } from "./actor";
import { countErpCustomers } from "@/server/erp";
import { isForbiddenErpColumn } from "@/server/erp/guard";

// Runs as crm_app against the local database built by `npm run db:reset` (sample ERP data in scripts/local/).
// Test rows are named "TEST ..." and removed before each run; audit rows stay (the log is append-only).

type Row = Record<string, unknown>;
const q = async <T extends Row = Row>(query: ReturnType<typeof sql>) => (await db().execute(query)) as unknown as T[];

/** The database's own error message (Drizzle wraps it as "Failed query: ..." with the original as the cause). */
async function dbError(query: ReturnType<typeof sql>): Promise<string> {
  try {
    await q(query);
  } catch (e) {
    return e instanceof Error && e.cause instanceof Error ? e.cause.message : String(e);
  }
  return "no error: the statement was allowed";
}

const ERP = {
  fultonNz: "20000000-0000-0000-0000-000000000001",
  acmeNz: "20000000-0000-0000-0000-000000000002",
  fultonAus: "20000000-0000-0000-0000-000000000003",
};

let paulId: string;

async function cleanup() {
  await withActor({ type: "system", reason: "import" }, async (tx) => {
    await tx.execute(sql`delete from crm.deals where title like 'TEST %'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST %'`);
  });
}

beforeAll(async () => {
  const [p] = await q<{ id: string }>(sql`select id from crm.profiles where display_name = 'Paul Charteris'`);
  paulId = p.id;
  await cleanup();
});
afterAll(cleanup);

describe("crm_app permissions", () => {
  it("connects as crm_app", async () => {
    const [r] = await q<{ u: string }>(sql`select current_user as u`);
    expect(r.u).toBe("crm_app");
  });

  it.each(["customers", "sales_orders", "products", "stock_movements", "users", "xero_connections", "audit_log"])(
    "cannot read the ERP table public.%s",
    async (table) => {
      expect(await dbError(sql.raw(`select 1 from public.${table} limit 1`))).toMatch(/permission denied/);
    },
  );

  it("cannot write to erp_read views", async () => {
    expect(await dbError(sql`delete from erp_read.customers`)).toMatch(/permission denied|cannot delete/);
  });

  it("cannot change or delete the audit log", async () => {
    expect(await dbError(sql`delete from crm.audit_log`)).toMatch(/permission denied/);
    expect(await dbError(sql`update crm.audit_log set actor_type = 'x'`)).toMatch(/permission denied/);
  });
});

describe("erp_read views", () => {
  it("expose no cost, margin, password or token column", async () => {
    const cols = await q<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'erp_read'`,
    );
    expect(cols.length).toBeGreaterThan(0);
    expect(cols.filter((c) => isForbiddenErpColumn(c.column_name) || c.column_name === "notes")).toEqual([]);
  });

  it("hide deleted customers", async () => {
    expect(await countErpCustomers()).toBe(4);
    expect(await countErpCustomers("NZ")).toBe(3);
    expect(await countErpCustomers("AUS")).toBe(1);
  });

  it("work out stock from the ledger: 90 on hand, 12 committed, 78 available", async () => {
    const [s] = await q<{ on_hand: string; committed: string; available: string }>(
      sql`select on_hand, committed, available from erp_read.product_stock where entity_id = 'NZ' and sku = 'SBEXP1012002400'`,
    );
    expect(Number(s.on_hand)).toBe(90);
    expect(Number(s.committed)).toBe(12);
    expect(Number(s.available)).toBe(78);
  });

  it("count a Katana order once, though it is in sales_orders and sales_history", async () => {
    const [s] = await q<{ order_count: string; total_ex_gst: string }>(
      sql`select order_count, total_ex_gst from erp_read.customer_sales_summary where customer_id = ${ERP.fultonNz}`,
    );
    expect(Number(s.order_count)).toBe(1);
    expect(Number(s.total_ex_gst)).toBe(1000);
  });

  it("list the overdue invoice", async () => {
    const rows = await q<{ number: string; xero_amount_due: string }>(sql`select number, xero_amount_due from erp_read.overdue_invoices`);
    expect(rows).toHaveLength(1);
    expect(rows[0].number).toBe("SO-1004");
  });

  it("return dates as plain day strings", async () => {
    const [r] = await q<{ d: unknown }>(sql`select order_date as d from erp_read.sales_orders where number = 'SO-1001'`);
    expect(r.d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("withActor and the audit log", () => {
  it("records who made a change", async () => {
    const id = await withActor({ type: "user", profileId: paulId }, async (tx) => {
      const [r] = (await tx.execute(sql`insert into crm.companies (name) values ('TEST Audit Ltd') returning id`)) as unknown as { id: string }[];
      return r.id;
    });
    const [a] = await q<{ actor_type: string; actor_id: string; action: string }>(
      sql`select actor_type, actor_id, action from crm.audit_log where table_name = 'companies' and record_id = ${id}`,
    );
    expect(a).toEqual({ actor_type: "user", actor_id: paulId, action: "INSERT" });
  });

  it("records Claude as the actor for Claude's changes", async () => {
    const id = await withActor({ type: "claude", profileId: paulId }, async (tx) => {
      const [r] = (await tx.execute(sql`insert into crm.companies (name) values ('TEST Claude Ltd') returning id`)) as unknown as { id: string }[];
      return r.id;
    });
    const [a] = await q<{ actor_type: string }>(sql`select actor_type from crm.audit_log where record_id = ${id}`);
    expect(a.actor_type).toBe("claude");
  });

  it("does not leak the actor to later queries on the same pool", async () => {
    await withActor({ type: "user", profileId: paulId }, async () => undefined);
    const rows = await Promise.all(
      Array.from({ length: 5 }, () => q<{ t: string | null }>(sql`select nullif(current_setting('crm.actor_type', true), '') as t`)),
    );
    expect(rows.map((r) => r[0].t)).toEqual([null, null, null, null, null]);
  });
});

describe("ERP deal sync", () => {
  it("moves deals from ERP quote status, records why, and is idempotent", async () => {
    await withActor({ type: "user", profileId: paulId }, async (tx) => {
      await tx.execute(sql`
        with co as (insert into crm.companies (name) values ('TEST Fulton Hogan') returning id),
             links as (insert into crm.company_erp_links (company_id, erp_entity, erp_customer_id, match_method, confirmed)
                       select id, e.entity, e.cust::uuid, 'manual', true from co,
                       (values ('NZ', ${ERP.fultonNz}), ('AUS', ${ERP.fultonAus})) e(entity, cust))
        insert into crm.deals (title, company_id, entity, est_currency, stage, erp_so_number)
        select t.title, co.id, t.entity, t.cur, t.stage::crm.deal_stage, t.so from co,
        (values ('TEST quote sent',  'NZ',  'NZD', 'contacted',   'SO-1001'),
                ('TEST quote draft', 'NZ',  'NZD', 'new_enquiry', 'SO-1002'),
                ('TEST order open',  'NZ',  'NZD', 'qualified',   'SO-1003'),
                ('TEST declined',    'AUS', 'AUD', 'quote_sent',  'SO-2001')) t(title, entity, cur, stage, so)`);
    });

    const moved = await withActor({ type: "system", reason: "erp_sync" }, async (tx) =>
      (await tx.execute(sql`select * from crm.sync_deals_from_erp()`)) as unknown as Row[],
    );
    expect(moved.length).toBeGreaterThanOrEqual(4);

    const deals = await q<{ title: string; stage: string; lost_reason: string | null }>(
      sql`select title, stage, lost_reason from crm.deals where title like 'TEST %' order by title`,
    );
    expect(Object.fromEntries(deals.map((d) => [d.title, d.stage]))).toEqual({
      "TEST declined": "lost",
      "TEST order open": "won",
      "TEST quote draft": "qualified",
      "TEST quote sent": "quote_sent",
    });
    expect(deals.find((d) => d.title === "TEST declined")?.lost_reason).toBe("ERP: declined");

    const [h] = await q<{ n: string }>(sql`
      select count(*)::text as n from crm.deal_stage_history h join crm.deals d on d.id = h.deal_id
      where d.title like 'TEST %' and h.reason = 'erp_sync'`);
    expect(Number(h.n)).toBe(4);

    const again = await withActor({ type: "system", reason: "erp_sync" }, async (tx) =>
      (await tx.execute(sql`select * from crm.sync_deals_from_erp() where deal_id in (select id from crm.deals where title like 'TEST %')`)) as unknown as Row[],
    );
    expect(again).toEqual([]);
  });

  it("puts the expiring quote on the chase list", async () => {
    const rows = await q<{ rule: string; title: string }>(sql`select rule, title from crm.v_chase_list where title like 'TEST %'`);
    expect(rows).toContainEqual({ rule: "quote_expiring", title: "TEST quote sent" });
  });

  it("shows the ERP panel for both of the company's entities", async () => {
    const rows = await q<{ erp_entity: string; credit_limit: string }>(sql`
      select v.erp_entity, v.credit_limit from crm.v_company_erp v
      join crm.companies c on c.id = v.company_id where c.name = 'TEST Fulton Hogan' order by v.erp_entity`);
    expect(rows.map((r) => r.erp_entity)).toEqual(["AUS", "NZ"]);
  });
});
