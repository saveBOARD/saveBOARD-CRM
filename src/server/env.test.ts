import { describe, expect, it } from "vitest";
import { databaseUrlSchema, isCrmAppUser } from "./env";

describe("isCrmAppUser", () => {
  it("accepts crm_app locally and through the pooler", () => {
    expect(isCrmAppUser("crm_app")).toBe(true);
    expect(isCrmAppUser("crm_app.abcdefghijklmnop")).toBe(true);
  });
  it("refuses every other role", () => {
    for (const u of ["postgres", "postgres.abcdefghijklmnop", "service_role", "authenticated", "crm_app_admin", ""]) {
      expect(isCrmAppUser(u)).toBe(false);
    }
  });
});

describe("databaseUrlSchema", () => {
  it("accepts a crm_app connection string", () => {
    expect(
      databaseUrlSchema.safeParse("postgresql://crm_app.abcdefghijklmnop:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres")
        .success,
    ).toBe(true);
  });
  it("refuses the postgres owner role", () => {
    const r = databaseUrlSchema.safeParse("postgresql://postgres.abcdefghijklmnop:pw@db.example.supabase.co:5432/postgres");
    expect(r.success).toBe(false);
  });
  it("refuses a missing or non-postgres URL", () => {
    expect(databaseUrlSchema.safeParse(undefined).success).toBe(false);
    expect(databaseUrlSchema.safeParse("https://lfk.supabase.co").success).toBe(false);
  });
});

describe("databaseUrlSchema messages", () => {
  const msg = (v: string) => databaseUrlSchema.safeParse(v).error?.issues[0]?.message ?? "ok";
  it("names the wrong user it found, never the password", () => {
    const m = msg("postgresql://postgres.abcdefghij:S3cretPw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres");
    expect(m).toContain('connects as "postgres.abcdefghij"');
    expect(m).not.toContain("S3cretPw");
  });
  it("explains a password that breaks the connection string", () => {
    expect(msg("postgresql://crm_app.abcdefghij:pa#ss@host:6543/postgres")).toMatch(/not a valid connection string|connects as/);
  });
  it("ignores spaces around the value", () => {
    expect(msg("  postgresql://crm_app.abcdefghij:pw@host:6543/postgres \n")).toBe("ok");
  });
});
