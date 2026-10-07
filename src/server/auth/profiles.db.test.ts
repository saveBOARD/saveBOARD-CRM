import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { activeProfile, claimProfile, profileByOid } from "./profiles";

// Uses its own throwaway profiles so the real users' microsoft_oid stays untouched.
const run = (q: ReturnType<typeof sql>) => db().execute(q);

async function cleanup() {
  await run(sql`delete from crm.profiles where display_name like 'TEST %'`);
}

beforeAll(async () => {
  await cleanup();
  await run(sql`insert into crm.profiles (display_name, email, role, active) values
    ('TEST Active', 'Test.Active@saveboard.example', 'user', true),
    ('TEST Inactive', 'test.inactive@saveboard.example', 'user', false)`);
});
afterAll(cleanup);

describe("claimProfile", () => {
  it("lets in an active user by email (any case) and saves their Microsoft id", async () => {
    const p = await claimProfile(["TEST.ACTIVE@saveboard.example"], "oid-1");
    expect(p?.displayName).toBe("TEST Active");
    const [r] = (await run(sql`select microsoft_oid from crm.profiles where display_name = 'TEST Active'`)) as unknown as {
      microsoft_oid: string;
    }[];
    expect(r.microsoft_oid).toBe("oid-1");
  });

  it("matches on the Microsoft sign-in name when the email claim is missing", async () => {
    expect((await claimProfile(["", "test.active@saveboard.example"], "oid-1"))?.displayName).toBe("TEST Active");
  });

  it("refuses a different Microsoft account using the same email", async () => {
    expect(await claimProfile(["test.active@saveboard.example"], "oid-2")).toBeNull();
  });

  it("refuses inactive users and unknown emails", async () => {
    expect(await claimProfile(["test.inactive@saveboard.example"], "oid-3")).toBeNull();
    expect(await claimProfile(["stranger@example.com"], "oid-4")).toBeNull();
    expect(await claimProfile([""], "oid-5")).toBeNull();
  });

  it("knows the seeded CRM users", async () => {
    const rows = (await run(sql`select email from crm.profiles where display_name not like 'TEST %' order by email`)) as unknown as {
      email: string;
    }[];
    expect(rows.map((r) => r.email)).toEqual(["dave@saveboard.nz", "iris@saveboard.nz", "mark@saveboard.com.au", "paul@saveboard.nz"]);
  });
});

describe("activeProfile", () => {
  it("drops a user as soon as they are deactivated", async () => {
    const [p] = (await run(sql`select id from crm.profiles where display_name = 'TEST Active'`)) as unknown as { id: string }[];
    expect(await activeProfile(p.id)).not.toBeNull();
    await run(sql`update crm.profiles set active = false where id = ${p.id}`);
    expect(await activeProfile(p.id)).toBeNull();
  });
});

describe("profileByOid", () => {
  it("finds the profile claimed by a Microsoft account, only while active", async () => {
    await run(sql`insert into crm.profiles (display_name, email, role, active, microsoft_oid)
                  values ('TEST OidUser', 'test.oid@saveboard.example', 'user', true, 'oid-claimed')`);
    expect((await profileByOid("oid-claimed"))?.displayName).toBe("TEST OidUser");
    expect(await profileByOid("oid-unknown")).toBeNull();
    expect(await profileByOid("")).toBeNull();
    await run(sql`update crm.profiles set active = false where microsoft_oid = 'oid-claimed'`);
    expect(await profileByOid("oid-claimed")).toBeNull();
  });
});
