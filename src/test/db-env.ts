import { existsSync } from "node:fs";

// Database tests run against the LOCAL database only. scripts/local-db.mjs writes CRM_TEST_DATABASE_URL to .env.local.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.CRM_TEST_DATABASE_URL;
if (!url) throw new Error("CRM_TEST_DATABASE_URL is not set. Run `npm run db:start` and `npm run db:reset` first.");

const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Database tests only run against the local database, not ${host}.`);
}

process.env.CRM_DATABASE_URL = url;
