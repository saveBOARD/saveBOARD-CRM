# saveBOARD CRM: database migrations

Implements the data model, ERP link and HubSpot load from **saveBOARD CRM: System Design Brief v0.1**.
Target: the ERP's Supabase project (Sydney). Nothing here changes an ERP table, column or row.

## Files and run order

**Live status:** 1 to 5 ran on 5 Oct 2026 (all checks passed); 6 and 7 ran on 6 Oct 2026, both re-run complete on 7 Oct 2026; 8 ran on 7 Oct 2026 (12 checks pass). **9 still to run.**

| # | File | What it does | Touches the live ERP DB? |
|---|---|---|---|
| 1 | `20261003000100_crm_schema.sql` | `crm` and `crm_staging` schemas, `crm_app` role, enums, 17 tables, triggers (updated_at, stage history, activity clock, audit), RLS, grants, settings | No (new schemas only) |
| 2 | `20261003000200_erp_read_views.sql` | `erp_read` schema: read-only, column-limited views over the ERP | **Yes: creates views over ERP tables. Needs Paul's approval.** |
| 3 | `20261003000300_crm_logic_and_views.sql` | ERP deal sync, match suggestions, chase list, company ERP panel, pipeline view | No |
| 4 | `20261003000400_hubspot_staging_and_load.sql` | Staging tables, country/city/owner maps, the contacts and companies loader | No |
| 5 | `20261003000500_seed_profiles.sql` | CRM users (Paul, Mark Atkinson, Iris Lim, Dave Elder) | No |
| 6 | `20261005000100_suggest_matches_definer.sql` | Lets the app run the ERP match suggester (pg_trgm lives in `extensions`, which `crm_app` cannot use) | No |
| 7 | `20261006000100_import_hubspot_contacts.sql` | In-app HubSpot contacts import: one function `crm_app` may run (no direct access to the staging tables) | No |
| 8 | `20261007000100_hubspot_notes_and_consent.sql` | HubSpot notes import, email consent from campaign results, do-not-email list (`crm.email_suppressions`) applied to new contacts | No |
| 9 | `20261008000100_mail_accounts.sql` | Outlook connections: one row per user, the Microsoft refresh token stored encrypted (key in the `MAIL_TOKEN_KEY` app setting, never in the database) | No |
| - | `../scripts/verify_after_migration.sql` | 13 read-only safety checks. Keep it OUT of `supabase/migrations/`. | Read-only |

Files 1 to 5 live in `supabase/migrations/`. Run `supabase db push`, or paste them into the SQL editor in order. All five are idempotent and safe to re-run.

## After the migrations

1. **Set the app role's password** in the Supabase SQL editor (never in a file):
   `alter role crm_app login password '<long random password>';`
   The CRM app and its Claude jobs connect only as `crm_app`. Through the pooler the user name is `crm_app.<project-ref>`.
2. **Run `scripts/verify_after_migration.sql`.** Every row must show `passed = true`. Also confirm in Settings > API that `crm`, `crm_staging` and `erp_read` are **not** in the exposed schemas. Supabase's advisor may warn about "security definer" views in `erp_read`. That is expected: the views must run with owner rights to read the ERP, and the schema is closed to the Data API.
3. **Load HubSpot contacts.** Use `psql` on the *direct* connection (not the pooler):
   ```
   truncate crm_staging.hubspot_contacts;
   \copy crm_staging.hubspot_contacts from 'data/hubspot-crm-exports-all-contacts-2026-10-02.csv' with (format csv, header true)
   select crm_staging.load_hubspot_contacts('hubspot-crm-exports-all-contacts-2026-10-02.csv');
   select * from crm_staging.v_import_report;
   ```
4. **Suggest and review ERP matches:** `select crm.suggest_erp_matches();` then review `crm.erp_match_candidates` (highest score first) and confirm each with `select crm.accept_erp_match('<candidate id>', '<your profile id>');`. Nothing is auto-confirmed.
5. **Schedule the deal sync** (every 15 minutes, and after the ERP's morning Xero refresh): `select * from crm.sync_deals_from_erp();`

## How the app should use it

- Before each write, set who is acting so the audit log is right:
  `select set_config('crm.actor_type', 'user', true), set_config('crm.actor_id', '<profile uuid>', true);`
  (use `'claude'` for Claude jobs). `crm.change_reason` (`manual`, `claude`, `import`) labels stage moves.
- The follow-up rules read their thresholds from `crm.settings` (7 days, 3-day quote expiry, 24-hour first response, 60-day customer check-in). Change them there, not in the view.
- The daily list is `select * from crm.v_chase_list order by priority;`.

## What was tested

Run on a scratch PostgreSQL 16 database built from your ERP schema dump (`saveBOARD_ERP_schema__public_.sql`, RLS enabled on every ERP table as in production), with a handful of sample ERP rows, and your real HubSpot export. It has **not** been run against the live Supabase project.

- All five migrations run cleanly in order, and again a second time (idempotent). The loader re-run updated 5,830 rows and created none.
- The HubSpot load of 5,830 contacts and 4,013 companies took about 0.6 seconds. It matches the brief: 997 with no name, 714 generic mailboxes, 240 with no company, 664 with an activity date, 382 samples sent, 3,749 with a segment, 1,679 reassigned from Mark Stokes to Mark Atkinson.
- ERP views: Katana orders counted once (history wins over the duplicate `sales_orders` row), availability = 90 on hand, 12 committed, 78 available on the test data, deleted customers hidden, no cost columns.
- Deal sync moved stages as designed (quote draft to qualified, sent to quote_sent, accepted to won, declined to lost), wrote stage history, and a second run changed nothing.
- Chase list produced each rule: slow first response, quote expiring, quote unanswered, gone quiet, existing customer check-in.
- Permissions: `crm_app` cannot read any ERP table, cannot edit or delete the audit log; `anon` and `authenticated` cannot see any CRM schema. The verify script fails when a privilege is wrongly granted.

## Known limits and decisions to make

- **Country:** 144 contacts could not be resolved from the country field, email domain, phone prefix or city and are left blank for review. 13 resolve to other countries (UK, Ireland, Jersey, Nigeria).
- **Phones:** 147 of about 2,155 numbers could not be converted to international format (no country, or a local number with no area code). The original is kept in `phone_raw`.
- **No consent data:** the contacts export has no unsubscribe or bounce information. All contacts load as `consent_status = 'unknown'`. Do not send any campaign until the opt-out list is imported.
- **Missing fields in the export:** no Create Date (so `created_at` is the load time). Re-export with it if you want original dates.
- **Not yet loaded:** deals (42), notes (976), tasks (132), calls (66) and companies with no contacts. Export them and stage them in `crm_staging.hubspot_raw`. Loaders can follow once the files exist.
- **Dates:** HubSpot last-activity times are read as Pacific/Auckland. Change the zone in the loader if the HubSpot account uses another.
- **Default owner** for the 510 unowned contacts is Paul Charteris (setting `default_owner_name`). Confirm or change.
- **ERP stock:** `committed`, `expected` and `available` are the CRM's own calculation from the stock ledger. Compare with the ERP's Inventory screen on a few products before relying on them for quoting.
- **Link table:** a company's ERP customers live in `crm.company_erp_links` (one row per entity), so one company can be a customer in both NZ and AUS. This replaces the single `erp_customer_id` field described in the brief's data model table.
- **Writes to the ERP** (create customer, draft quote) are not in these migrations. They need the two small endpoints on the ERP app.
- **Backups:** the CRM shares the ERP's Supabase project, so confirm the plan's point-in-time recovery covers it.
