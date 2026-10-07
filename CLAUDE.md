# saveBOARD CRM

A custom CRM replacing HubSpot for saveBOARD (NZ and AUS). It tracks every enquiry from first contact to an ERP sales order, captures Outlook email and post-call voice notes automatically, and builds a daily chase list so no lead goes quiet. Claude drafts, Paul approves.

Read `docs/DESIGN.md` first. It is the design brief and the source of truth for scope, data model, pipeline and follow-up rules. If this file and the brief disagree, stop and ask.

## Stack

- Next.js app deployed on Vercel (new project, Sydney region, separate from the ERP)
- Supabase Postgres, Sydney. **The same project as the ERP**, in its own `crm` schema
- Microsoft 365 sign-in and the Microsoft Graph API (Outlook only; no Gmail)
- Claude API for summaries and drafts
- Next.js 16 (App Router, TypeScript), React 19, Tailwind v4, lucide-react, clsx, Zod. UI follows `docs/erp-reference/Design.md` (same tokens and patterns as the ERP), except dates: day/month/year (see below)
- Package manager: **npm**. Node 22 or later
- Commands: `npm run dev` (http://localhost:3000), `npm run lint`, `npm run typecheck`, `npm test` (Vitest), `npm run check` (all three; run before every commit), `npm run build`
- Local database (Docker Desktop must be running): `npm run db:start`, `npm run db:reset` (ERP schema + made-up ERP data, then every migration twice, then the verify checks; writes a throwaway `crm_app` login to `.env.local`), `npm run test:db` (integration tests as `crm_app`), `npm run db:stop`. It uses its own Supabase workdir `local-db/` with automatic migrations off; never change `[db.migrations]` in `supabase/config.toml`, because that would make `db push` skip migrations on the live project
- Display formats live in `src/lib/format.ts`. Use them; don't format money or dates inline

@AGENTS.md

## Hard rules (never break these)

1. **Never write to ERP tables.** The CRM reads the ERP only through the `erp_read` views, and changes the ERP only through the ERP app's endpoints (create customer, create draft quote).
2. **Never expose cost or margin.** No `standard_cost`, MO costs or `unit_cost` of any kind, anywhere: not in queries, logs, prompts sent to Claude, or the UI. Also never touch the ERP `users`, `xero_connections` or `audit_log` tables.
3. **Connect to the database only as `crm_app`.** Never use the `postgres` owner role or the service role key in app code. Never grant `crm_app` access to `public`.
4. **Never send email to customers or anyone outside saveBOARD.** Chase emails are created as Outlook drafts for a person to approve and send. Do not request the `Mail.Send` permission. The only email the CRM sends itself is the internal morning digest, through the digest email service, to active CRM users at saveBOARD addresses only (allow-list enforced in code; reworded with Paul's approval, 7 Oct 2026). Do not create ERP customers or quotes without an explicit user confirmation step.
5. **Do not change the live database yourself.** Write migrations and test them locally; Paul runs anything that touches the live Supabase project, and approves any change to the `erp_read` views or roles.
6. **No secrets in the repo.** No keys, passwords, tokens or connection strings in code or commits. Use environment variables. Never commit the HubSpot export, any CSV with customer data, or `.env` files.
7. **Never email a contact without a consent check.** Contacts load as `consent_status = 'unknown'`. Bulk email must not run until HubSpot's unsubscribe and bounce lists are imported.

## Repo layout

```
CLAUDE.md
README.md
data/                    local-only: HubSpot exports and other customer data (git-ignored, never commit)
docs/
  DESIGN.md              design brief (re-export from the Claude doc when it changes)
  erp-reference/         read-only ERP files: schema dump, tables-for-CRM note, overview
supabase/migrations/     the five timestamped CRM migrations, plus any new ones
scripts/                 one-off tools (keep verify_after_migration.sql here, not in migrations/)
src/                     the Next.js app
```

The ERP repo (`saveboard-erp`) is a separate project. It is read-only reference: never edit it from this repo. The two ERP endpoints the CRM needs are built in the ERP repo, in a separate session, reviewed by Paul.

## Database conventions

- Schemas: `crm` (CRM data), `crm_staging` (imports), `erp_read` (read-only ERP views). None of them are in Supabase's exposed Data API schemas. Keep it that way.
- Every ERP object is scoped by **entity**: `'NZ'` or `'AUS'`. NZ and AUS never share customers, products or numbers. Always filter or group by entity. Deals carry an entity and the matching currency (NZD or AUD).
- Link CRM companies to ERP customers through `crm.company_erp_links` using the ERP customer `id` plus entity. Never match on name. A business trading in both countries has two links.
- A quote is a sales order with `status = 'quote'` (`quote_status`: draft, sent, accepted, declined, expired). An order counts as invoiced when `invoiced_on` is set, not by status. A completed sale can appear in both `sales_history` and `sales_orders`: count it once (see the views).
- ERP money: `unit_price` is ex GST, `discount_pct` and `tax_rate` are fractions (0.15 = 15%). Keep each amount in its own currency; never convert silently.
- In code: reads use `db()` from `src/server/db/client.ts`; every write goes through `withActor(actor, tx => ...)` in `src/server/db/actor.ts`, which does the `set_config` below. ERP data is read only through `src/server/erp/`. `src/server/boundaries.test.ts` enforces the hard rules: keep it passing, never weaken it.
- Before any write, set who is acting so the audit log is correct:
  `select set_config('crm.actor_type', 'user'|'claude'|'system', true), set_config('crm.actor_id', '<profile uuid>', true);`
- Follow-up thresholds (7 days, quote expiry warning, first response, 2-month customer check-in) live in `crm.settings`. Change them there, never hard-code them.
- Migrations are idempotent, timestamp-named and forward-only. Never edit a migration that has already run live; add a new one.
- All CRM data access goes through one data-access layer in `src/`, so the `erp_read` views can later be swapped for an ERP API without touching the rest of the app.

## How to work in this repo

- **Plan before code** for anything larger than a small fix: write the plan, wait for approval.
- Build in the order in the brief's *Build phases*. Email capture and the chase list come before the nice-to-haves.
- Test migrations on a local database first (`supabase start`, or a scratch Postgres loaded with `docs/erp-reference/`). Run `scripts/verify_after_migration.sql`: every check must pass.
- **Sign-in:** Microsoft 365 via Auth.js (`src/auth.ts`), single tenant, allowed only for active `crm.profiles` rows matched by email (Entra `oid` saved on first sign-in and enforced after). `src/proxy.ts` only does a quick cookie check; the real check is `requireUser()` / `requireAdmin()` from `src/server/auth/session.ts`, which re-reads the profile every request. Call one of them in every page, server action and route handler that shows or changes CRM data (the `(app)` layout already does). Without the four `AUTH_*` settings the app stays locked. Setup steps: `docs/runbooks/entra-app-registration.md`
- Keep Claude's role explicit in code: it summarises, drafts and suggests; a person confirms. Log every Claude write with `actor_type = 'claude'`.
- Store email **summaries**, subject, date and a link to the message, not full bodies, unless Paul decides otherwise (open item in the brief).
- Capture only what is needed. Captured email and voice notes are personal information under the NZ Privacy Act 2020 and the Australian Privacy Act.
- Use NZ English in the UI and docs, NZ/AU date format (day/month/year), and NZ time (Pacific/Auckland) unless an entity needs otherwise.
- When something in the brief is marked "proposed" or "to confirm", do not treat it as settled. Ask.

## Context

- Users (profiles in migration 5, confirmed 4 Oct 2026): Paul Charteris (main, admin, paul@saveboard.nz), Mark Atkinson (mark@saveboard.com.au), Iris Lim (iris@saveboard.nz), Dave Elder (dave@saveboard.nz). Consultants have no logins. Their Excel visit logs are uploaded.
- Scale is small: about 5,800 contacts, 4,000 companies, a few dozen deals, 2 to 3 users. Prefer simple over clever.
- HubSpot has no workflows to replicate. Its notes were written by a Claude skill, which will be repointed at the CRM.
- ERP overview: `docs/erp-reference/`. The ERP went live 30 Sep 2026 on Next.js, Vercel and Supabase.
