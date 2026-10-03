#!/usr/bin/env node
// LOCAL TESTING ONLY. Runs a local Supabase Postgres in Docker that mirrors the live layout:
// the ERP schema (from docs/erp-reference) with made-up rows, then the CRM migrations on top.
//
//   npm run db:start   start the local database (Docker Desktop must be running)
//   npm run db:reset   rebuild: ERP schema + sample data, migrations twice (idempotency), verify checks
//   npm run db:verify  run scripts/verify_after_migration.sql; exits 1 if any check fails
//   npm run db:stop    stop the local database
//
// Uses its own Supabase workdir (local-db/) where automatic migrations are off, because the ERP tables must
// exist before migration 2. Never point this at the live project: it only talks to the local container.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WORKDIR = join(ROOT, "local-db");
const SUPABASE_CLI = join(ROOT, "node_modules", "supabase", "dist", "supabase.js");
const CONTAINER = "supabase_db_saveboard-crm-local";
const PORT = 54322;
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const ERP_SCHEMA = join(ROOT, "docs", "erp-reference", "saveBOARD ERP schema (public).sql");
// Everything except Postgres itself: the CRM never uses Supabase's API, auth or storage containers.
const EXCLUDE = "gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";

// Docker Desktop's CLI folder is not always on PATH straight after install; add it for this script and the Supabase CLI.
const DOCKER_BIN = "C:\\Program Files\\Docker\\Docker\\resources\\bin";
const ENV = process.platform === "win32" ? { ...process.env, PATH: `${process.env.PATH};${DOCKER_BIN}` } : process.env;
const DOCKER = "docker";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: ENV, ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ ${cmd} ${args.join(" ")} failed`);
    process.exit(r.status ?? 1);
  }
  return r;
}

function supabase(...args) {
  // Run the CLI with Node directly (no shell), so the space in the repo path needs no quoting.
  return run(process.execPath, [SUPABASE_CLI, ...args, "--workdir", WORKDIR]);
}

/** Run SQL as the postgres owner inside the local container. Stops on the first error. */
function psql(sqlText, label, extra = []) {
  const r = spawnSync(
    DOCKER,
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", ...extra, "-f", "-"],
    { input: sqlText, encoding: "utf8", env: ENV },
  );
  if (r.status !== 0) {
    console.error(`✗ ${label}\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  if (r.stderr && /ERROR/.test(r.stderr)) {
    console.error(`✗ ${label}\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
}

function applyFile(path, label = path) {
  psql(readFileSync(path, "utf8"), label);
  console.log(`  ✓ ${label}`);
}

function migrations() {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

function setEnvLocal(values) {
  const file = join(ROOT, ".env.local");
  let text = existsSync(file) ? readFileSync(file, "utf8") : "# Local only (git-ignored). Written by scripts/local-db.mjs.\n";
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(file, text);
}

function verify() {
  const out = psql(readFileSync(join(ROOT, "scripts", "verify_after_migration.sql"), "utf8"), "verify", ["-A", "-t", "-F", "|"]);
  const rows = out.split(/\r?\n/).filter((l) => /\|[tf]$/.test(l));
  let failed = 0;
  for (const l of rows) {
    const [name, passed] = l.split("|");
    if (passed !== "t") failed++;
    console.log(`  ${passed === "t" ? "✓" : "✗"} ${name}`);
  }
  if (rows.length === 0) {
    console.error("✗ verify produced no checks");
    process.exit(1);
  }
  if (failed) {
    console.error(`✗ ${failed} verify check(s) failed`);
    process.exit(1);
  }
  console.log(`  all ${rows.length} checks passed`);
}

function reset() {
  console.log("Resetting local database (empty: automatic migrations are off in local-db/)");
  supabase("db", "reset", "--local", "--yes");

  console.log("Loading the ERP schema and sample data");
  applyFile(ERP_SCHEMA, "ERP schema (docs/erp-reference)");
  applyFile(join(ROOT, "scripts", "local", "erp_bootstrap.sql"), "ERP live-only settings (RLS, indexes)");
  applyFile(join(ROOT, "scripts", "local", "erp_sample_data.sql"), "ERP sample data (made up)");

  for (const pass of [1, 2]) {
    console.log(`Applying CRM migrations, pass ${pass}${pass === 2 ? " (must be idempotent)" : ""}`);
    for (const f of migrations()) applyFile(join(MIGRATIONS, f), f);
  }

  // A throwaway password for the local crm_app role, kept only in .env.local.
  const password = randomBytes(18).toString("base64url");
  psql(`alter role crm_app login password '${password}';`, "set local crm_app password");
  const url = `postgresql://crm_app:${password}@127.0.0.1:${PORT}/postgres`;
  setEnvLocal({ CRM_DATABASE_URL: url, CRM_TEST_DATABASE_URL: url });
  console.log("  ✓ crm_app can log in locally; connection string written to .env.local");

  console.log("Verify checks");
  verify();
}

const command = process.argv[2];
switch (command) {
  case "start":
    supabase("start", "-x", EXCLUDE);
    break;
  case "stop":
    supabase("stop");
    break;
  case "reset":
    reset();
    break;
  case "verify":
    verify();
    break;
  default:
    console.log("Usage: node scripts/local-db.mjs <start|reset|verify|stop>");
    process.exit(command ? 1 : 0);
}
