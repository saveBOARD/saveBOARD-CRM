import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rows } from "@/server/db/client";
import { withActor } from "@/server/db/actor";
import type { VisitActionReader } from "@/server/claude/visit-action";
import { importVisitFile, previewVisitFile, rememberedRegions } from "./import";

// Consultant visit reports as crm_app, with a made-up report in the real layout and a fake Claude.
// Own rows: *.visittest.test, practices 'TEST V ...'.

const SYS = { type: "system" as const, reason: "import" as const };
let paulId = "";
let knownId = "";

async function cleanup() {
  await withActor(SYS, async (tx) => {
    const mine = sql`(select id from crm.contacts where email like '%visittest.test')`;
    await tx.execute(sql`delete from crm.tasks where contact_id in ${mine}`);
    await tx.execute(sql`delete from crm.visits where contact_id in ${mine}`);
    await tx.execute(sql`delete from crm.activities where contact_id in ${mine}`);
    await tx.execute(sql`delete from crm.contacts where email like '%visittest.test'`);
    await tx.execute(sql`delete from crm.companies where name like 'TEST V %'`);
    await tx.execute(sql`delete from crm.import_batches where file_name like 'TEST V %'`);
  });
}

beforeAll(async () => {
  await cleanup();
  [{ id: paulId }] = await rows<{ id: string }>(sql`select id from crm.profiles where lower(email) = 'paul@saveboard.nz'`);
  await withActor(SYS, async (tx) => {
    [{ id: knownId }] = await rows<{ id: string }>(
      sql`insert into crm.contacts (first_name, last_name, email, owner_id, specifier_stage, is_specifier)
          values ('Kim', 'Known', 'kim@studio.visittest.test', ${paulId}, 'specified', true) returning id`,
      tx,
    );
  });
});
afterAll(cleanup);

/** A report in the "Client D" layout, with made-up people. */
async function report(rowsIn: (string | null)[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["ReportGroupD", "Practice", "VisitContact", "PracticeLocation", "Client D ActivityTxt", "Client D CommentSSR", "Phone contact", "webpage", "Predominant", "Workload", "Contact Fullname", "Email", "Type", "Postal Address"]);
  for (const r of rowsIn) ws.addRow(r);
  ws.addRow([]);
  const buf = await wb.xlsx.writeBuffer();
  return buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer.slice(0) as ArrayBuffer;
}

const ROWS = [
  ["Priority Feedback", "TEST V Studio", null, "1 Main St\nTauranga", "saveBOARD sample  provided\n betterBRACE sample  provided", "Kim wants pricing for a 6-unit job starting in November. Please call.", "07 555 0001", null, "Residential", "Busy", "Ms Kim  Known", "kim@studio.visittest.test", "Architects", null],
  ["General Feedback", "TEST V Design Co", null, "2 Side Rd\nHamilton", "saveBOARD brochure(s)  provided", "Had a general chat, no current projects.", "07 555 0002", "www.designco.visittest.test", "Residential", "Quiet", "Mr Lee  New", "lee@designco.visittest.test", "Architectural Designers", null],
  ["General Feedback", "TEST V Design Co", null, "2 Side Rd\nHamilton", "saveBOARD brochure(s)  provided", "Would like a CPD session for the team.", "07 555 0003", "www.designco.visittest.test", "Residential", "Busy", "Ms Ana  Other", "ana@designco.visittest.test", "Architectural Designers", null],
  ["General Feedback", null, null, null, null, "No name or email", null, null, null, null, null, null, null, null],
];

const fakeClaude = vi.fn<VisitActionReader>(async ({ comments }) =>
  /pricing|CPD/i.test(comments)
    ? { needs_follow_up: true, action: /CPD/.test(comments) ? "Book a CPD session" : "Send pricing for 6-unit job", follow_up_date: null }
    : { needs_follow_up: false, action: null, follow_up_date: null },
);

