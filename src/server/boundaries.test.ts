import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Static checks for CLAUDE.md's hard rules. They scan app source (not tests) so a rule cannot be broken
// by accident in a later change.

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const files = sourceFiles(SRC).map((p) => ({ path: relative(SRC, p).split(sep).join("/"), text: readFileSync(p, "utf8") }));

function offenders(test: (f: { path: string; text: string }) => boolean) {
  return files.filter(test).map((f) => f.path);
}

describe("hard rules", () => {
  it("only src/server/erp reads the erp_read views", () => {
    expect(offenders((f) => !f.path.startsWith("server/erp/") && f.text.includes("erp_read"))).toEqual([]);
  });

  it("never names an ERP cost, password or token field, or an ERP table directly", () => {
    const forbidden = /standard_cost|unit_cost|password_hash|xero_connections|\bpublic\.[a-z_]+/;
    expect(offenders((f) => forbidden.test(f.text))).toEqual([]);
  });

  it("never uses the service role or postgres owner credentials", () => {
    expect(offenders((f) => /service_role|SERVICE_ROLE/.test(f.text))).toEqual([]);
  });

  it("never asks for permission to send mail", () => {
    expect(offenders((f) => /Mail\.Send/.test(f.text))).toEqual([]);
  });

  it("reads mail headers only: the Outlook sync never asks Microsoft for email bodies", () => {
    const sync = files.filter((f) => f.path.startsWith("server/mail/") && /MESSAGE_FIELDS\s*=/.test(f.text));
    expect(sync.length).toBe(1);
    const fields = /MESSAGE_FIELDS\s*=\s*"([^"]+)"/.exec(sync[0].text)?.[1] ?? "";
    expect(fields.split(",").filter((f) => /body|uniqueBody|attachments|bodyPreview/i.test(f))).toEqual([]);
  });

  it("every API route checks a signed-in user or the cron secret", () => {
    const routes = files.filter((f) => f.path.startsWith("app/api/") && f.path.endsWith("/route.ts") && !f.path.startsWith("app/api/auth/"));
    expect(routes.filter((f) => !/requireUser\(|requireAdmin\(|process\.env\.CRON_SECRET/.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("keeps database drivers on the server", () => {
    const dbImport = /from\s+["'](postgres|drizzle-orm[^"']*|@\/server\/db\/[^"']*)["']/;
    expect(offenders((f) => dbImport.test(f.text) && !f.path.startsWith("server/"))).toEqual([]);
    expect(offenders((f) => dbImport.test(f.text) && !/^import\s+["']server-only["'];?$/m.test(f.text))).toEqual([]);
  });
});