describe("consultant visit reports", () => {
  it("previews what an upload will do, saving nothing", async () => {
    const p = await previewVisitFile(await report(ROWS), { fileName: "TEST V Report August 2026_Northern.xlsx", region: "Northern", month: "2026-08-01", followUps: false });
    expect(p).toMatchObject({ rows: 3, existing: 1, newContacts: 2, alreadyImported: 0, skipped: [{ row: 5, reason: "No contact name or email" }] });
    expect(await rows(sql`select 1 from crm.contacts where email = 'lee@designco.visittest.test'`)).toEqual([]);
  });

  it("history: visits on timelines, new specifiers and practices, no follow-ups and no Claude", async () => {
    fakeClaude.mockClear();
    const r = await importVisitFile({ type: "user", profileId: paulId }, await report(ROWS), { fileName: "TEST V Report August 2026_Northern.xlsx", region: "Northern", month: "2026-08-01", followUps: false }, fakeClaude);
    expect(r).toMatchObject({ visits: 3, existing: 1, newContacts: 2, followUps: 0, newCompanies: 2 });
    expect(fakeClaude).not.toHaveBeenCalled();

    const [kim] = await rows<{ stage: string; company: string; acts: number }>(sql`
      select c.specifier_stage::text as stage, co.name as company, (select count(*)::int from crm.activities a where a.contact_id = c.id and a.type = 'visit') as acts
      from crm.contacts c join crm.companies co on co.id = c.company_id where c.id = ${knownId}`);
    expect(kim).toEqual({ stage: "specified", company: "TEST V Studio", acts: 1 }); // existing stage kept, not downgraded

    const fresh = await rows<{ email: string; first_name: string; last_name: string; stage: string; spec: boolean; owner: string; company: string; segment: string; country: string }>(sql`
      select c.email, c.first_name, c.last_name, c.specifier_stage::text as stage, c.is_specifier as spec, p.email as owner, co.name as company,
             c.segment::text as segment, c.country_code as country
      from crm.contacts c join crm.profiles p on p.id = c.owner_id join crm.companies co on co.id = c.company_id
      where c.email like '%designco.visittest.test' order by c.email`);
    expect(fresh.map((f) => [f.email, f.first_name, f.last_name, f.stage, f.spec, f.company, f.segment, f.country])).toEqual([
      ["ana@designco.visittest.test", "Ana", "Other", "visited", true, "TEST V Design Co", "architect_designer", "NZ"],
      ["lee@designco.visittest.test", "Lee", "New", "visited", true, "TEST V Design Co", "architect_designer", "NZ"],
    ]);
    expect(new Set(fresh.map((f) => f.owner))).toEqual(new Set(["paul@saveboard.nz", "dave@saveboard.nz"])); // alternating NZ pair

    const [act] = await rows<{ subject: string; summary: string; day: string }>(sql`
      select subject, summary, to_char(occurred_at at time zone 'Pacific/Auckland', 'YYYY-MM-DD') as day
      from crm.activities where contact_id = ${knownId} and type = 'visit'`);
    expect(act.subject).toBe("Consultant visit: Northern, August 2026");
    expect(act.summary).toContain("Kim wants pricing for a 6-unit job");
    expect(act.day).toBe("2026-08-31");
    expect(await rows(sql`select 1 from crm.tasks where contact_id in (select id from crm.contacts where email like '%visittest.test')`)).toEqual([]);
    expect(await rememberedRegions()).toMatchObject({ [r.layout]: "Northern" });
  });

  it("uploading the same report again adds nothing", async () => {
    const r = await importVisitFile({ type: "user", profileId: paulId }, await report(ROWS), { fileName: "TEST V again.xlsx", region: "Northern", month: "2026-08-01", followUps: true }, fakeClaude);
    expect(r).toMatchObject({ visits: 0, newContacts: 0, alreadyImported: 3, followUps: 0 });
  });

  it("the latest month with follow-ups: Claude's actions become chase items for the contact's owner", async () => {
    fakeClaude.mockClear();
    const r = await importVisitFile({ type: "user", profileId: paulId }, await report(ROWS), { fileName: "TEST V September 2026.xlsx", region: "Northern", month: "2026-09-01", followUps: true }, fakeClaude);
    expect(r).toMatchObject({ visits: 3, newContacts: 0, existing: 3, followUps: 2 });
    expect(fakeClaude).toHaveBeenCalledTimes(3);
    const tasks = await rows<{ title: string; rule: string; owner: string; email: string; claude: boolean }>(sql`
      select t.title, t.rule, p.email as owner, c.email, t.created_by_claude as claude
      from crm.tasks t join crm.contacts c on c.id = t.contact_id join crm.profiles p on p.id = t.assigned_to
      where c.email like '%visittest.test' order by t.title`);
    expect(tasks.map((t) => [t.title, t.rule, t.email, t.claude])).toEqual([
      ["Book a CPD session", "visit_follow_up", "ana@designco.visittest.test", true],
      ["Send pricing for 6-unit job", "visit_follow_up", "kim@studio.visittest.test", true],
    ]);
    expect(tasks.find((t) => t.email === "kim@studio.visittest.test")?.owner).toBe("paul@saveboard.nz");
  });
});
